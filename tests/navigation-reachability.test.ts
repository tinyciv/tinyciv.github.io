import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { canMove, canWalk, createReachabilityQuery, findPath, travelTimeMap } from '../src/game/pathfinding';
import type { Point } from '../src/game/types';

function fixture() {
  const state = scenario('Open melee');
  entityStore(state).buildings.replace([]);
  return state;
}

describe('combat path-existence queries', () => {
  it('limits a nearby blocked partial-goal scan to cells that can beat the start', () => {
    const state = fixture(), width = 112, height = 88;
    state.world = { ...state.world, width, height, tiles: Array.from({ length: width * height }, () => ({ ...state.world.tiles[0] })) };
    const start = { x: 56.5, y: 44.5 }, goal = { x: 54.5, y: 44.5 }, occupied = new Set([44 * width + 54]);
    let probes = 0;
    const has = occupied.has.bind(occupied);
    occupied.has = index => { probes++; return has(index); };
    expect(findPath(state, start, goal, 0, true, occupied)).toEqual([{ x: 55.5, y: 44.5 }]);
    expect(probes).toBeLessThan(160); // The former whole-map scan visited 9,856 cells.
  });

  it('preserves partial destinations outside map bounds and at extreme coordinates', () => {
    const state = fixture(), start = { x: 2.5, y: 12.5 };
    expect(findPath(state, start, { x: -3.5, y: 12.5 }, 0, true)).toEqual([{ x: 1.5, y: 12.5 }, { x: .5, y: 12.5 }]);
    expect(findPath(state, start, { x: 1e308, y: 12.5 }, 0, true)).toEqual([]);
    expect(findPath(state, start, { x: -1e308, y: -1e308 }, 0, true)).toEqual([]);
  });

  it('rejects an enclosed attack pocket without searching the surrounding continent', () => {
    const state = fixture(), width = state.world.width, occupied = new Set<number>();
    for (let y = 10; y <= 14; y++) for (let x = 14; x <= 18; x++)
      if (y === 10 || y === 14 || x === 14 || x === 18) occupied.add(y * width + x);
    let probes = 0;
    const reachable = createReachabilityQuery(state, { x: 2.5, y: 12.5 }, 0,
      { has: index => { probes++; return occupied.has(index); } });
    expect(reachable({ x: 16.5, y: 12.5 })).toBe(false);
    expect(probes).toBeLessThan(80);
    const first = probes;
    expect(reachable({ x: 15.5, y: 11.5 })).toBe(false);
    expect(probes - first).toBe(1);
    expect(reachable({ x: 20.5, y: 12.5 })).toBe(true);
  });

  it('also stops quickly when the attacker is enclosed', () => {
    const state = fixture(), width = state.world.width, occupied = new Set<number>();
    for (let y = 11; y <= 13; y++) for (let x = 4; x <= 6; x++)
      if (y !== 12 || x !== 5) occupied.add(y * width + x);
    let probes = 0;
    const reachable = createReachabilityQuery(state, { x: 5.5, y: 12.5 }, 0,
      { has: index => { probes++; return occupied.has(index); } });
    expect(reachable({ x: 25.5, y: 12.5 })).toBe(false);
    expect(probes).toBeLessThan(30);
  });

  it('reuses a completed search for several unreachable contact cells', () => {
    const state = fixture(), width = state.world.width, start = { x: 5.5, y: 12.5 };
    const occupied = new Set(Array.from({ length: state.world.height }, (_, y) => y * width + 16));
    let probes = 0;
    const reachable = createReachabilityQuery(state, start, 0, { has: index => { probes++; return occupied.has(index); } });
    for (const goal of [{ x: 17.5, y: 12.5 }, { x: 18.5, y: 13.5 }]) {
      expect(reachable(goal)).toBe(false);
      expect(findPath(state, start, goal, 0, false, occupied)).toEqual([]);
    }
    const afterSearch = probes;
    expect(reachable({ x: 20.5, y: 8.5 })).toBe(false);
    expect(probes - afterSearch).toBe(1); // Only validate the new goal's occupancy.
    expect(reachable({ x: 15.5, y: 12.5 })).toBe(true);
  });

  it('preserves the dynamic start exception and touching diagonal corners', () => {
    const state = fixture(), width = state.world.width, start = { x: 5.7, y: 5.3 }, goal = { x: 6.5, y: 6.5 };
    const occupied = new Set([5 * width + 5, 5 * width + 6, 6 * width + 5]);
    const reachable = createReachabilityQuery(state, start, 0, occupied);
    expect(reachable(start)).toBe(true);
    expect(reachable(goal)).toBe(true);
    expect(findPath(state, start, goal, 0, false, occupied).length).toBeGreaterThan(0);
    state.world.tiles[5 * width + 5].terrain = 'lake'; state.world.revision!++;
    expect(createReachabilityQuery(state, start, 0, occupied)(start)).toBe(false);
  });

  it('matches weighted path existence across terrain, structures and occupancy', () => {
    const state = fixture(), width = state.world.width, start = { x: 4.5, y: 12.5 };
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * width + 16].terrain = 'river';
    state.world.tiles[12 * width + 16].overlay = 'ford';
    for (let y = 0; y < 8; y++) for (let x = 4; x < 26; x++) state.world.tiles[y * width + x].overlay = 'forest';
    state.world.revision!++;
    const occupied = new Set([12 * width + 15, 11 * width + 15, 13 * width + 15]);
    const reachable = createReachabilityQuery(state, start, 0, occupied);
    for (let y = 0; y < state.world.height; y += 3) for (let x = 0; x < width; x += 4) {
      const goal = { x: x + .5, y: y + .5 };
      expect(reachable(goal)).toBe(findPath(state, start, goal, 0, false, occupied).length > 0);
    }
    const staticReachable = createReachabilityQuery(state, start, 0);
    expect(staticReachable({ x: 25.5, y: 12.5 })).toBe(true);
    occupied.add(12 * width + 16);
    expect(createReachabilityQuery(state, start, 0, occupied)({ x: 25.5, y: 12.5 })).toBe(false);
  });

  it('restarts safely when another query or a weighted search uses shared scratch', () => {
    const state = fixture(), width = state.world.width;
    const barrier = new Set(Array.from({ length: state.world.height }, (_, y) => y * width + 16));
    const left = createReachabilityQuery(state, { x: 5.5, y: 12.5 }, 0, barrier);
    const right = createReachabilityQuery(state, { x: 25.5, y: 12.5 }, 0, barrier);
    expect(left({ x: 6.5, y: 12.5 })).toBe(true);
    expect(right({ x: 26.5, y: 12.5 })).toBe(true);
    findPath(state, { x: 1.5, y: 1.5 }, { x: 30.5, y: 20.5 }, 0);
    travelTimeMap(state, { x: 4.5, y: 4.5 }, 0, 2, 6);
    expect(left({ x: 25.5, y: 12.5 })).toBe(false);
    expect(right({ x: 5.5, y: 12.5 })).toBe(false);
    expect(left({ x: 14.5, y: 20.5 })).toBe(true);
  });

  it('rejects invalid coordinates and accepts read-only obstacle probes', () => {
    const state = fixture(), start = { x: 5.5, y: 5.5 }, goal = { x: 6.5, y: 5.5 };
    const blocked = { has: (index: number) => index === 5 * state.world.width + 6 };
    expect(canWalk(state, goal.x, goal.y, 0, blocked)).toBe(false);
    expect(canMove(state, start, goal, 0, blocked)).toBe(false);
    const reachable = createReachabilityQuery(state, start, 0, blocked);
    const invalid: Point[] = [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: -.01, y: 0 }, { x: state.world.width, y: 0 }];
    for (const point of invalid) {
      expect(reachable(point)).toBe(false);
      expect(createReachabilityQuery(state, point, 0, blocked)(start)).toBe(false);
    }
  });
});
