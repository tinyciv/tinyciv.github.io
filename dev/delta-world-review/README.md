# Coastal delta world review

Build with `node scripts/build-delta-world-review.mjs`, then open `output/delta-world-review.html`. The file embeds four complete generated worlds, the same seeds generated with river deltas disabled, and all native game and approved marsh preview artwork. It requires no server or network connection.

The gallery uses the real terrain renderer for world overviews and detailed delta crops. Whole world opens a larger fitted map; its numbered markers lead to delta details. Lift marsh plants exposes the tile layout, Without deltas shows the same seed with delta generation disabled, and the PNG link exports the current view. The comparison is explicitly labeled as a separate generation because settlement retries can differ.

Marsh plant previews use all four approved 32×48 variants, with a 2.45-tile height, 2-tile crown width, and dry land roots. Nearby ordinary vegetation uses the existing game renderer’s sprite selection and depth order. No asset files are installed into production by this review.

The generator, compressed worlds, metrics and browser screenshots are retained in `scratch/2026-11-01-delta-worlds`. Browser checks: `node scratch/2026-11-01-delta-worlds/check.mjs`. `--reuse-worlds` rebuilds presentation only from the recorded maps.
