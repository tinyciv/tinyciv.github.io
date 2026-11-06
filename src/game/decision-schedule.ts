/** Decision clocks use game time. Continuous movement, combat execution and
 * deadline events keep their own fast updates; only expensive sensing/planning
 * uses these clocks. Runtime clocks are intentionally not part of saved state. */
import type { GameState } from './types';
import { CHECK_INTERVAL, MAX_CHECK_HZ } from './work-cadence';

export const QUIET_DECISION_HZ = MAX_CHECK_HZ;
export const COMBAT_DECISION_HZ = MAX_CHECK_HZ;

export interface DecisionClock {
  nextAt?: number;
  sampledAt?: number;
  interval?: number;
}

const revisions = new WeakMap<GameState, number>();
/** Explicit commands and changes of allegiance invalidate pending decisions. */
export const decisionRevision = (state: GameState): number => revisions.get(state) ?? 0;
export function invalidateDecisions(state: GameState): void {
  revisions.set(state, decisionRevision(state) + 1);
}

/** Stable entity phases distribute recurring work without consuming gameplay
 * RNG. Damage, orders and entering combat do not bypass the minimum spacing;
 * execution still validates a retained target before moving or attacking.
 * Missed decisions are coalesced, never replayed as a catch-up burst. */
export function decisionDue(clock: DecisionClock, now: number, key: number, _active = false, _urgent = false): boolean {
  if (!Number.isFinite(now)) return false;
  const first = clock.sampledAt === undefined;
  const rewind = !first && now < clock.sampledAt!;
  if (!first && !rewind && now + 1e-9 < clock.nextAt!) return false;
  const phase = (Math.imul(key | 0, 0x9e3779b1) >>> 0) / 0x100000000;
  clock.sampledAt = now;
  clock.interval = CHECK_INTERVAL;
  // First observations are immediate. Only their first follow-up is phased;
  // rounding to an absolute phase after every scan could violate the cap.
  clock.nextAt = now + CHECK_INTERVAL * (first || rewind ? 1 + phase : 1);
  return true;
}
