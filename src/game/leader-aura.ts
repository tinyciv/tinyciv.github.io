import { indexedLeader } from './spatial';
import { isSoldier, type GameState, type Unit } from './types';

export const LEADER_ATTACK_AURA_RADIUS = 6;
export const LEADER_ATTACK_AURA_PER_LEVEL = .02;
/** Only the living faction commander inspires soldiers; no self-bonus or stacking. */
export function leaderAttackAura(state: GameState, soldier: Unit): number {
  if (!isSoldier(soldier) || soldier.hp <= 0 || soldier.inside) return 1;
  const leader = indexedLeader(state, soldier.faction);
  if (!leader || leader.hp <= 0 || leader.inside
    || (leader.x - soldier.x) ** 2 + (leader.y - soldier.y) ** 2 > LEADER_ATTACK_AURA_RADIUS ** 2) return 1;
  return 1 + Math.max(1, leader.leaderProgression?.level ?? 1) * LEADER_ATTACK_AURA_PER_LEVEL;
}
