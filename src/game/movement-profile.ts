import type { GameState } from './types';

/** Opt-in timings: movementMs includes search/steering, while spatialMs and
 * separationMs are separate simulation passes. Disabled games read no clock. */
export interface MovementProfile {
  calls: number;
  movementMs: number;
  pathSearches: number;
  pathSearchMs: number;
  congestionMs: number;
  routeValidationMs: number;
  steeringMs: number;
  spatialMs: number;
  separationMs: number;
}
const profiles = new WeakMap<GameState, MovementProfile>();
export function setMovementProfiling(state: GameState, enabled: boolean): void {
  if (!enabled) { profiles.delete(state); return; }
  profiles.set(state, { calls: 0, movementMs: 0, pathSearches: 0, pathSearchMs: 0,
    congestionMs: 0, routeValidationMs: 0, steeringMs: 0, spatialMs: 0, separationMs: 0 });
}
export function movementProfile(state: GameState): MovementProfile | undefined { return profiles.get(state); }
