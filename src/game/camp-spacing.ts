import { type Building, type GameState, isFarmKind } from './types';

/** Touching single-tile farms need no intervening walking lane. */
export const CAMP_CENTER_SPACING = 1;
export function isCamp(building: Building): boolean {
  return building.hp > 0 && isFarmKind(building.kind);
}

/** A plot is reserved only by the actual footprint of another farm. */
export function campFieldSpacingAllowed(state: GameState, campId: number, x: number, y: number): boolean {
  return state.buildings.every(other => other.id === campId || !isCamp(other)
    || x < other.x || y < other.y || x >= other.x + 1 || y >= other.y + 1);
}
