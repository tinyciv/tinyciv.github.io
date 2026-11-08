import { createNoise2D } from 'simplex-noise';
import { WATER, type World } from '../game/types';
import { environmentRandom } from './environment-fields';
import { terrainYields } from './generator';

const NEIGHBORS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

/** Climate chooses the dry interiors; this land-only ecotone makes their
 * margins readable as steppe/savanna. Its width varies with a correlated field,
 * so it is neither a latitude stripe nor a fixed-width outline. Rivers, lakes,
 * beaches and the authored cliff/apron palettes retain their own boundaries. */
export function applyDesertTransitions(world: World): void {
  const { width, height, tiles } = world;
  const distance = new Uint8Array(tiles.length).fill(255), queue: number[] = [];
  const relief = new Uint8Array(tiles.length);
  const noise = createNoise2D(environmentRandom(`${world.seed}:desert-margin`));
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    if (tile.terrain === 'desert' && !tile.beach) { distance[cell] = 0; queue.push(cell); }
    if (!tile.ridge) continue;
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) relief[ny * width + nx] = 1;
    }
  }
  for (let read = 0; read < queue.length; read++) {
    const cell = queue[read], x = cell % width, y = Math.floor(cell / width);
    if (distance[cell] >= 4) continue;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || distance[next] <= distance[cell] + 1
        || WATER.has(tiles[next].terrain) || tiles[next].beach) continue;
      distance[next] = distance[cell] + 1; queue.push(next);
    }
  }
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    if (tile.terrain !== 'grassland' || tile.marsh || relief[cell] || distance[cell] === 255) continue;
    const x = cell % width, y = Math.floor(cell / width);
    const belt = 2.8 + noise(x * .065 + 19, y * .065 - 31) * 1.2;
    if (distance[cell] > belt) continue;
    // Keep the intentionally grassy, non-beach sea bank matching its authored
    // water rim. Inland desert margins never propagate through the ocean.
    const shore = NEIGHBORS.some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      const terrain = tiles[ny * width + nx].terrain;
      return terrain === 'ocean' || terrain === 'coast';
    });
    if (shore) continue;
    const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields('plains', tile.overlay);
    tile.terrain = 'plains'; tile.biome = (tile.temperature ?? .5) > .64 ? 'savanna' : 'steppe';
    for (const resource of ['food', 'production', 'gold'] as const)
      tile[resource] = Math.max(0, tile[resource] + after[resource] - before[resource]);
  }
}
