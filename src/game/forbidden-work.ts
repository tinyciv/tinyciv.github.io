import { isForbidden } from './forbidden-zones';
import { buildingHeight, buildingWidth, type Building, type GameState } from './types';

/** A job acts on its footprint even when the worker stands beside it. */
export function buildingWorkForbidden(state: GameState, building: Building, faction = building.faction): boolean {
  for (let y = building.y; y < building.y + buildingHeight(building); y++)
    for (let x = building.x; x < building.x + buildingWidth(building); x++)
      if (isForbidden(state, x, y, faction)) return true;
  return false;
}
