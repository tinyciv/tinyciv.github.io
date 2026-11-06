import { humanVisibilityViews, pointInSight, type FogView } from './fog';
import type { GameState, MarauderPack, Unit } from './types';

export const HIDDEN_MARAUDER_UPDATE_DIVISOR = 5;
interface Schedule {
  frame: number;
  time: number;
  views?: FogView[];
  units: WeakMap<Unit, { pending: number; frame: number }>;
}
const schedules = new WeakMap<GameState, Schedule>();

/** Only real simulation steps advance this clock. IDs spread work over five
 * phases without consuming randomness or depending on the observing client. */
export function beginMarauderFrame(state: GameState): void {
  let schedule = schedules.get(state);
  if (!schedule || state.time < schedule.time) {
    schedule = { frame: 0, time: state.time, units: new WeakMap() };
    schedules.set(state, schedule);
  }
  schedule.frame++; schedule.time = state.time; schedule.views = undefined;
}
export const isScheduledMarauder = (unit: Unit): boolean => unit.faction === -2 && unit.villageId === undefined;
function visible(state: GameState, schedule: Schedule, unit: Unit): boolean {
  if (unit.inside) return false;
  schedule.views ??= humanVisibilityViews(state);
  return schedule.views.some(view => pointInSight(view, unit.x, unit.y));
}
const phaseDue = (frame: number, id: number): boolean => frame % HIDDEN_MARAUDER_UPDATE_DIVISOR
  === ((id % HIDDEN_MARAUDER_UPDATE_DIVISOR) + HIDDEN_MARAUDER_UPDATE_DIVISOR) % HIDDEN_MARAUDER_UPDATE_DIVISOR;

/** Zero means skip sensing/planning this step. Movement and morale consume the
 * accumulated elapsed time once, never five replayed AI/pathfinding updates.
 * Cooldowns, already-acquired attacks, projectiles and healing stay fast. */
export function marauderUpdateElapsed(state: GameState, unit: Unit, dt: number): number {
  if (!isScheduledMarauder(unit)) return dt;
  const schedule = schedules.get(state)!;
  let clock = schedule.units.get(unit);
  // Do not charge time spent inactive inside a camp to a newly released unit.
  if (!clock || clock.frame !== schedule.frame - 1) {
    clock = { pending: 0, frame: schedule.frame - 1 }; schedule.units.set(unit, clock);
  }
  clock.pending += dt; clock.frame = schedule.frame;
  if (!visible(state, schedule, unit) && !phaseDue(schedule.frame, unit.id)) return 0;
  const elapsed = clock.pending; clock.pending = 0;
  return elapsed;
}

/** Shared pack objectives receive the same reduction when every member is
 * hidden; a visible member wakes the entire pack's strategic planning. */
export function marauderPackUpdateDue(state: GameState, pack: MarauderPack, members: readonly Unit[]): boolean {
  const schedule = schedules.get(state)!;
  return phaseDue(schedule.frame, pack.id) || members.some(unit => unit.hp > 0 && visible(state, schedule, unit));
}
