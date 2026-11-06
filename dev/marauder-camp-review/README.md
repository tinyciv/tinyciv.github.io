# Compact marauder camp review

Build the self-contained review with `node scripts/build-marauder-camp-review.mjs`, then open `output/marauder-camp-review-compact.html` (also written to `output/marauder-camp-review.html`). No server or network access is needed. This is a visual proposal; the production camp generator is unchanged.

The selected Blackroot revision has a dedicated review at `output/marauder-warcamp-tight.html`. It compares map area with the previous 25 × 25 warcamp, retains three irregular defensive tiers, and includes a tile-grid toggle for inspecting wall width. Native wall sprites and junctions remain clipped to one cell; layout validation rejects duplicate wall cells and solid 2 × 2 wall/gate blocks.

The revised designs use only tents, wooden walls (including their timber gate pieces), guard towers, wooden signs, and roads on native game ground. Each tent occupies one tile and has a clear door immediately south. Towers share wall cells; gates occupy actual openings. Validation checks overlaps, signs beside rather than on routes, physical access, and minimum gate depth into each defensive tier.

Rendering uses the game's native terrain raster, dirt paths, and faction-only umber palette. Timber runs, corners, and open gate frame 5 are exact source rectangles from the purchased Puny Medieval atlas. No houses, halls, supply props, fires, targets, trees, or people are drawn. The original sprite scale is unchanged; compactness comes from smaller plans and tighter lanes. Each plan records its previous dimensions for an area comparison.

Lossless source crops in `art/`:

- `palisades.png`: `[2640, 96, 160, 64]`
- `lookouts.png`: `[2656, 320, 64, 32]`

Source: `scratch/2026-10-28-puny-medieval/pack/PUNY-WORLD-PAID_v1/punyworld-atlas.png`. These two crops retain the purchased project-use license. Tents use the free world atlas rectangle `[64,416,16,16]`. Three signs use `[112,480,16,16]`, `[128,480,16,16]`, and `[144,480,16,16]`, with native footing `[8,15]`. `assets.json` records only the allowed asset set. The build embeds the world atlas and the two timber crops.

The gallery supports tier highlighting, tile grids, area labels, lifting outer defenses, native/game zoom, and full-resolution PNG export. `scripts/check-marauder-camp-review.mjs` checks compactness, wall thickness, allowed assets, offline loading, layout topology, controls, exports, and responsive rendering. The latest QA artifacts are in `scratch/2026-11-01-warcamp-tight/`, alongside the archived previous gallery and warcamp image. Earlier compact-gallery QA is in `scratch/2026-11-01-marauder-camps-compact/`.
