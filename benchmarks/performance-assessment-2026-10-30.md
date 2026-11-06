**BTV performance assessment — October 30, 2026**

The highest-return strategy is to reduce repeated simulation work, make state ownership and cache invalidation explicit, and then separate simulation from presentation. Keep the existing compiled pathfinder. Optimize Canvas's repeated drawing and large terrain surfaces before deciding whether a GPU renderer is necessary. A selective Rust/WASM simulation core is a credible later investment; a language-only rewrite is not supported by the measurements.

A realistic initial target is **1.3–1.7× comparable-work throughput (about 23–41% less CPU time)**, with materially better worst-frame behavior, from combined simulation and Canvas changes. That is a planning estimate, not an implemented result. A deeper data-oriented simulation/Rust redesign could plausibly reach **1.4–2.5× whole-frame throughput** on the current simulation-heavy settlement. These envelopes overlap: do not multiply them. Tenfold gains are plausible for individual repeated queries, but there is no evidence for a tenfold whole-game improvement from Rust, WebGPU, or more cores alone.

**What was reviewed and measured**

Reviewed production simulation, rendering, UI, world generation, persistence, navigation and the existing company/multicore experiments. No production code was changed. Existing uncommitted work was preserved. Files changed externally during the review, so the final measurements use a copied source snapshot captured at approximately 08:09 Pacific, with SHA-256 hashes. An earlier palace-defense hotspot had already been fixed by that point and is not recommended here as an outstanding uncached scan.

Fresh runs used an Apple M3 Pro, Chrome 156, headless, 1440×900, DPR 1 unless specified, Vite development serving, existing AssemblyScript WASM enabled. Benchmarks ran sequentially, although this shared machine was not otherwise controlled. These are local measurements, not universal hardware predictions or production-build GPU timings. Rendering timings measure synchronous browser/Canvas work; they do not measure completion of all GPU/compositor work. The final source snapshot and raw results are in [the review directory](../scratch/2026-10-30-holistic-performance/); compact records are in [the benchmark summary](performance-assessment-2026-10-30.json).

| Fresh measurement | Result | Interpretation |
| --- | --- | --- |
| Frozen saved settlement, 30 s, requested 2× speed | 24.12 ms mean frame work: 19.27 simulation, 4.77 drawing; 40.49 RAF callbacks/sec; achieved 1.986× game speed | About 80% simulation and 20% drawing |
| Same run's frame tails | p95 42.1 ms; p99 119.5 ms; maximum 272.6 ms | Average FPS hides substantial stalls |
| Same run, first two recorded seconds excluded | 23.46 ms mean; p95 37.6 ms; p99 114.1 ms; maximum 195.8 ms | Stalls persist after cold-start activity |
| Separate frozen 20 s run with CPU sampling | 21.12 ms mean; 46.38 FPS | Run-to-run workload/timing variation is significant; this is not an optimization A/B |
| Sampled CPU in frozen run | updateGame 75.91%, draw 18.57%, findPath 3.30%, GC self 1.35% | Sampling includes time outside frame work; inclusive categories overlap |
| Static saved view, zoom 1, DPR 1 | 5.89 ms draw mean, 2,451 Canvas drawImage submissions, 1,115 clips | Isolated draw test, not whole-frame FPS; calls counted across Canvas contexts, not GPU draws |
| Same view, production minimum zoom 0.65, separate run | 9.41 ms draw mean, 5,191 Canvas drawImage submissions, 1,285 clips | Graphics are materially more expensive at the normal widest view |
| Same view, zoom 0.55, artificial stress test | 11.64 ms draw mean, 6,155 Canvas drawImage submissions, 1,536 clips | Wider than the production minimum zoom of 0.65 |
| Same view, zoom 2 | 1.95 ms draw mean, 566 Canvas drawImage submissions | Visible scene density matters strongly |
| DPR 2 versus DPR 1 at zoom 1 | 6.14 versus 5.89 ms draw mean | Little gain from lowering DPR in this CPU submission test; GPU/display results remain unmeasured |
| New default world, three fixed seeds | generation 253–323 ms; createGame 1,158–1,300 ms | Game setup costs more than geographic generation here |
| First draw of a new default world, one sample after assets ready | 861 ms | Cold terrain/palette/fog/cache preparation; excludes network image loading |
| Large-state JSON serialization, five samples | 18.9–20.7 ms; 7,785,916 characters | Synchronous autosave can consume a frame |
| Large-state structuredClone, five samples | 23.7–25.0 ms | Object transfer is expensive before any simulation work |
| Isolated localStorage write of that serialization | QuotaExceededError | Current save catches and suppresses failures; large saves need a different storage path |

The settlement began with 1,036 units, 1,706 buildings and 1,524 fields on a 224×176 map. The final unprofiled run ended with 1,026 units, 1,790 buildings and 1,536 fields. Variable elapsed-time steps mean repeat runs can reach different states. FPS references in these headless tests mean frame-callback cadence; physical display/compositor presentation was not measured.

| Frozen fixture | Simulation mean | Drawing mean | Total p95 |
| --- | ---: | ---: | ---: |
| Idle 100 units | 0.57 ms | 1.90 ms | 3.1 ms |
| Idle 300 units | 1.58 ms | 2.22 ms | 4.4 ms |
| Idle 600 units | 3.70 ms | 3.13 ms | 7.6 ms |
| Combat 100 units | 1.89 ms | 1.99 ms | 5.2 ms |
| Combat 300 units | 4.31 ms | 2.41 ms | 7.7 ms |
| Combat 600 units | 9.49 ms | 3.29 ms | 15.5 ms |

Both 600-unit fixtures sustained 60 RAF callbacks/sec in separate runs. These scaling controls deliberately suppress ordinary economy/expansion and keep soldiers alive with high HP; the combat-600 direct sample averaged only about 23 recently fighting units. Their 112×88 map is much smaller than today's **274×216 default**; a stale fixture comment says it matches the default. They are not a substitute for long live-settlement runs or dense fully engaged battles.

Existing measured optimizations must not be counted as new gains. [The October 29 comparison](navigation-wasm-2026-10-29.json) already showed 2.51× faster A* route batches but only 20.51→18.51 ms whole-frame work, or **1.108×**. Spatial buckets, typed-array A*, cached connectivity, terrain caching, fog dirty uploads, sprite palette caches, a throttled HUD and viewport culling are already implemented.

**How to read the estimates**

All multipliers below are engineering estimates unless explicitly called measured. A multiplier of 1.25× means the same work takes 20% less time; it does not mean a 25% CPU-time reduction. Whole-frame estimates refer to a simulation-heavy settlement like the measured one, with the same game speed and features. The affected-work column is deliberately separate from whole-frame impact. Confidence concerns the opportunity, not a guarantee of the exact range. Effort is approximate engineering work including validation: small = days; medium = roughly 1–3 weeks; large = several weeks; very large = potentially months.

For an accelerated fraction p and local speedup s, whole-frame speedup is `1 / ((1 - p) + p / s)`. At an 80/20 simulation/render split:

| Change in isolation | Whole-frame work speedup |
| --- | ---: |
| Simulation twice as fast | 1.67× |
| Simulation three times as fast | 2.14× |
| Drawing twice as fast | 1.11× |
| Drawing five times as fast | 1.19× |
| Drawing made free | 1.25× theoretical ceiling |
| Eliminate all findPath work at the sampled 3.3% share | Approximately 1.034× ceiling |

The last bound applies to `findPath`, not all movement, reachability, collision, contact selection or navigation preparation. Those consume substantially more time elsewhere. Inclusive profiler entries must not be added together. FPS is additionally limited by refresh rate, scheduling and GPU work; reducing 10 ms to 5 ms on a 60 Hz display may leave measured FPS at 60 while creating useful headroom.

**Simulation and data model options**

| Option | Affected-work estimate | Whole-frame estimate | Effort / confidence |
| --- | --- | --- | --- |
| Persist entity/building/city indexes; invalidate by actual dependency revisions | 2–10× selected index/reconciliation work | 1.08–1.25× | Medium / high |
| Event-driven farms, residents, workforce and timed expiry | 3–20× selected housekeeping | 1.05–1.15× | Medium / high |
| Cache morale/perception/target decisions; integrate effects continuously | 2–6× selected decision work | 1.05–1.18× | Medium / medium; reaction cadence changes |
| Cache stationary formations and maintain membership | 2–10× formation work | 1.02–1.05× | Small–medium / high |
| Persistent combat contact slots and indexed reservations | 2–5× contact selection | 1.02–1.06× | Medium / medium |
| Persistent occupancy/congestion and ranged occlusion grids | 2–10× setup; 5–20× individual occluder construction | 1.01–1.08× | Medium / high |
| Incremental visibility and shared sight results | 2–5× affected visibility work | 1.02–1.04× | Medium / medium |
| Stagger/budget city planning and placement candidates | 1–2× planning mean; spread bursts | 1.00–1.04× mean; larger possible tail benefit | Medium / high |
| Fixed 20–30 Hz simulation with interpolation and slower decision clocks | 1.2–1.8× simulation work per real second, depending on starting cadence | 1.15–1.50× | Medium–large / medium; behavior must be revalidated |
| Typed arrays for hot components, pooled scratch storage and numeric keys | 1.2–2× suitable loops | 1.08–1.30× | Large / medium |
| Company-level orders, sleeping settled troops, shared routes | 1.5–4× affected military work | 1.1–1.5× here; greater future army capacity | Very large / low; gameplay architecture changes |
| Aggregate distant civilian economy / coarse remote simulation | 2–10× affected remote work | 1.3–3× only if remote work becomes dominant | Very large / low; simulation fidelity tradeoff |

Specific implementation targets:

- [stepGame](../src/game/simulation.ts#L1730) calls many reconciliation systems every substep. [synchronizeFarms](../src/game/farms.ts#L178) normalizes residents and scans faction buildings before its cache check; [ensureCollectors](../src/game/farms.ts#L383), harvests and builders recreate maps and rosters. Trigger membership work on births/deaths, building completion, capture, resident moves and research changes. Use due-time queues or time buckets for harvest, spoilage, research and stump expiry rather than scanning everything to discover that nothing is due. Preserve exact event times where gameplay needs them.
- [beginUnitFrame](../src/game/spatial.ts#L54) constructs maps, entries, arrays and building buckets, then discards them at the end of the step even though incremental unit updates already exist. Keep the index alive. Static building data should follow a structure revision, not `state.time` or a newly allocated array identity. Retain deterministic ordering where query tie-breaking affects play.
- Cache building-to-city assignment and city aggregates once for governor, defense and UI consumers. The snapshot's [palaceDefenses](../src/game/palace-capture.ts#L35) already has a defense index, but invalidates it every timestep and when the buildings array is replaced. Keep live references for HP/activity checks while invalidating membership only when ownership/geometry changes.
- [updateMorale](../src/game/simulation.ts#L925) took 6.61% inclusive sampled CPU; [retinueFormation](../src/game/formation.ts#L147) 4.48%; [synchronizeFarms](../src/game/farms.ts#L178) 4.38%. These are larger opportunities than the compiled A* kernel. Share local threat counts, retain stationary rally goals, and immediately wake decisions on orders, damage, deaths and topology changes.
- [faction development](../src/game/faction-development.ts#L172) already runs major planning at six/thirty-second intervals; [faction strategy](../src/game/faction-strategy.ts#L222) already throttles strategic thinking. The remaining issue is pre-check scanning and synchronized planning bursts. Budget candidate evaluation, cache failed placement searches until inputs change, and spread independent cities across steps.
- [main.ts](../src/main.ts#L746) ties simulation updates to requestAnimationFrame. A 120 Hz display may drive more housekeeping than a 60 Hz display. Separate clocks and interpolate rendering. At requested 2× speed, 20 wall-clock updates/sec already means 0.1 game-second steps, the current maximum; going slower merely causes internal substeps and cannot be credited as free savings. At the existing ~40 FPS, going to 30 Hz saves less than halving a true 60 Hz simulation.
- Allocation contributes index-construction time and cache disruption, but GC self time was only 1.35%. Eliminating GC alone would not deliver a dramatic gain. Keep hot numeric fields separate from optional jobs/orders, use reusable previous-position buffers, and avoid filtering/replacing unchanged entity arrays every step.

**Navigation options**

| Option | Affected-work estimate | Whole-frame estimate here | Assessment |
| --- | --- | --- | --- |
| Civilian empty-occupancy fast path and cached palace↔farm/trade routes | 2–10× route setup/repeated searches | 1.01–1.05× | Good early experiment; medium effort |
| Shared destination flow fields / route corridors | 3–20× repeated searches after amortization | 1.01–1.03× from A* alone; possibly more from removed setup | Useful at army scale; medium–large effort |
| Hierarchical regional/portal routing | 2–10× long searches | 1.00–1.03× from A* alone | Larger maps first; large effort |
| Dirty regional topology and reusable access classes | 2–10× selected rebuilds | Small typical mean gain; potentially large construction/destruction tail benefit | Medium–large effort |
| Sparse query masks/stamps in WASM; integer paths with cursor | 1.1–2× affected short-query/path maintenance work | Usually under 1–2% | Small–medium, measure query mix |
| Async path worker pool only | Depends on batch size; can regress for tiny queries | Approximately 1.00–1.03× ceiling from current findPath share | Low priority for this settlement |
| Rust port of the current AssemblyScript A* | Roughly 0.8–1.5× kernel; may regress | Approximately unchanged, usually under 1% | Low return |

The code already has stamped scratch arrays, a heap, per-faction connectivity, reusable WASM terrain and intentional JS fallbacks for cheap live occupancy queries. Do not replace these with a fresh full-unit serialization per request.

[Workers and merchants ignore unit collisions](../src/game/collisions.ts#L9), but [movementCongestion](../src/game/engagement.ts#L99) can still scan every unit for their requests. Bypass that work and cache their relatively stable routes by faction/access/topology. Military routes need dynamic local avoidance; a shared flow field is a global direction guide, not a guarantee of passage through occupied gates. Include target movement, terrain costs, gates and ownership in invalidation.

[Contact reservations](../src/game/engagement.ts#L31) are repeatedly converted to local sets, while ranged attack checks construct tower/wall exclusion data from all buildings. Index claims by cell and target, and maintain an occluder grid. These changes attack the surrounding costs that a faster A* loop misses.

The WASM wrapper clears three whole-world query arrays: roughly 394 KB per supported query on a 224×176 map. Stamps/sparse reset are worth testing for short routes. Large search improvements such as HPA* are credible scaling options, but their published speedups do not transfer automatically to BTV. Ordinary Jump Point Search assumes uniform costs; this game has roads, forests, fords and dynamic congestion. [The original HPA* paper](https://webdocs.cs.ualberta.ca/~mmueller/ps/2004/hpastar.pdf) and [weighted JPS research](https://ojs.aaai.org/index.php/AAAI/article/download/26458/26230) support experiments rather than a drop-in recommendation.

The [company laboratory](../dev/company-lab/README.md) already explores cached fields, persistent formations and bounded recovery. It is promising architecture evidence, not an apples-to-apples production speedup: collision rules, maps, economy/fog and combat differ; its nominal 720-soldier browser runs measured roughly 525–588 living soldiers. Port one mechanism at a time and measure completed journeys, waiting, overlap and battle outcomes as well as CPU.

**Graphics, memory and UI options**

| Option | Affected-work estimate | Whole-frame estimate | Effort / confidence |
| --- | --- | --- | --- |
| One inland clearing draw; cache coastal masks/composites | 3–10× clearing work | 1.02–1.05× | Small / high |
| Persistent render indexes, cached connections and city label layout | 2–10× selected preparation | 1.01–1.05× | Small–medium / high |
| Dirty ground/road/crop chunks plus cached water frames | Combined Canvas renderer 1.3–2.5× | 1.05–1.14× settlement; more when zoomed out | Medium / medium |
| Native-resolution terrain backing surface | Exactly 4× fewer backing pixels at 16 versus 32 px/tile | No guaranteed steady-frame gain; major memory/startup opportunity | Small–medium / high memory confidence |
| Bounded terrain chunks and local dirty updates | Large reduction in dirty-region work when edits are distant | Primarily memory, initial draw and p99; workload dependent | Medium / high |
| WebGL2 atlas/instanced sprite batching | 2–5× rendering CPU plausible | 1.11–1.19× current settlement; about 1.2–1.45× in a render-heavy zoomed-out mix | Large / medium |
| WebGPU instead of an already good WebGL2 renderer | Roughly 0.9–1.3× rendering | Usually 0–4% additional overall | Large / low; no demonstrated need today |
| Lower/dynamic DPR | Up to 4× fewer pixels for 2→1, not 4× total rendering | Negligible in measured CPU test; potentially useful on fill-limited hardware | Small / conditional |
| Minimap 10–20 Hz; diff HUD DOM updates; cache previews | 2–6× these small subsystems | Usually under 1–3%; preview-heavy interactions may benefit more | Small / high |
| Demand-driven paused/hidden rendering | Potentially over 90% less idle frame work if nothing animates | No active-play FPS gain | Small / high |

[renderer.ts](../src/game/renderer.ts#L288) redraws each full building clearing through surrounding tile clips: typically nine draws for a 1×1 footprint or sixteen for 2×2. Even dry inland cells pay transform/clip overhead. The frozen profile attributes 3.29% inclusive CPU to `clipFarmToLand`; fix repeated draws before rewriting the renderer.

The renderer also reconstructs remembered-building indexes, field maps and preview maps each frame. Cache by explicit presentation revisions, maintain stable view objects, cull before city-summary work, and update economic text less often than moving sprites. Animated water advances at 3 Hz but is submitted every frame; cached water-frame chunks avoid rebuilding the same quads. Cache construction validation by pointer tile, tool, resources and topology rather than solving it on every draw.

The default world allocates a terrain surface at 8,768×6,912 pixels: **231.2 MiB of raw RGBA storage for one surface**, before browser/GPU copies. The original terrain raster is 16 px/tile; retaining that resolution gives **57.8 MiB**, with the same nearest-neighbor final display if coordinates are adjusted consistently. A full-world water mask adds about 14.45 MiB. Chunks can bound resident working memory further. The current incremental terrain painter uses one bounding rectangle for edits, so two distant changes can cause almost whole-map repainting. Separate terrain, structure and ownership revisions and track dirty chunks.

Tall vegetation/buildings deliberately share depth ordering with units. Bake ground layers, not every tall object into one background; preserve crop/foliage occlusion and remembered fog appearances. Canvas2D may already be hardware accelerated. The GPU renderer recommendation is about batching thousands of sprite/state submissions and shader-based masks/palettes, not assuming all existing pixels are painted in JavaScript. [MDN Canvas optimization](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) documents pre-rendering repeated content; [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) documents batching. These establish techniques, not the estimated BTV multipliers.

**Multicore and Rust options**

The existing [multicore experiment](../dev/multicore-lab/README.md) is unusually useful evidence. One worker running the real simulation preserved complete state after 90 identical updates, but its dynamic snapshots made the large settlement **slower**: 35.98→32.06 displayed FPS and achieved game speed 1.975×→1.885×. Combat improved 57.36→59.90 FPS. Main callback p95 improved in both, which alone would have hidden the settlement regression.

Measured settlement non-compute round-trip p95 was **42.4 ms for full state**, **10.8 ms for dynamic state**, and **0.5 ms for a transferred packed unit buffer**. The packed case excludes buildings, crops, equipment, fog and other production rendering inputs; it proves a transport direction, not a complete-game speedup. Worker snapshot age reached p95 168 ms, and cloned objects increased renderer preparation costs.

| Architecture | Expected benefit | Effort / qualification |
| --- | --- | --- |
| One simulation worker, compact deltas/pose buffers, main-thread renderer | Simulation compute remains about 1×; roughly 1.0–1.25× scheduling/throughput benefit, much better input responsiveness. 60 Hz interpolated display is plausible even when simulation is slower. | Large; rebuild ownership/presentation boundary first |
| OffscreenCanvas renderer worker, simulation on main | Approximately 1.05–1.20× pipelined critical-path benefit if communication stays cheap; similar total CPU | Large; rendering ownership and asset initialization change |
| Simulation and renderer together in one worker | Frees main thread for DOM/input with minimal full-state transfer; does not parallelize simulation versus drawing | Medium–large alternative when responsiveness is the priority |
| Two/four-worker job system with deterministic resolve/commit | Perhaps 1.3–2.5× simulation, or 1.2–1.9× whole-frame equivalent | Very large / low confidence; not an automatic core-count multiplier |
| SharedArrayBuffer over efficient reusable transferables | Often only 0–5% additional throughput here; can reduce copying/jitter | Medium; useful only after measuring transport as a remaining limit |
| Coarse Rust/WASM kernels with resident numeric data | 1.5–3× selected kernels; 1.1–1.5× overall if they cover 30–50% of frame work | Large / medium–low; prototype against optimized TypeScript |
| Full Rust/WASM simulation and data redesign | Speculative 1.5–4× simulation; 1.4–2.5× overall at 80% simulation share | Very large / low; upper range includes architecture gains |
| SIMD for dense field/grid/math passes | 1.2–3× suitable kernels; normally a few percent overall initially | Medium / low until vectorizable fraction is measured |
| GPU compute for visibility/fields/crowd work | No justified present-game gain; dispatch/readback may regress performance. Large dense future workloads could accelerate substantially. | Very large; keep outputs GPU-resident where possible |
| Native Rust desktop engine | No defensible BTV-specific multiplier yet. It can remove web deployment constraints and enable a different renderer/threading model, but would be a platform rewrite. | Very large; do not budget it as an extra multiplier on top of Rust/WASM |

The preferred first boundary is one authoritative simulation owner for RNG, jobs, movement, economy, combat, visibility/memories, command validation and saves. The main thread owns camera, input, DOM and read-only presentation. Keep terrain resident; publish changed terrain/building/field records, reused unit/effect buffers and low-frequency city/UI summaries. Apply records to stable render objects. Include tick/command/topology IDs, interpolate position, bound messages and report snapshot age. Rendering currently calls `updateFog`, so simulation-derived fog state must move behind this boundary too.

Ordinary [transferable ArrayBuffers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) move their backing storage rather than clone its contents. Buffer ownership/recycling still needs coordination. [SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) requires a secure cross-origin-isolated document; the tested existing environment lacked that capability. Start with transferables. [OffscreenCanvas](https://web.dev/articles/offscreen-canvas) permits worker drawing, but merely moving work does not make that work cheaper.

Splitting factions or soldiers into workers directly is not safe as a mechanical optimization: each unit currently sees earlier units' immediate mutations and refreshed spatial/fog indexes. True parallel simulation needs read/propose/resolve/commit phases, deterministic conflict handling and spatial boundary handling. Initially parallelize pure batches: topology rebuilds, candidate placement scoring, route batches and visibility calculations. Discard asynchronous results whose order/topology versions are obsolete; pending work must not be interpreted as failure.

Rust will help most when it owns long-lived numeric state and executes whole phases. Export commands in batches and expose a packed presentation buffer. Passing rich JS objects or repeatedly serializing full GameState across the boundary can consume any kernel gain. Do not port Canvas calls to Rust one sprite at a time and expect batching benefits. Benchmark an equivalent TypeScript typed-array implementation as a control: some apparent language gains are really data-layout and algorithm gains. No save-migration or backward-compatibility work is required for this proposal.

**Loading, saving and deployment**

Replace synchronous full-state localStorage persistence with compact durable state in IndexedDB and serialization owned by the simulation worker. Avoid saving derived caches where they can be reconstructed safely. The isolated large-state quota failure is an observed correctness issue, not just a hypothetical performance risk. Current fifteen-second autosave can spend about 20 ms preparing data even when the eventual write fails. Moving serialization off the main thread removes that stall, but total serialization work remains unless the data format changes.

World generation, createGame and first terrain preparation should run in a worker or be split into explicit loading phases. A worker mainly improves responsiveness; faster startup requires cached/static products, native-resolution terrain, reduced initial reconciliation and potentially batched construction of indexes. Prototype a 2–3× reduction in setup work rather than claiming it is already achievable from language alone.

Production bundling, appropriate compression/cache headers, essential-asset preloading and lazy loading of unused sprite variants can improve download/startup. They do not accelerate an already-running simulation. Public assets total about 5.3 MB on disk, but that is not a measurement of bytes actually transferred to a player. Measure a production build with cold and warm caches before assigning a download-time gain. CSS/DOM replacement or an engine/framework switch has no demonstrated large steady-state payoff; focus on the concrete hot paths.

**Recommended sequence and acceptance criteria**

1. Establish a stable benchmark set and instrument phase times, decisions/searches, cache rebuilds, allocations, save duration and snapshot age. Track CPU ms per simulated second, not just ms per displayed frame. Include current 274×216 worlds; existing stress fixtures and saved worlds are smaller.
2. Implement persistent indexes/dependency revisions, event-driven reconciliation, stationary formation reuse, civilian routing fast paths, and staggered city planning. In parallel, fix clearing overdraw and terrain surface size. Combined target: 1.3–1.7× comparable-work throughput, with fewer 40–100 ms stalls. This target requires measurement and is not the product of the row estimates.
3. Move saves to reliable asynchronous storage; separate presentation data from authoritative state. Add a fixed simulation clock and interpolation only with explicit gameplay checks. Then trial one simulation worker against the identical command stream.
4. If zoomed-out rendering remains expensive, build a WebGL2 batching proof of concept preserving occlusion/fog. If simulation remains expensive, prototype one broad Rust/WASM kernel with resident state. Choose the winner from complete-frame and per-game-second measurements, including interface costs.
5. Invest in company-level simulation, multiworker resolution or a full Rust core when the desired world/army scale justifies a redesign. Treat them as alternative architectures, not independent switches whose gains can be multiplied.

For implementation-only changes, require fixed-step state digests and the existing navigation/movement/fog/capture tests. For changed cadence or company semantics, require behavioral invariants: no prohibited military overlaps, preserved civilian pass-through rules, bounded waiting at gates, valid unreachable-order recovery, correct resource totals, no hidden information leaks, and comparable battle/arrival outcomes. Test idle settlements, battles, mass move commands, narrow crossings, coast/forest views, long construction drags, topology destruction, autosave, cold/new/load transitions, and 1×/2×/4× speed at 60/120 Hz. Measure DPR 1/2 and real target browsers/hardware, including the intended embedded preview if applicable.

Run several repetitions in randomized order without concurrent benchmark/test load. Separate warm-up from steady state, retain p50/p95/p99/max, and use long enough runs to encounter planning/economy/autosave periods. Preserve visual captures for depth/occlusion changes. A worker result only passes if authoritative simulation keeps up and command/snapshot latency stays bounded; 60 FPS of stale state is not success.

Reproduction uses the existing `scripts/profile-live-state.mjs` and `scripts/profile-engine.mjs`; the new review-only `scratch/2026-10-30-holistic-performance/audit-extra.mjs` measures zoom/DPR draw submission, serialization, generation and first draw. The frozen source manifest records input/source hashes. No optimization has been implemented by this review, so the estimated speedups still require controlled A/B validation.
