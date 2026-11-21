import { type Unit } from './types';
import { rustEngine } from './rust-engine';
import { movementFlags, movementFormation, movementKind, type CollisionTraits } from './movement-native';

export const civilianFootprint = (unit: Pick<Unit, 'kind'> & Partial<Pick<Unit, 'engineer'>>): boolean => !!rustEngine.movement_civilian(movementKind(unit.kind), movementFlags(unit));
export const unitCollisionRadius = (unit: Unit): number => rustEngine.movement_radius(movementKind(unit.kind));

/** Non-military units pass through each other. Human civilians can also cross
 * the battle line; military pairs and military/wildlife pairs still collide. */
type CollisionUnit = CollisionTraits;
export function unitsCollide(a: CollisionUnit, b: CollisionUnit): boolean {
  return !!rustEngine.movement_collides(movementKind(a.kind), a.faction ?? NaN, movementFlags(a), movementFormation(a),
    movementKind(b.kind), b.faction ?? NaN, movementFlags(b), movementFormation(b));
}

export function unitObstructs(unit: Unit, other: Unit): boolean {
  // Direct player control has right of way through its own company. Keep this
  // directional: retinue still reserves friendly cells, including the Leader's.
  return !!rustEngine.movement_obstructs(unit.id, movementKind(unit.kind), unit.faction ?? NaN, movementFlags(unit), movementFormation(unit),
    other.id, movementKind(other.kind), other.faction ?? NaN, movementFlags(other), movementFormation(other), other.hp);
}

/** Navigation and physical movement use the same unit collision rules. */
export function unitBlocksNavigationCell(unit: Unit, other: Unit): boolean {
  return unitObstructs(unit, other);
}
