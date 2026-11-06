import { describe, expect, it } from 'vitest';
import { ensureCollectors, FIELD_HARVEST_FOOD, FIELD_HARVEST_SECONDS, synchronizeFarms } from '../src/game/farms';
import { updateGame } from '../src/game/simulation';
import type { GameState } from '../src/game/types';

/** One courier on open grassland isolates distance/decay from city traffic.
 * The stationary Leader visits the farm so abandonment is tested separately. */
function fixture(farmX: number): GameState {
  const width = 224, height = 24;
  const state: GameState = {
    world: { width, height, seed: 'decay-distance', source: 'test', spawns: [], tiles: Array.from({ length: width * height }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', faction: 0, x: 3, y: 10, hp: 650, maxHp: 650, capacity: 0, populationGrowth: -10000, governorPermissions: { farms: false, housing: false } },
      { id: 2, kind: 'camp', faction: 0, x: farmX, y: 10, hp: 100, maxHp: 100, capacity: 0 },
    ],
    units: [{ id: 3, kind: 'leader', faction: 0, x: farmX + .9, y: 10.9, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 1000, gold: 0, production: 0,
      population: 4, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 3, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'decay-distance', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 },
  };
  synchronizeFarms(state); ensureCollectors(state);
  return state;
}

function run(farmX: number, noDecay = false) {
  const state = fixture(farmX), firstHarvests = state.fields!.map(field => field.nextHarvest);
  for (let step = 0; step < 3000; step++) {
    if (noDecay) {
      // Counterfactual changes only expiry. The same courier uses real paths,
      // speed, pickup, return and delivery logic in both runs.
      for (const field of state.fields!) {
        for (const batch of field.foodBatches ?? []) batch.expiresAt = 1e9;
        if (field.foodBatches?.length) field.expiresAt = 1e9;
      }
      for (const unit of state.units) {
        for (const batch of unit.cargoBatches ?? []) batch.expiresAt = 1e9;
        if (unit.cargoBatches?.length) unit.cargoExpiresAt = 1e9;
      }
    }
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
  }
  const delivered = state.buildings[0].foodDelivered ?? 0;
  const produced = firstHarvests.reduce((sum, first) => sum
    + Math.max(0, Math.floor((state.time - first + 1e-6) / FIELD_HARVEST_SECONDS) + 1) * FIELD_HARVEST_FOOD, 0);
  const pending = state.fields!.reduce((sum, field) => sum + field.food, 0)
    + state.units.reduce((sum, unit) => sum + (unit.cargo ?? 0), 0);
  return { delivered, produced, pending, spoiled: produced - delivered - pending };
}

describe('physical food delivery distance', () => {
  it('delivers every recurring harvest along a short unobstructed route', () => {
    const result = run(9);
    expect(result.delivered).toBeGreaterThan(FIELD_HARVEST_FOOD);
    expect(result.delivered).toBeCloseTo(result.produced);
    expect(result.spoiled).toBeCloseTo(0);
  });

  it('loses food on a long route even without other couriers or housing congestion', () => {
    const result = run(203);
    expect(result.produced).toBeGreaterThan(0);
    expect(result.delivered).toBe(0);
    expect(result.spoiled).toBeGreaterThan(FIELD_HARVEST_FOOD);
  });

  it('delivers food over that same long route when only expiry is disabled', () => {
    const result = run(203, true);
    expect(result.delivered).toBeGreaterThan(FIELD_HARVEST_FOOD);
    expect(result.spoiled).toBeCloseTo(0);
    expect(result.delivered + result.pending).toBeCloseTo(result.produced);
  });
});
