import { buildingWidth, buildingHeight, type Building, type World } from './types';
import { recordWorldTileChanges } from './world-revisions';

/** Decoration has no navigation, yield or resource identity. Clearing is permanent. */
export function clearDesertStones(world: World, building: Building): void {
  const changed: number[] = [];
  for (let y = building.y; y < building.y + buildingHeight(building); y++)
    for (let x = building.x; x < building.x + buildingWidth(building); x++) {
      if (x >= 0 && y >= 0 && x < world.width && y < world.height) {
        const cell = y * world.width + x;
        const tile = world.tiles[cell];
        if (tile?.desertStone !== undefined) { delete tile.desertStone; changed.push(cell); }
      }
    }
  if (changed.length) recordWorldTileChanges(world, changed);
}
