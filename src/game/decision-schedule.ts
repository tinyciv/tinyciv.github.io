/** Decision clocks use game time. Continuous movement, combat execution and
 * deadline events keep their own fast updates; only expensive sensing/planning
 * uses these clocks. Runtime clocks are intentionally not part of saved state. */
import type { GameState } from './types';
import { MAX_CHECK_HZ } from './work-cadence';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';

export const QUIET_DECISION_HZ = MAX_CHECK_HZ;
export const COMBAT_DECISION_HZ = MAX_CHECK_HZ;

export interface DecisionClock {
  nextAt?: number;
  sampledAt?: number;
  interval?: number;
}

let decisionResult: Float64Array | undefined;
/** Explicit commands and changes of allegiance invalidate pending decisions.
 * The revision is a resource of the game's native simulation core. */
export const decisionRevision = (state: GameState): number => rustEngine.sim_decision_revision(simCore(state).handle);
export function invalidateDecisions(state: GameState): void { rustEngine.sim_decisions_invalidate(simCore(state).handle); }

/** Stable entity phases distribute recurring work without consuming gameplay
 * RNG. Units `active` in combat re-decide at 8 Hz, quiet units at 3 Hz; an
 * `urgent` event (damage, a lost target, a new order) or entering combat
 * bypasses the pending deadline. Missed decisions are coalesced, never replayed.
 * 2026-11-13: restoring this responsiveness (removed on 11-08) roughly halved
 * soldiers standing idle beside enemies in the battle experiments. */
export function decisionDue(clock: DecisionClock, now: number, key: number, active = false, urgent = false): boolean {
  const pointer = rustEngine.cadence_decision_due(now, key | 0, clock.nextAt ?? NaN, clock.sampledAt ?? NaN, clock.interval ?? NaN, Number(active), Number(urgent));
  if (!decisionResult || decisionResult.buffer !== rustEngine.memory.buffer || decisionResult.byteOffset !== pointer)
    decisionResult = new Float64Array(rustEngine.memory.buffer, pointer, 4);
  if (!decisionResult[0]) return false;
  clock.nextAt = decisionResult[1]; clock.sampledAt = decisionResult[2]; clock.interval = decisionResult[3];
  return true;
}
