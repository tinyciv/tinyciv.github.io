import { describe, expect, it } from 'vitest';
import { courierReturnPath, courierRouteCacheStats } from '../src/game/courier-routes';
import { entityStore } from '../src/game/entity-store';
import { updateCollector } from '../src/game/farms';
import { FARM_TRAVEL_EDIT_BATCH } from '../src/game/farm-travel';
import { canMove, findPath } from '../src/game/pathfinding';
import type { Building, GameState, Point, Unit } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 32, height: 18, revision: 0, seed: 'courier-routes', source: 'test', spawns: [],
      tiles: Array.from({ length: 32 * 18 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 2, 8), building(2, 'camp', 25, 8)], units: [], fields: [],
    factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self', food: 20,
      gold: 20, production: 0, population: 4, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false }], time: 10, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    gameOver: false, victory: false, seed: 'courier-routes', rngState: 1,
  };
}
function building(id: number, kind: Building['kind'], x: number, y: number): Building {
  return { id, kind, x, y, faction: 0, hp: 200, maxHp: 200, capacity: 0 };
}
const start = { x: 25.5, y: 8.5 }, door = { x: 4.5, y: 8.5 };
const cell = (point: Point): number => Math.floor(point.y) * 32 + Math.floor(point.x);
function courier(id: number): Unit {
  return { id, kind: 'worker', faction: 0, ...start, hp: 50, maxHp: 50, morale: 100, attack: 0,
    defense: 0, speed: 2.2, range: 1.1, order: 'work', cooldown: 0, lastCombat: -60, moving: false,
    facing: 0, attackTime: 0, collector: true, collectPhase: 'returning', inside: false, home: 1, collectorCamp: 2 };
}

describe('shared courier return routes', () => {
  it('shares a prior route suffix with another courier without another search', () => {
    const state = fixture(), first = courierReturnPath(state, start, door, 0);
    expect(first).toEqual(findPath(state, start, door, 0));
    const following = { ...first[3] }, expected = first.slice(4).map(point => ({ ...point }));
    first[4].x = 99; first.length = 0; // Unit-owned paths never own cached nodes.
    expect(courierReturnPath(state, following, door, 0)).toEqual(expected);
    expect(courierRouteCacheStats(state)).toMatchObject({ hits: 1, searches: 1, fallbacks: 0, doors: 1 });
  });

  it('keeps the requested door separate and preserves incoming-side and queue selection', () => {
    const state = fixture(), first = courier(10);
    entityStore(state).units.add(first);
    updateCollector(state, first, .1, () => {});
    expect(first.destination).toEqual({ x: 4.5, y: 9.5 }); // Incoming right-side door.
    const chosen = { ...first.destination! }, queued = Array.from({ length: 12 }, (_, i) => ({
      ...courier(100 + i), destination: { ...chosen },
    }));
    const second = courier(20);
    entityStore(state).units.replace([...queued, second]);
    updateCollector(state, second, .1, () => {});
    expect(second.destination).not.toEqual(chosen);
    expect(second.destination).not.toEqual({ x: 4.5, y: 8.5 }); // Outgoing-side penalty remains.
    expect(second.path!.at(-1)).toEqual(second.destination);
    const third = courier(30);
    entityStore(state).units.replace([third]);
    updateCollector(state, third, .1, () => {});
    expect(third.destination).toEqual(chosen);
    expect(courierRouteCacheStats(state)).toMatchObject({ hits: 1, searches: 2, doors: 2 });
  });

  it('checks dynamic blockers and never teaches their temporary detours to the shared cache', () => {
    const state = fixture(), original = courierReturnPath(state, start, door, 0);
    const occupied = new Set([cell(original[4])]);
    const detour = courierReturnPath(state, start, door, 0, { has: index => occupied.has(index) });
    expect(detour.at(-1)).toEqual(door);
    expect(detour.some(point => occupied.has(cell(point)))).toBe(false);
    expect(courierRouteCacheStats(state).fallbacks).toBe(1);
    expect(courierReturnPath(state, start, door, 0)).toEqual(original);
    expect(courierRouteCacheStats(state).hits).toBe(1);
  });

  it('centers a fractional start before its cached diagonal would cut through a wall', () => {
    const state = fixture(); entityStore(state).buildings.add(building(90, 'wall', 9, 8));
    const centered = { x: 10.5, y: 8.5 }, destination = { x: 8.5, y: 10.5 };
    const original = courierReturnPath(state, centered, destination, 0);
    expect(original[0]).toEqual({ x: 9.5, y: 9.5 });
    const fractional = { x: 10.05, y: 8.6 }, path = courierReturnPath(state, fractional, destination, 0);
    expect(path).toEqual([centered, ...original]);
    let previous = fractional;
    for (const point of path) { expect(canMove(state, previous, point, 0)).toBe(true); previous = point; }
    expect(courierRouteCacheStats(state).hits).toBe(1);
    expect(courierReturnPath(state, { x: 8.8, y: 10.7 }, destination, 0)).toEqual([destination]);
  });

  it('invalidates immediately when a wall gate closes, preserving partial-path fallback', () => {
    const state = fixture();
    for (let y = 0; y < 18; y++) entityStore(state).buildings.add(building(100 + y, 'wall', 15, y));
    const gate = building(200, 'road', 15, 8); entityStore(state).buildings.add(gate);
    expect(courierReturnPath(state, start, door, 0).at(-1)).toEqual(door);
    gate.hp = 0; // No revision hook: same-tick critical edits must stay live.
    const partial = courierReturnPath(state, start, door, 0);
    expect(partial).toEqual(findPath(state, start, door, 0, true));
    expect(partial.every(point => point.x > 15)).toBe(true);
    expect(courierRouteCacheStats(state)).toMatchObject({ hits: 0, searches: 3, fallbacks: 1 });
    gate.hp = 200;
    expect(courierReturnPath(state, start, door, 0).at(-1)).toEqual(door);
  });

  it('keeps routine road edits coalesced, then learns the faster route on edit twenty', () => {
    const state = fixture(), original = courierReturnPath(state, start, door, 0);
    for (let i = 0; i < FARM_TRAVEL_EDIT_BATCH; i++) {
      entityStore(state).buildings.add(building(100 + i, 'road', 5 + i, 9)); state.world.revision!++;
      const path = courierReturnPath(state, start, door, 0);
      if (i < FARM_TRAVEL_EDIT_BATCH - 1) expect(path).toEqual(original);
      else {
        expect(path).toEqual(findPath(state, start, door, 0));
        expect(path).not.toEqual(original);
        expect(path.some(point => point.y === 9.5)).toBe(true);
      }
    }
    expect(courierRouteCacheStats(state)).toMatchObject({ hits: 19, searches: 2 });
  });

  it('bounds cached doors and preserves complete, cycle-free routes after eviction', () => {
    const state = fixture();
    for (let i = 0; i < 80; i++) {
      const destination = { x: 5.5 + i % 20, y: .5 + Math.floor(i / 20) };
      const path = courierReturnPath(state, start, destination, 0);
      expect(path.at(-1)).toEqual(destination);
      expect(new Set(path.map(cell)).size).toBe(path.length);
    }
    expect(courierRouteCacheStats(state).doors).toBeLessThanOrEqual(64);
    expect(courierRouteCacheStats(state).nodes).toBeLessThanOrEqual(16_384);
    expect(courierReturnPath(state, start, door, 0).at(-1)).toEqual(door);
  });

  it('evicts long routes at the shared node budget before reaching the door limit', () => {
    const state = fixture();
    state.world.width = 1024; state.world.height = 2;
    state.world.tiles = Array.from({ length: 2048 }, () => ({ ...state.world.tiles[0] }));
    entityStore(state).buildings.replace([]);
    for (let i = 0; i < 30; i++) {
      const destination = { x: 800.5 + i, y: .5 };
      expect(courierReturnPath(state, { x: .5, y: .5 }, destination, 0).at(-1)).toEqual(destination);
    }
    expect(courierRouteCacheStats(state).doors).toBeLessThan(30);
    expect(courierRouteCacheStats(state).nodes).toBeLessThanOrEqual(16_384);
    const searches = courierRouteCacheStats(state).searches;
    expect(courierReturnPath(state, { x: .5, y: .5 }, { x: 800.5, y: .5 }, 0).at(-1)).toEqual({ x: 800.5, y: .5 });
    expect(courierRouteCacheStats(state).searches).toBe(searches);
    expect(courierRouteCacheStats(state).reverseHits).toBe(1);
  });
});
