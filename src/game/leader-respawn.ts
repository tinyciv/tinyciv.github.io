import { playerFaction } from './player-context';
import { initialLeaderProgression, leaderXpRequired, LEADER_LEVEL_ATTACK_BONUS, LEADER_LEVEL_HP_BONUS } from './leader-progression';
import { spendGold } from './gold-ledger';
import { buildingReady, unitMaxHp, type GameState, type Unit } from './types';
export const LEADER_RESPAWN_MILLISECONDS = 10_000;
export function leaderRespawnRemainingSeconds(state: GameState, factionId = playerFaction(state), now = Date.now()): number {
  const pending = state.factions.find(faction => faction.id === factionId)?.leaderRespawn;
  return pending ? Math.max(0, (pending.readyAtWallTime - now) / 1000) : 0;
}
/** A real-time deadline survives pause, game speed, snapshots and reconnects. */
export function recordLeaderDeath(state: GameState, leader: Unit, now = Date.now()): void {
  if (leader.kind !== 'leader' || leader.faction < 0 || leader.leaderDeathRecorded) return;
  const faction = state.factions.find(candidate => candidate.id === leader.faction);
  if (!faction || faction.leaderRespawn) return;
  leader.leaderDeathRecorded = true;
  const progress = structuredClone(leader.leaderProgression ?? initialLeaderProgression());
  const lostLevel = progress.level > 1;
  progress.level = Math.max(1, progress.level - 1);
  progress.xp = Math.min(progress.xp, leaderXpRequired(progress.level) - 1);
  if (lostLevel) progress.skillPoints = Math.max(0, progress.skillPoints - 1);
  spendGold(state, faction, 200, 'other');
  const citySurvives = state.buildings.some(building => building.kind === 'palace' && building.faction === leader.faction && buildingReady(building));
  faction.defeated = !citySurvives;
  if (citySurvives) faction.leaderRespawn = { readyAtWallTime: now + LEADER_RESPAWN_MILLISECONDS, progression: progress,
    // Respawn creates a fresh entity; store its unscaled maximum so the live
    // difficulty setting is applied once, even if it changes during the wait.
    maxHp: Math.max(1, unitMaxHp(leader) / (leader.enemyStrengthMultiplier ?? 1) - (lostLevel ? LEADER_LEVEL_HP_BONUS : 0)),
    attack: leader.attack - (lostLevel ? LEADER_LEVEL_ATTACK_BONUS : 0), defense: leader.defense, position: { x: leader.x, y: leader.y } };
}
