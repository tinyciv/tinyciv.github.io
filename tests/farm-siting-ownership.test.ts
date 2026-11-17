import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as travel from '../src/game/farm-travel';
import { entityStore } from '../src/game/entity-store';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { installNavigationWasm, navigationWasmStatus, setNavigationWasmEnabled } from '../src/game/navigation-wasm';
import { buildingReady, type Building, type GameState } from '../src/game/types';

beforeAll(async () => {
  await installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/simulation.wasm')));
  setNavigationWasmEnabled(true);
});
afterEach(() => vi.restoreAllMocks());

function fixture(cities: number): GameState {
  const width = 80, height = 80;
  return {
    world: { width, height, revision: 0, seed: 'farm-siting-owners', source: 'test', spawns: [],
      tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: Array.from({ length: cities }, (_, i) => ({ id: i + 1, kind: 'palace', faction: 0,
      x: 2 + i % 10 * 7, y: 2 + Math.floor(i / 10) * 7, hp: 650, maxHp: 650, capacity: 4 })),
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f00', affinity: 100, relation: 'self',
      food: 1000, gold: 1000, production: 0, population: cities, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'farm-siting-owners', rngState: 1,
  };
}

/** Previous automatic siting compares every other city's Float32 distance.
 * Unreachable candidates are rejected by the selected city's scoring below. */
function individualCityQuery(state: GameState, faction: number) {
  const cities = state.buildings.filter(city => city.kind === 'palace' && city.faction === faction && buildingReady(city));
  const maps = cities.map(city => ({ city, distances: travel.palaceWalkingDistances(state, city) }));
  return (point: Pick<Building, 'x' | 'y'>) => {
    let best: Building | undefined, score = Infinity;
    for (const { city, distances } of maps) {
      const distance = travel.farmWalkingDistance(distances, state.world.width, point.x, point.y);
      if (!best || distance < score || distance === score && city.id < best.id) { best = city; score = distance; }
    }
    return best;
  };
}

describe('automatic farm ownership', () => {
  it('uses one scoring field and one ownership flood for a hundred cities', () => {
    const state = fixture(100), before = navigationWasmStatus();
    const plan = planAutomaticFarmSite(state, state.buildings[0]);
    expect(plan).toBeDefined();
    expect(travel.farmCityQuery(state, 0)(plan!.point)?.id).toBe(state.buildings[0].id);
    expect(navigationWasmStatus().travelMaps - before.travelMaps).toBe(1);
    expect(navigationWasmStatus().nearestMaps - before.nearestMaps).toBe(1);
    expect(planAutomaticFarmSite(state, state.buildings[0])).toEqual(plan);
    expect(navigationWasmStatus().travelMaps - before.travelMaps).toBe(1);
    expect(navigationWasmStatus().nearestMaps - before.nearestMaps).toBe(1);
  });

  it.each(['plain', 'roads', 'woodland', 'water'] as const)('preserves selected plots and own-distance scoring on %s terrain', terrain => {
    const initial = fixture(3), { width } = initial.world;
    if (terrain === 'roads') for (let x = 0; x < 30; x++) entityStore(initial).buildings.add({ id: 100 + x, kind: 'road', faction: 0,
      x, y: 5, hp: 100, maxHp: 100, capacity: 0 });
    if (terrain === 'woodland') for (let y = 4; y < 13; y++) for (let x = 4; x < 20; x++)
      initial.world.tiles[y * width + x].overlay = 'forest';
    if (terrain === 'water') for (let y = 0; y < 18; y++) if (y !== 7) initial.world.tiles[y * width + 7].terrain = 'lake';
    const choices = (state: GameState) => state.buildings.filter(city => city.kind === 'palace')
      .map(palace => planAutomaticFarmSite(state, palace));
    const previous = vi.spyOn(travel, 'farmCityQuery').mockImplementation(individualCityQuery);
    let expected: ReturnType<typeof choices>;
    try { expected = choices(structuredClone(initial)); } finally { previous.mockRestore(); }
    expect(expected.every(plan => plan !== undefined)).toBe(true);
    expect(choices(structuredClone(initial))).toEqual(expected);
  });
});
