import { isForbidden } from './forbidden-zones';
import { constructionFootprint } from './bridge-construction';
import type { Building, GameState } from './types';

/** A job acts on its footprint even when the worker stands beside it. */
export function buildingWorkForbidden(state: GameState, building: Building, faction = building.faction): boolean {
  const footprint = constructionFootprint(building);
  for (let y = footprint.y; y < footprint.y + footprint.height; y++)
    for (let x = footprint.x; x < footprint.x + footprint.width; x++)
      if (isForbidden(state, x, y, faction)) return true;
  return false;
}
