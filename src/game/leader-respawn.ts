import { initialLeaderProgression } from './leader-progression';
import { spendGold } from './gold-ledger';
import { buildingReady, unitMaxHp, type GameState, type Unit } from './types';
import { rustEngine } from './rust-engine';
import { settlementLeaderDeath } from './settlement-bridge';
export const LEADER_RESPAWN_MILLISECONDS = 10_000;
const LEADER_DEATH_GOLD = rustEngine.progression_constant(13);

/** The simulation never reads a wall clock itself. Hosts (main.ts, the match
 * worker, tests, parity runs) pass their wall time in milliseconds through
 * `updateGame(..., { wallNow })` or the explicit `now` arguments below; the
 * last supplied value is kept per game for deaths recorded inside a step.
 * It is host memory, never saved, and starts at 0 until a host supplies it. */
const hostWallClocks = new WeakMap<GameState, number>();
export function setHostWallClock(state: GameState, now: number): void {
  if (Number.isFinite(now)) hostWallClocks.set(state, now);
}
export function hostWallClock(state: GameState): number { return hostWallClocks.get(state) ?? 0; }

export function leaderRespawnRemainingSeconds(state: GameState, factionId: number, now: number): number {
  const pending = state.factions.find(faction => faction.id === factionId)?.leaderRespawn;
  return pending ? Math.max(0, (pending.readyAtWallTime - now) / 1000) : 0;
}
/** A real-time deadline survives pause, game speed, snapshots and reconnects. */
export function recordLeaderDeath(state: GameState, leader: Unit, now: number): void {
  if (leader.kind !== 'leader' || leader.faction < 0 || leader.leaderDeathRecorded) return;
  const faction = state.factions.find(candidate => candidate.id === leader.faction);
  if (!faction || faction.leaderRespawn) return;
  leader.leaderDeathRecorded = true;
  const progress = structuredClone(leader.leaderProgression ?? initialLeaderProgression());
  const pointer = rustEngine.progression_death(progress.level, progress.xp, progress.skillPoints,
    unitMaxHp(leader), leader.attack, leader.enemyStrengthMultiplier ?? 1);
  const [level, xp, skillPoints, maxHp, attack] = new Float64Array(rustEngine.memory.buffer, pointer, 5);
  progress.level = level; progress.xp = xp; progress.skillPoints = skillPoints;
  spendGold(state, faction, LEADER_DEATH_GOLD, 'other');
  settlementLeaderDeath(state, leader.faction);
  const citySurvives = state.buildings.some(building => building.kind === 'palace' && building.faction === leader.faction && buildingReady(building));
  faction.defeated = !citySurvives;
  if (citySurvives) faction.leaderRespawn = { readyAtWallTime: now + LEADER_RESPAWN_MILLISECONDS, progression: progress,
    // Respawn creates a fresh entity; store its unscaled maximum so the live
    // difficulty setting is applied once, even if it changes during the wait.
    maxHp, attack, defense: leader.defense, position: { x: leader.x, y: leader.y } };
}
