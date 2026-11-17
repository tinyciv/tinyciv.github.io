# Geothermal landscape sprites

All three jagged volcanoes (`volcano-a/b/c.png`) and all three hot mud pools
(`mud-pool-a/b/c.png`) were generated with PixelLab using existing game buildings
as style context. Each sheet has nine horizontal 32×32 RGBA frames. Original
generated pixels are unchanged.

Native feature IDs are 1–3 for volcano A/B/C, and 4–6 for mud pool A/B/C.
The complete canvas occupies a 2×2-cell footprint at the same pixel scale as
32×32 buildings. All four cells block walking and construction. Volcano frames
last 140 ms, mud pool frames 180 ms; playback loops with a position-based phase.

See `source.json` for provenance, prompts and hashes. Placement is owned by
`rust/src/sim/geothermal.rs`; art loading and rendering are in
`src/game/geothermal-art.ts`. These are natural scenery, without damage,
harvesting, ownership or construction actions.
