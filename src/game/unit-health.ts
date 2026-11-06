import { hasLeaderAbility } from './leader-abilities';
import { type GameState, unitMaxHp } from './types';
import { insideOwnBorders, territory } from './borders';
import { healerShackHealingQuery } from './healer-shack';
import { entityStore, type EntityStore } from './entity-store';
import { simulationReadsActive } from './simulation-reads';
import { CHECK_INTERVAL } from './work-cadence';

export const UNIT_REGEN_DELAY = 15;
export const UNIT_REGEN_PER_SECOND = 2.4;
const initialized = new WeakMap<GameState, EntityStore>();
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
  for (const unit of simulationReadsActive(state) ? units.query('damageClock') : state.units) if (!Number.isFinite(unit.lastDamagedAt)) {
    unit.lastDamagedAt = Number.isFinite(unit.lastCombat) ? Math.min(state.time, unit.lastCombat) : state.time;
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
  for (const unit of simulationReadsActive(state) ? units.query('wounded') : state.units) {
    const leader = unit.faction === -2 && unit.marauderLeader;
    const discretion = unit.order === 'flee' && hasLeaderAbility(unit, 'discretion');
    if (unit.hp <= 0 || unit.hp >= unitMaxHp(unit)) { units.updateRoles(unit, false); continue; }
    if (!leader && !discretion && !insideOwnBorders(state, unit.faction, unit.x, unit.y, borders ??= trusted ? sample().borders : territory(state))) continue;
    const quietSince = leader ? Math.max(unit.lastDamagedAt ?? state.time, unit.lastCombat) : unit.lastDamagedAt ?? state.time;
    const healingTime = Math.min(dt, Math.max(0, state.time - quietSince - (discretion ? 0 : UNIT_REGEN_DELAY)));
    if (healingTime > 0) {
      healingMultiplier ??= trusted ? sample().multiplier : healerShackHealingQuery(state);
      let multiplier: number;
      if (trusted) {
        let byUnit = bonuses.get(state);
        if (!byUnit) { byUnit = new WeakMap(); bonuses.set(state, byUnit); }
        let bonus = byUnit.get(unit);
        if (!bonus || state.time < bonus.at || state.time + 1e-9 >= bonus.at + CHECK_INTERVAL) {
          bonus = { at: state.time, value: healingMultiplier(unit) }; byUnit.set(unit, bonus);
        }
        multiplier = bonus.value;
      } else multiplier = healingMultiplier(unit);
      unit.hp = Math.min(unitMaxHp(unit), unit.hp + healingTime * UNIT_REGEN_PER_SECOND * multiplier);
      if (multiplier > 1) unit.healerHealingAt = state.time;
      if (unit.hp >= unitMaxHp(unit)) units.updateRoles(unit, false);
    }
  }
}
