import { applySoilFertility } from './soil';
import { createNoise2D } from 'simplex-noise';
import { WATER, type World } from '../game/types';
import { environmentRandom } from './environment-fields';
import { longitudeClimate } from './longitude-climate-native';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';
import { terrainYields } from './generator';

/** Signed distance in tile rows from the irregular edge of either polar cap. */
export function tundraBoundary(world: World): (x: number, y: number) => number {
  const noise = createNoise2D(environmentRandom(`${world.seed}:tundra`));
  const span = Math.max(1, world.height - 1);
  const columns = longitudeClimate(world.width);
  return (x, y) => {
    const edge = .12 + columns[x].tundraEdge
      + noise(x * .025, y * .025) * .022 + noise(x * .09 + 37, y * .09) * .008;
    return Math.min(y, world.height - 1 - y) - edge * span;
  };
}

export function applyTundra(world: World, _parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): void {
  const distance = tundraBoundary(world);
  const stoneFringe = new Uint8Array(world.tiles.length);
  world.tiles.forEach((tile, cell) => {
    if (tile.resource !== 'stone') return;
    const x = cell % world.width, y = Math.floor(cell / world.width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height) stoneFringe[ny * world.width + nx] = 1;
    }
  });
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const tile = world.tiles[y * world.width + x];
    if (WATER.has(tile.terrain) || distance(x, y) > 0) continue;
    if (stoneFringe[y * world.width + x] && !tile.beach) continue;
    const old = terrainYields(tile.terrain, tile.overlay);
    tile.terrain = 'tundra'; tile.biome = 'tundra';
    delete tile.beach; delete tile.palm; delete tile.marsh; delete tile.desertStone;
    if (tile.overlay === 'jungle') tile.overlay = 'forest';
    if (tile.overlay === 'forest') tile.treeClass = 'snowy';
    if (tile.geothermal) continue;
    const next = terrainYields(tile.terrain, tile.overlay);
    for (const resource of ['food', 'production', 'gold'] as const)
      tile[resource] = Math.max(0, tile[resource] + next[resource] - old[resource]);
  }
  for (const tile of world.tiles) {
    if (tile.terrain === 'tundra') {
      tile.biome = 'tundra'; delete tile.beach; delete tile.palm; delete tile.marsh; delete tile.desertStone;
      if (tile.overlay === 'forest' || tile.overlay === 'jungle') tile.treeClass = 'snowy';
    } else if (tile.biome === 'tundra') tile.biome = 'taiga';
  }
  applySoilFertility(world);
  // No altitude-only snow or snowy trees surviving on warm terrain.
  for (const tile of world.tiles) if (tile.terrain !== 'tundra' && tile.treeClass === 'snowy') tile.treeClass = 'conifer';
}
