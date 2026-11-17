import type { GameState, Unit } from './types';
import { HIDDEN_MARAUDER_UPDATE_DIVISOR, isScheduledMarauder } from './marauder-schedule';
import { rustEngine } from './rust-engine';
import { SIM_ENGINE, SimSlot, simCore, type SimCore } from './sim-handle';

// Rust owns the FIFO, per-update budget, reserved admissions and expiry. The
// bridge retains object identity and publishes deferred flags to actor views.
export const MOVEMENT_PATH_REQUESTS_PER_UPDATE = rustEngine.path_budget_limit();
class Schedule {
  readonly handle: number;
  active = false;
  time = 0;
  readonly deferred = new WeakSet<Unit>();
  private readonly tokens = new WeakMap<Unit, number>();
  private readonly pending = new Map<number, Unit>();
  private inputView?: Float64Array;
  private removedView?: Float64Array;
  private nextToken = 0;
  constructor(readonly core: SimCore, time: number) { this.handle = core.engine(this, SIM_ENGINE.pathBudget); this.time = time; }
  begin(time: number): void {
    const pointer = rustEngine.path_budget_input(this.handle);
    const count = rustEngine.path_budget_count(this.handle);
    if (!this.inputView || this.inputView.buffer !== rustEngine.memory.buffer || this.inputView.byteOffset !== pointer || this.inputView.length !== count * 3)
      this.inputView = new Float64Array(rustEngine.memory.buffer, pointer, count * 3);
    const input = this.inputView;
    for (let row = 0; row < count; row++) {
      const unit = this.pending.get(input[row * 3]);
      input[row * 3 + 1] = Number(!!unit && unit.hp > 0 && !unit.inside);
      input[row * 3 + 2] = unit && isScheduledMarauder(unit) ? HIDDEN_MARAUDER_UPDATE_DIVISOR : 1;
    }
    const removedPointer = rustEngine.path_budget_begin(this.handle);
    const removedCount = rustEngine.path_budget_removed_count(this.handle);
    if (!this.removedView || this.removedView.buffer !== rustEngine.memory.buffer || this.removedView.byteOffset !== removedPointer || this.removedView.length !== removedCount)
      this.removedView = new Float64Array(rustEngine.memory.buffer, removedPointer, removedCount);
    for (const token of this.removedView) this.pending.delete(token);
    this.time = time; this.active = true;
  }
  end(): void { rustEngine.path_budget_end(this.handle); this.active = false; }
  request(unit: Unit, immediate: boolean): boolean {
    this.deferred.delete(unit);
    let token = this.tokens.get(unit);
    if (token === undefined) { token = ++this.nextToken; this.tokens.set(unit, token); }
    const result = rustEngine.path_budget_request(this.handle, token, Number(immediate));
    if (result === 0) { this.pending.set(token, unit); this.deferred.add(unit); }
    else if (result === 1) this.pending.delete(token);
    return result !== 0;
  }
}
const schedules = new SimSlot<Schedule>();

export function withMovementPathBudget<T>(state: GameState, run: () => T): T {
  let schedule = schedules.get(state);
  if (schedule?.active) return run();
  if (!schedule || state.time < schedule.time) schedule = schedules.set(state, new Schedule(simCore(state), state.time));
  schedule.begin(state.time);
  try { return run(); } finally { schedule.end(); }
}

export function clearMovementPathDeferred(state: GameState, unit: Unit): void { schedules.get(state)?.deferred.delete(unit); }
export function movementPathDeferred(state: GameState, unit: Unit): boolean { return schedules.get(state)?.deferred.has(unit) ?? false; }
/** False means only "try a later update", never an unreachable destination. */
export function requestMovementPath(state: GameState, unit: Unit, immediate = false): boolean {
  const schedule = schedules.get(state);
  return schedule ? schedule.request(unit, immediate) : true;
}
