# Road and irrigation dragging research

The strongest first improvement is a shared, locally invalidated gesture preview. Irrigation still runs the general construction planner and global context checks during dragging. Roads already have a specialized display path and incremental purchases.

## Measured behavior

Independent browser replays used the captured 843-population world, its original viewport, configured 3× speed, and pointer movement at approximately 8 Hz. The audited construction files match the frozen release4 source used for these runs. Each replay lasted roughly 30 seconds; no gameplay implementation was changed.

| Metric | Road | Irrigation |
| --- | ---: | ---: |
| Average RAF throughput | 34.3 FPS | 25.2 FPS |
| Frame work, p95 | 50.7 ms | 81.0 ms |
| Pointer-event work, p95 | 8.8 ms | 41.2 ms |
| Final pointer move + release | 19.5 ms | 61.6 ms |
| Preview cells / newly purchased cells | 6 / 6 | 10 / 2 |

These are different legal strokes in the same world. Each tool has one unprofiled run, and the numbers do not establish an identical-route comparison. Pointer-event percentiles exclude frames without pointer input and the first active frame. FPS measures RAF throughput. Roads finished purchases and deferred cleanup 1.51 seconds after release began; irrigation purchased synchronously.

A separate 15.5-second irrigation CPU profile attributed approximately 2.06 seconds inclusive and 1.30 seconds self time to `constructionPreviewContext`, the largest individual self-time entry. `placementOccupancy` accounted for 493 ms inclusive, `irrigationConnects` 167 ms, and `constructionPreviewState` 62 ms. Inclusive times overlap. This profile supports prioritizing repeated dependency scans and indexed reads. Its overhead makes its frame and release timings unsuitable for the table above.

Machine-readable measurements, source hashes, reproduction details, and raw artifact paths are in [construction-drag-research-2026-11-09.json](construction-drag-research-2026-11-09.json).

## How dragging works

1. `main.ts:460` converts the pointer to a tile and requests a route when the endpoint changes. Stationary routes reconsider state every 350 ms. `main.ts:949` quotes the route for the cost display; pointer events can repeat this even within the same tile. `renderer.ts:461` maintains another quote cache on a separate 3 Hz clock.
2. `construction-route.ts:43` first tries a cardinal staircase between the endpoints. Rejected direct paths trigger a local search, with up to six attempts of 650 expansions. The search sorts its open array on each expansion and can return a valid shortened prefix.
3. `construction.ts:124` uses a private transaction to reserve eligible cells and subtract their prices. Roads and irrigation grow from a connected end, so reverse drags work. Failed cells cannot seed disconnected extensions.
4. `construction-display.ts:30` gives roads a private view excluding friendly crops, a local dependency context, and memoized reads. Road previews are optimistic about farm relocation; each actual purchase checks relocation live. Irrigation uses the ordinary exact planner, global signatures and commit tokens.
5. `main.ts:1213` queues single-player road purchases. Each later step attempts one tile, then staffing and rates run in later phases, including while paused. Irrigation refreshes its authoritative route and calls synchronous `buildStroke` on release. Multiplayer continues through authoritative build commands.

## Recommended implementation order

1. **Share one gesture result.** Keep the requested endpoint, route, accepted cells, rejection reasons and price in one result used by input, the HUD and rendering. Coalesce pointer events to the latest position and calculate at most once per frame. Refresh release input before committing. Preserve camera-relative pointer handling.
2. **Scope irrigation preview dependencies.** Introduce an irrigation read-only display scope that retains farm records. Reuse indexed occupancy throughout one calculation and omit unused purchase tokens from UI work. Track nearby terrain, ditches, occupancy, access, leader, research and treasury dependencies. The present global building/field serialization is the clearest measured target.
3. **Index connections and keep a stable frontier.** Maintain living ditch and road cells, with a small overlay for planned cells. Find connected pending cells through neighbor lookups. Current repeated `pending.findIndex` and building scans can approach O(stroke² × buildings). Preserve the existing deterministic pending-cell order, reverse growth and blocked-gap behavior.
4. **Queue irrigation purchases.** Share the bounded purchase scheduler with tool-specific rules, applying live placement and payment per accepted cell. Irrigation needs no farm relocation reservations. Bound bookkeeping as well as the number of purchases. Allow cleanup turns between queued strokes so continuous orders cannot postpone staffing indefinitely while paused.
5. **Retain preview rendering data.** `renderer.ts:456` copies the full building occupancy map for every frame containing a ghost; the new map identity invalidates building-depth caching. Retain a small ghost overlay keyed by route and occupancy revisions. Cache irrigation highlight cells against the relevant route, field and visibility changes.
6. **Improve fallback routing after the preview changes.** Use a stable heap and reusable search buffers. Skip road/wall network reservations for irrigation. Keep the last valid route when its endpoint and geometry remain unchanged. Longer searches can yield under a frame budget while the previous preview remains visible.

Irrigation coverage already answers farm queries through a bitmap. Its all-building scan could eventually use ditch-specific revisions, but `prepareIrrigation` accounted for only about 9 ms in the short profile, making it a lower priority here. Farm relocation can still make an individual road purchase expensive; resumable read-only relocation planning is a later option for larger crop-crossing strokes.

## Gameplay and feedback

- Irrigation connects cardinally to rivers, lakes, or any living ditch, including pending and other-faction ditches. New dry-land cells cost 35 gold. Existing friendly ditches and freshwater cells are free stroke cells.
- Irrigation shares friendly road and farm tiles, preserves crops and vegetation, and performs no farm relocation. Completed ditches provide a non-stacking two-tile circular benefit: 2× farm yield normally and 3× on desert. There is no ongoing water-flow requirement after placement.
- Keep the requested endpoint visible when a route stops short, with its blocking reason. Show requested and affordable lengths separately so price changes do not silently reshape the intended route.
- Retain pending outlines after release and show purchase progress. Report partially accepted strokes explicitly. Cancellation should stop remaining unpaid cells and allow cleanup and saving to finish.

Relevant implementation: `src/main.ts`, `src/game/construction.ts`, `src/game/construction-route.ts`, `src/game/construction-display.ts`, `src/game/construction-preview-cache.ts`, `src/game/road-purchase.ts`, `src/game/irrigation.ts`, and `src/game/renderer.ts`.
