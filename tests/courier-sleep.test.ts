import { describe, expect, it } from 'vitest';
import { invalidateDecisions } from '../src/game/decision-schedule';
import { entityStore, resetEntities } from '../src/game/entity-store';
import { invalidateCourierSleep, prepareCourierUpdates, settleCourier, wakeCourier, wakeFarmCouriers } from '../src/game/courier-sleep';
import { ensureCollectors, FARM_IDLE_SECONDS, synchronizeFarms, updateCollector, updateHarvests } from '../src/game/farms';
import { beginUnitFrame, endUnitFrame, forEachNearbyUnit, nearbyUnits, refreshIndexedUnit } from '../src/game/spatial';
import { updateGame } from '../src/game/simulation';
import type { GameState, Unit } from '../src/game/types';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 24, height: 16, seed: 'sleeping-couriers', source: 'test', spawns: [],
      tiles: Array.from({ length: 384 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', x: 2, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 },
      { id: 2, kind: 'camp', x: 6, y: 7, faction: 0, hp: 100, maxHp: 100, capacity: 0 },
      { id: 3, kind: 'camp', x: 10, y: 7, faction: 0, hp: 100, maxHp: 100, capacity: 0 },
      // Three residents leave two gatherers after reserving one builder.
      { id: 4, kind: 'camp', x: 14, y: 12, faction: 0, hp: 100, maxHp: 100, capacity: 0 },
      { id: 5, kind: 'camp', x: 18, y: 12, faction: 0, hp: 100, maxHp: 100, capacity: 0 },
      { id: 6, kind: 'camp', x: 20, y: 12, faction: 0, hp: 100, maxHp: 100, capacity: 0 },
    ],
    units: [{ id: 10, kind: 'leader', faction: 0, x: 3.5, y: 10.5, hp: 100, morale: 100, attack: 1,
      defense: 0, speed: 2.2, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    fields: [], factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self',
      food: 20, gold: 20, production: 0, population: 3, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'sleeping-couriers', rngState: 1,
  };
  synchronizeFarms(state); ensureCollectors(state);
  for (const field of state.fields!) if (field.camp > 3) field.nextHarvest = 1000;
  updateHarvests(state);
  return state;
}
const couriers = (state: GameState) => entityStore(state).units.query('collector');
const active = (state: GameState, unit: Unit) => entityStore(state).units.query('active').includes(unit);
function sleep(state: GameState): void {
  prepareCourierUpdates(state);
  for (const unit of couriers(state)) settleCourier(state, unit);
}

describe('sleeping farm couriers', () => {
  it('keeps the same serializable entities and role views while preserving active order', () => {
    const state = fixture(), store = entityStore(state), workers = couriers(state), before = JSON.stringify(state);
    const revision = store.units.revision;
    sleep(state);
    expect(store.units.query('active')).toEqual([state.units[0]]);
    expect(couriers(state)).toBe(workers);
    expect(store.units.revision).toBe(revision);
    expect(JSON.stringify(state)).toBe(before);
    wakeCourier(state, workers[1]); wakeCourier(state, workers[0]);
    expect(store.units.query('active')).toEqual(state.units);
    expect(store.units.revision).toBe(revision);
  });

  it('does not read sleeping positions or fields on unchanged scheduling and spatial frames', () => {
    const state = fixture(); sleep(state);
    let reads = 0;
    for (const unit of couriers(state)) {
      const x = unit.x;
      Object.defineProperty(unit, 'x', { configurable: true, get: () => { reads++; return x; } });
    }
    for (const field of state.fields!) {
      const next = field.nextHarvest;
      Object.defineProperty(field, 'nextHarvest', { configurable: true, get: () => { reads++; return next; } });
    }
    for (let i = 0; i < 10; i++) {
      state.time += .01; prepareCourierUpdates(state); beginUnitFrame(state); endUnitFrame(state);
    }
    expect(reads).toBe(0);
  });

  it('preserves sleep for unchanged roles and wakes a worker reassigned to construction', () => {
    const state = fixture(), worker = couriers(state)[0], store = entityStore(state); sleep(state);
    const revision = store.units.revision;
    store.setUnitRole(worker, { kind: 'worker', collector: true });
    expect(active(state, worker)).toBe(false); expect(store.units.revision).toBe(revision);
    store.setUnitRole(worker, { kind: 'worker', collector: false, builder: true });
    expect(active(state, worker)).toBe(true);
    prepareCourierUpdates(state); settleCourier(state, worker);
    expect(active(state, worker)).toBe(true);
  });

  it('parks couriers in the real simulation and leaves idle retry clocks untouched between harvests', () => {
    const state = fixture(), input = { up: false, down: false, left: false, right: false };
    updateGame(state, .1, input);
    const workers = couriers(state), retryAt = workers.map(unit => unit.repathAt);
    expect(workers.every(unit => !active(state, unit))).toBe(true);
    for (let i = 0; i < 10; i++) updateGame(state, .1, input);
    expect(workers.map(unit => unit.repathAt)).toEqual(retryAt);
    expect(workers.every(unit => !active(state, unit))).toBe(true);
  });

  it('wakes only the ripe farm at its deadline and dispatches its existing courier', () => {
    const state = fixture(); sleep(state);
    const first = [...state.fields!].sort((a, b) => a.nextHarvest - b.nextHarvest)[0];
    const worker = couriers(state).find(unit => unit.collectorCamp === first.camp)!;
    state.time = first.nextHarvest - .01; prepareCourierUpdates(state);
    expect(active(state, worker)).toBe(false);
    state.time = first.nextHarvest; updateHarvests(state); prepareCourierUpdates(state);
    expect(couriers(state).filter(unit => active(state, unit))).toEqual([worker]);
    updateCollector(state, worker, .1, () => undefined);
    expect(worker.inside).toBe(false);
    expect(worker.collectPhase).toBe('outbound');
    expect(state.fields!.some(field => field.claimedBy === worker.id)).toBe(true);
  });

  it('reassigns and wakes a pooled gatherer when a previously unstaffed field ripens', () => {
    const state = fixture(), workers = [...couriers(state)]; sleep(state);
    const field = state.fields!.find(plot => plot.camp === 4)!;
    expect(workers.every(worker => worker.collectorCamp !== field.camp)).toBe(true);
    field.food = 3; field.expiresAt = 11; field.foodBatches = [{ amount: 3, expiresAt: 11 }];
    const input = { up: false, down: false, left: false, right: false };
    for (let step = 0; step < 8; step++) updateGame(state, .1, input);
    const gatherer = couriers(state).find(worker => worker.field === field.id)!;
    expect(workers).toContain(gatherer);
    expect(gatherer.inside).toBe(false);
    expect(active(state, gatherer)).toBe(true);
    expect(field.claimedBy).toBe(gatherer.id);
    expect(couriers(state)).toHaveLength(2);
  });

  it('wakes for fallow cultivation and orchard maturity without waiting for an idle polling tick', () => {
    const state = fixture(), worker = couriers(state)[0], farm = state.buildings.find(building => building.id === worker.collectorCamp)!;
    for (const field of state.fields!) if (field.camp === farm.id) { field.planted = false; field.nextHarvest = 500; }
    delete farm.farmFirstHarvestAt;
    sleep(state); state.time = FARM_IDLE_SECONDS; updateHarvests(state);
    expect(farm.farmFallow).toBe(true); expect(active(state, worker)).toBe(true);
    farm.farmFallow = false; farm.orchard = { startedAt: state.time, readyAt: state.time + 5 };
    prepareCourierUpdates(state); settleCourier(state, worker);
    expect(active(state, worker)).toBe(false);
    state.time += 5; prepareCourierUpdates(state);
    expect(active(state, worker)).toBe(true);
  });

  it.each([
    ['terrain', (state: GameState) => { state.world.revision = (state.world.revision ?? 0) + 1; }],
    ['commands', (state: GameState) => invalidateDecisions(state)],
    ['population', (state: GameState) => { state.factions[0].population++; }],
    ['allegiance', (state: GameState) => { state.factions[0].relation = 'confederated'; }],
    ['forbidden zones', (state: GameState) => { state.forbiddenZones = { revision: 1, cells: [10] }; }],
    ['building removal', (state: GameState) => { entityStore(state).buildings.retain(building => building.kind !== 'camp'); }],
  ])('wakes after %s changes', (_name, mutate) => {
    const state = fixture(); sleep(state); mutate(state); prepareCourierUpdates(state);
    expect(couriers(state).every(unit => active(state, unit))).toBe(true);
  });

  it('reconciles reassignment, capture, damage and death without waking unchanged farms', () => {
    const state = fixture(), [worker, other] = couriers(state); sleep(state);
    invalidateCourierSleep(state); prepareCourierUpdates(state);
    expect(active(state, worker)).toBe(false); expect(active(state, other)).toBe(false);
    worker.faction = 1; worker.home = 99; worker.collectorCamp = 99;
    invalidateCourierSleep(state); prepareCourierUpdates(state);
    expect(active(state, worker)).toBe(true); expect(active(state, other)).toBe(false);
    other.hp = 0; invalidateCourierSleep(state); prepareCourierUpdates(state);
    expect(active(state, other)).toBe(true);
    entityStore(state).units.retain(unit => unit.hp > 0); prepareCourierUpdates(state);
    expect(entityStore(state).units.query('active')).not.toContain(other);
  });

  it.each<Partial<Unit>>([
    { hp: 49 }, { cargo: 1 }, { cargoBatches: [{ amount: 1, expiresAt: 8 }] }, { cooldown: .1 }, { attackTime: .1 },
    { inside: false }, { collectPhase: 'returning' }, { order: 'flee', routed: true },
    { civilianPanic: { until: 6, threat: { x: 5, y: 5 }, previousOrder: 'work' } },
  ])('keeps units with continuous work active: %j', changes => {
    const state = fixture(), worker = couriers(state)[0]; Object.assign(worker, changes); sleep(state);
    expect(active(state, worker)).toBe(true);
  });

  it('keeps ripe capacity-blocked couriers active and wakes explicitly for farm events', () => {
    const state = fixture(), worker = couriers(state)[0];
    state.fields!.find(field => field.camp === worker.collectorCamp)!.food = 1;
    state.factions[0].population = 0; sleep(state);
    expect(active(state, worker)).toBe(true);
    const other = couriers(state)[1]; expect(active(state, other)).toBe(false);
    wakeFarmCouriers(state, other.collectorCamp!); expect(active(state, other)).toBe(true);
  });

  it('rebuilds scheduling after save reload and wakes on rewind, retaining IDs and cargo', () => {
    const state = fixture(); state.time = 10; sleep(state);
    const serialized = JSON.stringify(state), old = couriers(state)[0];
    Object.assign(state, JSON.parse(serialized)); resetEntities(state); prepareCourierUpdates(state);
    const loaded = couriers(state)[0];
    expect(loaded).not.toBe(old); expect(loaded.id).toBe(old.id); expect(active(state, loaded)).toBe(true);
    sleep(state); expect(active(state, loaded)).toBe(false);
    state.time = 1; prepareCourierUpdates(state); expect(active(state, loaded)).toBe(true);
    loaded.cargo = 1; loaded.cargoBatches = [{ amount: 1, expiresAt: 20 }]; settleCourier(state, loaded);
    expect(active(state, loaded)).toBe(true); expect(loaded.cargoBatches).toEqual([{ amount: 1, expiresAt: 20 }]);
  });

  it('omits sleepers from buckets while retaining other hidden/dead candidates and original ordering', () => {
    const state = fixture(), workers = couriers(state); sleep(state);
    beginUnitFrame(state);
    try {
      expect(nearbyUnits(state, { x: 4, y: 8 }, 20)).toEqual([state.units[0]]);
      for (const worker of [...workers].reverse()) {
        wakeCourier(state, worker); worker.inside = false; refreshIndexedUnit(state, worker);
      }
      expect(nearbyUnits(state, { x: 4, y: 8 }, 20)).toEqual(state.units);
      const indices: number[] = [];
      forEachNearbyUnit(state, { x: 4, y: 8 }, 20, (unit, order) => { expect(state.units[order]).toBe(unit); indices.push(order); });
      expect(indices).toHaveLength(3);
      workers[0].inside = true; settleCourier(state, workers[0]); refreshIndexedUnit(state, workers[0]);
      workers[1].hp = 0; refreshIndexedUnit(state, workers[1]);
      expect(nearbyUnits(state, { x: 4, y: 8 }, 20)).toEqual([state.units[0], workers[1]]);
    } finally { endUnitFrame(state); }
  });
});
