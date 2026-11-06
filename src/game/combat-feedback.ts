import { nearbyUnits } from './spatial';
import { distance, type GameState, type Unit } from './types';

export const DEFENSIVE_RADIUS = 5;
export const DAMAGE_NUMBER_DURATION = .85;
/** Record actual lost HP, including the final hit, rather than raw attack power. */
export function recordUnitDamage(state: GameState, target: Unit, previousHp: number, attackerId?: number): void {
  const lost = Math.max(0, previousHp - target.hp);
  if (!lost) return;
  const last = state.particles.at(-1);
  // A bounded queue keeps huge engagements from retaining unlimited labels.
  if (state.particles.length < 240) state.particles.push({ x: target.x, y: target.y,
    text: `-${Math.max(1, Math.round(lost))}`, color: '#fff0db', life: DAMAGE_NUMBER_DURATION,
    duration: DAMAGE_NUMBER_DURATION, kind: 'damage', direction: (target.id % 2 ? 1 : -1) * (last?.x === target.x ? -1 : 1) });
  if (attackerId === undefined) return;
  for (const ally of nearbyUnits(state, target, DEFENSIVE_RADIUS)) {
    if (ally.faction !== target.faction || ally.hp <= 0 || ally.retinueStance !== 'defensive' || !ally.defensiveAnchor) continue;
    if (distance(ally.defensiveAnchor, target) > DEFENSIVE_RADIUS) continue;
    ally.defensiveThreat = { target: attackerId, until: state.time + 4 };
  }
}
export function damageNumberPose(life: number, direction = 1): { rise: number; offset: number; alpha: number } {
  const progress = Math.max(0, Math.min(1, 1 - life / DAMAGE_NUMBER_DURATION));
  return { rise: .18 + .42 * Math.sin(Math.PI * Math.min(1, progress * 1.15)) + .22 * progress,
    offset: direction * (.2 + .22 * progress), alpha: Math.min(1, life / .25) };
}
