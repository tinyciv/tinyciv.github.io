import { afterEach, describe, expect, it, vi } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { advanceFactionDevelopment, updateFactionDevelopment, type DevelopmentOrders } from '../src/game/faction-development';
import * as resources from '../src/game/resource-development';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { withSimulationReads } from '../src/game/simulation-reads';
import type { GameState } from '../src/game/types';

function fixture(count: number, faction = 0): GameState {
  return {
    world: { width: 40, height: 40, revision: 0, seed: 'governor-schedule', source: 'test', spawns: [],
      tiles: Array.from({ length: 1600 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: Array.from({ length: count }, (_, index) => ({ id: index + 1, kind: 'palace', faction,
      x: 2 + index % 10 * 3, y: 2 + Math.floor(index / 10) * 3, hp: 650, maxHp: 650, capacity: 4,
      unhousedResidents: 1, governorNextPlanAt: 30, governorPermissions: { farms: false, housing: false } })),
    units: [], fields: [], factions: [{ id: faction, name: 'Test', color: '#fff', affinity: 100,
      relation: faction ? 'peace' : 'self', food: 0, gold: 0, production: 0, population: count,
      yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    time: 30, tick: 1, paused: false, speed: 1, events: [], particles: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed: 'governor-schedule', rngState: 1,
  };
}

function callbacks() {
  const houses: { city: number; elapsed: number }[] = [], farms: number[] = [];
  const orders: DevelopmentOrders = {
    farms: (_faction, palace) => { farms.push(palace.id); },
    houses: (_faction, elapsed, palace) => { houses.push({ city: palace.id, elapsed }); },
    validate: () => ({ ok: false }), build: () => ({ ok: false }),
  };
  return { orders, houses, farms };
}

afterEach(() => vi.restoreAllMocks());

describe('bounded governor planning', () => {
  it('retains unpaid housing time across a save during a suspended city turn', () => {
    const state = fixture(1), { orders, houses } = callbacks(), palace = state.buildings[0];
    palace.governorPermissions = { farms: true, housing: true };
    advanceFactionDevelopment(state, orders);
    expect(houses).toHaveLength(0);
    const loaded = parseGameSave(serializeGameSave(state));
    expect(loaded.buildings[0].governorHousingCreditedAt).toBe(0);
    loaded.time = 60;
    for (let step = 0; step < 7; step++) advanceFactionDevelopment(loaded, orders);
    expect(houses).toEqual([{ city: 1, elapsed: 60 }, { city: 1, elapsed: 0 }]);
    expect(loaded.buildings[0].governorNextPlanAt).toBe(90);
    loaded.time = 90;
    for (let step = 0; step < 7; step++) advanceFactionDevelopment(loaded, orders);
    expect(houses.slice(2)).toEqual([{ city: 1, elapsed: 30 }, { city: 1, elapsed: 0 }]);
  });

  it.each(['pause', 'research'] as const)('rechecks a resumed upgrade after its %s permission changes', change => {
    const state = fixture(1, 1), palace = state.buildings[0], faction = state.factions[0];
    faction.gold = 10000;
    faction.research = { focus: 'blacksmith', levels: { blacksmith: 1 }, progress: {} };
    entityStore(state).buildings.add({ id: 99, kind: 'library', faction: 1, x: palace.x + 2, y: palace.y + 2,
      hp: 100, maxHp: 100, capacity: 0 });
    vi.spyOn(resources, 'autoDevelopResources').mockReturnValue({ ok: false, message: '' });
    let validations = 0;
    const build = vi.fn(() => ({ ok: true }));
    const orders: DevelopmentOrders = { farms: () => {}, houses: () => {}, build,
      validate: () => ({ ok: ++validations === 4 }) };
    advanceFactionDevelopment(state, orders); // Faction resource action.
    advanceFactionDevelopment(state, orders); // Valid fourth candidate, suspended before purchase.
    expect(validations).toBe(4);
    expect(build).not.toHaveBeenCalled();
    if (change === 'pause') faction.constructionPauseUntil = { blacksmith: 100 };
    else delete faction.research.levels.blacksmith;
    for (let step = 0; step < 5; step++) advanceFactionDevelopment(state, orders);
    expect(build).not.toHaveBeenCalled();
  });

  it('interleaves farm and housing actions fairly and carries all elapsed housing credit', () => {
    const state = fixture(3), { orders, farms, houses } = callbacks();
    for (const palace of state.buildings) palace.governorPermissions = { farms: true, housing: true };
    for (let step = 0; step < 30; step++) {
      state.time = 30 + step / 30;
      const previousFarms = farms.length, previousHouses = houses.length;
      advanceFactionDevelopment(state, orders);
      expect(farms.length - previousFarms + houses.length - previousHouses).toBeLessThanOrEqual(1);
      for (const called of houses.slice(previousHouses)) {
        if (called.elapsed) expect(called.elapsed).toBeCloseTo(state.time);
      }
      if (step === 5) expect(new Set(farms).size).toBe(3);
    }
    expect(farms).toHaveLength(12);
    expect(houses).toHaveLength(6);
    for (const city of [1, 2, 3]) expect(houses.filter(call => call.city === city && call.elapsed === 0)).toHaveLength(1);
  });

  it('retains ordered placement cursors within four validations per turn', () => {
    const state = fixture(1, 1), palace = state.buildings[0];
    state.factions[0].gold = 10000;
    state.factions[0].research = { focus: 'blacksmith', levels: { blacksmith: 1 }, progress: {} };
    entityStore(state).buildings.add({ id: 99, kind: 'library', faction: 1, x: palace.x + 2, y: palace.y + 2,
      hp: 100, maxHp: 100, capacity: 0 });
    vi.spyOn(resources, 'autoDevelopResources').mockReturnValue({ ok: false, message: '' });
    const immediate = structuredClone(state), expected: string[] = [], actual: string[] = [];
    const make = (list: string[]): DevelopmentOrders => ({ farms: () => {}, houses: () => {},
      validate: (_faction, kind, x, y) => { list.push(`${kind}:${x},${y}`); return { ok: false }; },
      build: () => { throw Error('Rejected sites cannot spend resources'); } });
    updateFactionDevelopment(immediate, make(expected));
    expect(expected.length).toBeGreaterThan(50);
    for (let step = 0; step < 120; step++) {
      state.time = 30 + step / 60;
      const previous = actual.length;
      advanceFactionDevelopment(state, make(actual));
      expect(actual.length - previous).toBeLessThanOrEqual(4);
    }
    expect(actual).toEqual(expected);
    expect(state.factions[0].gold).toBe(10000);
  });

  it('ends a turn after a live crop preflight without changing candidate order or the selected site', () => {
    const state = fixture(1, 1), palace = state.buildings[0];
    state.factions[0].gold = 10000;
    state.factions[0].research = { focus: 'blacksmith', levels: { blacksmith: 1 }, progress: {} };
    entityStore(state).buildings.add({ id: 99, kind: 'library', faction: 1, x: palace.x + 2, y: palace.y + 2,
      hp: 100, maxHp: 100, capacity: 0 });
    vi.spyOn(resources, 'autoDevelopResources').mockReturnValue({ ok: false, message: '' });
    // The third ordered candidate has a crop. The next one acquires a crop
    // while the governor is suspended; neither may share a turn with another
    // expensive preflight. Rejected crop sites remain in their original order.
    entityStore(state).buildings.add({ id: 100, kind: 'camp', faction: 1, x: 1, y: 2,
      hp: 100, maxHp: 100, capacity: 0 });
    const immediate = structuredClone(state), expected: string[] = [], actual: string[] = [];
    const expectedBuilds: string[] = [], actualBuilds: string[] = [];
    const make = (list: string[], builds: string[]): DevelopmentOrders => ({ farms: () => {}, houses: () => {},
      validate: (_faction, kind, x, y) => { list.push(`${kind}:${x},${y}`); return { ok: list.length === 8 }; },
      build: (_faction, kind, x, y) => { builds.push(`${kind}:${x},${y}`); return { ok: true }; } });
    updateFactionDevelopment(immediate, make(expected, expectedBuilds));
    const orders = make(actual, actualBuilds);
    advanceFactionDevelopment(state, orders); // Faction resource action.
    advanceFactionDevelopment(state, orders);
    expect(actual).toEqual(expected.slice(0, 3));
    entityStore(state).buildings.add({ id: 101, kind: 'cottage', faction: 1, x: 3, y: 2,
      hp: 100, maxHp: 100, capacity: 0 });
    advanceFactionDevelopment(state, orders);
    expect(actual).toEqual(expected.slice(0, 4));
    advanceFactionDevelopment(state, orders);
    expect(actual).toEqual(expected);
    expect(actualBuilds).toEqual([]); // Fourth cheap validation is its own boundary.
    advanceFactionDevelopment(state, orders);
    expect(actualBuilds).toEqual(expectedBuilds);
    expect(state.factions[0].gold).toBe(10000);
  });

  it.each([{ faction: 1, hp: 100, checks: 1 }, { faction: 2, hp: 100, checks: 4 }, { faction: 1, hp: 0, checks: 4 }])(
    'weights only live owned crops across the entire candidate footprint (%j)', crop => {
      const state = fixture(1, 1), palace = state.buildings[0];
      state.factions[0].gold = 10000;
      state.factions[0].research = { focus: 'archeryRange', levels: { archeryRange: 1 }, progress: {} };
      entityStore(state).buildings.add({ id: 99, kind: 'library', faction: 1, x: palace.x + 2, y: palace.y + 2,
        hp: 100, maxHp: 100, capacity: 0 });
      // This is the second cell of the first archery range candidate, rather
      // than its anchor. Enemy/dead crops cannot trigger own-farm relocation.
      entityStore(state).buildings.add({ id: 100, kind: 'shack', faction: crop.faction, x: palace.x + 1, y: palace.y,
        hp: crop.hp, maxHp: 100, capacity: 0 });
      vi.spyOn(resources, 'autoDevelopResources').mockReturnValue({ ok: false, message: '' });
      const validate = vi.fn(() => ({ ok: false })), orders = { ...callbacks().orders, validate };
      withSimulationReads(state, () => advanceFactionDevelopment(state, orders));
      withSimulationReads(state, () => advanceFactionDevelopment(state, orders));
      expect(validate).toHaveBeenCalledTimes(crop.checks);
      expect(validate.mock.calls[0]).toEqual([1, 'archeryRange', palace.x, palace.y]);
    });

  it('cancels active work after postponement or capture and lets direct callers finish queued work', () => {
    const state = fixture(2), { orders, farms, houses } = callbacks();
    state.buildings.forEach(palace => { palace.governorPermissions = { farms: true, housing: true }; });
    advanceFactionDevelopment(state, orders);
    state.buildings[0].governorNextPlanAt = 100;
    advanceFactionDevelopment(state, orders);
    expect(farms.filter(id => id === 1)).toHaveLength(1);
    updateFactionDevelopment(state, orders);
    expect(farms.filter(id => id === 2)).toHaveLength(4);
    expect(houses.filter(value => value.city === 2)).toHaveLength(2);
    expect(state.buildings[0].governorNextPlanAt).toBe(100);
    state.time = 100;
    advanceFactionDevelopment(state, orders);
    state.buildings[0].faction = -1;
    const previous = farms.filter(id => id === 1).length;
    for (let step = 0; step < 5; step++) advanceFactionDevelopment(state, orders);
    expect(farms.filter(id => id === 1)).toHaveLength(previous);
  });

  it('drains one of one hundred due cities each step without losing housing time', () => {
    const state = fixture(100), { orders, houses, farms } = callbacks();
    for (let step = 0; step < 100; step++) {
      state.time = 30 + step / 30;
      updateFactionDevelopment(state, orders, 1);
      expect(houses).toHaveLength(step + 1);
      expect(farms).toHaveLength((step + 1) * 4);
      expect(houses[step]).toEqual({ city: step + 1, elapsed: state.time });
      expect(state.buildings[step].governorNextPlanAt).toBe(state.time + 30);
    }
    expect(state.time - 30).toBeLessThan(3.34);
    updateFactionDevelopment(state, orders, 1);
    expect(houses).toHaveLength(100);
    expect(state.rngState).toBe(1);
  });

  it('retains original cohort order ahead of newly due cities', () => {
    const state = fixture(4), { orders, houses } = callbacks();
    state.buildings[3].governorNextPlanAt = 31;
    updateFactionDevelopment(state, orders, 1);
    state.time = 31;
    updateFactionDevelopment(state, orders, 1);
    updateFactionDevelopment(state, orders, 1);
    updateFactionDevelopment(state, orders, 1);
    expect(houses.map(value => value.city)).toEqual([1, 2, 3, 4]);
  });

  it('skips removed, captured, unfinished and postponed queued cities', () => {
    const state = fixture(5), { orders, houses } = callbacks();
    const [first, removed, captured, unfinished, postponed] = state.buildings;
    updateFactionDevelopment(state, orders, 1);
    entityStore(state).buildings.retain(building => building !== removed);
    captured.faction = -1;
    unfinished.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    postponed.governorNextPlanAt = 100;
    entityStore(state).buildings.add({ ...first, id: 10, x: 32, governorNextPlanAt: 30 });
    state.time += .1;
    updateFactionDevelopment(state, orders, 1);
    expect(houses.map(value => value.city)).toEqual([1, 10]);
    expect(postponed.governorNextPlanAt).toBe(100);
    expect(unfinished.governorNextPlanAt).toBeUndefined();
  });

  it('attempts faction resources once per due cohort across budgeted and direct calls', () => {
    const state = fixture(3, 1), { orders, houses } = callbacks();
    const develop = vi.spyOn(resources, 'autoDevelopResources').mockReturnValue({ ok: false, message: '' });
    updateFactionDevelopment(state, orders, 1);
    state.time += .1;
    updateFactionDevelopment(state, orders, 1);
    updateFactionDevelopment(state, orders);
    expect(houses.map(value => value.city)).toEqual([1, 2, 3]);
    expect(develop).toHaveBeenCalledTimes(1);
    state.time = 40;
    updateFactionDevelopment(state, orders);
    expect(develop).toHaveBeenCalledTimes(2);
    expect(houses).toHaveLength(6);
  });

  it('keeps direct calls immediate and rebuilds queued work after a clock rewind', () => {
    const state = fixture(3), { orders, houses } = callbacks();
    updateFactionDevelopment(state, orders);
    expect(houses).toEqual([1, 2, 3].map(city => ({ city, elapsed: 30 })));
    state.time = 60;
    updateFactionDevelopment(state, orders, 1);
    state.time = 10;
    state.buildings.forEach(palace => { palace.governorNextPlanAt = 10; });
    updateFactionDevelopment(state, orders);
    expect(houses.slice(-3)).toEqual([1, 2, 3].map(city => ({ city, elapsed: 30 })));
  });
});
