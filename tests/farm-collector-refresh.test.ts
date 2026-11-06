import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { farmCityQuery } from '../src/game/farm-travel';
import { ensureCollectors, synchronizeFarms } from '../src/game/farms';
import type { Building, GameState } from '../src/game/types';

function fixture() {
  const building = (id: number, kind: Building['kind'], x: number, y: number): Building =>
    ({ id, kind, faction: 0, x, y, hp: 650, maxHp: 650, capacity: kind === 'palace' ? 5 : 0,
      unhousedResidents: kind === 'palace' ? 5 : undefined });
  const left = building(1, 'palace', 2, 10), right = building(2, 'palace', 24, 10), farm = building(3, 'camp', 12, 10);
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'courier-refresh', source: 'test', revision: 0, spawns: [],
      tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [left, right, farm], units: [], fields: [],
    factions: [{ id: 0, name: 'Home', color: '#f43', affinity: 100, relation: 'self', population: 10,
      food: 100, gold: 1000, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, speed: 1, paused: false, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'courier-refresh', rngState: 1,
  };
  synchronizeFarms(state); ensureCollectors(state);
  const courier = state.units.find(unit => unit.collectorCamp === farm.id)!;
  expect(courier.home).toBe(left.id);
  return { state, left, right, farm, courier, building };
}

function addRoad(state: GameState, index: number): void {
  // Ten paved cells make the originally farther eastern palace the shorter
  // journey. Remaining edits are distant roads used to complete the batch.
  entityStore(state).buildings.add({ id: 1000 + index, kind: 'road', faction: 0,
    x: index < 10 ? 14 + index : index - 10, y: index < 10 ? 10 : 21,
    hp: 100, maxHp: 100, capacity: 0 });
  state.world.revision!++;
}

describe('courier assignments follow published farming travel maps', () => {
  it('keeps the old home during a road batch and reassigns the same courier on the twentieth edit', () => {
    const { state, left, right, farm, courier } = fixture();
    for (let edit = 0; edit < 19; edit++) {
      addRoad(state, edit); ensureCollectors(state);
      expect(courier.home).toBe(left.id);
    }
    addRoad(state, 19);
    // A city label or planner may publish the map before staffing next runs.
    expect(farmCityQuery(state, 0)(farm)?.id).toBe(right.id);
    ensureCollectors(state);
    expect(courier.home).toBe(right.id);
    expect(state.units.filter(unit => unit.collectorCamp === farm.id)).toEqual([courier]);
  });

  it('revisits a cached home when the final road batch times out without another structural edit', () => {
    const { state, left, right, farm, courier } = fixture();
    for (let edit = 0; edit < 10; edit++) addRoad(state, edit);
    ensureCollectors(state);
    expect(courier.home).toBe(left.id);
    state.time = 6.6;
    ensureCollectors(state);
    expect(courier.home).toBe(left.id);
    state.time = 6.7;
    expect(farmCityQuery(state, 0)(farm)?.id).toBe(right.id);
    ensureCollectors(state);
    expect(courier.home).toBe(right.id);
  });

  it('immediately assigns an existing courier to a newly completed nearby palace with residents', () => {
    const { state, courier, building } = fixture();
    addRoad(state, 0); ensureCollectors(state); // Leave an ordinary edit pending.
    const palace = building(5000, 'palace', 8, 10);
    state.factions[0].population += 5;
    entityStore(state).buildings.add(palace);
    state.world.revision!++;
    ensureCollectors(state);
    expect(courier.home).toBe(palace.id);
  });
});
