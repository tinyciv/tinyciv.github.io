import { environmentRandom } from './environment-fields';
import type { World } from '../game/types';

/** Cosmetic 8FC stones: sparse, separated, and independent of gameplay RNG. */
export function scatterDesertStones(world: World): void {
  const random = environmentRandom(`${world.seed}:8FC`);
  const { width, height, tiles } = world;
  for (const tile of tiles) delete tile.desertStone;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const tile = tiles[y * width + x];
    if (tile.terrain !== 'desert' || tile.overlay !== 'none' || tile.resource || tile.ridge || tile.stair
      || tile.creek || tile.channel || tile.beach || tile.marsh || tile.palm || tile.villageTrail || tile.farm !== undefined) continue;
    if (random() >= .085) continue;
    let nearby = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbor = tiles[(y + dy) * width + x + dx];
      if (neighbor.desertStone !== undefined || neighbor.terrain !== 'desert' || neighbor.ridge) nearby = true;
    }
    if (!nearby) tile.desertStone = Math.floor(random() * 24);
  }
}
