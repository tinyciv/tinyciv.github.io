import { isSoldier, type Unit } from './types';

const military = (unit: Pick<Unit, 'kind'>): boolean => unit.kind === 'leader' || isSoldier(unit) || unit.kind === 'militia';
export const civilianFootprint = (unit: Pick<Unit, 'kind'> & Partial<Pick<Unit, 'engineer'>>): boolean => !unit.engineer && (unit.kind === 'worker' || unit.kind === 'supplyCart' || unit.kind === 'merchant' || unit.kind === 'scout');
export const unitCollisionRadius = (unit: Unit): number => unit.kind === 'worker' ? .14 : unit.kind === 'scout' || unit.kind === 'marshBird' ? .18 : unit.kind === 'merchant' || unit.kind === 'supplyCart' ? .22 : .5;

/** Non-military units pass through each other. Human civilians can also cross
 * the battle line; military pairs and military/wildlife pairs still collide. */
type CollisionUnit = Pick<Unit, 'kind'> & Partial<Pick<Unit, 'faction' | 'infantryDrillLeader' | 'engineer' | 'levyAssembling'>>;
export function unitsCollide(a: CollisionUnit, b: CollisionUnit): boolean {
  if (a.faction === b.faction && (a.levyAssembling || b.levyAssembling)) return false;
  if (a.engineer || b.engineer) {
    if (a.faction === b.faction && (a.kind === 'leader' || b.kind === 'leader')) return false;
    return military(a) || military(b) || !!a.engineer && !!b.engineer;
  }
  if (a.kind === 'levyInfantry' || b.kind === 'levyInfantry') return !civilianFootprint(a) && !civilianFootprint(b);
  if (a.infantryDrillLeader !== undefined && a.infantryDrillLeader === b.infantryDrillLeader && a.faction === b.faction) return false;
  return (military(a) || military(b)) && !civilianFootprint(a) && !civilianFootprint(b);
}

export function unitObstructs(unit: Unit, other: Unit): boolean {
  // Direct player control has right of way through its own company. Keep this
  // directional: retinue still reserves friendly cells, including the Leader's.
  return other.id !== unit.id && other.hp > 0 && !other.inside
    && !(unit.kind === 'leader' && (unit.faction === 0 || unit.humanControlled) && other.faction === unit.faction)
    && unitsCollide(unit, other);
}

/** Navigation and physical movement use the same unit collision rules. */
export function unitBlocksNavigationCell(unit: Unit, other: Unit): boolean {
  return unitObstructs(unit, other);
}
