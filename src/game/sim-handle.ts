import { rustEngine } from './rust-engine';
import type { GameState } from './types';

/** One native simulation core (rust/src/sim) per GameState.
 *
 * The core is a bevy World holding the clock, the single mulberry32 stream
 * and the table of staged engines the game owns. Every module that used to
 * keep its own `WeakMap<GameState, engine>` stores its host view in a
 * `SimSlot` and creates its native engine through `simEngine`, so the game
 * owns exactly one native handle and dropping it releases every engine.
 *
 * Native-owned mirrors written here only: `rngState` (after each draw),
 * `simCore` (consumed when the core imports it; saves write a fresh one),
 * `time` (after each substep advance) and `tick` (after each economy tick).
 * `speed`, `paused`, `gameOver`, `victory` and `victoryContinued` are still
 * decided by TypeScript and synchronized into the clock before it advances
 * and before a save. A host write to `time`/`tick` (fixtures, editor) is
 * adopted as a clock patch by the next clock command. */

/** rust/src/sim/mod.rs EngineKind. */
export const SIM_ENGINE = {
  movement: 1, settlement: 2, morale: 3, healthInitialization: 4, healthRegeneration: 5, projectiles: 6,
  construction: 7, research: 8, population: 9, pathBudget: 10,
} as const;
export type SimEngineKind = typeof SIM_ENGINE[keyof typeof SIM_ENGINE];

const OUTBOX = { time: 0, tick: 1, rng: 2 } as const;
const dropSims = new FinalizationRegistry<number>(handle => rustEngine.sim_drop(handle));
const releaseEngines = new FinalizationRegistry<{ sim: number; kind: number; engine: number }>(
  value => rustEngine.sim_engine_release(value.sim, value.kind, value.engine));

export class SimCore {
  readonly handle: number;
  /** Host views (wrappers, caches) of this game's engines, keyed by SimSlot. */
  readonly slots = new Map<number, unknown>();
  private outboxView?: Float64Array;
  private time: number;
  private tick: number;
  private speed = NaN;
  private flags = -1;
  constructor(state: GameState, seed: number) {
    this.handle = rustEngine.sim_create(seed);
    dropSims.register(this, this.handle);
    this.time = state.time; this.tick = state.tick;
    rustEngine.sim_clock_set(this.handle, state.time, state.tick);
    this.syncFlags(state);
  }
  outbox(): Float64Array {
    if (!this.outboxView || this.outboxView.buffer !== rustEngine.memory.buffer)
      this.outboxView = new Float64Array(rustEngine.memory.buffer, rustEngine.sim_outbox(this.handle), 8);
    return this.outboxView;
  }
  /** Creates an engine owned by this game. `owner` is the host view that uses
   * it; when the view is collected the engine is released early, and the
   * rest are released with the game. The owner must keep this core alive. */
  engine(owner: object, kind: SimEngineKind, a = 0, b = 0, c = 0): number {
    const engine = rustEngine.sim_engine_create(this.handle, kind, a, b, c);
    releaseEngines.register(owner, { sim: this.handle, kind, engine });
    return engine;
  }
  syncFlags(state: GameState, paused = state.paused): void {
    const flags = Number(!!paused) | Number(!!state.gameOver) << 1 | Number(!!state.victory) << 2 | Number(!!state.victoryContinued) << 3;
    if (flags === this.flags && Object.is(state.speed, this.speed)) return;
    this.flags = flags; this.speed = state.speed;
    rustEngine.sim_clock_flags(this.handle, state.speed, flags & 1, flags >> 1 & 1, flags >> 2 & 1, flags >> 3 & 1);
  }
  /** A host-written time or tick is a fixture/editor clock patch. */
  adoptClock(state: GameState): void {
    if (state.time === this.time && state.tick === this.tick) return;
    this.time = state.time; this.tick = state.tick;
    rustEngine.sim_clock_set(this.handle, state.time, state.tick);
  }
  mirrorClock(state: GameState): void {
    const outbox = this.outbox();
    state.time = this.time = outbox[OUTBOX.time];
    state.tick = this.tick = outbox[OUTBOX.tick];
  }
  mirrorRandom(state: GameState): void { state.rngState = this.outbox()[OUTBOX.rng]; }
}

const cores = new WeakMap<GameState, SimCore>();

/** A per-game host view, replacing a module-level WeakMap<GameState, T>. */
export class SimSlot<T> {
  private static next = 0;
  private readonly key = SimSlot.next++;
  get(state: GameState): T | undefined { return cores.get(state)?.slots.get(this.key) as T | undefined; }
  set(state: GameState, value: T): T { simCore(state).slots.set(this.key, value); return value; }
  delete(state: GameState): void { cores.get(state)?.slots.delete(this.key); }
}

function create(state: GameState, seed: number): SimCore {
  const core = new SimCore(state, seed);
  cores.set(state, core);
  if (typeof state.simCore === 'string') {
    const values = decode(state.simCore);
    const pointer = rustEngine.sim_import_input(core.handle, values.length);
    new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
    if (!rustEngine.sim_import_commit(core.handle, values.length)) throw new Error('The saved simulation state is invalid.');
    core.mirrorClock(state); core.mirrorRandom(state);
    // The core keeps the restored sections; later clones of this state seed
    // from its live mirrors instead of re-importing a stale snapshot.
    delete state.simCore;
  }
  return core;
}

/** The game's core, created on first use from the saved snapshot or from the
 * state's mirrors (hand-built fixtures, clones and development handoffs). */
export function simCore(state: GameState): SimCore { return cores.get(state) ?? create(state, state.rngState); }

/** New-game creation: `sim_create(seed)`. */
export function createSimulation(state: GameState, seed: number): SimCore {
  const core = create(state, seed);
  core.mirrorRandom(state);
  return core;
}

/** One draw in [0, 1) from the game's mulberry32 stream. */
export function simRandom(state: GameState): number {
  const core = simCore(state), value = rustEngine.sim_random(core.handle);
  core.mirrorRandom(state);
  return value;
}

/** Fixture/editor command: restart the random stream from `seed`. */
export function seedSimulationRandom(state: GameState, seed: number): void {
  const core = simCore(state);
  rustEngine.sim_seed(core.handle, seed);
  core.mirrorRandom(state);
}

/** Fixture/editor command: set simulated time (and the economy tick). */
export function patchSimulationClock(state: GameState, time: number, tick = state.tick): void {
  const core = simCore(state);
  rustEngine.sim_clock_set(core.handle, time, tick);
  core.mirrorClock(state);
}

/** Start of a simulation substep: simulated time advances by `dt`. */
export function advanceSimulationClock(state: GameState, dt: number): void {
  const core = simCore(state);
  core.adoptClock(state); core.syncFlags(state);
  rustEngine.sim_advance(core.handle, dt);
  core.mirrorClock(state);
}

/** Consumes one due economy tick (tick < floor((time + 1e-7) / interval)). */
export function takeEconomyTick(state: GameState, interval: number): boolean {
  const core = simCore(state);
  core.adoptClock(state);
  if (!rustEngine.sim_economy_tick(core.handle, interval)) return false;
  core.mirrorClock(state);
  return true;
}

/** Sectioned native snapshot for GameState.simCore, taken at the instant the
 * dynamic state is serialized (section 0 clock/RNG, section 1 settlements). */
export function flushSimulationSnapshot(state: GameState, paused = state.paused): string {
  const core = simCore(state);
  core.adoptClock(state); core.syncFlags(state, paused);
  const length = rustEngine.sim_export(core.handle);
  const values = new Float64Array(rustEngine.memory.buffer, rustEngine.sim_export_ptr(core.handle), length).slice();
  core.syncFlags(state);
  return encode(values);
}

/** True when a parsed save or development handoff carries a simulation core
 * (or, for a live-state handoff, its mirrors). */
export function restorableSimulation(saved: Partial<GameState>): boolean {
  return typeof saved.simCore === 'string' || Number.isFinite(saved.rngState);
}

function encode(values: Float64Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 16384) binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
  return btoa(binary);
}
function decode(encoded: string): Float64Array {
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Float64Array(bytes.buffer, 0, Math.floor(bytes.length / 8));
}
