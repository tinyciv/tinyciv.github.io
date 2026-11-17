import { achievementEffect } from './achievement-effects';
import { hasLeaderAbility } from './leader-abilities';
import { type GameState, type Unit, unitMaxHp } from './types';
import { insideOwnBorders, territory } from './borders';
import { healerShackHealingQuery } from './healer-shack';
import { entityStore, type EntityStore } from './entity-store';
import { simulationReadsActive } from './simulation-reads';
import { CHECK_INTERVAL } from './work-cadence';
import { rustEngine } from './rust-engine';
import { SIM_ENGINE, SimSlot, simCore, type SimCore } from './sim-handle';

export const UNIT_REGEN_DELAY = rustEngine.health_constant(0);
export const UNIT_REGEN_PER_SECOND = rustEngine.health_constant(1);
const initialized = new WeakMap<GameState, EntityStore>();
const INPUT_STRIDE = 7, OUTPUT_STRIDE = 3;

/** Separate persistent worlds for sparse clock initialization and wounded
 * integration prevent those two different rosters from replacing each other. */
class HealthBatch {
  readonly handle: number;
  readonly pending: Unit[] = [];
  private capacity = 0;
  private pointer = 0;
  private inputView?: Float64Array;
  private outputView?: Float64Array;
  private results = new Float64Array(0);
  values = new Float64Array(0);
  count = 0;
  constructor(readonly store: EntityStore, readonly world: GameState['world'], readonly core: SimCore, mode: 0 | 1) {
    this.handle = core.engine(this, mode ? SIM_ENGINE.healthRegeneration : SIM_ENGINE.healthInitialization);
  }
  reserve(count: number): void {
    if (count <= this.capacity) return;
    this.capacity = Math.max(8, 2 ** Math.ceil(Math.log2(count)));
    this.values = new Float64Array(this.capacity * INPUT_STRIDE);
    this.results = new Float64Array(this.capacity * OUTPUT_STRIDE);
    this.pointer = rustEngine.health_input(this.handle, this.capacity);
  }
  run(state: GameState, count: number, dt: number, mode: number): Float64Array {
    // Discovery callbacks can grow WASM memory. Copy only after every sampled
    // input is ready, and recreate borrowed views only when their memory grows.
    if (!this.inputView || this.inputView.buffer !== rustEngine.memory.buffer || this.inputView.byteOffset !== this.pointer || this.inputView.length !== this.values.length)
      this.inputView = new Float64Array(rustEngine.memory.buffer, this.pointer, this.values.length);
    this.inputView.set(this.values);
    const pointer = rustEngine.health_run(this.handle, count, state.time, dt, mode);
    if (!this.outputView || this.outputView.buffer !== rustEngine.memory.buffer || this.outputView.byteOffset !== pointer || this.outputView.length !== this.results.length)
      this.outputView = new Float64Array(rustEngine.memory.buffer, pointer, this.capacity * OUTPUT_STRIDE);
    // Publishing role changes can allocate ECS archetypes and grow memory.
    // Keep one reusable host snapshot before applying those publications.
    this.results.set(this.outputView);
    this.count = count;
    return this.results;
  }
}
const batches = [new SimSlot<HealthBatch>(), new SimSlot<HealthBatch>()] as const;
function healthBatch(state: GameState, store: EntityStore, mode: 0 | 1): HealthBatch {
  let batch = batches[mode].get(state);
  if (!batch || batch.store !== store || batch.world !== state.world)
    batch = batches[mode].set(state, new HealthBatch(store, state.world, simCore(state), mode));
  return batch;
}
function healthRow(batch: HealthBatch, row: number, unit: Unit, flags: number, multiplier = 1): void {
  const index = row * INPUT_STRIDE, input = batch.values;
  input[index] = unit.id; input[index + 1] = unit.hp; input[index + 2] = unitMaxHp(unit);
  input[index + 3] = unit.lastDamagedAt ?? NaN; input[index + 4] = unit.lastCombat;
  input[index + 5] = flags | (unit.lastDamagedAt === undefined ? 8 : 0) | (unit.warship ? 16 : 0); input[index + 6] = multiplier;
}
interface HealingSample {
  store: EntityStore; world: GameState['world']; at: number; borders: ReturnType<typeof territory>;
  multiplier: ReturnType<typeof healerShackHealingQuery>;
}
const samples = new WeakMap<GameState, HealingSample>();
const bonuses = new WeakMap<GameState, WeakMap<object, { at: number; value: number }>>();

/** Old saves only recorded combat activity. Use that once as a conservative
 * fallback, before this frame's attacks can alter it. New hits have their own clock. */
export function initializeUnitDamageTimes(state: GameState): void {
  const store = entityStore(state), units = store.units;
  // Import/fixture setup may populate entities before assigning initial health.
  // Reconcile once at the first simulation step, then damage sites own changes.
  if (initialized.get(state) !== store) {
    for (const unit of state.units) units.updateRoles(unit, false);
    initialized.set(state, store);
  }
  let batch: HealthBatch | undefined;
  for (const unit of simulationReadsActive(state) ? units.query('damageClock') : state.units) if (!Number.isFinite(unit.lastDamagedAt)) {
    if (!batch) { batch = healthBatch(state, store, 0); batch.pending.length = 0; }
    batch.pending.push(unit);
  }
  if (!batch) return;
  batch.reserve(batch.pending.length);
  batch.pending.forEach((unit, row) => healthRow(batch!, row, unit, 0));
  const output = batch.run(state, batch.pending.length, 0, 0);
  for (let row = 0; row < batch.pending.length; row++) {
    if (!(output[row * OUTPUT_STRIDE + 2] & 1)) continue;
    const unit = batch.pending[row]; unit.lastDamagedAt = output[row * OUTPUT_STRIDE + 1];
    units.updateRoles(unit, false);
  }
}

/** Run after all impacts and melee attacks so deaths cannot be undone and a hit
 * on this step prevents healing. Only the portion beyond the delay is credited. */
export function regenerateUnits(state: GameState, dt: number): void {
  const store = entityStore(state), units = store.units, trusted = simulationReadsActive(state);
  let borders: ReturnType<typeof territory> | undefined;
  let healingMultiplier: ReturnType<typeof healerShackHealingQuery> | undefined;
  // HP integration and damage deadlines remain exact. Discovery of territory
  // and nearby healers is sampled; a border lookup is just one indexed cell.
  const sample = (): HealingSample => {
    let value = samples.get(state);
    if (!value || value.store !== store || value.world !== state.world || state.time < value.at || state.time + 1e-9 >= value.at + CHECK_INTERVAL) {
      if (!value || value.store !== store || value.world !== state.world || state.time < value.at) bonuses.delete(state);
      value = { store, world: state.world, at: state.time, borders: territory(state), multiplier: healerShackHealingQuery(state) };
      samples.set(state, value);
    }
    return value;
  };
  const wounded = trusted ? units.query('wounded') : state.units;
  if (!wounded.length) {
    const previous = batches[1].get(state);
    if (previous?.count && previous.store === store && previous.world === state.world) previous.run(state, 0, dt, 1);
    return;
  }
  const factions = new Map(state.factions.map(faction => [faction.id, faction]));
  const batch = healthBatch(state, store, 1); batch.reserve(wounded.length);
  for (let row = 0; row < wounded.length; row++) {
    const unit = wounded[row];
    const leader = unit.faction === -2 && unit.marauderLeader;
    const discretion = unit.order === 'flee' && hasLeaderAbility(unit, 'discretion');
    let flags = (leader ? 2 : 0) | (discretion ? 4 : 0);
    if (unit.hp <= 0 || unit.hp >= unitMaxHp(unit)) { healthRow(batch, row, unit, flags); continue; }
    const ownBorders = insideOwnBorders(state, unit.faction, unit.x, unit.y, borders ??= trusted ? sample().borders : territory(state));
    if (!leader && !discretion && !ownBorders) {
      healthRow(batch, row, unit, flags); continue;
    }
    flags |= 1;
    const quietSince = leader ? Math.max(unit.lastDamagedAt ?? state.time, unit.lastCombat) : unit.lastDamagedAt ?? state.time;
    let multiplier = 1;
    // This cheap preflight preserves when expensive healer samples are taken.
    // The ECS alone integrates elapsed healing and decides the resulting HP.
    if (dt > 0 && state.time - quietSince - (discretion ? 0 : UNIT_REGEN_DELAY) > 0) {
      healingMultiplier ??= trusted ? sample().multiplier : healerShackHealingQuery(state);
      if (trusted) {
        let byUnit = bonuses.get(state);
        if (!byUnit) { byUnit = new WeakMap(); bonuses.set(state, byUnit); }
        let bonus = byUnit.get(unit);
        if (!bonus || state.time < bonus.at || state.time + 1e-9 >= bonus.at + CHECK_INTERVAL) {
          bonus = { at: state.time, value: healingMultiplier(unit) }; byUnit.set(unit, bonus);
        }
        multiplier = bonus.value;
      } else multiplier = healingMultiplier(unit);
    }
    healthRow(batch, row, unit, flags, achievementEffect(factions.get(unit.faction), 2, multiplier, Number(ownBorders)));
  }
  const output = batch.run(state, wounded.length, dt, 1);
  for (let row = 0; row < wounded.length; row++) {
    const unit = wounded[row], index = row * OUTPUT_STRIDE, status = output[index + 2];
    if (status & 8) unit.hp = output[index];
    if (status & 4) unit.healerHealingAt = state.time;
    if (status & 2) units.updateRoles(unit, false);
  }
}
