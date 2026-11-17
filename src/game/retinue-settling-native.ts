import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { isRetinueMember, type GameState, type Point, type Unit } from './types';

const observations = (unit: Unit): number => Number(unit.target !== undefined) << 1
  | Number(!!unit.joiningRetinue) << 2 | Number(unit.recallIssuedAt !== undefined) << 3
  | Number(!!unit.forcedAttack) << 4 | Number(unit.order !== 'follow') << 5
  | Number(!isRetinueMember(unit)) << 6;

/** Publish observations only; Rust owns quiet-time, tolerance and hysteresis. */
export function nativeRetinueSettled(state: GameState, unit: Unit, leader: Unit, goal: Point, traveling: boolean): boolean {
  return !!rustEngine.sim_retinue_settle(simCore(state).handle, leader.id, unit.id, unit.x, unit.y,
    goal.x, goal.y, leader.x, leader.y, observations(unit) | Number(traveling), unit.stuckFor ?? 0);
}
export function nativeRetinueYieldAllowed(state: GameState, requester: Unit, blocker: Unit): boolean {
  return !!rustEngine.sim_retinue_yield_allowed(simCore(state).handle, requester.id, blocker.id,
    requester.x, requester.y, observations(requester));
}
