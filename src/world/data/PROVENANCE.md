# Terrain training data

Made with Natural Earth. The checked-in `ne_110m_land.geojson` is the Natural Earth
1:110 million land layer, from the pinned v5.1.2 release:

https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson

Publisher: https://www.naturalearthdata.com/downloads/110m-physical-vectors/

License: **public domain**, including modification and commercial use:
https://www.naturalearthdata.com/about/terms-of-use/

SHA-256 of the checked-in original:
`9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`.

`python3 src/world/data/build_samples.py` regenerates `earth-samples.ts` using
even/odd polygon scan conversion, sampled at cell centers on a 0.5-degree grid.
The twelve 64 × 64 samples cover named real geographic windows. Their exact
south/west coordinates are embedded in the generated file. No network access or
GIS dependency is needed to reproduce the derived data.

The game extracts 24 × 24 patches, augments each with all four rotations, scores
candidate overlap agreement and a broad continental prior, then stitches the
chosen patches with minimum-error overlap seams. Coastline geometry is therefore
resampled from real land/water data, rather than just a thresholded noise map.
A narrow ocean edge and removal of isolated one-cell artifacts are gameplay
postprocessing. The seed controls patch selection and every subsequent step.

Limitations: the source is a generalized landmask, **not elevation or climate
observations**. Temperature/moisture, vegetation, rivers, and lakes are
procedural. Rivers use a coast-directed, least-cost valley
drainage potential on cardinal neighbors, with tributaries merging on first
contact to maintain one-tile-wide channels. Lakes retain wider irregular basins;
they are not a physically calibrated erosion model. The continental prior and
small settlement clearings favor an accessible RTS map over geographic accuracy.
Generation retries if it cannot place six separated capitals and five rival
second cities on the same walkable component. Each rival's second site favors
nearby usable ground, and small development maps scale the separation distance.
This is a compact image-quilting implementation inspired by
multi-point simulation, not a full geostatistical MPS solver.

The retired hill and mountain overlays are no longer generated. Native raised
plateaus use ledge and stair metadata instead. Each plateau and its two-cell
surrounding apron share one grassland or desert palette; overlapping aprons are
harmonized together without changing waterways or the stair geometry.
The previously reviewed LPC Overworld sheets remain in `public/assets/lpc-overworld`
with their artist credits and license for reference.

Ocean-facing land receives coherent sandy beach stretches from a separate seeded smooth field, ranked to cover approximately half of shoreline tiles. Beaches extend one to three cells inland and receive sparse native palm scenery. This coastal decoration happens after drainage and settlement selection; it does not replace the underlying Natural Earth coastline or affect navigable water geometry. Rendered ocean colors use distance-to-land fields and original Puny World transition tiles, not bathymetry data.
