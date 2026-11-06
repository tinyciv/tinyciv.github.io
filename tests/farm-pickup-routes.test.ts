import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { courierRouteCacheStats } from '../src/game/courier-routes';
import { farmPickupPath, farmPickupRouteStats } from '../src/game/farm-pickup-routes';
import { updateCollector } from '../src/game/farms';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { installNavigationWasm, navigationWasmStatus } from '../src/game/navigation-wasm';
import { canMove, findPath, movementMultiplier, withNavigationFrame } from '../src/game/pathfinding';
import { beginUnitFrame, endUnitFrame } from '../src/game/spatial';
import type { Building, GameState, Point, Unit } from '../src/game/types';

beforeAll(async () => { await installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/navigation.wasm'))); });
const farm = { x: 8, y: 8 };
const plots = Array.from({ length: 4 }, (_, i) => ({ x: farm.x + i % 2 + .5, y: farm.y + Math.floor(i / 2) + .5 }));
function building(id: number, kind: Building['kind'], x: number, y: number): Building {
  return { id, kind, x, y, faction: 0, hp: 200, maxHp: 200, capacity: 0 };
}
function fixture(): GameState {
  return {
    world: { width: 24, height: 18, revision: 0, seed: 'pickup-routes', source: 'test', spawns: [],
      tiles: Array.from({ length: 24 * 18 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 2, 8), building(2, 'camp', farm.x, farm.y)], units: [], fields: [],
    factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self', food: 20,
      gold: 20, production: 0, population: 4, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false }], time: 10, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    gameOver: false, victory: false, seed: 'pickup-routes', rngState: 1,
  };
}
function pathCost(state: GameState, start: Point, path: Point[]): number {
  if (!path.length) return Infinity;
  let cost = 0, previous = start;
  for (const point of path) {
    cost += Math.hypot(point.x - previous.x, point.y - previous.y)
      * (1 / movementMultiplier(state, previous.x, previous.y) + 1 / movementMultiplier(state, point.x, point.y)) * .5;
    previous = point;
  }
  return cost;
}
function expectLegal(state: GameState, start: Point, path: Point[]): void {
  let previous = start;
  for (const point of path) {
    expect(canMove(state, previous, point, 0, undefined, true)).toBe(true);
    previous = point;
  }
}
const fullPath = (state: GameState, from: Point, goal: Point): Point[] =>
  findPath(state, from, goal, 0, false, undefined, undefined, undefined, false, true);

describe('local weighted farm pickup routes', () => {
  it('uses no full search for any pair of normal or irrigated plots', () => {
    for (const irrigated of [false, true]) {
      const state = fixture();
      if (irrigated) for (let i = 0; i < 4; i++) entityStore(state).buildings.add(building(20 + i, 'irrigation', Math.floor(plots[i].x), Math.floor(plots[i].y)));
      withNavigationFrame(state, () => {
        for (const from of plots) for (const goal of plots) {
          const before = navigationWasmStatus().searches, path = farmPickupPath(state, from, goal, 0, farm);
          expect(navigationWasmStatus().searches).toBe(before);
          expect(path.at(-1)).toEqual(goal); expectLegal(state, from, path);
          expect(pathCost(state, from, path)).toBeCloseTo(pathCost(state, from, fullPath(state, from, goal)), 10);
        }
      });
      expect(farmPickupRouteStats(state)).toEqual({ local: 16, fallbacks: 0 });
    }
  });

  it('chooses a faster two-step road route over a direct irrigated diagonal', () => {
    const state = fixture();
    for (const i of [0, 3]) entityStore(state).buildings.add(building(20 + i, 'irrigation', Math.floor(plots[i].x), Math.floor(plots[i].y)));
    entityStore(state).buildings.add(building(30, 'road', 9, 8));
    const path = farmPickupPath(state, plots[0], plots[3], 0, farm);
    expect(path).toEqual([plots[1], plots[3]]);
    expect(pathCost(state, plots[0], path)).toBeCloseTo(pathCost(state, plots[0], fullPath(state, plots[0], plots[3])), 10);
    expect(farmPickupRouteStats(state)).toEqual({ local: 1, fallbacks: 0 });
  });

  it('respects cliff flanks and centers a fractional start before an obstacle corner', () => {
    const state = fixture();
    state.world.tiles[9 * 24 + 8].ridge = 1;
    const aroundCliff = farmPickupPath(state, plots[0], plots[3], 0, farm);
    expect(aroundCliff).toEqual([plots[1], plots[3]]); expectLegal(state, plots[0], aroundCliff);
    delete state.world.tiles[9 * 24 + 8].ridge; state.world.revision!++;
    entityStore(state).buildings.add(building(30, 'wall', 8, 9));
    const from = { x: 8.05, y: 8.6 }, aroundCorner = farmPickupPath(state, from, plots[3], 0, farm);
    expect(aroundCorner).toEqual([plots[0], plots[3]]); expectLegal(state, from, aroundCorner);
    expect(farmPickupRouteStats(state)).toEqual({ local: 2, fallbacks: 0 });
  });

  it('keeps forbidden edits live and falls back when outside routes might be cheaper', () => {
    const state = fixture();
    for (let i = 0; i < 4; i++) {
      state.world.tiles[Math.floor(plots[i].y) * 24 + Math.floor(plots[i].x)].overlay = 'forest';
      entityStore(state).buildings.add(building(20 + i, 'irrigation', Math.floor(plots[i].x), Math.floor(plots[i].y)));
    }
    const path = farmPickupPath(state, plots[0], plots[3], 0, farm);
    expect(path).toEqual(fullPath(state, plots[0], plots[3]));
    expect(farmPickupRouteStats(state)).toEqual({ local: 0, fallbacks: 1 });
    setForbiddenRectangle(state, plots[3], plots[3], true);
    expect(farmPickupPath(state, plots[0], plots[3], 0, farm)).toEqual([]);
    setForbiddenRectangle(state, plots[3], plots[3], false);
    expect(farmPickupPath(state, plots[0], plots[3], 0, farm).at(-1)).toEqual(plots[3]);
  });

  it('matches full weighted search across mixed terrain, roads, water and forbidden plots', () => {
    let seed = 1719;
    const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let sample = 0; sample < 24; sample++) {
      const state = fixture();
      let id = 100;
      for (let y = 6; y < 12; y++) for (let x = 6; x < 12; x++) {
        const tile = state.world.tiles[y * 24 + x];
        tile.terrain = random() < .08 ? 'lake' : 'grassland';
        tile.overlay = random() < .4 ? 'forest' : random() < .3 ? 'swamp' : 'none';
        if (random() < .3) entityStore(state).buildings.add(building(id++, random() < .5 ? 'road' : 'irrigation', x, y));
      }
      if (sample % 3 === 0) setForbiddenRectangle(state, plots[sample % 4], plots[sample % 4], true);
      withNavigationFrame(state, () => {
        for (const from of plots) for (const goal of plots) if (from !== goal) {
          const path = farmPickupPath(state, from, goal, 0, farm), expected = fullPath(state, from, goal);
          if (!expected.length) expect(path).toEqual([]);
          else {
            expect(path.at(-1)).toEqual(goal); expectLegal(state, from, path);
            expect(pathCost(state, from, path)).toBeCloseTo(pathCost(state, from, expected), 9);
          }
        }
      });
    }
  });

  it('dispatches through occupied cells with native search, shares return navigation, and sweeps with no search', () => {
    const state = fixture();
    const worker: Unit = { id: 10, kind: 'worker', faction: 0, x: 3, y: 9, hp: 50, maxHp: 50, morale: 100,
      attack: 0, defense: 0, speed: 2.2, range: 1.1, order: 'work', cooldown: 0, lastCombat: -60,
      moving: false, facing: 0, attackTime: 0, collector: true, collectPhase: 'idle', inside: true, home: 1, collectorCamp: 2 };
    entityStore(state).units.replace([worker, ...[...plots, { x: 4.5, y: 8.5 }, { x: 4.5, y: 9.5 }].map((point, i) => ({
      ...worker, ...point, id: 20 + i, kind: 'warrior' as const, collector: false, inside: false,
    }))]);
    state.fields = plots.map((point, i) => ({ id: 50 + i, camp: 2, faction: 0, x: Math.floor(point.x), y: Math.floor(point.y),
      planted: true, nextHarvest: 70, food: 1, foodBatches: [{ amount: 1, expiresAt: 100 + i }], expiresAt: 100 + i }));
    beginUnitFrame(state);
    try {
      const before = navigationWasmStatus();
      updateCollector(state, worker, .1, () => {});
      expect(worker.collectPhase).toBe('outbound');
      expect(navigationWasmStatus().searches).toBe(before.searches + 1);
      const picked = state.fields.find(field => field.id === worker.field)!;
      expect(worker.path?.at(-1)).toEqual({ x: picked.x + .5, y: picked.y + .5 });
      expectLegal(state, worker, worker.path!);
      Object.assign(worker, { x: picked.x + .5, y: picked.y + .5 });
      updateCollector(state, worker, .1, () => {});
      expect(worker.cargoBatches).toEqual([{ amount: 1, expiresAt: picked.id - 50 + 100 }]);
      expect(worker.collectPhase).toBe('outbound'); expect(worker.field).not.toBe(picked.id);
      expect(navigationWasmStatus().searches).toBe(before.searches + 1);
      // Three local checks reserve the sweep before departure; the actual
      // first pickup revalidates its next leg without another global search.
      expect(farmPickupRouteStats(state)).toEqual({ local: 4, fallbacks: 0 });
      Object.assign(worker, { collectPhase: 'returning', destination: undefined, field: undefined });
      updateCollector(state, worker, .1, () => {});
      expect(worker.destination).toBeDefined();
      expect(worker.path?.at(-1)).toEqual(worker.destination);
      expectLegal(state, worker, worker.path!);
      // The planned sweep checks the two nearest doors once, then reuses their
      // shared reverse fields when the first pickup and return are executed.
      expect(courierRouteCacheStats(state)).toMatchObject({ reverseSearches: 3, reverseFields: 2, fallbacks: 0 });
      expect(courierRouteCacheStats(state).reverseExpanded).toBeGreaterThan(0);
      expect(navigationWasmStatus().searches).toBe(before.searches + 1);
      expect(navigationWasmStatus().unsupported).toBe(before.unsupported);
    } finally { endUnitFrame(state); }
  });
});
