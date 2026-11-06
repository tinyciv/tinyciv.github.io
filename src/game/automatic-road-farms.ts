import { planRoadFarmRelocation, relocateFarm } from './farm-relocation';
import { buildingHeight, buildingWidth, isFarmKind, tileAt, type GameState, type Point } from './types';

/** Roads created by traffic use the same free crop relocation as manual roads.
 * Keep the farm's owner and home city, even for a caravan travelling abroad.
 * If the crop cannot move, leave both the crop and road network untouched. */
export function prepareFarmForAutomaticRoad(state: GameState, point: Point): boolean {
  const farm = state.buildings.find(building => building.hp > 0 && isFarmKind(building.kind)
    && point.x >= building.x && point.x < building.x + buildingWidth(building)
    && point.y >= building.y && point.y < building.y + buildingHeight(building));
  if (!farm) return tileAt(state.world, point.x, point.y)?.farm === undefined
    && !(state.fields ?? []).some(field => field.x === point.x && field.y === point.y);
  const plan = planRoadFarmRelocation(state, point, farm.faction);
  return !!plan && relocateFarm(state, plan, point, { wall: true, road: true });
}
