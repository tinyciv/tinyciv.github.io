import { afterEach, describe, expect, it, vi } from 'vitest';
import { constructionEdges } from '../src/game/builders';
import { entityStore } from '../src/game/entity-store';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { dismissLevy, LEVY_ACTION_COOLDOWN, levyDisplayStatus, levyPopulation, levyStatus } from '../src/game/mass-levy';
import * as navigation from '../src/game/pathfinding';
import type { GameState, Unit } from '../src/game/types';

function fixture(workers = 9, inside = false): GameState {
  const makeUnit = (id: number, kind: Unit['kind']): Unit => ({
    id, kind, faction: 0, x: 12.5 + id % 4, y: 12.5 + Math.floor(id / 4) % 4,
    hp: 50, maxHp: 50, attack: 0, defense: 0, morale: 100, speed: 2.2, range: 1.1,
    order: kind === 'worker' ? 'work' : 'follow', cooldown: 0, lastCombat: -60,
    moving: false, facing: 0, attackTime: 0, home: 100,
    collector: kind === 'worker', collectorCamp: kind === 'worker' ? 100 : undefined,
    inside: kind === 'worker' && inside,
  });
  return {
    world: { width: 40, height: 40, seed: 'levy-performance', source: 'test', spawns: [],
      tiles: Array.from({ length: 1600 }, () => ({ terrain: 'grassland', overlay: 'none',
        elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [makeUnit(1, 'leader'), ...Array.from({ length: workers }, (_, index) => makeUnit(index + 2, 'worker'))],
    buildings: [{ id: 100, kind: 'palace', faction: 0, x: 8, y: 8, hp: 650, maxHp: 650,
      capacity: workers, unhousedResidents: workers, governorPermissions: { farms: false, housing: false } },
    ...Array.from({ length: 20 }, (_, index) => ({ id: 101 + index, kind: 'road' as const, faction: 0,
      x: 25 + index % 10, y: 25 + Math.floor(index / 10), hp: 100, maxHp: 100, capacity: 0 }))],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self',
      food: 500, gold: 1000, production: 0, population: workers, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false,
      research: { focus: 'massLevy', levels: { massLevy: 1 }, progress: {} } }],
    time: 10, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'levy-performance', rngState: 1,
    fields: [], raiderCamps: [], marauderPacks: [], villages: [],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('mass levy status query cost', () => {
  it('validates building topology once for a roster of hidden workers', () => {
    const state = fixture(36, true);
    // Warm the ordinary navigation snapshot, then count actual scalar reads
    // rather than timing this machine or depending on a private cache API.
    expect(levyStatus(state).available).toBe(12);
    const road = state.buildings[1];
    let reads = 0;
    Object.defineProperty(road, 'kind', { configurable: true, enumerable: true,
      get: () => { reads++; return 'road'; } });

    expect(levyStatus(state)).toMatchObject({ available: 12, canLevy: true });
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(4);
  });

  it('reuses display eligibility within a game second and refreshes when it expires', () => {
    const state = fixture(), probes = vi.spyOn(navigation, 'canWalk');
    expect(levyDisplayStatus(state)).toMatchObject({ available: 3, canLevy: true });
    const firstQuery = probes.mock.calls.length;
    expect(firstQuery).toBeGreaterThan(0);

    for (const worker of state.units.slice(2)) worker.hp = 0;
    for (const time of [10.1, 10.5, 10.99]) {
      state.time = time;
      expect(levyDisplayStatus(state).available).toBe(3);
    }
    state.paused = true;
    for (let frame = 0; frame < 60; frame++) levyDisplayStatus(state);
    expect(probes.mock.calls.length).toBe(firstQuery);

    state.paused = false; state.time = 11;
    expect(levyDisplayStatus(state)).toMatchObject({ available: 1, canLevy: true });
    const refreshed = probes.mock.calls.length;
    expect(refreshed).toBeGreaterThan(firstQuery);
    levyDisplayStatus(state);
    expect(probes.mock.calls.length).toBe(refreshed);
  });

  it('keeps treasury, population, research and leader controls live between eligibility refreshes', () => {
    const state = fixture(), faction = state.factions[0], leader = state.units[0];
    const probes = vi.spyOn(navigation, 'canWalk');
    expect(levyDisplayStatus(state).available).toBe(3);
    const firstQuery = probes.mock.calls.length;

    // Cache the eligible roster, not the population-capped number of recruits.
    faction.population = 30;
    expect(levyDisplayStatus(state)).toMatchObject({ maximum: 10, available: 9, draftCost: 135 });
    faction.population = 3;
    expect(levyDisplayStatus(state)).toMatchObject({ maximum: 1, available: 1 });
    faction.gold = 15;
    expect(levyDisplayStatus(state)).toMatchObject({ available: 0, canLevy: false });
    faction.gold = 15.1;
    expect(levyDisplayStatus(state)).toMatchObject({ available: 1, draftCost: 15, canLevy: true });

    delete faction.research!.levels.massLevy;
    expect(levyDisplayStatus(state).canLevy).toBe(false);
    faction.research!.levels.massLevy = 1;
    expect(levyDisplayStatus(state).canLevy).toBe(true);
    leader.inside = true;
    expect(levyDisplayStatus(state).canLevy).toBe(false);
    leader.inside = false; leader.embarkedOn = 500;
    expect(levyDisplayStatus(state).canLevy).toBe(false);
    delete leader.embarkedOn; leader.order = 'flee';
    expect(levyDisplayStatus(state).canLevy).toBe(false);
    leader.order = 'follow'; leader.hp = 0;
    expect(levyDisplayStatus(state).canLevy).toBe(false);
    leader.hp = 50;
    expect(levyDisplayStatus(state).canLevy).toBe(true);
    state.gameOver = true;
    expect(levyDisplayStatus(state).canLevy).toBe(false);
    state.gameOver = false; faction.defeated = true;
    expect(levyDisplayStatus(state).canLevy).toBe(false);
    expect(probes.mock.calls.length).toBe(firstQuery);
  });

  it('refreshes display eligibility immediately when new buildings block the muster exits', () => {
    const state = fixture(9, true), faction = state.factions[0];
    expect(levyDisplayStatus(state)).toMatchObject({ available: 3, canLevy: true });
    const exits = constructionEdges(state, state.buildings[0], true);
    expect(exits.length).toBeGreaterThan(0);
    entityStore(state).buildings.add(...exits.map((point, index) => ({ id: 200 + index,
      kind: 'house' as const, faction: 0, x: Math.floor(point.x), y: Math.floor(point.y),
      hp: 160, maxHp: 160, capacity: 0 })));
    expect(levyDisplayStatus(state)).toMatchObject({ available: 0, canLevy: false });

    expect(levyStatus(state)).toMatchObject({ available: 0, canLevy: false });
    const gold = faction.gold;
    expect(levyPopulation(state).ok).toBe(false);
    expect(faction.gold).toBe(gold);
    expect(state.units.filter(unit => unit.kind === 'worker')).toHaveLength(9);
    expect(state.units.some(unit => unit.kind === 'levyInfantry')).toBe(false);
  });

  it.each(['death', 'panic'] as const)('exact recruitment rejects newly unavailable workers after %s despite cached display eligibility', change => {
    const state = fixture(), faction = state.factions[0];
    expect(levyDisplayStatus(state)).toMatchObject({ available: 3, canLevy: true });
    for (const worker of state.units.slice(1)) {
      if (change === 'death') worker.hp = 0;
      else worker.civilianPanic = { until: state.time + 3, threat: { x: 20, y: 20 }, previousOrder: 'work' };
    }
    expect(levyDisplayStatus(state)).toMatchObject({ available: 3, canLevy: true });
    expect(levyStatus(state)).toMatchObject({ available: 0, canLevy: false });
    const gold = faction.gold;
    expect(levyPopulation(state).ok).toBe(false);
    expect(faction.gold).toBe(gold);
    expect(state.units.filter(unit => unit.kind === 'worker')).toHaveLength(9);
  });

  it('refreshes hidden-worker eligibility when forbidden exits are painted or erased', () => {
    const state = fixture(9, true);
    expect(levyDisplayStatus(state).available).toBe(3);
    setForbiddenRectangle(state, { x: 7, y: 7 }, { x: 10, y: 10 }, true);
    expect(levyDisplayStatus(state)).toMatchObject({ available: 0, canLevy: false });
    setForbiddenRectangle(state, { x: 7, y: 7 }, { x: 10, y: 10 }, false);
    expect(levyDisplayStatus(state)).toMatchObject({ available: 3, canLevy: true });
    expect(state.time).toBe(10);
  });

  it('refreshes cached workforce immediately after drafting and a cooled-down dismissal', () => {
    const state = fixture(); state.factions[0].population = 30;
    expect(levyDisplayStatus(state).available).toBe(9);
    expect(levyPopulation(state, 2)).toMatchObject({ ok: true, count: 2 });
    expect(levyDisplayStatus(state)).toMatchObject({ active: 2, available: 7, upkeep: 10 });
    expect(state.time).toBe(10);
    state.time += LEVY_ACTION_COOLDOWN;
    // Prime the display cache at the dismissal timestamp so expiry cannot hide
    // missing invalidation when the drafted workers return.
    expect(levyDisplayStatus(state)).toMatchObject({ active: 2, available: 7, upkeep: 10 });
    expect(dismissLevy(state).ok).toBe(true);
    expect(levyDisplayStatus(state)).toMatchObject({ active: 0, available: 9, upkeep: 0 });
    expect(state.time).toBe(10 + LEVY_ACTION_COOLDOWN);
  });

  it('keeps display workforce snapshots separate for each state and faction', () => {
    const state = fixture(), other = fixture(3);
    state.factions.push({ ...structuredClone(state.factions[0]), id: 1, relation: 'war' });
    entityStore(state).units.add({ ...state.units[0], id: 300, faction: 1 },
      { ...state.units[1], id: 301, faction: 1 });
    expect(levyDisplayStatus(state, 0).available).toBe(3);
    expect(levyDisplayStatus(state, 1).available).toBe(1);
    expect(levyDisplayStatus(other, 0).available).toBe(1);
    expect(levyDisplayStatus(state, 0).available).toBe(3);
  });
});
