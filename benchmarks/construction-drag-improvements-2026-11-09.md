# Road and irrigation drag improvements

Implemented shared gesture previews, local irrigation cache dependencies, indexed connectivity, queued irrigation purchases, retained ghost/highlight geometry, and explicit progress/cancellation feedback.

| Captured 843-population world at 3× | Before | After |
| --- | ---: | ---: |
| Road average FPS | 34.1 | 39.7 |
| Irrigation average FPS | 22.6 | 35.8 |
| Road frame work, p95 | 48.3 ms | 45.8 ms |
| Irrigation frame work, p95 | 88.4 ms | 50.3 ms |
| Road final pointer update + release | 14.9 ms | 17.7 ms |
| Irrigation final pointer update + release | 66.4 ms | 13.4 ms |

The irrigation stress replay, changing its endpoint every frame, averaged 37.9 FPS. All replays purchased the expected six road cells or two ditch cells without browser errors. The final ordinary irrigation purchase and cleanup completed 0.91 seconds after release began; road completion took 1.33 seconds. These scheduled operations keep pending outlines visible and permit cancellation of unpaid cells.

Some simulation frames still exceed 33.3 ms. These results demonstrate smoother dragging, not a locked 30 FPS guarantee. Each condition has one replay; exact percentages are subject to runtime variability. Frame rate measures RAF throughput. Pointer handling now records input for the shared draw callback, so total frame work is the useful comparison.

## Implementation

- `construction-gesture.ts` shares a single quote across the HUD and renderer. Pointer movement is coalesced; release samples the latest endpoint and live dependencies. Stationary quotes refresh at 3 Hz.
- `construction-display.ts` separates route geometry from affordability in private UI views. Treasury changes keep the route stable while accepted cells and price feedback update. Irrigation preserves farm and road layers and uses a reserved-cell overlay without rebuilding a speculative world or ECS.
- `construction-preview-cache.ts` maintains separate local UI contexts, preventing optimistic road results from leaking into authoritative planners. Relevant local terrain, structures, access and leader changes invalidate the quote.
- `irrigation.ts` indexes ditch connections. `road-purchase.ts` provides `createLinearPurchase` with a stable connected frontier and live per-cell placement/payment. Roads retain full-stroke crop reservations; irrigation keeps crops in place.
- `main.ts` schedules purchases and cleanup across frames, including while paused. Cleanup finishes between strokes. Pending outlines, affordable/requested counts, blocked endpoints and partial completion messages explain the outcome. Escape stops remaining unpaid cells and lets reconciliation/save finish.
- `construction-presentation.ts` retains ghost occupancy and irrigation coverage graphics. Existing building-depth caches survive unchanged ghosts. All game text retains the existing Pixel Operator styling.

## Checks and reproduction

The production build and focused gesture, preview, routing, connectivity, purchase, presentation and layering suites passed. Browser scenarios covered 200 coalesced pointer events, funds changing from 70+ to 35 gold without route movement, paused completion of two ditches for 70 gold with all crops unmoved, and cancellation after one 5-gold road purchase. The full repository suite was not run.

The browser interaction script is `benchmarks/construction-gestures.mjs`. The frame replay supports `--drag-kind=road|irrigation` and `--pointer-interval=125` (or 0 for an endpoint change every frame).

Both measured source copies preserve the same concurrent unrelated gameplay changes. Only construction changes differ. Source manifests, raw artifact paths, full measurements, environment and method are recorded in [construction-drag-improvements-2026-11-09.json](construction-drag-improvements-2026-11-09.json).
