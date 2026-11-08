import { tileAt, type Tile, type World } from './types';

/** Rocky deposits occupy their whole cell before and after development. */
export const resourceBlocksGround = (tile: Pick<Tile, 'resource'> | undefined): boolean =>
  tile?.resource === 'stone' || tile?.resource === 'copper' || tile?.resource === 'iron';

export function resourceFootprintBlocked(world: World, x: number, y: number, width = 1, height = width): boolean {
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++)
    if (resourceBlocksGround(tileAt(world, x + dx, y + dy))) return true;
  return false;
}
