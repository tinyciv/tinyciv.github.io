# Packed rock texture and ore overlays

Revised review art based on the user's rocky terrain screenshot. Preview in
Storybook under **Tiles / Contiguous Ore / Rock texture & separate ore layers**.
The earlier slab candidates remain available for comparison. Candidate 1 and
the shared ore layers are now copied into `public/assets/resources/outcrops/`
for the game renderer. The other candidates remain review alternatives.

- **1:** coarse packed gray rocks, generated at 64px, for the 16px art grid.
- **2:** simpler packed-rock treatment at 64px, for the same 16px grid.
- **3:** finer shading at 128px, compared on the 32px grid and reduced to 16px.

The imagegen tool extracted a rock-only reference from the user's screenshot.
PixelLab generated the native rock textures from that reference. Copper pixels
were selected from a PixelLab edit of the first rock texture. PixelLab generated
the iron flecks directly on transparency. All styles use the same ore layers.
The ore remains separate from the stone, so the material can be reused.

## Assets

`N-stone.png` is the repeating material. `copper-overlay.png` and
`iron-overlay.png` are the two canonical transparent ore layers. Tile the base
and selected overlay at the same origin and scale, then alpha-composite the ore
onto the stone. The overlay dimensions are 64×64 at the 16px art grid; use 2×
for the 32px grid. `N-copper-overlay.png` and `N-iron-overlay.png` are ready-sized
copies for the candidate previews. `N-copper.png` and `N-iron.png` show the result.

The generator's unwanted two-pixel outer frame is cropped from the source
material, which is restored to its original size by nearest-neighbor sampling.
Only the terminal pixel rows and columns are copied between opposite borders
to make their profiles match. The irregular interior is preserved without
mirroring. Exactly the same crop, edge matching and scale apply to the overlays.
There are no phase atlases or per-mask material variants.

`-repeat.png` shows a 2×2 repetition. The `-blobs.png` previews clip the material
to four irregular deposits using the existing PixelLab contour alpha from the
first review. `-blobs-native.png` preserves native resolution. No simulation is
started. All stone and ore imagery is tool generated; scripts only crop, select,
repeat and composite generated pixels. `source.json` records prompts and jobs.
