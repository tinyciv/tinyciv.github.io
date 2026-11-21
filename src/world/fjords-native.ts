import { rustEngine } from '../game/rust-engine';
import { WATER, type Tile, type World } from '../game/types';
import { environmentRandom } from './environment-fields';
import type { LandformPlan } from './landforms';
import { POLAR_SEA_LANE_WIDTH } from './polar-sea';

export const FJORD_TILE_TYPES: readonly Tile['fjord'][] = [undefined, 'water', 'shore', 'rock'];

/** Import the native coast draft before climate, rivers and starting sites. */
export function carveFjordCoast(land: Uint8Array, width: number, height: number, seed: string,
  plan: LandformPlan | undefined): Uint8Array | undefined {
  const pointer = rustEngine.fjord_coasts_input(land.length);
  new Uint8Array(rustEngine.memory.buffer, pointer, land.length).set(land);
  const layoutSeed = Math.floor(environmentRandom(`${seed}:fjords`)() * 0x100000000);
  const output = rustEngine.fjord_coasts_generate(width, height, layoutSeed, POLAR_SEA_LANE_WIDTH);
  const tags = new Uint8Array(rustEngine.memory.buffer, output, land.length).slice();
  if (!tags.includes(1)) return;
  for (let cell = 0; cell < tags.length; cell++) {
    if (tags[cell] === 1) land[cell] = 0;
    if (!plan) continue;
    if (tags[cell] === 1) plan.elevation[cell] = 0;
    else if (tags[cell] === 2) plan.elevation[cell] = Math.min(plan.elevation[cell], .19);
    else if (tags[cell] === 3) plan.elevation[cell] = Math.max(plan.elevation[cell], .45);
  }
  return tags;
}

/** Rivers still cut across dry banks. Keep the final metadata consistent with
 * the terrain used by fishing, rendering and the resource planner. */
export function reconcileFjordTerrain(world: World): void {
  for (const tile of world.tiles) {
    if (!tile.fjord) continue;
    if (tile.fjord === 'water' ? tile.terrain !== 'coast' && tile.terrain !== 'ocean' : WATER.has(tile.terrain) || tile.creek) {
      delete tile.fjord;
    }
  }
}
