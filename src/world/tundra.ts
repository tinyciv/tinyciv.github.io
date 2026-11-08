import { harmonizeRidgeTerrain } from './ridges';
import { applySoilFertility } from './soil';
import { createNoise2D } from 'simplex-noise';
import { WATER, type World } from '../game/types';
import { environmentRandom } from './environment-fields';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';
import { treeClimateLatitude } from './tree-climate';
import { terrainYields } from './generator';

/** Coherent polar regions, with a gently wandering rather than ruler-straight edge. */
export function applyTundra(world: World, parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): void {
  const noise = createNoise2D(environmentRandom(`${world.seed}:tundra`));
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const tile = world.tiles[y * world.width + x];
    if (WATER.has(tile.terrain) || tile.beach || tile.resource === 'salt' || tile.resource === 'stone') continue;
    const latitude = treeClimateLatitude(y, world.height, parameters);
    const edge = .98 + noise(x * .025, y * .025) * .19 + noise(x * .09 + 37, y * .09) * .045;
    if (latitude < edge) continue;
    const old = terrainYields(tile.terrain, tile.overlay);
    tile.terrain = 'tundra'; tile.biome = 'tundra';
    delete tile.palm; delete tile.marsh; delete tile.desertStone;
    if (tile.overlay === 'jungle') tile.overlay = 'forest';
    if (tile.overlay === 'forest') tile.treeClass = 'snowy';
    const next = terrainYields(tile.terrain, tile.overlay);
    for (const resource of ['food', 'production', 'gold'] as const)
      tile[resource] = Math.max(0, tile[resource] + next[resource] - old[resource]);
  }
  harmonizeRidgeTerrain(world);
  for (const tile of world.tiles) {
    if (tile.terrain === 'tundra') {
      tile.biome = 'tundra'; delete tile.palm; delete tile.marsh; delete tile.desertStone;
      if (tile.overlay === 'forest' || tile.overlay === 'jungle') tile.treeClass = 'snowy';
    } else if (tile.biome === 'tundra') tile.biome = 'taiga';
  }
  applySoilFertility(world);
  // No altitude-only snow or snowy trees surviving on warm terrain.
  for (const tile of world.tiles) if (tile.terrain !== 'tundra' && tile.treeClass === 'snowy') tile.treeClass = 'conifer';
}
