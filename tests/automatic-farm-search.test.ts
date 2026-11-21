import { afterEach, describe, expect, it, vi } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { createAutomaticFarmSiteSearch, planAutomaticFarmSite, validateAutomaticFarmSite, type FarmSiteSearchResult } from '../src/game/farm-siting';
import * as relief from '../src/game/relief';
import * as blocks from '../src/game/farm-blocks';
import * as siting from '../src/game/farm-siting';
import { advanceAutomaticDevelopment, BUILD_COSTS } from '../src/game/simulation';
import { advanceFactionDevelopment, type DevelopmentOrders } from '../src/game/faction-development';
import { recordWorldTileChanges } from '../src/game/world-revisions';
import { type Building, type GameState } from '../src/game/types';

afterEach(() => vi.restoreAllMocks());
function fixture(): GameState {
  return {
    world: { width: 64, height: 48, revision: 0, seed: 'farm-search', source: 'test', spawns: [],
      tiles: Array.from({ length: 64 * 48 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', x: 23, y: 22, faction: 0, hp: 650, maxHp: 650, capacity: 4,
      unhousedResidents: 4, governorNextPlanAt: 30, governorPermissions: { farms: true, housing: false } }],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f00', affinity: 100, relation: 'self',
      food: 1000, gold: 10000, production: 0, population: 4, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 30, tick: 1, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'farm-search', rngState: 1,
  };
}
function building(id: number, kind: Building['kind'], x: number, y: number): Building {
  return { id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
}

describe('resumable automatic farm searches', () => {
  it.each(['plain', 'irrigated', 'roads', 'woodland'] as const)('retains synchronous selected-site and yield order on %s terrain', kind => {
    const state = fixture(), palace = state.buildings[0];
    if (kind === 'irrigated') {
      entityStore(state).buildings.add(building(2, 'irrigation', 26, 26));
      state.world.tiles[26 * 64 + 27].terrain = 'desert';
      state.factions[0].villageBonuses = { food: .25, trade: 0, construction: 0, research: 0 };
    }
    if (kind === 'roads') for (let x = 19; x <= 31; x++) entityStore(state).buildings.add(building(100 + x, 'road', x, 25));
    if (kind === 'woodland') for (let y = 12; y < 32; y++) for (let x = 12; x < 32; x++) state.world.tiles[y * 64 + x].overlay = 'forest';
    const expected = planAutomaticFarmSite(state, palace), before = JSON.stringify(state);
    expect(expected).toBeDefined();
    const search = createAutomaticFarmSiteSearch(state, palace);
    let result: FarmSiteSearchResult = { done: false }, turns = 0;
    while (!result.done && turns++ < 100) result = search.advance(256);
    expect(result).toEqual({ done: true, plan: expected });
    expect(turns).toBeGreaterThan(5);
    expect(validateAutomaticFarmSite(state, palace, expected!.point)).toEqual(expected);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('bounds both candidate filtering and expensive scoring per turn', () => {
    const state = fixture(), search = createAutomaticFarmSiteSearch(state, state.buildings[0]);
    const footprint = vi.spyOn(relief, 'reliefFootprintAllowed');
    const original = blocks.farmBlockPlacementQuery;
    let scoring = 0;
    vi.spyOn(blocks, 'farmBlockPlacementQuery').mockImplementation((...args) => {
      const query = original(...args);
      return { ...query, canAdd(point) { scoring++; return query.canAdd(point); } };
    });
    let result: FarmSiteSearchResult = { done: false }, turns = 0;
    while (!result.done && turns++ < 100) {
      footprint.mockClear(); scoring = 0;
      result = search.advance(512);
      expect(footprint.mock.calls.length).toBeLessThanOrEqual(512);
      expect(scoring).toBeLessThanOrEqual(128);
    }
    expect(result.done).toBe(true);
  });

  it.each(['occupied', 'queued building footprint', 'unfinished ditch', 'field', 'water', 'forbidden', 'new city'] as const)('rejects a quoted site after a live %s change', change => {
    const state = fixture(), palace = state.buildings[0], plan = planAutomaticFarmSite(state, palace)!;
    const { x, y } = plan.point;
    if (change === 'occupied') entityStore(state).buildings.add(building(2, 'road', x, y));
    if (change === 'queued building footprint' || change === 'unfinished ditch') {
      const site = change === 'queued building footprint' ? building(2, 'library', x - 1, y - 1) : building(2, 'irrigation', x, y);
      site.hp = 1;
      site.construction = { startedAt: state.time, duration: 4, waitingForBuilder: true };
      entityStore(state).buildings.add(site);
    }
    if (change === 'field') state.fields!.push({ id: 10, camp: 99, faction: 0, x, y, planted: false, food: 0, nextHarvest: 60 });
    if (change === 'water') {
      state.world.tiles[y * 64 + x].terrain = 'lake'; recordWorldTileChanges(state.world, [y * 64 + x]);
    }
    if (change === 'forbidden') state.forbiddenZones = { cells: [y * 64 + x], revision: 1 };
    if (change === 'new city') entityStore(state).buildings.add(building(2, 'palace', x + 1, y));
    expect(validateAutomaticFarmSite(state, palace, plan.point)).toBeUndefined();
    if (change === 'unfinished ditch') {
      state.buildings[1].construction = undefined;
      expect(validateAutomaticFarmSite(state, palace, plan.point)?.irrigatedPlots).toBe(1);
    }
  });

  it('finishes despite unrelated edits and pays once for the live accepted plot', () => {
    const state = fixture(), faction = state.factions[0], initialGold = faction.gold;
    let turns = 0;
    while (!state.buildings.some(building => building.kind === 'camp') && turns++ < 80) {
      // A busy distant settlement edits topology throughout the search.
      entityStore(state).buildings.add(building(1000 + turns, 'road', 63, turns % 48));
      advanceAutomaticDevelopment(state);
      if (turns <= 2) expect(faction.gold).toBe(initialGold);
    }
    expect(turns).toBeLessThan(80);
    expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(1);
    expect(faction.gold).toBe(initialGold - BUILD_COSTS.camp.gold);
  });

  it('rejects an obstructed winner without paying, then continues the remaining city actions', () => {
    const state = fixture(), faction = state.factions[0], initialGold = faction.gold;
    const validate = siting.validateAutomaticFarmSite;
    let rejected: { x: number; y: number } | undefined;
    const calls = vi.spyOn(siting, 'validateAutomaticFarmSite').mockImplementationOnce((state, palace, point) => {
      rejected = point;
      entityStore(state).buildings.add(building(1000, 'road', point.x, point.y));
      return validate(state, palace, point);
    });
    for (let turn = 0; turn < 100 && !state.buildings.some(building => building.kind === 'camp'); turn++) advanceAutomaticDevelopment(state);
    expect(calls.mock.calls.length).toBeGreaterThanOrEqual(2);
    const farms = state.buildings.filter(building => building.kind === 'camp');
    expect(farms).toHaveLength(1);
    expect({ x: farms[0].x, y: farms[0].y }).not.toEqual(rejected);
    expect(faction.gold).toBe(initialGold - BUILD_COSTS.camp.gold);
  });

  it.each(['world', 'tiles', 'palace', 'faction', 'rewind'] as const)('discards a suspended search after %s replacement', change => {
    const state = fixture(), palace = state.buildings[0], search = createAutomaticFarmSiteSearch(state, palace);
    expect(search.advance(512)).toEqual({ done: false });
    if (change === 'world') state.world = { ...state.world };
    if (change === 'tiles') state.world.tiles = [...state.world.tiles];
    if (change === 'palace') entityStore(state).buildings.replace([{ ...palace }]);
    if (change === 'faction') state.factions[0] = { ...state.factions[0] };
    if (change === 'rewind') state.time--;
    expect(search.advance(Infinity)).toEqual({ done: true });
  });

  it.each(['permission', 'funds', 'priority'] as const)('spends nothing when %s changes before purchase', change => {
    const state = fixture(), palace = state.buildings[0], faction = state.factions[0];
    advanceAutomaticDevelopment(state); // Admit and prepare a search, no purchase.
    expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(0);
    if (change === 'permission') palace.governorPermissions!.farms = false;
    if (change === 'funds') faction.gold = 0;
    if (change === 'priority') {
      // Completed crops supplied while the search was suspended remove the
      // food shortfall without changing the governor's permission.
      for (let i = 0; i < 16; i++) entityStore(state).buildings.add(building(100 + i, 'shack', 16 + i % 4 * 3, 16 + Math.floor(i / 4) * 3));
    }
    const gold = faction.gold;
    for (let turn = 0; turn < 100; turn++) advanceAutomaticDevelopment(state);
    expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(0);
    expect(faction.gold).toBe(gold);
  });

  it('retains each pending farm action while fairly advancing the other city', () => {
    const state = fixture(), palace = state.buildings[0];
    entityStore(state).buildings.add({ ...palace, id: 2, x: 43 });
    const attempts = new Map<number, number>(), completed: number[] = [], sequence: number[] = [];
    const orders: DevelopmentOrders = { houses() {}, validate: () => ({ ok: false }), build: () => ({ ok: false }),
      farms(_faction, city, slice) {
        expect(slice?.maxCandidates).toBe(512);
        sequence.push(city.id);
        const count = (attempts.get(city.id) ?? 0) + 1; attempts.set(city.id, count);
        if (count % 3) return false;
        completed.push(city.id); return true;
      } };
    for (let turn = 0; turn < 35; turn++) advanceFactionDevelopment(state, orders);
    expect(sequence.slice(0, 6)).toEqual([1, 1, 2, 1, 2, 1]);
    expect(completed.filter(id => id === 1)).toHaveLength(4);
    expect(completed.filter(id => id === 2)).toHaveLength(4);
    expect(attempts.get(1)).toBe(12); expect(attempts.get(2)).toBe(12);
  });
});
