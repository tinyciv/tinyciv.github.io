import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COURIER_OUTBOUND_NODE_LIMIT, COURIER_OUTBOUND_TARGET_LIMIT, COURIER_ROUTE_MAX_AGE, courierOutboundPath, courierReturnPath, courierRouteCacheStats } from '../src/game/courier-routes';
import { entityStore } from '../src/game/entity-store';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { FARM_TRAVEL_EDIT_BATCH } from '../src/game/farm-travel';
import { installNavigationWasm, navigationWasmStatus } from '../src/game/navigation-wasm';
import { canMove, findPath } from '../src/game/pathfinding';
import type { Building, GameState, Point } from '../src/game/types';

beforeAll(async () => { await installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/navigation.wasm'))); });

function fixture(width = 32, height = 18): GameState {
  return {
    world: { width, height, revision: 0, seed: 'outbound-routes', source: 'test', spawns: [],
      tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [], units: [], fields: [],
    factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self', food: 20,
      gold: 20, production: 0, population: 4, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false }], time: 10, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    gameOver: false, victory: false, seed: 'outbound-routes', rngState: 1,
  };
}
function building(id: number, kind: Building['kind'], x: number, y: number): Building {
  return { id, kind, x, y, faction: 0, hp: 200, maxHp: 200, capacity: 0 };
}
const door = { x: 4.5, y: 8.5 }, farm = { x: 25.5, y: 8.5 };
const directPath = (state: GameState, from: Point, to: Point) =>
  findPath(state, from, to, 0, false, undefined, undefined, undefined, false, true);

describe('shared outbound courier routes', () => {
  it('runs weighted forward A* once, then shares immutable suffixes without another native search', () => {
    const state = fixture();
    for (let x = 5; x < 25; x++) entityStore(state).buildings.add(building(100 + x, 'road', x, 9));
    // A return journey cannot substitute its reversed route for a forward search.
    courierReturnPath(state, farm, door, 0);
    const expected = directPath(state, door, farm), before = navigationWasmStatus();
    const first = courierOutboundPath(state, door, farm, 0);
    expect(first).toEqual(expected);
    expect(first.some(point => point.y === 9.5)).toBe(true);
    expect(navigationWasmStatus().searches).toBe(before.searches + 1);
    expect(navigationWasmStatus().unsupported).toBe(before.unsupported);
    const following = { ...first[3] }, suffix = first.slice(4).map(point => ({ ...point }));
    first[4].x = 99; first.length = 0;
    expect(courierOutboundPath(state, following, farm, 0)).toEqual(suffix);
    expect(courierRouteCacheStats(state)).toMatchObject({ searches: 1, outboundHits: 1, outboundSearches: 1 });
    expect(navigationWasmStatus().searches).toBe(before.searches + 1);
  });

  it('keeps a whole 150-farm round warm without evicting the separate return-door cache', () => {
    const state = fixture(), from = { x: .5, y: .5 };
    courierReturnPath(state, farm, door, 0);
    const goals = Array.from({ length: 150 }, (_, i) => ({ x: 1.5 + i % 30, y: 2.5 + Math.floor(i / 30) }));
    for (const goal of goals) expect(courierOutboundPath(state, from, goal, 0).at(-1)).toEqual(goal);
    for (const goal of goals) expect(courierOutboundPath(state, from, goal, 0).at(-1)).toEqual(goal);
    courierReturnPath(state, farm, door, 0);
    expect(courierRouteCacheStats(state)).toMatchObject({ hits: 1, searches: 1, doors: 1,
      outboundHits: 150, outboundSearches: 150, outboundTargets: 150 });
  });

  it('rejects new forbidden cells immediately, including a now-forbidden destination', () => {
    const state = fixture(), first = courierOutboundPath(state, door, farm, 0), blocked = first[5];
    setForbiddenRectangle(state, blocked, blocked, true);
    const changed = courierOutboundPath(state, door, farm, 0);
    expect(changed).toEqual(directPath(state, door, farm));
    expect(changed.some(point => point.x === blocked.x && point.y === blocked.y)).toBe(false);
    let previous = door;
    for (const point of changed) { expect(canMove(state, previous, point, 0, undefined, true)).toBe(true); previous = point; }
    setForbiddenRectangle(state, farm, farm, true);
    expect(courierOutboundPath(state, door, farm, 0)).toEqual([]);
  });

  it('returns no partial dispatch path when a same-tick gate closure makes the farm unreachable', () => {
    const state = fixture();
    for (let y = 0; y < state.world.height; y++) entityStore(state).buildings.add(building(100 + y, 'wall', 15, y));
    const gate = building(200, 'road', 15, 8); entityStore(state).buildings.add(gate);
    expect(courierOutboundPath(state, door, farm, 0).at(-1)).toEqual(farm);
    gate.hp = 0;
    expect(courierOutboundPath(state, door, farm, 0)).toEqual([]);
    gate.hp = 200;
    expect(courierOutboundPath(state, door, farm, 0).at(-1)).toEqual(farm);
  });

  it('invalidates a cached water crossing immediately when its bridge is destroyed', () => {
    const state = fixture();
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 15].terrain = 'river';
    const bridge = building(200, 'bridge', 15, 8); entityStore(state).buildings.add(bridge);
    expect(courierOutboundPath(state, door, farm, 0).at(-1)).toEqual(farm);
    expect(courierOutboundPath(state, door, farm, 0).at(-1)).toEqual(farm);
    expect(courierRouteCacheStats(state).outboundHits).toBe(1);
    bridge.hp = 0;
    expect(courierOutboundPath(state, door, farm, 0)).toEqual([]);
    bridge.hp = 200;
    expect(courierOutboundPath(state, door, farm, 0).at(-1)).toEqual(farm);
  });

  it('centers fractional starts before a cached diagonal crosses a blocked cell', () => {
    const state = fixture(); entityStore(state).buildings.add(building(90, 'wall', 9, 8));
    const centered = { x: 10.5, y: 8.5 }, destination = { x: 8.5, y: 10.5 };
    const original = courierOutboundPath(state, centered, destination, 0);
    expect(original[0]).toEqual({ x: 9.5, y: 9.5 });
    const fractional = { x: 10.05, y: 8.6 }, path = courierOutboundPath(state, fractional, destination, 0);
    expect(path).toEqual([centered, ...original]);
    let previous = fractional;
    for (const point of path) { expect(canMove(state, previous, point, 0, undefined, true)).toBe(true); previous = point; }
    expect(courierOutboundPath(state, { x: 8.8, y: 10.7 }, destination, 0)).toEqual([destination]);
  });

  it('publishes faster routine road routes on edit twenty while terrain access stays immediate', () => {
    const state = fixture(), original = courierOutboundPath(state, door, farm, 0);
    for (let i = 0; i < FARM_TRAVEL_EDIT_BATCH; i++) {
      entityStore(state).buildings.add(building(100 + i, 'road', 5 + i, 9)); state.world.revision!++;
      const path = courierOutboundPath(state, door, farm, 0);
      if (i < FARM_TRAVEL_EDIT_BATCH - 1) expect(path).toEqual(original);
      else { expect(path).toEqual(directPath(state, door, farm)); expect(path).not.toEqual(original); }
    }
    expect(courierRouteCacheStats(state)).toMatchObject({ outboundHits: 19, outboundSearches: 2 });
    state.world.tiles[8 * state.world.width + 25].terrain = 'lake'; state.world.revision!++;
    expect(courierOutboundPath(state, door, farm, 0)).toEqual([]);
  });


  it('keeps a 780-farm working set warm across unrelated construction and farm-only revisions', () => {
    const state = fixture(80, 80), from = { x: .5, y: .5 };
    const goals = Array.from({ length: 780 }, (_, i) => ({ x: 1.5 + i % 30, y: 1.5 + Math.floor(i / 30) }));
    for (const goal of goals) expect(courierOutboundPath(state, from, goal, 0).at(-1)).toEqual(goal);
    entityStore(state).buildings.add(building(1000, 'house', 70, 70)); state.world.revision!++;
    for (let i = 0; i < FARM_TRAVEL_EDIT_BATCH; i++) {
      entityStore(state).buildings.add(building(2000 + i, 'camp', 35 + i % 10 * 2, 40 + Math.floor(i / 10) * 2));
      state.world.revision!++;
    }
    state.time += 60;
    for (const goal of goals) expect(courierOutboundPath(state, from, goal, 0).at(-1)).toEqual(goal);
    expect(courierRouteCacheStats(state)).toMatchObject({ outboundHits: 780, outboundSearches: 780, outboundTargets: 780 });
  });

  it('refreshes surviving routes after a bounded age so distant shortcuts can be adopted', () => {
    const state = fixture();
    courierOutboundPath(state, door, farm, 0);
    state.time += COURIER_ROUTE_MAX_AGE;
    expect(courierOutboundPath(state, door, farm, 0)).toEqual(directPath(state, door, farm));
    expect(courierRouteCacheStats(state).outboundSearches).toBe(2);
  });

  it('bounds both outbound destination count and retained nodes without invalidating return routes', () => {
    const state = fixture(64, 64), from = { x: .5, y: .5 };
    courierReturnPath(state, farm, door, 0);
    for (let i = 0; i < COURIER_OUTBOUND_TARGET_LIMIT + 50; i++) {
      const destination = { x: 1.5 + i % 45, y: 1.5 + Math.floor(i / 45) };
      expect(courierOutboundPath(state, from, destination, 0).at(-1)).toEqual(destination);
    }
    const stats = courierRouteCacheStats(state);
    expect(stats.outboundTargets).toBe(COURIER_OUTBOUND_TARGET_LIMIT);
    expect(stats.outboundNodes).toBeLessThanOrEqual(COURIER_OUTBOUND_NODE_LIMIT);
    courierReturnPath(state, farm, door, 0);
    expect(courierRouteCacheStats(state)).toMatchObject({ hits: 1, searches: 1 });

    const long = fixture(1024, 2);
    for (let i = 0; i < 180; i++) {
      const destination = { x: 800.5 + i, y: .5 }, path = courierOutboundPath(long, from, destination, 0);
      expect(path.at(-1)).toEqual(destination);
      expect(new Set(path.map(point => `${point.x},${point.y}`)).size).toBe(path.length);
    }
    expect(courierRouteCacheStats(long).outboundTargets).toBeLessThan(180);
    expect(courierRouteCacheStats(long).outboundNodes).toBeLessThanOrEqual(COURIER_OUTBOUND_NODE_LIMIT);
  });
});
