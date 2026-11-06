import { entityStore, type EntityStore } from './entity-store';
import type { GameState } from './types';

/** Maximum recurring sensing/maintenance frequency, in simulation seconds.
 * Rendering and UI use the equivalent wall-clock interval. Movement, collision
 * and hit resolution remain on the fast clock; explicit commands are events. */
export const MAX_CHECK_HZ = 3;
export const CHECK_INTERVAL = 1 / MAX_CHECK_HZ;
export const CHECK_INTERVAL_MS = 1000 / MAX_CHECK_HZ;

interface WorkClock { sampledAt: number; observedAt: number; elapsed: number }
interface WorkSchedule { store: EntityStore; world: GameState['world']; clocks: Map<string, WorkClock> }
const schedules = new WeakMap<GameState, WorkSchedule>();

/** Coalesce missed work into one pass and preserve elapsed integration time.
 * Revisions/events never bypass this cap. A new state/import or clock rewind
 * starts a fresh schedule. Calling the same task twice in a step is harmless. */
export function recurringWorkElapsed(state: GameState, key: string, dt: number): number | undefined {
  const now = state.time;
  if (!Number.isFinite(now) || !Number.isFinite(dt) || dt < 0) return;
  const store = entityStore(state);
  let schedule = schedules.get(state);
  if (!schedule || schedule.store !== store || schedule.world !== state.world) {
    schedule = { store, world: state.world, clocks: new Map() };
    schedules.set(state, schedule);
  }
  let clock = schedule.clocks.get(key);
  if (!clock || now < clock.observedAt) {
    clock = { sampledAt: now, observedAt: now, elapsed: 0 };
    schedule.clocks.set(key, clock);
    return dt;
  }
  if (clock.observedAt !== now) { clock.elapsed += dt; clock.observedAt = now; }
  if (now + 1e-9 < clock.sampledAt + CHECK_INTERVAL) return;
  const elapsed = clock.elapsed;
  clock.sampledAt = now; clock.elapsed = 0;
  return elapsed;
}

export function runRecurringWork(state: GameState, key: string, dt: number, run: (elapsed: number) => void): boolean {
  const elapsed = recurringWorkElapsed(state, key, dt);
  if (elapsed === undefined) return false;
  run(elapsed);
  return true;
}
