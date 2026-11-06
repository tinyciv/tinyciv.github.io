import { nearbyUnits } from './spatial';
import { buildingReady, buildingWidth, buildingHeight, distance, type Building, type GameState, type Unit } from './types';

export const TOWER_THREAT_SECONDS = 6;
const threats = new WeakMap<Unit, Map<Building, number>>();

/** A fired shot alerts its victim and nearby allies who can observe the same
 * engagement. Unseen towers elsewhere never become global attack targets. */
export function recordTowerShot(state: GameState, tower: Building, victim: Unit): void {
  for (const ally of nearbyUnits(state, victim, 4)) {
    if (ally.faction !== victim.faction || ally.hp <= 0 || ally.inside || distance(ally, victim) > 4
      || distance(ally, { x: tower.x + buildingWidth(tower) / 2, y: tower.y + buildingHeight(tower) / 2 }) > 8) continue;
    let known = threats.get(ally);
    if (!known) { known = new Map(); threats.set(ally, known); }
    for (const [source, until] of known) if (until < state.time || source.hp <= 0) known.delete(source);
    known.set(tower, state.time + TOWER_THREAT_SECONDS);
  }
}

export function firingTowerThreats(state: GameState, unit: Unit): Building[] {
  const known = threats.get(unit);
  if (!known) return [];
  const result: Building[] = [];
  for (const [tower, until] of known) {
    if (until < state.time || !buildingReady(tower)) { known.delete(tower); continue; }
    result.push(tower);
  }
  return result.sort((a, b) => distance(unit, a) - distance(unit, b) || a.id - b.id);
}
