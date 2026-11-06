import { ridgeLevel } from './ridges';
import { buildingHeight, buildingWidth, tileAt, type Building, type Point, type Unit, type World } from './types';

export const HIGH_GROUND_RANGE_BONUS = 1;
const aimPoint = (target: Point | Building): Point => 'capacity' in target
  ? { x: target.x + buildingWidth(target) / 2, y: target.y + buildingHeight(target) / 2 } : target;

/** Playable elevation tiers, not generation noise or a valley along the ray,
 * decide whether a shot is downhill. Stacking tiers never stacks the bonus. */
export function downhillRangeBonus(world: World, from: Point, target: Point | Building): number {
  const aim = aimPoint(target), source = tileAt(world, from.x, from.y), destination = tileAt(world, aim.x, aim.y);
  return source && destination && ridgeLevel(source) > ridgeLevel(destination) ? HIGH_GROUND_RANGE_BONUS : 0;
}
const firesProjectiles = (unit: Unit): boolean => (unit.kind === 'leader' || unit.kind === 'archer' || unit.kind === 'skirmisher') && unit.range > 0;
/** Broad-phase searches include the extra tile; each shot still checks its target. */
export const maximumUnitRange = (unit: Unit): number => unit.range + (firesProjectiles(unit) ? HIGH_GROUND_RANGE_BONUS : 0);
export const unitAttackRange = (world: World, unit: Unit, target: Point | Building, from: Point = unit): number =>
  unit.range + (firesProjectiles(unit) ? downhillRangeBonus(world, from, target) : 0);
