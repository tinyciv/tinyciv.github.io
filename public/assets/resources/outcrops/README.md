# Natural resource outcrops

Production copper, iron and gold now use the approved mountain silhouettes in
`../mountain-ore/`, rendered by `src/game/ore-art.ts`. This directory supplies
loose rubble in the game. The joined stone texture and mineral overlays remain
available in the visual studies below. Quarries draw one complete stone formation per deposit using the existing mountain artwork.

The archived joined stone style uses `stone.png`, the approved coarse
PixelLab texture from `stories/assets/rock-texture-overlays/1-stone.png`.
Copper and iron remain independent transparent overlays. `loose-rocks.png`
contains eight PixelLab-generated gray stones in 16×16 cells: four tiny pebbles
on the top row and four small rocks below. `source.json` records the prompts,
generation job, component crops, packing and file hashes.

`src/game/outcrop-art.ts` supplies presentation only:

- Stone and loose-rock sheets are brightened by 32% once at load time. Copper
  and iron overlays are composited afterward and retain their original colors.
- Eight-neighbor occupancy and shared seeded noise define an irregular contour
  on the native 16px grid. Only exposed edges are clipped; filled interiors and
  texture coordinates continue across cells. Smooth occupancy interpolation,
  a lower coverage threshold and reduced edge noise keep the visible blobs
  fuller and their connections wider without adding new resource cells.
- The exposed contour has a thin dark keyline, an inner upper/left highlight
  and a shaded lower/right face. A narrow translucent earth contact layer and
  small pebble shadows anchor the rock against the terrain. All shading follows
  the shared contour, including samples beyond the tile boundary; internal tile
  joins receive no border. Fully surrounded interiors bypass the effect.
- World seed and tile coordinates fix the result. No simulation random stream
  is consumed and nothing changes while the camera moves or time advances.
- A sparse one-cell ring of rubble uses the generated loose-rock sprites.
  Pebbles sit nearer the deposit with varied sizes and offsets. An isolated
  boulder receives fewer companions than a long face or concavity.
- Rubble stays wholly inside clear land cells, avoiding resources, vegetation,
  creeks and water. The renderer also skips farms, roads and all buildings.
  Its source deposit must have been explored before the rubble is visible.
- Contour, rim and ground-contact layers share a 512-entry cache; noise fields
  have a four-entry cache. Pebble shadow alpha is derived once from the generated
  sprite sheet. These are runtime shading effects, not new painted art assets.
  NativeArt retains the baked resource sprites. The rubble index is rebuilt on
  world appearance changes; exploration filters that index and updates only
  resource joins. Frame rendering uses lookups and cached art.

Developed copper and iron use only the original timber doorway and dark tunnel,
extracted once from `resource-objects.png`. The old ore mound, gray jambs and sill
are excluded. The 10×8 doorway fits inside the current contour towards its foot;
its vertical placement is cached with the contour. Fully filled cells use a
fixed lower anchor. Both ores share the frame and retain their own new texture.
Resource identity, resource cells, movement, collision, yield and mining are
unchanged.

Storybook: **Tiles / Contiguous Ore / Natural outcrops & loose rocks**, plus
different-seed and developed-mine views. They use the production drawing code
without starting the simulation.

**Mine doorways · new ore surface** shows copper and iron entrances at a cluster
edge and on a single-cell outcrop, at native and 4× sizes.

**Edge treatments · before & after** compares identical stone layouts with
`flat`, `rim`, and `grounded` shading.
