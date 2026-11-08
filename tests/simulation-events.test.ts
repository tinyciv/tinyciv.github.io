import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { SimulationEvents } from '../src/game/simulation-events';
import { FIELD_HARVEST_FOOD, FIELD_HARVEST_SECONDS, FIELD_SPOIL_SECONDS, synchronizeFarms, updateHarvests } from '../src/game/farms';
import { updateFactionDevelopment, type DevelopmentOrders } from '../src/game/faction-development';
import { updateTreeStumps } from '../src/game/tree-clearing';
import { updateGame } from '../src/game/simulation';
import { createPerformanceScenario } from '../dev/performance/scenarios';
import type { Building, GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function farmRealm(): GameState {
  const state: GameState = {
    world: { width: 24, height: 16, seed: 'event-queue', source: 'test', spawns: [], tiles: Array.from({ length: 384 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', x: 2, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 },
      { id: 2, kind: 'camp', x: 6, y: 7, faction: 0, hp: 100, maxHp: 100, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 50, gold: 0,
      production: 0, population: 4, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    units: [], fields: [], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'event-queue', rngState: 1,
  };
  synchronizeFarms(state);
  return state;
}

describe('simulation-time event queue', () => {
  it('orders deadlines and equal-time events deterministically, firing each once', () => {
    const events = new SimulationEvents<string>();
    events.schedule('later', 20, 'later'); events.schedule('first', 10, 'first'); events.schedule('second', 10, 'second');
    expect(events.takeDue(9.999)).toEqual([]);
    expect(events.takeDue(10)).toEqual(['first', 'second']);
    expect(events.takeDue(10)).toEqual([]);
    expect(events.takeDue(100)).toEqual(['later']);
  });

  it('rejects stale generations after replacement and cancellation', () => {
    const events = new SimulationEvents<string>();
    events.schedule('rescheduled', 10, 'old'); events.schedule('rescheduled', 30, 'new');
    events.schedule('cancelled', 5, 'removed'); events.cancel('cancelled');
    expect(events.takeDue(20)).toEqual([]);
    expect(events.takeDue(30)).toEqual(['new']);
  });

  it('bounds memory for repeatedly postponed events and clears state for a new timeline', () => {
    const events = new SimulationEvents<string>();
    for (let i = 0; i < 5000; i++) events.schedule('visit', i + 100, 'visit');
    expect(events.size).toBe(1); expect(events.queuedCount).toBeLessThanOrEqual(64);
    events.clear(); events.schedule('visit', 1, 'new world');
    expect(events.takeDue(1)).toEqual(['new world']);
    expect(events.takeDue(10000)).toEqual([]);
  });

  it('supports disabling a deadline without scheduling a wall-clock callback', () => {
    const events = new SimulationEvents<string>();
    events.schedule('research', 10, 'research'); events.schedule('research', Infinity, 'research');
    expect(events.takeDue(1e9)).toEqual([]);
    events.schedule('research', 20, 'research');
    expect(events.takeDue(19)).toEqual([]); expect(events.takeDue(19)).toEqual([]);
    expect(events.takeDue(20)).toEqual(['research']);
  });
});

describe('scheduled farm harvests', () => {
  it('leaves unchanged food batches resident between deadlines', () => {
    const state = farmRealm(), field = state.fields![0];
    field.nextHarvest = FIELD_HARVEST_SECONDS; updateHarvests(state);
    const emptyBatches = field.foodBatches;
    for (const time of [1, 2, 10, FIELD_HARVEST_SECONDS - 1]) { state.time = time; updateHarvests(state); }
    expect(field.foodBatches).toBe(emptyBatches);
    expect(field.food).toBe(0);
    state.time = FIELD_HARVEST_SECONDS; updateHarvests(state);
    expect(field.food).toBe(FIELD_HARVEST_FOOD);
    const ripeBatches = field.foodBatches;
    state.time = FIELD_HARVEST_SECONDS + 1; updateHarvests(state);
    expect(field.foodBatches).toBe(ripeBatches);
  });

  it('catches up harvests and individual spoilage deadlines on a large time jump', () => {
    const state = farmRealm(), field = state.fields![0];
    field.nextHarvest = FIELD_HARVEST_SECONDS; updateHarvests(state);
    state.buildings[1].farmLastVisitedAt = FIELD_HARVEST_SECONDS * 2;
    state.time = FIELD_HARVEST_SECONDS * 3; updateHarvests(state);
    expect(field.nextHarvest).toBe(FIELD_HARVEST_SECONDS * 4);
    expect(field.food).toBeCloseTo(FIELD_HARVEST_FOOD);
    expect(field.foodBatches).toEqual([{ amount: FIELD_HARVEST_FOOD, expiresAt: FIELD_HARVEST_SECONDS * 3 + FIELD_SPOIL_SECONDS }]);
    // The two expired batches retain fractional quantities; their visible loss
    // is rounded to a whole number while the simulation retains every fraction.
    const displayedLoss = Math.round(FIELD_HARVEST_FOOD * 2);
    expect(state.particles.some(particle => particle.x === field.x + .5 && particle.text === `−${displayedLoss} food`)).toBe(true);
  });

  it('observes edited deadlines and in-place batch mutations', () => {
    const state = farmRealm(), field = state.fields![0];
    field.nextHarvest = 1000; updateHarvests(state);
    field.food = 3; field.foodBatches = [{ amount: 3, expiresAt: 5 }]; field.expiresAt = 5;
    state.time = 4; updateHarvests(state); expect(field.food).toBe(3);
    field.foodBatches[0].expiresAt = 4;
    updateHarvests(state); expect(field.food).toBe(0);
    field.nextHarvest = 4; updateHarvests(state); expect(field.food).toBe(FIELD_HARVEST_FOOD);
  });

  it('discards replaced field objects and rebuilds after a state rewind/load', () => {
    const state = farmRealm(), initial = structuredClone(state), old = state.fields![0];
    old.nextHarvest = 1; updateHarvests(state);
    const replacement = { ...old, nextHarvest: 1000, food: 0, foodBatches: [] };
    state.fields![0] = replacement;
    state.time = 1; updateHarvests(state);
    expect(replacement.food).toBe(0); expect(old.food).toBe(0);
    Object.assign(state, structuredClone(initial));
    state.fields![0].nextHarvest = .5;
    state.time = .5; updateHarvests(state);
    expect(state.fields![0].food).toBe(FIELD_HARVEST_FOOD);
    expect(replacement.food).toBe(0);
  });
});

describe('scheduled city and stump lifecycles', () => {
  const recorder = (planned: number[]): DevelopmentOrders => ({
    farms: (_faction, palace) => { planned.push(palace.id); }, houses: () => {},
    validate: () => ({ ok: false }), build: () => ({ ok: false }),
  });

  it('preserves city array order when a jump makes multiple deadlines due', () => {
    const state = farmRealm(), planned: number[] = [];
    const first = state.buildings[0]; first.governorNextPlanAt = 10;
    const second: Building = { ...first, id: 20, x: 15, governorNextPlanAt: 5 };
    entityStore(state).buildings.add(second); updateFactionDevelopment(state, recorder(planned));
    state.time = 10; updateFactionDevelopment(state, recorder(planned));
    expect(planned).toEqual([first.id, first.id, first.id, first.id, second.id, second.id, second.id, second.id]);
    expect(first.governorNextPlanAt).toBe(40); expect(second.governorNextPlanAt).toBe(40);
  });

  it('cancels deleted cities and respects explicit deadline changes', () => {
    const state = farmRealm(), planned: number[] = [], palace = state.buildings[0];
    palace.governorNextPlanAt = 10; updateFactionDevelopment(state, recorder(planned));
    palace.governorNextPlanAt = 20;
    state.time = 10; updateFactionDevelopment(state, recorder(planned)); expect(planned).toEqual([]);
    entityStore(state).buildings.replace(state.buildings.filter(building => building !== palace));
    state.time = 20; updateFactionDevelopment(state, recorder(planned)); expect(planned).toEqual([]);
    entityStore(state).buildings.add({ ...palace, governorNextPlanAt: 21 });
    state.time = 21; updateFactionDevelopment(state, recorder(planned)); expect(planned).toEqual([palace.id, palace.id, palace.id, palace.id]);
  });

  it('uses simulated elapsed time, including pause and game speed, for expiry', () => {
    const state = createPerformanceScenario('idle-100').state;
    state.treeStumps = [{ x: 1, y: 1, sourceX: 0, sourceY: 0, expiresAt: 1 }];
    state.paused = true; updateGame(state, 10, idle);
    expect(state.time).toBe(0); expect(state.treeStumps).toHaveLength(1);
    state.paused = false; state.speed = 2; updateGame(state, .25, idle);
    expect(state.time).toBeCloseTo(.5); expect(state.treeStumps).toHaveLength(1);
    updateGame(state, .26, idle);
    expect(state.time).toBeCloseTo(1.02);
    // Expired stumps are removed by the next 3 Hz maintenance pass.
    updateGame(state, .2, idle); expect(state.treeStumps).toHaveLength(0);
  });

  it('rebuilds stump deadlines when replacing a world on the same state object', () => {
    const state = farmRealm();
    state.treeStumps = [{ x: 1, y: 1, sourceX: 0, sourceY: 0, expiresAt: 5 }]; updateTreeStumps(state);
    Object.assign(state, farmRealm());
    state.treeStumps = [{ x: 2, y: 2, sourceX: 0, sourceY: 0, expiresAt: 10 }];
    state.time = 5; updateTreeStumps(state); expect(state.treeStumps).toHaveLength(1);
    state.time = 10; updateTreeStumps(state); expect(state.treeStumps).toHaveLength(0);
  });
});
