import { infantryFormationActive, infantryFormationSoldierCount, INFANTRY_FORMATION_MIN_START, INFANTRY_FORMATION_MIN_REMAINING } from '../game/infantry-drill';
import { playerFaction } from '../game/player-context';
import { researchLevel } from '../game/research';
import type { GameState } from '../game/types';

export type LeaderHotbarAction = 'recall' | 'stance' | 'formation';

/** Numeric recall/stance remain stable while formations or boats use Q/E steering. */
export function leaderHotbarActionForKey(key: string, formation: boolean): LeaderHotbarAction | undefined {
  if (key === '1') return 'recall';
  if (key === '2') return 'stance';
  if (key === '3') return 'formation';
  if (!formation && key.toLowerCase() === 'q') return 'stance';
  if (!formation && key.toLowerCase() === 'e') return 'recall';
}

export function leaderHeldTurnForKey(key: string, formation: boolean): 'turnLeft' | 'turnRight' | undefined {
  if (formation && key.toLowerCase() === 'q') return 'turnLeft';
  if (formation && key.toLowerCase() === 'e') return 'turnRight';
}

export function infantryFormationControl(state: GameState) {
  const faction = playerFaction(state), leader = state.units.find(unit => unit.faction === faction && unit.kind === 'leader' && unit.hp > 0);
  const unlocked = researchLevel(state.factions.find(candidate => candidate.id === faction), 'infantryDrill') > 0;
  const active = infantryFormationActive(state, faction), available = !state.gameOver && !!leader && !leader.inside
    && leader.embarkedOn === undefined && leader.boardingBoat === undefined && leader.order !== 'flee';
  const soldiers = infantryFormationSoldierCount(state, faction);
  const reason = !unlocked ? 'Research Infantry Drill first.' : !available ? 'Your Leader must be alive and on land.'
    : !active && soldiers < INFANTRY_FORMATION_MIN_START ? `Formation requires ${INFANTRY_FORMATION_MIN_START} living retinue soldiers (${soldiers}/${INFANTRY_FORMATION_MIN_START}).` : '';
  return { active, unlocked, enabled: !reason, reason,
    title: reason || `Formation (3) · ${active ? 'Active · A/D strafe · W/S advance/reverse · Hold Q/E to rotate' : 'Close ranks around the Leader · 105% speed · +25% frontal damage and +50% defense'} · Requires ${INFANTRY_FORMATION_MIN_START} soldiers to form; below ${INFANTRY_FORMATION_MIN_REMAINING}, all ranks and the Leader rout.` };
}
