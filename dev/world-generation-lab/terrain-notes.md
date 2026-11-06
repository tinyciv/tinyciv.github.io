# Terrain patterns and their limits

This generator uses statistical ideas from landscape research to arrange playable terrain. A tile is not assigned a fixed real-world distance, and the simulation is not an empirically calibrated erosion model. Forest coverage, frequency bands, hill size, and route spacing are gameplay parameters.

## Evidence behind the design

- **Ridges and valleys have regional structure.** Perron, Dietrich, and Kirchner modeled competition among drainage basins and found a characteristic valley spacing rather than unconstrained random topography. Their first-order model basins had width-to-length ratios of about 0.3–0.9. We use this as a reason to align and cluster nearby landforms, not to equate a game hill with a real drainage basin. [Controls on the spacing of first-order valleys (2008)](https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2007JF000977)
- **Mountain-front drainage has a repeatable relative scale.** Hovius measured eleven mountain belts and reported mean catchment length-to-width ratios mostly between 1.91 and 2.23, with structural exceptions. This motivates coherent mountain axes with interruptions and transverse routes. It does not prescribe an exact number of game tiles between passes. [Regular spacing of drainage outlets from linear mountain belts (1996)](https://onlinelibrary.wiley.com/doi/pdf/10.1111/j.1365-2117.1996.tb00113.x)
- **Forest patches span many sizes.** A global remote-sensing study found patch-area distributions with power-law exponents in a relatively narrow range, approximately 1.90–2.01. The game therefore combines broad woodland regions, smaller groves, and fine boundaries instead of placing equally sized circular forests. We do not claim that the generated map fits that exponent. [Power laws and critical fragmentation in global forests (2018)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6288094/)
- **Topography and water availability influence forests.** A Montana watershed study combining 308 tree cores, lidar, and vegetation-index measurements found higher growth with increasing topographic wetness. The generator increases woodland suitability near freshwater and in locally concave terrain while retaining forests on usable upper hill and mountain floors. This is a simplified hydrological proxy, not a species growth model. [Hillslope Topography Mediates Spatial Patterns of Ecosystem Sensitivity to Climate (2018)](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1002/2017JG004108)

## Implemented construction

`createTerrainEnvironment` supplies deterministic, dimensionless moisture, woodland suitability, ruggedness, and a local terrain axis. Relief and vegetation share these signals. Broad domain-warped provinces contain directional ridge bands; woodland combines three nested spatial frequencies. Freshwater proximity and local elevation concavity affect moisture.

The approved sample #20 default woodland thresholds are **0.5668 on ordinary ground** and **0.7068 in desert**; desert groves also need moisture above **0.43**. These numbers tune the game’s density rather than estimate a real biome. These thresholds now define a regional woodland envelope, rather than filling every suitable tile with a tree. Seeded thinning initially occupies 58–68% of suitable cells, with wetter core areas receiving more trees. Removal-only safeguards then eliminate fully wooded 2×2 blocks and ensure every remaining tree adjoins traversable, unwooded ground. This creates lower-density woodland with openings throughout it, rather than solid canopy with only a few large clearings. Overall coverage still responds to climate and woodland settings instead of being forced to a global quota. Review measurements include coverage and the local opening guarantees across multiple seeds.

Forest placement happens after ledges and passes. Trees can occupy valid upper floors at either elevation tier. Full cliff cells, stair cells, their upper/lower approaches, mountain pass cells, beaches, and each palace’s immediate 5×5 clearing remain free of forest. The same existing Medieval World tree assets and climate families render both lowland and upland woodland.

## Climate and compact lakes

`sampleTerrainClimate` supplies a smoothly warped warm belt. The default equator is **75.85% down the map**, with a configurable belt width of **0.2423 map heights**. Warmth gently reduces moisture and raises the chance that a dry cell becomes desert. Regional and local noise remain active, so wet equatorial patches and occasional dry northern pockets survive. North lies at the top of the map. Woodland suitability has an additional northward bias, and tree families and coastal palms use the same equator and belt-width settings. These are artistic/gameplay controls, not a literal global climate model: the map represents a cool northern region extending into a warm belt, rather than both full hemispheres.

The climate controls expose equator position/width, latitude strength, regional variation, patch size, background moisture and desert threshold. Woodland controls expose density threshold, patch size, northern preference and freshwater moisture boost. The relief field has a separate province-size control. Actual forest placement still preserves cliffs, stairs, passes and city clearings.

Freshwater lakes are **81.1% compact / 18.9% snaky candidates** by default, sampled independently; no snaky lake is required on an individual map. Both size and number are adjustable. Compact lakes have gently irregular oval shores and must pass an actual cell-geometry check: both their principal-axis aspect ratio and axis-aligned bounding-box aspect ratio are no greater than the configured maximum, **1.5773:1 in the approved sample #20 preset**. Smaller requested maxima create rounder basins. Compact lakes spread across viable inland regions, favoring distance from existing basins rather than repeatedly choosing the deepest interior. All lakes must stay connected and inland. Long snaky basins are harder to fit, so their accepted share can be below their candidate weight.

## Connected geography and gameplay

The production pipeline now places visible relief before rainfall and drainage. A priority-flood surface resolves inland depressions; lake surfaces share a spillway and accumulated rainfall controls river width. Raised tiers contribute to the same elevation field used for climate and soil. Rivers preserve the authored two-tile ledge apron and stair landings, so coastal cliffs and waterfalls still require separate artwork.

A deterministic east/west wind transports ocean moisture, raises rainfall on windward slopes and dries the lee. Coastal moderation and elevation influence temperature. Nine ecological classifications reuse existing ground and tree families. Soil fertility changes actual farm harvests; wetlands, tundra and alpine country change movement costs consistently in route selection and physical movement. Resource provinces produce clay, iron, stone, salt and fish, which establish local trade specialties. Initial settlements preserve local ground and consider freshwater; rival second cities use overland distance. Wildlife and rare named discoveries use habitat and geographic context.

These remain game-scale approximations. There is no erosion simulation, seasonal climate, water transport, new wildlife species or new terrain artwork. The measurements below describe historical revisions and are not current baselines.

## Historical measured comparison

These measurements compare the previous terrain revision, before the configurable latitude and compact-lake changes. Nine deterministic maps use `CROWN`, `NEW-HORIZONS`, and `BTV-world-modes-review`, each in Continents, Pangaea, and Fractal mode, at 274×216 tiles. The baseline snapshot precedes the shared environment and ecology changes, after the thinner ranges and tiny hill shapes were introduced. Values below are means across the nine maps, except the wooded upper-floor share, which pools floor counts.

| Measure | Before | After |
| --- | ---: | ---: |
| Woodland / dry land | 23.4% | 42.0% |
| Open interior / dry land | 8.6% | 4.6% |
| Open-cell distance to cover, 90th percentile | 4.9 tiles | 4.3 tiles |
| Forest patches per map | 451 | 250 |
| Largest forest patch per map | 323 tiles | 1,787 tiles |
| Wooded share of walkable upper floors | 21.7% | 40.8% |

“Open interior” means dry, unwooded, unraised ground with a Manhattan distance of at least five tiles to water, forest, or raised terrain. Its area fell by 47.1%. This is a game-layout measure of broad clearings, not an ecological field statistic. Forest patches use cardinal connectivity. Larger connected stands contain small clearings and coexist with smaller groves; the measured patch-size distribution has not been fitted to the published power-law exponent.

The numerical evidence and bundled generator snapshots are in `scratch/2026-10-30-slim-mountains/landscape-before.json` and `landscape-after.json`, with adjacent `.snapshot.mjs` files. Reproduce current measurements with `node scripts/measure-world-landscape.mjs`.

At the time of that comparison, production mountain bands were 4–5 tiles across (previously 13–15), with unchanged length and ground-level passes. The showcase was six tiles across (previously 17). Integer rounding made these approximately one-third width. The narrowest crests are impassable ledge; wider crests have valid ramp-connected upper floors. Hill silhouettes include full 2×2 corner outcrops, 2×3/2×4/2×5 strips, rectangles in both orientations, and larger clipped shelves. Tiny closed outcrops cannot support trees or structures because every tile is a cliff; larger usable floors can.
