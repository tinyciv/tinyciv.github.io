import { ridgeGroundWalkable } from './ridges';
import { isFord, tileAt, WATER, type World } from './types';

/** Boats and fish share the same level water surface. A waterfall remains
 * water for drainage and irrigation, but is never a navigable channel cell. */
export function navigableWaterCell(world: World, x: number, y: number): boolean {
  const tile = tileAt(world, x, y);
  return !!tile && WATER.has(tile.terrain) && !tile.waterfall && !tile.creek
    && !isFord(tile) && !tile.stair && ridgeGroundWalkable(world, x, y);
}
