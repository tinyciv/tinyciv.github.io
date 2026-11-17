import { entityStore, type EntityStore } from './entity-store';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import type { GameState } from './types';
import { traceOrchestration } from './orchestration-trace';

/** Average recurring sensing/maintenance ceiling, in simulation seconds.
 * Rendering and UI use the equivalent wall-clock interval. Movement, collision
 * and hit resolution remain on the fast clock; explicit commands are events. */
export const MAX_CHECK_HZ = 3;
export const CHECK_INTERVAL = 1 / MAX_CHECK_HZ;
export const CHECK_INTERVAL_MS = 1000 / MAX_CHECK_HZ;

// Host bridge to the native work scheduler (rust/src/sim/work.rs). Rust owns
// every recurring clock, the cadence of each key (broad reconciliation passes
// tolerate a half-second delay; harvests, courier wakeups, research, tactical
// decisions and UI keep 3 Hz), the FIFO interactive budget and the
// immediate/deferred scopes. This module interns key names, forwards the
// host clock and tells Rust when the state it schedules was replaced.

const keyIds = new Map<string, number>();
function workKey(key: string): number {
  let id = keyIds.get(key);
  if (id === undefined) {
    // Reserve the input first: growing WASM memory detaches earlier buffers.
    const pointer = rustEngine.work_key_input(key.length);
    const input = new Float64Array(rustEngine.memory.buffer, pointer, key.length);
    for (let index = 0; index < key.length; index++) input[index] = key.charCodeAt(index);
    id = rustEngine.work_key_commit(key.length); keyIds.set(key, id);
  }
  return id;
}
export function recurringWorkInterval(key: string): number { return rustEngine.work_key_interval(workKey(key)); }

const BUDGET = 0, IMMEDIATE = 1, DEFERRED = 2;
function withScope<T>(state: GameState, scope: number, run: () => T): T {
  const sim = simCore(state).handle;
  if (!rustEngine.sim_work_enter(sim, scope)) return run();
  try { return run(); } finally { rustEngine.sim_work_exit(sim, scope); }
}

/** Optional interactive scheduling. FIFO overdue work receives one admission
 * per substep; all four continuously requested expensive keys run within four
 * substeps. First-use initialization joins that same queue. Direct callers and
 * explicit publications remain immediate, and pending elapsed credit is never spent. */
export function withRecurringWorkBudget<T>(state: GameState, run: () => T): T { return withScope(state, BUDGET, run); }

/** Small interactive transactions publish their entity edits immediately and
 * let their owner reconcile staffing on a later frame. Do not consume any
 * recurring deadline or elapsed credit while that work is deferred. */
export function withDeferredMaintenance<T>(state: GameState, run: () => T): T { return withScope(state, DEFERRED, run); }

/** Explicit orders must publish staffing and rates even while paused. They
 * can still share trusted reads and coalesce duplicate nested maintenance.
 * Each key runs at most once; elapsed integration and the next deadline use
 * the ordinary clock, so the following simulation step cannot double-count it. */
export function withImmediateMaintenance<T>(state: GameState, run: () => T): T { return withScope(state, IMMEDIATE, run); }

/** Keep an unrounded phase after late frames, skipping missed periods. Resetting
 * to now + period merges independent tasks into permanent expensive cohorts.
 * Actual observations can be one frame closer than the nominal interval. */
export function nextRecurringDeadline(deadline: number, now: number, interval = CHECK_INTERVAL): number {
  return rustEngine.cadence_next_deadline(deadline, now, interval);
}

interface ScheduledState { store: EntityStore; world: GameState['world']; tiles: GameState['world']['tiles'] }
const scheduled = new WeakMap<GameState, ScheduledState>();

/** Coalesce missed work into one pass and preserve elapsed integration time.
 * Revisions/events never bypass this schedule. A new state/import or clock rewind
 * starts a fresh schedule. Calling the same task twice in a step is harmless.
 * `initialPhase` overrides the key's own phase (fixtures). */
export function recurringWorkElapsed(state: GameState, key: string, dt: number, initialPhase?: number): number | undefined {
  const sim = simCore(state).handle, store = entityStore(state), previous = scheduled.get(state);
  if (!previous || previous.store !== store || previous.world !== state.world || previous.tiles !== state.world.tiles) {
    rustEngine.sim_work_reset(sim);
    scheduled.set(state, { store, world: state.world, tiles: state.world.tiles });
  }
  const elapsed = rustEngine.sim_work_elapsed(sim, workKey(key), state.time, dt, initialPhase ?? NaN);
  return Number.isNaN(elapsed) ? undefined : elapsed;
}

/** Initialize immediately, then distribute the first follow-up over one
 * interval. Subsequent checks retain their phase and average frequency rather
 * than piling every maintenance system onto the same rendering frame. */
export function runRecurringWork(state: GameState, key: string, dt: number, run: (elapsed: number) => void): boolean {
  const elapsed = recurringWorkElapsed(state, key, dt);
  if (elapsed === undefined) return false;
  traceOrchestration(state, 'work', key);
  run(elapsed);
  return true;
}
