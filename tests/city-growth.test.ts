import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { advanceCityPopulation } from '../src/game/city-growth';
import { citySummaries } from '../src/game/cities';
import { houseBirthProgress } from '../src/game/enclosures';
import { synchronizeFarms } from '../src/game/farms';
import { huntingGrowthMultiplierForFaction } from '../src/game/hunting';
import { type Building, type GameState } from '../src/game/types';

function realm(populations: [number, number] = [0, 0], farmCounts: [number, number] = [5, 5]): GameState {
  const buildings: Building[] = [];
  let id = 10;
  for (let city = 0; city < 2; city++) {
    const x = 10 + city * 40;
    buildings.push({ id: city + 1, kind: 'palace', faction: 0, x, y: 20, hp: 650, maxHp: 650,
      capacity: 0, cityName: city ? 'Capua' : 'Roma', populationGrowth: 0,
      governorPermissions: { farms: false, housing: false }, governorNextPlanAt: Infinity });
    let residents = populations[city];
    for (let i = 0; i < 8; i++) {
      const count = Math.min(2, residents); residents -= count;
      buildings.push({ id: id++, kind: 'house', faction: 0, x: x - 2 + (i % 4) * 3, y: 16 + Math.floor(i / 4),
        hp: 160, maxHp: 160, capacity: 2, houseLevel: 1, residents: count });
    }
    // Mature irrigated orchards provide the surplus this growth-isolation
    // fixture needs under the lower ordinary-field harvest balance.
    for (let i = 0; i < farmCounts[city]; i++) {
      // Three improved plots retain the old four-plot surplus for growth isolation.
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
        const point = { x: x - 6 + i % 5 * 2 + dx, y: 8 + Math.floor(i / 5) * 2 + dy };
        buildings.push({ id: id++, kind: 'camp', faction: 0, ...point, hp: 100, maxHp: 100, capacity: 0, orchard: { startedAt: -120, readyAt: 0 } },
          { id: id++, kind: 'irrigation', faction: 0, ...point, hp: 100, maxHp: 100, capacity: 0 });
      }
    }
  }
  const state: GameState = {
    world: { width: 80, height: 40, seed: 'city-population', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 3200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings, units: [], fields: [], factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self',
      food: 1000, gold: 1000, production: 0, population: populations[0] + populations[1],
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 30, tick: 1, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'city-population', rngState: 1,
  };
  synchronizeFarms(state);
  return state;
}
const palace = (state: GameState, id: number) => state.buildings.find(building => building.id === id)!;
const populations = (state: GameState) => citySummaries(state).map(city => city.population);
const rate = (surplus: number) => 3 * Math.min(2.4, .14 + surplus / 13);
function advance(state: GameState, multiplier = 1, unfed = 0): number {
  return advanceCityPopulation(state, state.factions[0], citySummaries(state), multiplier, unfed);
}
function encloseFirstCity(state: GameState): void {
  let id = 1000;
  for (let y = 14; y <= 24; y++) for (let x = 5; x <= 20; x++) if (y === 14 || y === 24 || x === 5 || x === 20)
    entityStore(state).buildings.add({ id: id++, kind: 'wall', faction: 0, x, y, hp: 225, maxHp: 225, capacity: 0 });
  // A friendly gate preserves the defense while letting this city's couriers
  // reach its orchards; a sealed ring would assign them to the other palace.
  entityStore(state).buildings.add({ id: id++, kind: 'road', faction: 0, x: 10, y: 14, hp: 100, maxHp: 100, capacity: 0 });
}

describe('city-specific natural population growth', () => {
  it('grows two well-fed empty cities in the same economy tick without seed residents', () => {
    const state = realm();
    expect(advance(state)).toBe(10);
    expect(populations(state)).toEqual([5, 5]);
    expect(state.factions[0].food).toBe(960);
    expect(palace(state, 1).populationGrowth).toBeCloseTo(rate(24) - 5);
    expect(palace(state, 2).populationGrowth).toBeCloseTo(rate(24) - 5);
  });

  it('does not let older-city vacancies starve Capua or depend on building-array order', () => {
    const state = realm([2, 0]), reversed = structuredClone(state);
    entityStore(reversed).buildings.replace([...reversed.buildings].reverse());
    expect(advance(state)).toBe(10); expect(advance(reversed)).toBe(10);
    expect(populations(state)).toEqual([7, 5]);
    expect(citySummaries(reversed).sort((a, b) => a.palace.id - b.palace.id).map(city => city.population)).toEqual([7, 5]);
    expect(palace(reversed, 1).populationGrowth).toBeCloseTo(palace(state, 1).populationGrowth!);
    expect(palace(reversed, 2).populationGrowth).toBeCloseTo(palace(state, 2).populationGrowth!);
  });

  it('stops a food-deficit city even when another city is productive and shared food is abundant', () => {
    const state = realm([8, 0], [1, 5]); palace(state, 1).populationGrowth = 10;
    expect(citySummaries(state).map(city => city.food)).toEqual([expect.closeTo(-3.2), expect.closeTo(24)]);
    expect(advance(state)).toBe(5);
    expect(populations(state)).toEqual([8, 5]);
    expect(palace(state, 1).populationGrowth).toBe(10);
  });

  it('does not increase one city’s birth rate using another city’s extra surplus', () => {
    const state = realm([0, 0], [1, 5]);
    expect(advance(state)).toBe(6);
    expect(populations(state)).toEqual([1, 5]);
    expect(palace(state, 1).populationGrowth).toBeCloseTo(rate(4.8) - 1);
    expect(palace(state, 2).populationGrowth).toBeCloseTo(rate(24) - 5);
  });

  it('keeps banked progress in a full city instead of using another city’s spare beds', () => {
    const state = realm([16, 0]); palace(state, 1).populationGrowth = 100;
    expect(advance(state)).toBe(5);
    expect(populations(state)).toEqual([16, 5]);
    expect(palace(state, 1).populationGrowth).toBeCloseTo(100 + rate(8));
    expect(palace(state, 2).populationGrowth).toBeCloseTo(rate(24) - 5);
  });

  it('waits for local completed housing without blocking a different city’s growth', () => {
    const state = realm();
    for (const home of state.buildings) if (home.kind === 'house' && home.x < 30)
      home.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    palace(state, 1).populationGrowth = 10;
    expect(advance(state)).toBe(5); expect(populations(state)).toEqual([0, 5]);
    expect(palace(state, 1).populationGrowth).toBeCloseTo(10 + rate(24));
  });

  it('doubles the banked-birth allowance to ten per city without sharing a faction-wide limit', () => {
    const state = realm();
    palace(state, 1).populationGrowth = 100; palace(state, 2).populationGrowth = 100;
    expect(advance(state)).toBe(20); expect(populations(state)).toEqual([10, 10]);
    expect(state.factions[0].food).toBe(920);
  });

  it('credits all eligible cities before spending scarce shared food and never overdraws it', () => {
    const state = realm(); state.factions[0].food = 6;
    palace(state, 1).populationGrowth = 10; palace(state, 2).populationGrowth = 10;
    expect(advance(state)).toBe(1); expect(state.factions[0].food).toBe(2);
    expect(palace(state, 1).populationGrowth).toBeCloseTo(10 + rate(24) - 1);
    expect(palace(state, 2).populationGrowth).toBeCloseTo(10 + rate(24));
    expect(advance(state)).toBe(0); expect(state.factions[0].food).toBe(2);
  });

  it('keeps the existing meal-shortage credit decay local to each palace', () => {
    const state = realm(); state.factions[0].food = 0;
    palace(state, 1).populationGrowth = .2; palace(state, 2).populationGrowth = .8;
    expect(advance(state, 1, 3)).toBe(0);
    expect(palace(state, 1).populationGrowth).toBe(0);
    expect(palace(state, 2).populationGrowth).toBeCloseTo(.5);
  });

  it('applies enclosure progress costs only to homes in the enclosed city', () => {
    const state = realm(); encloseFirstCity(state);
    const homes = state.buildings.filter(building => building.kind === 'house');
    expect(houseBirthProgress(state, homes[0])).toBeCloseTo(1 / 1.3);
    expect(houseBirthProgress(state, homes[8])).toBe(1);
    expect(advance(state)).toBe(12); expect(populations(state)).toEqual([7, 5]);
    expect(palace(state, 1).populationGrowth).toBeCloseTo(rate(24) - 7 / 1.3);
    expect(palace(state, 2).populationGrowth).toBeCloseTo(rate(24) - 5);
  });

  it('retains the timed faction hunting bonus for each city’s newly earned progress', () => {
    const state = realm(); palace(state, 1).huntingBonuses = [{ startedAt: 0, expiresAt: 30 }];
    const multiplier = huntingGrowthMultiplierForFaction(state, 0, 0, 30);
    expect(multiplier).toBe(1.1);
    expect(advance(state, multiplier)).toBe(12); expect(populations(state)).toEqual([6, 6]);
    expect(palace(state, 1).populationGrowth).toBeCloseTo(rate(24) * 1.1 - 6);
    expect(palace(state, 2).populationGrowth).toBeCloseTo(rate(24) * 1.1 - 6);
  });

  it('naturally preserves separate fractional clocks when state is serialized', () => {
    const state = realm(); palace(state, 1).populationGrowth = .4; palace(state, 2).populationGrowth = .8;
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    expect(advance(state)).toBe(12); expect(advance(restored)).toBe(12);
    expect(populations(restored)).toEqual(populations(state));
    for (const id of [1, 2]) expect(palace(restored, id).populationGrowth).toBeCloseTo(palace(state, id).populationGrowth!);
  });
});
