# Hill biome world review

Build with `node scripts/build-hill-biome-review.mjs`, then open `output/hill-biome-worlds.html` directly. The HTML embeds all three generated worlds, the game’s terrain and vegetation art, and Pixel Operator fonts. It does not need a server or network connection.

The review starts with the existing world generator and adds experimental desert and forest hill provinces. Hill contours pass through the production relief builder and use the game’s actual ledge and ramp rules. This HTML is a design preview. The approved shapes are now shared with `src/world/hill-shapes.ts`; the game places local districts through `src/world/hill-biomes.ts` before river generation, without applying the preview’s world-wide climate split.

In-game screenshots and validation reports are in `scratch/2026-11-07-hill-biomes-game/`. The implementation adds `Tile.hillBiome` as a local terrain identity, keeps underlying climate fields separate, protects narrow passages from trees and resource deposits, and names the districts in the terrain inspector. `tests/hill-biomes.test.ts` covers deterministic geometry, both ramp levels, ecological openings, resource placement and complete generated worlds. `scripts/check-hill-biomes-game.mjs` exercises normal New World generation and the live renderer/inspector in an ephemeral browser context.

Choose a world and either biome. Drag or use arrow keys to pan; scroll, pinch, or use the zoom buttons to zoom. The overview is clickable. “Whole world” shows the complete generated map. “Find two-level hill” cycles through larger terraced hills in the selected biome. “Lift trees,” “Show ramps,” and “Tile grid” expose the geometry. “Save view PNG” exports the current view.

The second revision reserves occasional larger hills before packing small knolls around them. Larger footprints can use the production two-level relief builder, including separate ramps to each floor. Variable initial scale and growth retain small knolls alongside medium hills and broad terraced landmarks. Both levels are validated with the actual movement rules. The prior viewer is preserved as `scratch/2026-11-07-tiered-hill-biomes/before.html`; the revised standalone artifact also has a stable versioned copy at `output/hill-biome-worlds-v2.html`.

Generated world snapshots, metrics, and visual checks live in `scratch/2026-11-07-tiered-hill-biomes/`. Pass `--reuse-worlds` to the build script to rebuild only the viewer from those snapshots.

Validation:

```
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck --types vite/client dev/hill-biome-review/model.ts dev/hill-biome-review/main.ts
node scripts/check-hill-biome-topology.mjs
node scripts/check-hill-biome-review.mjs
```
