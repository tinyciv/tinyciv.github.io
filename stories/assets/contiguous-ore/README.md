# Contiguous stone and ore review

PixelLab-generated candidates, previewed at **Tiles / Contiguous Ore** in Storybook.
These assets are pending style selection under `skills/visuals.md` and are not
loaded by the live game renderer.

- **1A–1C:** 16px, broad stone planes, copper orange flecks, charcoal iron flecks.
- **2A–2C:** 32px, more detailed material; previews also show reduction to 16px.
- **3A–3C:** 16px, simplified cartoon material and a rougher eroded rim.

The original round stone from `public/assets/resources/resource-objects.png`
was the material reference. PixelLab generated filled stone surfaces and the
connected contour sets, then larger continuous stone textures. Copper and iron
are PixelLab edits of those textures. Selecting the generated mineral pixels
preserves identical stone planes and silhouettes across all three materials.
The original copper and iron sprites are shown only for comparison.

Every set contains all 16 corner masks and 64 material phases. The larger
material prevents repeating one shaded boulder or facet in every game cell.
Mirrored repetition of generated pixels makes opposite material seams match.
The green background was removed using its generated palette. All contour
pixels are PixelLab output; no rock or mineral pixels were hand drawn.

## Files and placement

`N-material.png` is a 4×4 corner-configuration sample. `N-material-texture.png`
is the repeating material. `N-material-autotiles.png` is the full atlas with
16 columns of corner masks and 64 rows of material phases. For a tile at `(x,y)`:

```text
mask = NW + 2*NE + 4*SW + 8*SE  (1 = stone corner, 0 = empty)
phase = (y mod 8)*8 + (x mod 8)
sourceX = mask * tileSize
sourceY = phase * tileSize
```

Sample occupancy at shared vertices so adjacent tiles agree on their corners.
Render with nearest-neighbor sampling and use the same world-coordinate phase
for all materials. The blob scenes use compact, concave, narrow-neck and small
deposits. `-blobs.png` is native resolution; `-game-scale.png` uses the game's
16px art grid. `source.json` records generation IDs, processing and file hashes.
