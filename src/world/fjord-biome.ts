import type { World } from '../game/types';

/** Map the native region onto the final tiles after climate and woodland settle. */
export function assignFjordBiome(world: World): void {
  for (const tile of world.tiles) if (tile.fjord) tile.biome = 'fjords';
}
