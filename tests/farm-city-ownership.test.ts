import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { farmCityQuery, farmTravelRevision, forkFarmTravelPlanning, palaceWalkingDistances } from '../src/game/farm-travel';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { installNavigationWasm, navigationWasmStatus, setNavigationWasmEnabled } from '../src/game/navigation-wasm';
import type { Building, GameState } from '../src/game/types';

beforeAll(async () => {
  await installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/simulation.wasm')));
  setNavigationWasmEnabled(true);
});

function fixture(cities = 2): GameState {
  const width = 80, height = 80;
  return { world: { width, height, revision: 0, seed: 'city-ownership', source: 'test', spawns: [],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: Array.from({ length: cities }, (_, i) => ({ id: i + 1, kind: 'palace', faction: 0,
      x: 2 + i % 10 * 7, y: 2 + Math.floor(i / 10) * 7, hp: 650, maxHp: 650, capacity: 0 })),
    factions: [{ id: 0, relation: 'self' }, { id: 1, relation: 'war' }], units: [], fields: [], time: 0,
  } as unknown as GameState;
}

describe('shared nearest-city ownership', () => {
  it('uses one flood for a hundred cities and reuses it until access changes', () => {
    const state = fixture(100), before = navigationWasmStatus();
    const query = farmCityQuery(state, 0);
    for (const palace of state.buildings) expect(query({ x: palace.x - 1, y: palace.y })?.id).toBe(palace.id);
    for (let i = 0; i < 20; i++) farmCityQuery(state, 0)({ x: i, y: 20 });
    expect(navigationWasmStatus().nearestMaps - before.nearestMaps).toBe(1);
    expect(navigationWasmStatus().travelMaps).toBe(before.travelMaps);
    entityStore(state).buildings.add({ id: 1000, kind: 'house', faction: 0, x: 40, y: 40, hp: 100, maxHp: 100, capacity: 0 });
    farmCityQuery(state, 0);
    expect(navigationWasmStatus().nearestMaps - before.nearestMaps).toBe(2);
    // Placement's individual distance field remains a separate lazy query.
    palaceWalkingDistances(state, state.buildings[0]);
    expect(navigationWasmStatus().travelMaps - before.travelMaps).toBe(1);
  });

  it('borrows a preview field and detaches when preview access changes', () => {
    const state = fixture(), preview = structuredClone(state), before = navigationWasmStatus().nearestMaps;
    forkFarmTravelPlanning(state, preview);
    const sourceQuery = farmCityQuery(state, 0), previewQuery = farmCityQuery(preview, 0);
    const farm = { x: 6, y: 2 };
    expect(previewQuery(farm)?.id).toBe(sourceQuery(farm)?.id);
    expect(previewQuery(farm)).toBe(preview.buildings.find(city => city.id === sourceQuery(farm)?.id));
    expect(navigationWasmStatus().nearestMaps - before).toBe(1);
    setForbiddenRectangle(preview, { x: 5, y: 0 }, { x: 5, y: 79 }, true);
    expect(farmCityQuery(preview, 0)(farm)?.id).toBe(2);
    expect(farmCityQuery(state, 0)(farm)?.id).toBe(1);
    expect(navigationWasmStatus().nearestMaps - before).toBe(2);
  });

  it('publishes capture and bridge access immediately and preserves unreachable fallback', () => {
    const state = fixture(3), farm = { x: 6, y: 2 }, palace = state.buildings[0];
    for (let y = 0; y < 80; y++) state.world.tiles[y * 80 + 5].terrain = 'lake';
    expect(farmCityQuery(state, 0)(farm)?.id).toBe(2);
    const before = farmTravelRevision(state);
    const bridge: Building = { id: 100, kind: 'bridge', faction: 0, x: 5, y: 2, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(bridge);
    expect(farmCityQuery(state, 0)(farm)?.id).toBe(palace.id);
    expect(farmTravelRevision(state)).not.toBe(before);
    palace.faction = 1;
    expect(farmCityQuery(state, 0)(farm)?.id).toBe(2);
    expect(farmCityQuery(state, 1)(farm)).toBe(palace);
    // An isolated field still gets a stable nearest city for its waiting courier.
    state.world.tiles[2 * 80 + 6].terrain = 'lake'; state.world.revision!++;
    expect(farmCityQuery(state, 0)(farm)?.id).toBe(2);
  });
});
