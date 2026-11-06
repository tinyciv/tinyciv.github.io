import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { type Building, type GameState, type World, tileAt } from '../src/game/types';
import { irrigationAt, irrigationYieldMultiplier, prepareIrrigation } from '../src/game/irrigation';
import { canWalk, findPath, invalidateNavigation, movementMultiplier, travelTimeMap } from '../src/game/pathfinding';
import { fieldHarvestFoodForState, fieldHarvestYield, synchronizeFarms, updateHarvests } from '../src/game/farms';
import { citySummaries } from '../src/game/cities';
import { cityDevelopmentNeeds } from '../src/game/governor';

function fixture(width = 16, height = 16): GameState {
  const world: World = { width, height, seed: 'irrigation', source: 'fixture', spawns: [],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) };
  return { world, buildings: [], units: [], fields: [],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', gold: 1000, food: 100,
      population: 0, production: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: world.seed, rngState: 1 };
}
const building = (kind: Building['kind'], x: number, y: number, id = 1): Building =>
  ({ id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
function farm(): GameState {
  const state = fixture();
  entityStore(state).buildings.replace([building('palace', 1, 1, 1), building('camp', 4, 4, 2)]);
  synchronizeFarms(state);
  return state;
}

describe('irrigation coverage and harvests', () => {
  it('doubles within a two-tile circular radius, without stacking or faction restrictions', () => {
    const state = fixture();
    entityStore(state).buildings.add(building('irrigation', 6, 6));
    for (const [x, y] of [[6, 6], [8, 6], [4, 6], [6, 4], [6, 8], [7, 7]])
      expect(irrigationYieldMultiplier(state, x, y)).toBe(2);
    for (const [x, y] of [[8, 7], [4, 5], [9, 6], [-1, 6], [16, 6]])
      expect(irrigationYieldMultiplier(state, x, y)).toBe(1);
    entityStore(state).buildings.add({ ...building('irrigation', 7, 6, 2), faction: 1 });
    expect(irrigationYieldMultiplier(state, 6, 6)).toBe(2);
    expect(irrigationYieldMultiplier(state, 9, 6)).toBe(2);
  });

  it('updates unfinished, completed, removed and same-tick fixture states without stale coverage', () => {
    const state = fixture(), ditch = building('irrigation', 6, 6);
    ditch.construction = { startedAt: 0, duration: 2 };
    entityStore(state).buildings.add(ditch);
    expect(irrigationYieldMultiplier(state, 6, 6)).toBe(1);
    delete ditch.construction;
    expect(irrigationYieldMultiplier(state, 6, 6)).toBe(2);
    ditch.x = 12;
    expect(irrigationYieldMultiplier(state, 6, 6)).toBe(1);
    expect(irrigationAt(state, 12.5, 6.5)).toBe(true);
    state.world.revision = 1;
    const coverage = prepareIrrigation(state).coverage;
    expect(prepareIrrigation(state).coverage).toBe(coverage);
    ditch.hp = 0; invalidateNavigation(state);
    expect(irrigationYieldMultiplier(state, 12, 6)).toBe(1);
    ditch.hp = 100; state.world.revision++;
    expect(irrigationYieldMultiplier(state, 12, 6)).toBe(2);
    entityStore(state).buildings.replace([]);
    expect(irrigationYieldMultiplier(state, 12, 6)).toBe(1);
  });

  it('reuses coverage across many field lookups and unchanged simulation ticks', () => {
    const state = fixture(); state.world.revision = 0;
    const ditch = building('irrigation', 6, 6); let reads = 0;
    Object.defineProperty(ditch, 'kind', { get: () => { reads++; return 'irrigation'; } });
    entityStore(state).buildings.add(ditch);
    reads = 0; // Measure coverage reads after entity registration.
    const mask = prepareIrrigation(state).coverage;
    for (let field = 0; field < 1000; field++) irrigationYieldMultiplier(state, field % 16, Math.floor(field / 16) % 16);
    expect(reads).toBe(1);
    state.time = .1;
    expect(prepareIrrigation(state).coverage).toBe(mask);
    expect(reads).toBe(2);
  });

  it('keeps a crop cell sharing a ditch beside a road and doubles actual new harvests', () => {
    const state = farm(), field = state.fields![0];
    field.food = .7; field.foodBatches = [{ amount: .7, expiresAt: 80 }];
    entityStore(state).buildings.add(building('irrigation', 4, 4, 3), building('road', 4, 5, 4));
    synchronizeFarms(state);
    expect(state.fields).toHaveLength(1);
    expect(state.fields![0]).toBe(field);
    for (const plot of state.fields!) plot.nextHarvest = 30;
    state.time = 30; updateHarvests(state);
    expect(field.food).toBeCloseTo(.7 + 1.6 * 4 / 3);
    expect(state.factions[0].food).toBe(100); // Collection still delivers the harvest.
    expect(canWalk(state, 4.5, 4.5, 0)).toBe(true);
  });

  it('uses the same fractional and orchard bonuses for harvest, city HUD and governor estimates', () => {
    const state = farm(), palace = state.buildings[0], field = state.fields![0];
    expect(citySummaries(state)[0].food).toBeCloseTo(.4 * 4 / 3);
    entityStore(state).buildings.add(building('irrigation', 3, 4, 3));
    expect(citySummaries(state)[0].food).toBeCloseTo(.8 * 4 / 3);
    expect(cityDevelopmentNeeds(state, palace).foodCapacity).toBeCloseTo((.8 * 4 / 3) * .9);
    tileAt(state.world, field.x, field.y)!.terrain = 'desert';
    expect(fieldHarvestFoodForState(state, field.x, field.y)).toBeCloseTo(.4 * 4 / 3);
    field.orchard = { startedAt: 0, readyAt: 10 };
    expect(fieldHarvestYield(state, field, 9)).toBe(0);
    expect(fieldHarvestYield(state, field, 10)).toBeCloseTo(.6 * 4 / 3);
    expect(citySummaries(state)[0].food).toBeCloseTo(0);
    state.time = 10;
    expect(citySummaries(state)[0].food).toBeCloseTo(.3 * 4 / 3);
  });
});

describe('irrigation movement', () => {
  it('is pathable by every faction and halves existing terrain speed only when completed and unbridged', () => {
    const state = fixture(), ditch = building('irrigation', 6, 6);
    entityStore(state).buildings.add(ditch);
    for (const faction of [0, 1, -1, -2]) expect(canWalk(state, 6.5, 6.5, faction)).toBe(true);
    expect(movementMultiplier(state, 6.5, 6.5)).toBe(.5);
    tileAt(state.world, 6, 6)!.overlay = 'forest';
    expect(movementMultiplier(state, 6.5, 6.5)).toBe(.25);
    ditch.construction = { startedAt: 0, duration: 2 };
    expect(movementMultiplier(state, 6.5, 6.5)).toBe(.5);
    delete ditch.construction;
    entityStore(state).buildings.add(building('road', 6, 6, 2));
    expect(movementMultiplier(state, 6.5, 6.5)).toBe(1.5);
  });

  it('charges matching route time and removes the crossing penalty after demolition or paving', () => {
    const state = fixture(5, 1), origin = { x: .5, y: .5 }, goal = { x: 4.5, y: .5 };
    expect(travelTimeMap(state, origin, 0, 1, 100)[4]).toBeCloseTo(4);
    entityStore(state).buildings.add(building('irrigation', 2, 0));
    expect(findPath(state, origin, goal, 0).at(-1)).toEqual(goal);
    expect(travelTimeMap(state, origin, 0, 1, 100)[4]).toBeCloseTo(5);
    entityStore(state).buildings.add(building('road', 2, 0, 2));
    expect(travelTimeMap(state, origin, 0, 1, 100)[4]).toBeCloseTo(3 + 2 / 3);
    entityStore(state).buildings.replace([]);
    expect(travelTimeMap(state, origin, 0, 1, 100)[4]).toBeCloseTo(4);
  });
});
