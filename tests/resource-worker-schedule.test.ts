import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceResourceWorkforce, updateResourceWorkforce } from '../src/game/resource-workers';
import * as roads from '../src/game/resource-roads';
import { entityStore } from '../src/game/entity-store';
import { withSimulationReads } from '../src/game/simulation-reads';
import type { GameState } from '../src/game/types';

function fixture(siteCount = 1): GameState {
  const width = 44, height = 24;
  const state = { world: { width, height, revision: 0, seed: 'resource-schedule', source: 'test', spawns: [],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [], buildings: [6, 23, 32].map((x, index) => ({ id: index + 1, kind: 'palace', faction: 0, x, y: 8,
      hp: 650, maxHp: 650, capacity: 30, unhousedResidents: 20, initialCity: true })), fields: [],
    factions: [{ id: 0, name: 'Test', relation: 'self', population: 60, gold: 500, food: 500, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], seed: 'resource-schedule', rngState: 1,
    gameOver: false, resourceWorkSites: [], nextResourceWorkSiteId: siteCount + 1 } as unknown as GameState;
  for (let i = 0; i < siteCount; i++) {
    const cell = (8 + i * 6) * width + 13;
    Object.assign(state.world.tiles[cell], { resource: 'copper', resourceDeveloped: true, resourceGroup: i + 1 });
    state.resourceWorkSites!.push({ id: i + 1, faction: 0, resource: 'copper', cells: [cell], revision: 0,
      nextVisitAt: 0, roadComplete: true });
  }
  return state;
}
const queue = (state: GameState) => withSimulationReads(state, () => updateResourceWorkforce(state));
const pump = (state: GameState) => {
  state.time += 1 / 60;
  withSimulationReads(state, () => advanceResourceWorkforce(state));
};
const unrelatedBuilding = (state: GameState, id: number) => entityStore(state).buildings.add({
  id, kind: 'house', faction: 0, x: 1, y: id % 5, hp: 100, maxHp: 100, capacity: 0,
});
function mockRoutePlanning() {
  const plan = vi.spyOn(roads, 'resourceRoadJourney');
  vi.spyOn(roads, 'createResourceRoadCursor').mockImplementation((state, city, cells, resource) => ({
    advance: () => ({ done: true, journey: roads.resourceRoadJourney(state, city, cells, resource), expansions: 0, validations: 0 }),
    cancel: () => {},
  }));
  return plan;
}
afterEach(() => vi.restoreAllMocks());

describe('resource trip scheduling', () => {
  it('keeps one suspended origin active without consuming its visit or starting another workspace', () => {
    const state = fixture(2), sites = state.resourceWorkSites!;
    const created: number[] = [], cancelled: number[] = [];
    vi.spyOn(roads, 'createResourceRoadCursor').mockImplementation((_state, _city, cells) => {
      created.push(cells[0]); let turns = 0;
      return { advance: () => ({ done: ++turns === 2, expansions: 1024, validations: 0 }),
        cancel: () => { cancelled.push(cells[0]); } };
    });
    queue(state); pump(state);
    expect(created).toEqual([sites[0].cells[0]]);
    expect(sites[0].nextVisitAt).toBe(0);
    pump(state);
    expect(created).toHaveLength(1); expect(cancelled).toEqual([sites[0].cells[0]]);
    pump(state);
    expect(created).toEqual([sites[0].cells[0], sites[1].cells[0]]);
    state.world = { ...state.world }; pump(state);
    expect(cancelled).toEqual(created);
    expect(sites.every(site => site.nextVisitAt === 0)).toBe(true);
  });

  it('tries one origin per fast step, rotates sites fairly, and consumes only completed attempts', () => {
    const state = fixture(2), plan = mockRoutePlanning().mockReturnValue(undefined);
    queue(state);
    const sites = state.resourceWorkSites!;
    expect(plan).not.toHaveBeenCalled();
    for (let step = 0; step < 4; step++) {
      pump(state); expect(plan).toHaveBeenCalledTimes(step + 1);
      expect(sites.map(site => site.nextVisitAt)).toEqual([0, 0]);
      expect(sites.map(site => site.retryAt)).toEqual([undefined, undefined]);
    }
    pump(state); expect(sites.map(site => site.nextVisitAt)).toEqual([10, 0]);
    pump(state); expect(sites.map(site => site.nextVisitAt)).toEqual([10, 10]);
    expect(plan.mock.calls.map(call => [call[2][0], call[1].id])).toEqual([
      [sites[0].cells[0], 1], [sites[1].cells[0], 1], [sites[0].cells[0], 2],
      [sites[1].cells[0], 2], [sites[0].cells[0], 3], [sites[1].cells[0], 3],
    ]);
    expect(state.units).toHaveLength(0);
  });

  it('publishes a freshly successful route during sustained unrelated construction', () => {
    const state = fixture(), cells = state.resourceWorkSites![0].cells;
    const route = roads.resourceRoadJourney(state, state.buildings[1], cells)!;
    expect(route).toBeDefined();
    const plan = mockRoutePlanning().mockImplementation((_state, city) => city.id === 2 ? route : undefined);
    queue(state);
    unrelatedBuilding(state, 101); pump(state);
    expect(state.resourceWorkSites![0].nextVisitAt).toBe(0);
    unrelatedBuilding(state, 102); pump(state);
    expect(plan).toHaveBeenCalledTimes(2);
    expect(state.units).toHaveLength(1);
    expect(state.units[0]).toMatchObject({ home: 2, inside: false, resourceWork: { phase: 'outbound' } });
    expect(state.resourceWorkSites![0].nextVisitAt).toBe(10);
  });

  it('does not cache stale failures or lose a visit when geometry changes mid-cohort', () => {
    const state = fixture(), route = roads.resourceRoadJourney(state, state.buildings[0], state.resourceWorkSites![0].cells)!;
    const plan = mockRoutePlanning().mockReturnValue(undefined);
    queue(state); pump(state); unrelatedBuilding(state, 101); pump(state); pump(state);
    const site = state.resourceWorkSites![0];
    expect(plan).toHaveBeenCalledTimes(3); expect(site.nextVisitAt).toBe(0); expect(site.retryAt).toBeUndefined();
    state.time += 2; pump(state); expect(plan).toHaveBeenCalledTimes(3);
    plan.mockReturnValue(route); state.time += 1; pump(state);
    expect(plan).toHaveBeenCalledTimes(4); expect(state.units).toHaveLength(1); expect(site.nextVisitAt).toBe(10);
  });

  it('retains an exact failure through population growth and harvest appearance changes', () => {
    const state = fixture(), plan = mockRoutePlanning().mockReturnValue(undefined);
    queue(state); pump(state); pump(state); pump(state);
    expect(plan).toHaveBeenCalledTimes(3);
    state.factions[0].population += 3;
    for (const city of state.buildings) city.unhousedResidents!++;
    state.farmVersion = (state.farmVersion ?? 0) + 1;
    state.time = 10.1; queue(state); pump(state);
    expect(plan).toHaveBeenCalledTimes(3);
    expect(state.resourceWorkSites![0].nextVisitAt).toBe(20);
  });

  it('drops removed sites and cannot dispatch from a captured or dead origin', () => {
    const state = fixture(2), plan = mockRoutePlanning().mockReturnValue(undefined);
    queue(state); pump(state);
    state.buildings[1].hp = 0;
    const removed = state.resourceWorkSites![1];
    for (const cell of removed.cells) state.world.tiles[cell].resourceDeveloped = false;
    state.world.revision!++;
    queue(state); pump(state); pump(state);
    expect(plan.mock.calls.some(call => call[1].id === 2)).toBe(false);
    expect(plan.mock.calls.some(call => call[2][0] === removed.cells[0])).toBe(false);
    expect(state.units).toHaveLength(0);
  });

  it('pauses queued work and discards runtime jobs after world replacement', () => {
    const state = fixture(), plan = mockRoutePlanning().mockReturnValue(undefined);
    queue(state); state.paused = true; pump(state); expect(plan).not.toHaveBeenCalled();
    state.paused = false; state.world = { ...state.world }; pump(state); expect(plan).not.toHaveBeenCalled();
    expect(state.resourceWorkSites![0].nextVisitAt).toBe(0);
  });

  it('revalidates a successful site before dispatch even between slow sensing passes', () => {
    const state = fixture(), site = state.resourceWorkSites![0];
    const route = roads.resourceRoadJourney(state, state.buildings[0], site.cells)!;
    mockRoutePlanning().mockReturnValue(route);
    queue(state);
    state.world.tiles[site.cells[0]].resourceDeveloped = false;
    state.world.revision!++;
    pump(state);
    expect(state.resourceWorkSites).toHaveLength(0);
    expect(state.units).toHaveLength(0);
    expect(site.nextVisitAt).toBe(0);
  });
});
