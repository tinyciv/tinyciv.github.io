# Multicore investigation — 2026-10-30

The production simulation can run in a Web Worker without changing its results.
The experiment produced identical SHA-256 hashes of the complete state after
90 equal simulation steps on both a 600-unit combat fixture and a saved large
settlement. Both threads explicitly used the existing WASM navigation backend.

**Recommendation:** give one persistent worker ownership of simulation, and keep
input, DOM, camera, and drawing on the main thread. First create a compact,
read-only presentation model with deltas and interpolation. The current
`GameState` is too expensive to ship directly for a large settlement. The
experiment is isolated; production threading is not enabled.

## Measurements

Chrome, 1440×900, the same production simulation and renderer. Each frame
comparison ran for 12 seconds. Variable elapsed-time updates follow the current
application's clock; update rate and achieved game speed are reported so that
rendering stale snapshots cannot masquerade as faster simulation.

| Workload | Main-thread engine | Worker with dynamic state snapshots |
| --- | ---: | ---: |
| 600-unit combat: display FPS | 57.4 | 59.9 |
| 600-unit combat: main callback CPU p95 | 22.1 ms | 11.7 ms |
| Large settlement: display FPS | 36.0 | 32.1 |
| Large settlement: main callback CPU p95 | 50.6 ms | 36.3 ms |
| Large settlement: achieved game speed, requested 2× | 1.97× | 1.89× |

The first worker split helps the smaller combat workload but makes the large
settlement's display and simulation throughput worse. It is not ready to enable
in the game. Main callback cost alone is insufficient: message deserialization
also runs on the main thread, and cloned state invalidates rendering caches.

For the large settlement, p95 non-compute round-trip overhead was 42.4 ms for a
full snapshot, 10.8 ms when retaining unchanged terrain, and 0.5 ms for a
transferred packed unit buffer. The packed buffer is a transport experiment:
it lacks the buildings, fields, equipment, fog, and other data required by the
production renderer. It does not establish an end-to-end FPS improvement.

A fresh production profile attributed about 77% of sampled time to simulation
and 18% to drawing. `findPath` accounted for about 3%, including roughly 1.4%
in WASM. A pathfinding-only worker pool therefore has limited potential on this
settlement. Different workloads can have a different distribution.

## Proposed production boundary

1. Simulation worker owns state, RNG, economy, movement, combat, pathfinding,
   fog discovery, and save serialization. Preserve the existing sequential
   interactions between soldiers and factions inside this owner.
2. Main thread sends ordered commands with sequence IDs. The worker validates
   construction, capture, research, and resource costs authoritatively.
3. Keep static terrain resident in both contexts. Publish changed tile/building
   records, low-frequency city/UI summaries, and reusable transferable buffers
   for unit poses and effects. Apply records to stable view objects.
4. Make rendering read-only. `Renderer.draw` currently invokes `updateFog`, which
   mutates exploration/memories and rebuilds simulation-derived views. Publish
   those visibility products from the worker instead.
5. Interpolate unit poses while rendering independently. Track snapshot age,
   completed updates, command latency, and backlog. Bound in-flight messages;
   do not let commands or snapshots accumulate without limits.
6. Once that split is measured, consider a small background pool for expensive
   topology rebuilds or batched path searches. Tag every asynchronous result
   with topology revision and order sequence; discard stale results. A pending
   route must not be treated as an unreachable destination.

Splitting factions or individual soldiers into workers now would change combat
and collision semantics: each unit currently observes previous units' mutations
and immediately refreshes shared spatial, fog, and population indexes.

## Browser/deployment notes

The tested local Chrome environment supported workers and OffscreenCanvas but
was not cross-origin isolated and did not expose SharedArrayBuffer. Ordinary
[worker messages and transferable buffers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
are sufficient for the proposed first split. Shared memory would add
[cross-origin isolation requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer).

Vite supports [module worker bundles](https://vite.dev/guide/features.html#web-workers).
An actual VSCode extension webview has additional
[worker loading restrictions](https://code.visualstudio.com/api/extension-guides/webview#using-web-workers);
the user's preview container should be tested before deploying. A localhost
page inside a preview is not necessarily an extension-owned document.

## Reproduce

```sh
npm run dev -- --port 5187 --strictPort
node scripts/benchmark-multicore.mjs --url=http://127.0.0.1:5187/
npx vitest run tests/multicore-snapshot.test.ts
```

The runner uses an isolated browser and a local copy of the saved settlement.
It never connects to the user's active game. It verifies complete-state parity,
measures four transport modes, and compares production drawing and simulation.
Reports and CPU profiles are in `scratch/2026-10-30-multicore/`.

Files: `simulation.worker.ts` owns the real engine, `protocol.ts` defines RPC,
`snapshot.ts` defines transport/digests, and `client.ts` runs the experiments.
The six persistent tests cover serialization, buffer ownership/reuse, world
patches, deterministic simulation, ordered requests, and error recovery.
