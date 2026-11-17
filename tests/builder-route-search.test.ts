import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { installNavigationWasm, navigationWasmStatus, setNavigationWasmEnabled } from '../src/game/navigation-wasm';
import { canMove, canWalk, findPath, findShortestPathBetween, movementMultiplier, travelTimeMapFrom, withNavigationFrame } from '../src/game/pathfinding';
import { distance, type GameState, type Point } from '../src/game/types';

beforeAll(async () => installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/simulation.wasm'))));

function fixture(seed: number): GameState {
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const state = { world: { width: 30, height: 24, revision: 1, seed: 'builder-paths', source: 'test', spawns: [],
    tiles: Array.from({ length: 720 }, () => ({ terrain: random() < .12 ? 'lake' : 'grassland',
      overlay: random() < .2 ? 'forest' : random() < .15 ? 'swamp' : 'none', elevation: .3,
      moisture: .5, variation: .5, food: 1, production: 1, gold: 0 })) },
    buildings: [], units: [], factions: [{ id: 0, relation: 'self' }], time: 0,
  } as unknown as GameState;
  for (let y = 2; y < 22; y++) entityStore(state).buildings.add({ id: 100 + y, kind: 'wall', faction: 0, x: 14, y, hp: 100, maxHp: 100, capacity: 0 });
  for (let x = 2; x < 28; x++) entityStore(state).buildings.add({ id: 200 + x, kind: 'road', faction: 0, x, y: 11, hp: 100, maxHp: 100, capacity: 0 });
  return state;
}

function routeCost(state: GameState, from: Point, path: readonly Point[]): number {
  let cost = 0;
  for (const point of path) {
    cost += distance(from, point) * (1 / movementMultiplier(state, from.x, from.y) + 1 / movementMultiplier(state, point.x, point.y)) / 2;
    from = point;
  }
  return cost;
}

describe('shared builder entrance search', () => {
  it('matches the cheapest independent exit/side pair across weighted terrain, walls and forbidden regions', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const state = fixture(seed);
      setForbiddenRectangle(state, { x: 7, y: 8 }, { x: 10, y: 13 }, true);
      const origins = [{ x: 3.5, y: 9.5 }, { x: 3.5, y: 10.5 }, { x: 4.5, y: 8.5 }, { x: 5.5, y: 11.5 }];
      const goals = [{ x: 24.5, y: 8.5 }, { x: 24.5, y: 9.5 }, { x: 25.5, y: 10.5 }, { x: 26.5, y: 9.5 }];
      withNavigationFrame(state, () => {
        for (const forbidden of [false, true]) {
          let minimum = Infinity;
          setNavigationWasmEnabled(false);
          for (const from of origins) for (const goal of goals) {
            const path = findPath(state, from, goal, 0, false, undefined, undefined, undefined, false, forbidden);
            if (path.length) minimum = Math.min(minimum, routeCost(state, from, path));
          }
          const js = findShortestPathBetween(state, origins, goals, 0, forbidden);
          setNavigationWasmEnabled(true);
          const native = findShortestPathBetween(state, origins, goals, 0, forbidden);
          expect(native).toEqual(js);
          if (!Number.isFinite(minimum)) { expect(native).toBeUndefined(); continue; }
          expect(native!.cost).toBeCloseTo(minimum, 8);
          expect(routeCost(state, native!.from, native!.path)).toBeCloseTo(minimum, 8);
          expect(origins).toContainEqual(native!.from); expect(goals).toContainEqual(native!.to);
          for (let i = 0; i < native!.path.length; i++) expect(canMove(state, i ? native!.path[i - 1] : native!.from,
            native!.path[i], 0, undefined, forbidden)).toBe(true);
        }
      });
    }
  });

  it('uses one native search and owns its result across other native queries', () => {
    const state = fixture(4);
    for (const tile of state.world.tiles) { tile.terrain = 'grassland'; tile.overlay = 'none'; }
    const origins = [5, 6, 7, 8].map(y => ({ x: 3.5, y: y + .5 }));
    const goals = [8, 9, 10, 11].map(y => ({ x: 25.5, y: y + .5 }));
    setNavigationWasmEnabled(true);
    const before = navigationWasmStatus().searches;
    const result = findShortestPathBetween(state, origins, goals, 0)!;
    expect(navigationWasmStatus().searches - before).toBe(1);
    const snapshot = structuredClone(result);
    const nextNative = findPath(state, origins[0], goals[0], 0);
    setNavigationWasmEnabled(false);
    expect(nextNative).toEqual(findPath(state, origins[0], goals[0], 0));
    setNavigationWasmEnabled(true);
    travelTimeMapFrom(state, [origins[0]], 0, 1, Infinity);
    expect(result).toEqual(snapshot);
  });

  it.each([false, true])('handles overlap, invalid inputs, disconnected sets and live gate changes (native=%s)', native => {
    const state = fixture(4);
    entityStore(state).buildings.replace([]);
    for (const tile of state.world.tiles) { tile.terrain = 'grassland'; tile.overlay = 'none'; }
    setNavigationWasmEnabled(native);
    const origins = [{ x: 3.5, y: 8.5 }, { x: 3.5, y: 8.5 }, { x: Infinity, y: 1.5 }, { x: 1, y: 1 }];
    expect(findShortestPathBetween(state, origins, origins, 0)).toEqual({ from: origins[0], to: origins[0], cost: 0, path: [] });
    expect(findShortestPathBetween(state, [], origins, 0)).toBeUndefined();
    expect(findShortestPathBetween(state, origins, [{ x: -1, y: 2.5 }], 0)).toBeUndefined();
    for (let y = 0; y < 24; y++) entityStore(state).buildings.add({ id: 100 + y, kind: 'wall', faction: 0, x: 14, y, hp: 100, maxHp: 100, capacity: 0 });
    const goals = [{ x: 25.5, y: 8.5 }];
    expect(findShortestPathBetween(state, origins, goals, 0)).toBeUndefined();
    const otherSide = { x: 20.5, y: 8.5 };
    expect(findShortestPathBetween(state, [...origins, otherSide], goals, 0)?.from).toEqual(otherSide);
    entityStore(state).buildings.get(108)!.hp = 0;
    const path = findShortestPathBetween(state, origins, goals, 0)!;
    expect(path.path.length).toBeGreaterThan(0);
    expect(path.path.every(point => canWalk(state, point.x, point.y, 0))).toBe(true);
  });
});
