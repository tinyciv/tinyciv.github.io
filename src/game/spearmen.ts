import { nearbyUnits } from './spatial';
import { distance, type GameState, type Unit } from './types';

export const SPEARMAN_DEFENSE_MULTIPLIER = 1.5;
export const SPEARMAN_RANGE = 1.4;
export const SPEAR_PIERCE_LENGTH = 2.6;
export const SPEAR_PIERCE_HALF_WIDTH = .585;
export const SPEAR_PIERCE_DAMAGE_MULTIPLIER = .6;

/** A thrust follows the primary target's axis, striking at most two additional
 * enemies behind it. It never fans sideways or passes through a solid obstacle. */
export function spearPiercingTargets(state: GameState, attacker: Unit, primary: Unit,
  hostile: (a: number, b: number) => boolean, clear: (target: Unit) => boolean): Unit[] {
  if (attacker.kind !== 'spearman') return [];
  const length = distance(attacker, primary);
  if (length < .001) return [];
  const dx = (primary.x - attacker.x) / length, dy = (primary.y - attacker.y) / length;
  // Include the strip's far corners in the broad phase at every facing angle.
  return nearbyUnits(state, attacker, Math.hypot(length + SPEAR_PIERCE_LENGTH, SPEAR_PIERCE_HALF_WIDTH)).filter(unit => {
    if (unit.id === primary.id || unit.hp <= 0 || unit.inside || !hostile(attacker.faction, unit.faction)) return false;
    const ux = unit.x - attacker.x, uy = unit.y - attacker.y, along = ux * dx + uy * dy;
    return along > length + .1 && along <= length + SPEAR_PIERCE_LENGTH
      && Math.abs(ux * dy - uy * dx) <= SPEAR_PIERCE_HALF_WIDTH && clear(unit);
  }).sort((a, b) => distance(attacker, a) - distance(attacker, b) || a.id - b.id).slice(0, 2);
}
