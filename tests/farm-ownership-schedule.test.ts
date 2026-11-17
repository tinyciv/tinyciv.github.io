import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { farmCityQuery, farmTravelRevision, withFarmTravelPlanningStep } from '../src/game/farm-travel';
import { canWalk } from '../src/game/pathfinding';
import { installNavigationWasm, navigationWasmStatus, setNavigationWasmEnabled } from '../src/game/navigation-wasm';
import { withSimulationReads } from '../src/game/simulation-reads';
import { markWorldChanged } from '../src/game/world-revisions';
import type { GameState } from '../src/game/types';

beforeAll(async () => {
  await installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/simulation.wasm')));
  setNavigationWasmEnabled(true);
});

function fixture(): GameState {
  const width = 40, height = 36;
  return {
    world: { width, height, revision: 0, seed: 'ownership-schedule', source: 'test', spawns: [],
      tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, kind: 'palace', faction: Math.floor(index / 2),
      x: index % 2 ? 18 : 2, y: 5 + Math.floor(index / 2) * 10, hp: 650, maxHp: 650, capacity: 4 })),
    units: [], fields: [], factions: [0, 1, 2].map(id => ({ id, name: `${id}`, color: '#fff', affinity: 100,
      relation: id ? 'peace' : 'self', food: 100, gold: 100, production: 0, population: 2,
      yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'ownership-schedule', rngState: 1,
  };
}
const homes = (state: GameState) => [0, 1, 2].map(faction => farmCityQuery(state, faction)({ x: 8, y: 5 + faction * 10 })?.id);
const step = <T>(state: GameState, run: () => T) => withSimulationReads(state, () => withFarmTravelPlanningStep(state, run));

function blockNearCities(state: GameState): void {
  const cells = Array.from({ length: state.world.height }, (_, y) => y * state.world.width + 5);
  for (const cell of cells) state.world.tiles[cell].terrain = 'lake';
  markWorldChanged(state.world, 'geometry', cells);
}

describe('incremental publication of faction farm ownership', () => {
  it('refreshes one existing faction per step while movement sees the live obstacle', () => {
    const state = fixture(); expect(homes(state)).toEqual([1, 3, 5]);
    blockNearCities(state);
    const before = navigationWasmStatus().nearestMaps;
    let generation: object;
    step(state, () => {
      expect(homes(state)).toEqual([2, 3, 5]);
      expect(canWalk(state, 5, 5, 0)).toBe(false);
      withFarmTravelPlanningStep(state, () => expect(homes(state)).toEqual([2, 3, 5]));
      expect(navigationWasmStatus().nearestMaps - before).toBe(1);
      generation = farmTravelRevision(state);
    });
    step(state, () => {
      expect(homes(state)).toEqual([2, 4, 5]);
      expect(farmTravelRevision(state)).not.toBe(generation);
      generation = farmTravelRevision(state);
      expect(navigationWasmStatus().nearestMaps - before).toBe(2);
    });
    step(state, () => {
      expect(homes(state)).toEqual([2, 4, 6]);
      expect(farmTravelRevision(state)).not.toBe(generation);
      expect(navigationWasmStatus().nearestMaps - before).toBe(3);
    });
    step(state, () => expect(homes(state)).toEqual([2, 4, 6]));
    expect(navigationWasmStatus().nearestMaps - before).toBe(3);
  });

  it('keeps standalone and explicit paused queries exact, even with trusted reads', () => {
    const state = fixture(); homes(state); blockNearCities(state);
    step(state, () => expect(homes(state)).toEqual([2, 3, 5]));
    const before = navigationWasmStatus().nearestMaps;
    state.paused = true;
    withSimulationReads(state, () => expect(homes(state)).toEqual([2, 4, 6]));
    expect(navigationWasmStatus().nearestMaps - before).toBe(2);
    step(state, () => expect(homes(state)).toEqual([2, 4, 6]));
    expect(navigationWasmStatus().nearestMaps - before).toBe(2);
  });

  it('does not starve older pending factions when topology changes again', () => {
    const state = fixture(); homes(state); blockNearCities(state);
    step(state, () => expect(homes(state)).toEqual([2, 3, 5]));
    entityStore(state).buildings.add({ id: 100, kind: 'house', faction: 0, x: 30, y: 30, hp: 100, maxHp: 100, capacity: 4 });
    const before = navigationWasmStatus().nearestMaps;
    step(state, () => expect(homes(state)).toEqual([2, 4, 5]));
    expect(navigationWasmStatus().nearestMaps - before).toBe(1);
    step(state, () => expect(homes(state)).toEqual([2, 4, 6]));
    expect(navigationWasmStatus().nearestMaps - before).toBe(2);
    step(state, () => homes(state));
    expect(navigationWasmStatus().nearestMaps - before).toBe(3);
  });

  it('rebuilds cold fields immediately and never returns a captured city from a previous map', () => {
    const state = fixture(), before = navigationWasmStatus().nearestMaps;
    step(state, () => expect(homes(state)).toEqual([1, 3, 5]));
    expect(navigationWasmStatus().nearestMaps - before).toBe(3);
    state.buildings[0].faction = -1;
    markWorldChanged(state.world);
    step(state, () => expect(farmCityQuery(state, 0)({ x: 8, y: 5 })?.id).toBe(2));
  });
});
