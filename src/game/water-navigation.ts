import { reliefGroundWalkable } from './relief';
import { isFord, tileAt, WATER, type World } from './types';
import { rustEngine } from './rust-engine';

/** Boats and fish share the same level water surface. A waterfall remains
 * water for drainage and irrigation, but is never a navigable channel cell. */
export function navigableWaterCell(world: World, x: number, y: number): boolean {
  const tile = tileAt(world, x, y);
  return !!tile && !!rustEngine.water_cell_navigable(Number(WATER.has(tile.terrain))
    | (tile.waterfall ? 2 : 0) | (tile.creek ? 4 : 0) | (tile.relief ? 8 : 0)
    | (reliefGroundWalkable(world, x, y) ? 16 : 0) | (isFord(tile) ? 32 : 0) | (tile.seaIce ? 64 : 0));
}
