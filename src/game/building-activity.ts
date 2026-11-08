import { playerFaction } from './player-context';
import { buildingArtTop, buildingReady, buildingWidth, buildingHeight, isFarmKind, type Building, type GameState, type Point } from './types';

export const BUILDING_ACTIVITY_RANGE = 3;
export type BuildingActivityKind = 'fort' | 'governor' | 'blacksmith' | 'farm' | 'guardPost' | 'archeryRange' | 'library' | 'scoutLodge' | 'stable' | 'village';

/** Add a kind here when another building gains an activity panel. */
export function buildingActivityKind(building: Building): BuildingActivityKind | undefined {
  return building.villageId !== undefined || building.kind === 'villageTent' ? 'village' : building.kind === 'palace' ? 'governor' : isFarmKind(building.kind) ? 'farm'
    : ['fort', 'blacksmith', 'guardPost', 'archeryRange', 'library', 'scoutLodge', 'stable'].includes(building.kind) ? building.kind as BuildingActivityKind : undefined;
}

/** Reach is measured from the actual footing, including its south/east edges. */
export function buildingActivityAvailable(state: GameState, building: Building): boolean {
  const village = building.villageId !== undefined && state.villages?.find(village => village.campId === building.id && !village.destroyed);
  if (state.gameOver || building.faction !== playerFaction(state) && !village || (!buildingReady(building) && !(building.kind === 'fort' && building.fort?.destroyed)) || !buildingActivityKind(building)) return false;
  const leader = state.units.find(unit => unit.faction === playerFaction(state) && unit.kind === 'leader' && unit.hp > 0 && !unit.inside);
  if (!leader) return false;
  const dx = Math.max(building.x - leader.x, 0, leader.x - building.x - buildingWidth(building));
  const dy = Math.max(building.y - leader.y, 0, leader.y - building.y - buildingHeight(building));
  return Math.hypot(dx, dy) <= BUILDING_ACTIVITY_RANGE;
}

export function buildingActivityAnchor(building: Building): Point {
  return { x: building.x + buildingWidth(building) / 2, y: building.y + buildingArtTop(building) };
}
