import { createNoise2D } from 'simplex-noise';
import { baseSoilFertility } from '../game/fertility';
import { WATER, type World } from '../game/types';
import { environmentRandom, settlementCoreMask } from './environment-fields';
import { terrainYields } from './generator';

/** Plains cannot cut across authored cliff aprons or the native water banks. */
export function stonePlainsGroundMask(world: World): Uint8Array {
  const { width, height, tiles } = world, cores = settlementCoreMask(world);
  const ground = Uint8Array.from(tiles, (tile, cell) => Number(!cores[cell] && !WATER.has(tile.terrain)
    && !tile.creek && !tile.beach && !tile.marsh && !tile.stair && !tile.mountainPass && !tile.hillBiome && tile.farm === undefined
    && tile.overlay !== 'volcano' && tile.overlay !== 'glacier' && tile.overlay !== 'swamp'));
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell], radius = tile.ridge ? 2 : WATER.has(tile.terrain) || tile.creek ? 1 : -1;
    if (radius < 0) continue;
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) ground[ny * width + nx] = 0;
    }
  }
  return ground;
}

/** Every outcrop has room for a complete one-tile plains fringe. */
export function stonePlainsSites(world: World, ground = stonePlainsGroundMask(world)): Uint8Array {
  const { width, height } = world, sites = new Uint8Array(ground.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let clear = true;
    for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1; dx++)
      if (!ground[(y + dy) * width + x + dx]) { clear = false; break; }
    sites[y * width + x] = Number(clear);
  }
  return sites;
}

/** A small, connected plain around each stone cluster, using existing terrain
 * joins. Apply after resource placement so its geology/habitat sampling stays
 * independent of these local ground changes. No elevation or waterways change. */
export function applyStonePlains(world: World): void {
  const { width, height, tiles } = world, ground = stonePlainsGroundMask(world);
  const noise = createNoise2D(environmentRandom(`${world.seed}:stone-plains`));
  const selected = new Set<number>();
  for (let cell = 0; cell < tiles.length; cell++) {
    if (tiles[cell].resource !== 'stone') continue;
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !ground[next]) continue;
      // Spatially coherent radii produce broad lobes rather than a square pad
      // or independent speckles. The entire first ring is always included.
      const radius = 2 + noise(nx * .24, ny * .24) * .45;
      if (dx * dx + dy * dy <= radius * radius) selected.add(next);
    }
  }
  for (const cell of selected) {
    const tile = tiles[cell];
    if (tile.terrain === 'plains') continue;
    const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields('plains', tile.overlay);
    if (tile.fertility !== undefined) tile.fertility += baseSoilFertility('plains') - baseSoilFertility(tile.terrain);
    tile.terrain = 'plains';
    if (tile.biome === 'desert') tile.biome = 'steppe';
    delete tile.palm;
    for (const resource of ['food', 'production', 'gold'] as const)
      tile[resource] = Math.max(0, tile[resource] + after[resource] - before[resource]);
  }
}
