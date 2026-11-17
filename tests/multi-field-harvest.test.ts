import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { beginCollectorFrame, endCollectorFrame, ensureCollectors, FIELD_HARVEST_FOOD,
  harvestFoodPerEconomyCycle, synchronizeFarms, updateCollector, updateHarvests } from '../src/game/farms';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { cityDevelopmentNeeds } from '../src/game/governor';
import { moveUnit } from '../src/game/simulation';
import { beginUnitFrame, endUnitFrame } from '../src/game/spatial';
import type { Building, GameState, Unit } from '../src/game/types';

const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, kind, x, y, faction: 0, hp: 200, maxHp: 200, capacity: kind === 'palace' ? 4 : 0,
  unhousedResidents: kind === 'palace' ? 2 : undefined, governorPermissions: { farms: false, housing: false },
});
function fixture(points = [[8, 8], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8]]): GameState {
  const state: GameState = {
    world: { width: 30, height: 20, revision: 0, seed: 'multi-pickup', source: 'test', spawns: [],
      tiles: Array.from({ length: 600 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 3, 8), ...points.map(([x, y], i) => building(100 + i, 'camp', x, y))],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self',
      food: 20, gold: 20, production: 0, population: 2, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 10, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'multi-pickup', rngState: 1,
  };
  synchronizeFarms(state);
  state.fields!.forEach((field, i) => Object.assign(field, {
    food: 1, foodBatches: [{ amount: 1, expiresAt: 40 }], expiresAt: 40, nextHarvest: 1e9,
  }));
  ensureCollectors(state);
  expect(state.units.filter(unit => unit.collector)).toHaveLength(1);
  return state;
}
function arriveAtFirst(state: GameState): Unit {
  const worker = state.units.find(unit => unit.collector)!, first = state.fields![0];
  Object.assign(worker, { x: first.x + .5, y: first.y + .5, inside: false, field: first.id, collectPhase: 'outbound' });
  first.claimedBy = worker.id;
  return worker;
}
function tick(state: GameState, worker: Unit): void {
  state.time += .05; state.tick++;
  updateHarvests(state);
  if (state.tick % 7 === 0) ensureCollectors(state);
  beginCollectorFrame(state); beginUnitFrame(state);
  try { updateCollector(state, worker, .05, moveUnit); }
  finally { endUnitFrame(state); endCollectorFrame(state); }
}

describe('multi-field harvest trips', () => {
  it('needs exactly25% fewer equally productive tiles before spoilage, and uses the new yield in city planning', () => {
    expect(FIELD_HARVEST_FOOD).toBeCloseTo(.8 * 4 / 3);
    const perCycle = harvestFoodPerEconomyCycle(FIELD_HARVEST_FOOD);
    expect(1 / perCycle).toBeCloseTo(2.5 * .75);
    const state = fixture([[6, 7], [6, 8], [6, 9]]);
    expect(cityDevelopmentNeeds(state, state.buildings[0]).foodCapacity).toBeCloseTo(4 + 3 * perCycle * .9);
  });

  it('one arrival collects six connected plots as one load and immediately returns home', () => {
    const state = fixture(), worker = arriveAtFirst(state);
    tick(state, worker);
    expect(worker.cargo).toBe(6); expect(worker.field).toBeUndefined();
    expect(worker.collectPhase).toBe('returning');
    expect(worker.cargoBatches).toEqual([{ amount: 6, expiresAt: 40 }]);
    expect(state.fields!.every(field => field.food === 0 && field.claimedBy === undefined)).toBe(true);
    const foodBefore = state.factions[0].food;
    for (let i = 0; i < 200 && !worker.inside; i++) tick(state, worker);
    expect(worker.inside).toBe(true); expect(worker.cargo).toBe(0);
    expect(state.factions[0].food).toBe(foodBefore + 6);
  });

  it('coalesces the load while preserving distinct deadlines after parcels merge', () => {
    const state = fixture([[8, 8], [9, 8]]), worker = arriveAtFirst(state), first = state.fields![0];
    first.expiresAt = 12.6; first.foodBatches = [{ amount: 1, expiresAt: 12.6 }];
    tick(state, worker);
    expect(worker.collectPhase).toBe('returning');
    expect(worker.cargoBatches).toEqual([{ amount: 1, expiresAt: 12.6 }, { amount: 1, expiresAt: 40 }]);
    expect(worker.cargoExpiresAt).toBe(12.6);
    expect(state.fields![1].food).toBe(0);
  });

  it('leaves already expired grain out of the parcel load', () => {
    const state = fixture([[8, 8], [9, 8]]), worker = arriveAtFirst(state), next = state.fields![1];
    next.expiresAt = 10; next.foodBatches = [{ amount: 1, expiresAt: 10 }];
    tick(state, worker);
    expect(worker.collectPhase).toBe('returning'); expect(next.claimedBy).toBeUndefined();
    expect(worker.cargoBatches).toEqual([{ amount: 1, expiresAt: 40 }]);
  });

  it.each(['forbidden', 'reserved', 'foreign'] as const)('excludes a %s tile from a parcel pickup', restriction => {
    const state = fixture([[8, 8], [9, 8]]), worker = arriveAtFirst(state), next = state.fields![1];
    if (restriction === 'forbidden') setForbiddenRectangle(state, next, next, true);
    if (restriction === 'reserved') next.claimedBy = 999;
    if (restriction === 'foreign') { next.faction = 1; state.buildings.find(b => b.id === next.camp)!.faction = 1; }
    updateCollector(state, worker, .05, moveUnit);
    expect(worker.cargo).toBe(1); expect(next.food).toBe(1);
  });

  it('does not turn a nearby field across water into a long pickup detour', () => {
    const state = fixture([[8, 8], [10, 8]]), worker = arriveAtFirst(state);
    for (let y = 2; y < state.world.height; y++) state.world.tiles[y * state.world.width + 9].terrain = 'lake';
    state.world.revision!++;
    tick(state, worker);
    expect(worker.collectPhase).toBe('returning'); expect(state.fields![1].claimedBy).toBeUndefined();
  });

  it.each(['forbidden', 'reserved', 'foreign', 'other-city'] as const)('does not collect a %s neighboring farm', restriction => {
    const state = fixture([[8, 8], [10, 8]]), worker = arriveAtFirst(state), next = state.fields![1];
    if (restriction === 'forbidden') setForbiddenRectangle(state, next, next, true);
    if (restriction === 'reserved') {
      const other = { ...worker, id: 999, field: next.id, collectorCamp: next.camp, x: 11.5, y: 8.5 };
      entityStore(state).units.add(other); next.claimedBy = other.id;
    }
    if (restriction === 'foreign') { next.faction = 1; state.buildings.find(b => b.id === next.camp)!.faction = 1; }
    if (restriction === 'other-city') entityStore(state).buildings.add(building(200, 'palace', 12, 8));
    tick(state, worker);
    expect(worker.collectPhase).toBe('returning'); expect(next.food).toBe(1);
    expect(next.claimedBy).not.toBe(worker.id);
  });

  it('abandons a pickup when its target changes ownership before arrival', () => {
    const state = fixture([[8, 8], [9, 8]]), worker = state.units.find(unit => unit.collector)!;
    updateCollector(state, worker, .05, moveUnit);
    const target = state.fields!.find(field => field.id === worker.field)!;
    worker.x = 6.5; // Interrupt after the worker has left the settlement door.
    target.faction = 1; state.buildings.find(b => b.id === target.camp)!.faction = 1;
    tick(state, worker);
    expect(worker.collectPhase).toBe('returning'); expect(target.claimedBy).toBeUndefined();
    expect(worker.cargo).toBe(0); expect(target.food).toBe(1);
  });
});
