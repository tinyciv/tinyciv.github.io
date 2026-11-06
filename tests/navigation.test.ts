import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { type Building, type GameState, type Point, type World } from '../src/game/types';
import { beginNavigationFrame, endNavigationFrame, invalidateNavigation, canMove, canTraverseEdge, canWalk, findPath, movementMultiplier, staticReachabilityMask, travelTimeMap, UNIT_RADIUS } from '../src/game/pathfinding';
import { constructionEdges } from '../src/game/builders';
import { palaceReachability } from '../src/game/placement';
import { addRiverFords } from '../src/world/generator';
import { ridgeEdgeAllowed } from '../src/game/ridges';

function fixture(width = 12, height = 10): GameState {
  const world: World = {
    width, height, seed: 'navigation', source: 'fixture', spawns: [],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: 0.4, moisture: 0.7, food: 3, production: 1, gold: 0, variation: 0.5 })),
  };
  return { world, units: [], buildings: [], factions: [], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: world.seed, rngState: 1 };
}
const tile = (state: GameState, x: number, y: number) => state.world.tiles[y * state.world.width + x];
const structure = (kind: Building['kind'], x: number, y: number, id = 1): Building => ({ id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
function validRoute(state: GameState, start: Point, path: Point[]): boolean {
  let previous = start;
  for (const step of path) {
    if (!canMove(state, previous, step, 0)) return false;
    previous = step;
  }
  return true;
}

describe('shared unit navigation', () => {
  it('keeps a whole-cell logical footprint while allowing touching obstacle corners', () => {
    const state = fixture(), start = { x: 4.5, y: 4.5 }, goal = { x: 5.5, y: 5.5 };
    entityStore(state).buildings.add(structure('wall', 5, 4), structure('wall', 4, 5, 2));
    expect(UNIT_RADIUS).toBe(0.5);
    expect(canMove(state, start, goal, 0)).toBe(true);
    expect(findPath(state, start, goal, 0)).toEqual([goal]);
    expect(canMove(state, start, { x: 6.5, y: 4.5 }, 0)).toBe(false);
    expect(canMove(state, { x: 5.2, y: 4.2 }, { x: 5.2, y: 4.2 }, 0)).toBe(false);
  });

  it('centers off-grid starts before a tight diagonal crossing', () => {
    const state = fixture(), start = { x: 4.7, y: 4.3 }, goal = { x: 5.5, y: 5.5 };
    entityStore(state).buildings.add(structure('wall', 5, 4), structure('wall', 4, 5, 2));
    const path = findPath(state, start, goal, 0);
    expect(path[0]).toEqual({ x: 4.5, y: 4.5 });
    expect(validRoute(state, start, path)).toBe(true);
    entityStore(state).buildings.replace([]);
    const occupied = new Set([4 * state.world.width + 5, 5 * state.world.width + 4]);
    expect(findPath(state, start, goal, 0, false, occupied)[0]).toEqual({ x: 4.5, y: 4.5 });
  });

  it('allows direct travel across forest and jungle overlay edges in every direction', () => {
    const state = fixture(), center = { x: 5.5, y: 5.5 };
    for (const overlay of ['forest', 'jungle'] as const) {
      tile(state, 5, 5).overlay = overlay;
      expect(canWalk(state, center.x, center.y, 0)).toBe(true);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const neighbor = { x: center.x + dx, y: center.y + dy };
        expect(canTraverseEdge(state.world, center, neighbor)).toBe(true);
        expect(canMove(state, center, neighbor, 0)).toBe(true);
        expect(canMove(state, neighbor, center, 0)).toBe(true);
      }
      const path = findPath(state, { x: 4.5, y: 5.5 }, center, 0);
      expect(path).toEqual([center]);
    }
  });

  it('walks ford river tiles at 45% speed and uses only completed bridges', () => {
    const state = fixture();
    for (let y = 0; y < state.world.height; y++) tile(state, 6, y).terrain = 'river';
    tile(state, 6, 5).overlay = 'ford';
    expect(canWalk(state, 6.5, 5.5, 0)).toBe(true);
    expect(movementMultiplier(state, 6.5, 5.5)).toBe(0.45);
    expect(canWalk(state, 6.5, 2.5, 0)).toBe(false);
    const bridge = structure('bridge', 6, 2);
    bridge.construction = { startedAt: 0, duration: 5 }; entityStore(state).buildings.add(bridge);
    expect(canWalk(state, 6.5, 2.5, 0)).toBe(false);
    delete bridge.construction;
    expect(canWalk(state, 6.5, 2.5, 0)).toBe(true);
    expect(movementMultiplier(state, 6.5, 2.5)).toBe(1);
    const start = { x: 5.5, y: 5.5 }, goal = { x: 7.5, y: 5.5 };
    // The quicker ford now beats a long bridge detour, but a nearby bridge wins.
    expect(findPath(state, start, goal, 0)).toEqual([{ x: 6.5, y: 5.5 }, goal]);
    bridge.y = 4;
    const path = findPath(state, start, goal, 0);
    expect(path.some(point => point.x === 6.5 && point.y === 4.5)).toBe(true);
    expect(validRoute(state, { x: 5.5, y: 5.5 }, path)).toBe(true);
  });

  it('uses travel-time costs consistently in the distance field', () => {
    const state = fixture(3, 1);
    tile(state, 1, 0).terrain = 'river'; tile(state, 1, 0).overlay = 'ford';
    const times = travelTimeMap(state, { x: 0.5, y: 0.5 }, 0, 2, 100);
    // Half an open tile + one full ford + half an open tile, at 2 tiles/sec.
    expect(times[2]).toBeCloseTo((1 + 1 / .45) / 2);
  });

  it('keeps a road gate on a ford at ford speed until an actual bridge is completed', () => {
    const state = fixture(3, 1);
    tile(state, 1, 0).terrain = 'river'; tile(state, 1, 0).overlay = 'ford';
    entityStore(state).buildings.add(structure('wall', 1, 0), structure('road', 1, 0, 2));
    expect(canWalk(state, 1.5, .5, 0)).toBe(true);
    expect(movementMultiplier(state, 1.5, .5)).toBe(.45);
    expect(travelTimeMap(state, { x: .5, y: .5 }, 0, 2, 100)[2]).toBeCloseTo((1 + 1 / .45) / 2);
    const bridge = structure('bridge', 1, 0, 3); entityStore(state).buildings.add(bridge);
    bridge.construction = { startedAt: 0, duration: 12, waitingForBuilder: true };
    expect(movementMultiplier(state, 1.5, .5)).toBe(.45);
    delete bridge.construction;
    expect(movementMultiplier(state, 1.5, .5)).toBe(1);
    expect(travelTimeMap(state, { x: .5, y: .5 }, 0, 2, 100)[2]).toBeCloseTo(1);
  });

  it.each([['none', 1], ['forest', .5], ['jungle', .5], ['swamp', .7]] as const)('charges %s travel time consistently at %sx speed', (overlay, speed) => {
    const state = fixture(8, 1), start = { x: .5, y: .5 }, goal = { x: 7.5, y: .5 };
    for (const tile of state.world.tiles) tile.overlay = overlay;
    expect(movementMultiplier(state, 4.5, .5)).toBe(speed);
    expect(travelTimeMap(state, start, 0, 2, Infinity)[7]).toBeCloseTo(3.5 / speed);
    expect(findPath(state, start, goal, 0)).toHaveLength(7);
    entityStore(state).buildings.add(structure('road', 4, 0));
    expect(movementMultiplier(state, 4.5, .5)).toBe(1.5);
  });

  it('takes a faster open route around forest overlays when available', () => {
    const state = fixture(), start = { x: 2.5, y: 4.5 }, goal = { x: 9.5, y: 4.5 };
    for (let x = 3; x < 9; x++) tile(state, x, 4).overlay = 'forest';
    expect(canMove(state, start, goal, 0)).toBe(true);
    const path = findPath(state, start, goal, 0);
    expect(path.at(-1)).toEqual(goal);
    expect(path.every(point => tile(state, Math.floor(point.x), Math.floor(point.y)).overlay !== 'forest')).toBe(true);
    expect(validRoute(state, start, path)).toBe(true);
  });

  it('finishes a long detour without the old 7000-node search cutoff', () => {
    const state = fixture(150, 130), start = { x: 74.5, y: 1.5 }, goal = { x: 76.5, y: 1.5 };
    for (let y = 0; y < 129; y++) tile(state, 75, y).terrain = 'ocean';
    const path = findPath(state, start, goal, 0);
    expect(path.at(-1)).toEqual(goal);
    expect(path.length).toBeGreaterThan(250);
    expect(validRoute(state, start, path)).toBe(true);
  });

  it('returns the nearest reachable goal only when partial routes are requested', () => {
    const state = fixture(), start = { x: 2.5, y: 4.5 }, goal = { x: 8.5, y: 4.5 };
    entityStore(state).buildings.add(structure('wall', 8, 4));
    expect(findPath(state, start, goal, 0)).toEqual([]);
    const path = findPath(state, start, goal, 0, true);
    expect(path.at(-1)).toEqual({ x: 7.5, y: 4.5 });
    expect(validRoute(state, start, path)).toBe(true);
  });

  it.each(['wall', 'palisade'] as const)('opens owned %s gates with ordered or completed roads while excluding other factions', kind => {
    const state = fixture(5, 1), start = { x: 1.5, y: .5 }, goal = { x: 3.5, y: .5 };
    const wall = structure(kind, 2, 0), road = structure('road', 2, 0, 2);
    entityStore(state).buildings.add(wall);
    for (const faction of [-2, 0, 1, 4]) expect(findPath(state, start, goal, faction)).toEqual([]);
    road.construction = { startedAt: 0, duration: 5, waitingForBuilder: true }; entityStore(state).buildings.add(road);
    expect(findPath(state, start, goal, 0).at(-1)).toEqual(goal);
    expect(movementMultiplier(state, 2.5, .5)).toBe(1);
    for (const faction of [-2, 1, 4]) expect(findPath(state, start, goal, faction)).toEqual([]);
    delete road.construction;
    expect(movementMultiplier(state, 2.5, .5)).toBe(1.5);
    for (const faction of [-2, 1, 4]) expect(canWalk(state, 2.5, .5, faction)).toBe(false);
    wall.construction = { startedAt: 0, duration: 5, waitingForBuilder: true };
    for (const faction of [-2, 0, 1, 4]) expect(findPath(state, start, goal, faction).at(-1)).toEqual(goal);
    wall.construction.waitingForBuilder = false;
    expect(findPath(state, start, goal, 0).at(-1)).toEqual(goal);
    expect(findPath(state, start, goal, -2)).toEqual([]);
    wall.hp = 0;
    expect(findPath(state, start, goal, -2).at(-1)).toEqual(goal);
  });

  it.each(['wall', 'palisade'] as const)('updates cached %s routes when gate ownership or confederation changes', kind => {
    const state = fixture(5, 1), start = { x: 1.5, y: .5 }, goal = { x: 3.5, y: .5 };
    const wall = structure(kind, 2, 0), road = structure('road', 2, 0, 2);
    entityStore(state).buildings.add(wall, road);
    state.factions.push({ id: 1, relation: 'peace' } as GameState['factions'][number]);
    expect(findPath(state, start, goal, 1)).toEqual([]);
    state.factions[0].relation = 'confederated';
    expect(findPath(state, start, goal, 1).at(-1)).toEqual(goal);
    wall.faction = -2;
    expect(findPath(state, start, goal, 1)).toEqual([]);
    expect(findPath(state, start, goal, 0)).toEqual([]);
    expect(findPath(state, start, goal, -2).at(-1)).toEqual(goal);
  });

  it('opens neutral gates to everyone, retaining solid wall obstacles and closing claimed gates to rivals', () => {
    const state = fixture(5, 1), start = { x: 1.5, y: .5 }, goal = { x: 3.5, y: .5 };
    const wall = structure('wall', 2, 0), road = structure('road', 2, 0, 2);
    wall.faction = -1; road.faction = -1; entityStore(state).buildings.add(wall);
    for (const faction of [-2, 0, 1]) expect(findPath(state, start, goal, faction)).toEqual([]);
    entityStore(state).buildings.add(road);
    for (const faction of [-2, 0, 1]) expect(findPath(state, start, goal, faction).at(-1)).toEqual(goal);
    wall.faction = 1; road.faction = 1;
    expect(findPath(state, start, goal, 1).at(-1)).toEqual(goal);
    for (const faction of [-2, 0]) expect(findPath(state, start, goal, faction)).toEqual([]);
  });

  it('treats queued and paused sites as open ground until active work resumes', () => {
    const state = fixture(5, 1), start = { x: 1.5, y: .5 }, goal = { x: 3.5, y: .5 };
    const house = structure('house', 2, 0); house.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    entityStore(state).buildings.add(house); beginNavigationFrame(state);
    expect(findPath(state, start, goal, 0).at(-1)).toEqual(goal);
    house.construction.waitingForBuilder = false; invalidateNavigation(state);
    expect(findPath(state, start, goal, 0)).toEqual([]);
    house.construction.pausedAt = 1; house.construction.waitingForBuilder = true; invalidateNavigation(state);
    expect(findPath(state, start, goal, 0).at(-1)).toEqual(goal);
    endNavigationFrame(state);
  });

  it('immediately refreshes a shared combat frame after a gate or building is destroyed', () => {
    const state = fixture(5, 1), start = { x: 1.5, y: .5 }, goal = { x: 3.5, y: .5 };
    const wall = structure('wall', 2, 0); entityStore(state).buildings.add(wall);
    beginNavigationFrame(state);
    expect(findPath(state, start, goal, 0)).toEqual([]);
    wall.hp = 0; invalidateNavigation(state);
    expect(findPath(state, start, goal, 0).at(-1)).toEqual(goal);
    endNavigationFrame(state);
    wall.hp = 100;
    expect(findPath(state, start, goal, 0)).toEqual([]);
  });

  it('keeps an occupied construction site passable until evacuation completes in the same frame', () => {
    const state = fixture(5, 1), start = { x: 1.5, y: .5 }, goal = { x: 3.5, y: .5 };
    const site = structure('house', 2, 0);
    site.construction = { startedAt: 0, duration: 10, evacuating: true };
    entityStore(state).buildings.add(site); beginNavigationFrame(state);
    expect(findPath(state, start, goal, 0).at(-1)).toEqual(goal);
    site.construction.evacuating = false; invalidateNavigation(state);
    expect(findPath(state, start, goal, 0)).toEqual([]);
    endNavigationFrame(state);
  });

  it('routes around occupied unit cells without retaining stale reservations', () => {
    const state = fixture(), start = { x: 2.5, y: 4.5 }, goal = { x: 8.5, y: 4.5 };
    const cell = (point: Point) => Math.floor(point.y) * state.world.width + Math.floor(point.x);
    const occupied = new Set([cell(start), cell({ x: 5.5, y: 4.5 })]);
    const path = findPath(state, start, goal, 0, false, occupied);
    expect(path.at(-1)).toEqual(goal);
    expect(path.every(point => !occupied.has(cell(point)))).toBe(true);
    expect(validRoute(state, start, path)).toBe(true);
    expect(canWalk(state, 5, 4, 0)).toBe(true);
    occupied.add(cell(goal));
    expect(findPath(state, start, goal, 0, false, occupied)).toEqual([]);
    const partial = findPath(state, start, goal, 0, true, occupied);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.every(point => !occupied.has(cell(point)))).toBe(true);
    expect(Math.hypot(partial.at(-1)!.x - goal.x, partial.at(-1)!.y - goal.y)).toBe(1);
    occupied.clear();
    const restored = findPath(state, start, goal, 0, false, occupied);
    expect(restored.every(point => point.y === start.y)).toBe(true);
    expect(findPath(state, start, goal, 0)).toEqual(restored);
  });

  it('blocks every tile of a 2 by 2 palace construction site', () => {
    const state = fixture(), palace = structure('palace', 4, 4);
    palace.construction = { startedAt: 0, duration: 10 }; entityStore(state).buildings.add(palace);
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]]) expect(canWalk(state, x, y, 0)).toBe(false);
  });

  it('keeps wooded regions reachable while rivers require crossings', () => {
    const state = fixture(42, 28);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 42; x++) {
      if (x === 33) tile(state, x, y).terrain = 'river';
      else if (x >= 5 && x <= 27 && y >= 4 && y <= 23) tile(state, x, y).overlay = x >= 10 && x <= 22 && y >= 9 && y <= 18 ? 'jungle' : 'forest';
      else if (x >= 37 && x <= 38 && y >= 8 && y <= 9) tile(state, x, y).overlay = 'forest';
      else if (x >= 37 && x <= 38 && y >= 16 && y <= 17) tile(state, x, y).overlay = 'jungle';
    }
    const origin = { x: .5, y: .5 };
    expect(findPath(state, origin, { x: 37.5, y: 8.5 }, 0)).toEqual([]);
    expect(addRiverFords(state.world)).toBe(true);
    const times = travelTimeMap(state, origin, 0, 1, Infinity);
    for (const index of [13 * 42 + 16, 5 * 42 + 40, 8 * 42 + 37, 16 * 42 + 37]) expect(Number.isFinite(times[index])).toBe(true);
    const path = findPath(state, origin, { x: 16.5, y: 13.5 }, 0);
    expect(path.at(-1)).toEqual({ x: 16.5, y: 13.5 });
    expect(validRoute(state, origin, path)).toBe(true);
    const snapshot = structuredClone(state.world);
    expect(addRiverFords(state.world)).toBe(false);
    expect(state.world).toEqual(snapshot);
  });

});

describe('cached navigation invalidation and soft traffic costs', () => {
  it('matches fresh weighted routes after cost-only edits, gate changes and bridge completion', () => {
    const state = fixture(), start = { x: 1.5, y: 5.5 }, goal = { x: 10.5, y: 5.5 };
    state.world.revision = 1;
    for (let y = 0; y < state.world.height; y++) tile(state, 6, y).terrain = 'river';
    tile(state, 6, 5).overlay = 'ford';
    for (let x = 3; x <= 5; x++) tile(state, x, 5).overlay = 'forest';
    const compare = () => {
      for (const faction of [0, 1]) {
        const fresh = structuredClone(state);
        expect(findPath(state, start, goal, faction)).toEqual(findPath(fresh, start, goal, faction));
        expect(travelTimeMap(state, start, faction, 2.2, Infinity)).toEqual(travelTimeMap(fresh, start, faction, 2.2, Infinity));
        expect(staticReachabilityMask(state, [start], faction)).toEqual(staticReachabilityMask(fresh, [start], faction));
      }
    };
    compare();
    const before = travelTimeMap(state, start, 0, 1, Infinity)[5 * state.world.width + 10];
    for (let x = 1; x <= 10; x++) entityStore(state).buildings.add(structure('road', x, 5, 100 + x));
    state.world.revision++; compare();
    expect(travelTimeMap(state, start, 0, 1, Infinity)[5 * state.world.width + 10]).toBeLessThan(before);
    for (let x = 1; x < 6; x++) tile(state, x, 4).overlay = 'swamp';
    state.world.revision++; compare();
    const wall = structure('wall', 6, 5, 200); entityStore(state).buildings.add(wall); compare();
    expect(findPath(state, start, goal, 1)).toEqual([]);
    const bridge = structure('bridge', 6, 4, 201); entityStore(state).buildings.add(bridge); compare();
    expect(findPath(state, start, goal, 1).length).toBeGreaterThan(0);
    bridge.construction = { startedAt: 0, duration: 12 }; compare();
    expect(findPath(state, start, goal, 1)).toEqual([]);
    wall.hp = 0; compare();
  });

  it('copies exact multi-origin connectivity while excluding blocked and invalid starts', () => {
    const state = fixture(), width = state.world.width;
    for (let y = 0; y < state.world.height; y++) tile(state, 6, y).terrain = 'river';
    const starts = [{ x: 1.5, y: 2.5 }, { x: 10.5, y: 2.5 }];
    const expected = new Uint8Array(width * state.world.height);
    for (const start of starts) {
      const times = travelTimeMap(state, start, 0, 1, Infinity);
      for (let i = 0; i < times.length; i++) if (Number.isFinite(times[i])) expected[i] = 1;
    }
    const mask = staticReachabilityMask(state, [...starts, { x: NaN, y: 0 }, { x: 6.5, y: 2.5 }], 0);
    expect(mask).toEqual(expected);
    expect(staticReachabilityMask(state, [{ x: -.5, y: 0 }, { x: 6.5, y: 2.5 }], 0).some(Boolean)).toBe(false);
    mask.fill(0);
    expect(staticReachabilityMask(state, starts, 0)).toEqual(expected);
  });

  it('keeps palace placement reachability identical to the union of weighted exit floods', () => {
    const state = fixture(), palace = structure('palace', 3, 4);
    entityStore(state).buildings.add(palace);
    for (let y = 0; y < state.world.height; y++) tile(state, 6, y).terrain = 'river';
    const expected = new Uint8Array(state.world.tiles.length);
    for (const exit of constructionEdges(state, palace)) {
      const times = travelTimeMap(state, exit, 0, 1, Infinity);
      for (let i = 0; i < times.length; i++) if (Number.isFinite(times[i])) expected[i] = 1;
    }
    expect(palaceReachability(state, palace)).toEqual(expected);
  });

  it('keeps the flat-edge shortcut identical to ridge rules at corners, stairs, and invalid edges', () => {
    const state = fixture(18, 16), world = state.world;
    for (let y = 5; y <= 12; y++) for (let x = 5; x <= 12; x++) tile(state, x, y).ridge = 1;
    tile(state, 8, 5).stair = 'south';
    tile(state, 2, 2).stair = 'east'; // Invalid stairs cannot open ordinary ground.
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const from = { x: x + .5, y: y + .5 }, to = { x: x + dx + .5, y: y + dy + .5 };
        expect(canTraverseEdge(world, from, to)).toBe(ridgeEdgeAllowed(world, from, to));
      }
    }
    expect(canTraverseEdge(world, { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 })).toBe(false);
  });

  it('refreshes all factions after a shared ford or bridge changes without sharing gate permissions', () => {
    const state = fixture(5, 3), start = { x: 1.5, y: 1.5 }, goal = { x: 3.5, y: 1.5 };
    state.world.revision = 1;
    for (let y = 0; y < 3; y++) tile(state, 2, y).terrain = 'river';
    tile(state, 2, 1).overlay = 'ford';
    for (const faction of [-3, -2, 0, 1]) expect(findPath(state, start, goal, faction).at(-1)).toEqual(goal);
    const bridge = structure('bridge', 2, 0); entityStore(state).buildings.add(bridge); state.world.revision++;
    tile(state, 2, 1).overlay = 'none'; state.world.revision++;
    for (const faction of [-3, -2, 0, 1]) expect(findPath(state, start, goal, faction).some(point => point.x === 2.5 && point.y === .5)).toBe(true);
    bridge.construction = { startedAt: 0, duration: 12 };
    for (const faction of [-3, -2, 0, 1]) expect(findPath(state, start, goal, faction)).toEqual([]);
    tile(state, 2, 2).overlay = 'ford'; state.world.revision++;
    const wall = { ...structure('wall', 2, 2, 2), faction: 1 };
    entityStore(state).buildings.add(wall, { ...structure('road', 2, 2, 3), faction: 1 });
    expect(findPath(state, start, goal, 1).at(-1)).toEqual(goal);
    for (const faction of [-3, -2, 0]) expect(findPath(state, start, goal, faction)).toEqual([]);
    wall.hp = 0;
    for (const faction of [-3, -2, 0, 1]) expect(findPath(state, start, goal, faction).at(-1)).toEqual(goal);
  });

  it('rebuilds revisioned terrain costs and crossings after edits and map replacement', () => {
    const state = fixture(8, 5), start = { x: 1.5, y: 2.5 }, goal = { x: 6.5, y: 2.5 };
    state.world.revision = 1;
    expect(findPath(state, start, goal, 0).every(point => point.y === 2.5)).toBe(true);
    for (let y = 0; y < 5; y++) tile(state, 4, y).terrain = 'river';
    state.world.revision++;
    expect(findPath(state, start, goal, 0)).toEqual([]);
    tile(state, 4, 3).overlay = 'ford'; state.world.revision++;
    expect(findPath(state, start, goal, 0).some(point => point.x === 4.5 && point.y === 3.5)).toBe(true);
    tile(state, 4, 2).terrain = 'grassland'; state.world.revision++;
    expect(findPath(state, start, goal, 0).every(point => point.y === 2.5)).toBe(true);
    for (let x = 3; x < 6; x++) tile(state, x, 2).overlay = 'forest'; state.world.revision++;
    const slow = travelTimeMap(state, start, 0, 1, Infinity)[2 * 8 + 6];
    for (let x = 3; x < 6; x++) tile(state, x, 2).overlay = 'none'; state.world.revision++;
    expect(travelTimeMap(state, start, 0, 1, Infinity)[2 * 8 + 6]).toBeLessThan(slow);
    state.world = fixture(8, 5).world;
    tile(state, 3, 2).terrain = 'ocean';
    expect(findPath(state, start, goal, 0).every(point => !(point.x === 3.5 && point.y === 2.5))).toBe(true);
  });

  it('prefers a short free detour but treats friendly traffic as passable in a choke point', () => {
    const state = fixture(7, 5), start = { x: 1.5, y: 2.5 }, goal = { x: 5.5, y: 2.5 }, occupied = new Set([2 * 7 + 3]);
    expect(findPath(state, start, goal, 0, false, undefined, occupied).some(point => point.y !== 2.5)).toBe(true);
    for (let x = 0; x < 7; x++) for (const y of [1, 3]) entityStore(state).buildings.add(structure('wall', x, y, 10 + x * 4 + y));
    const queued = findPath(state, start, goal, 0, false, undefined, occupied);
    expect(queued.at(-1)).toEqual(goal);
    expect(queued.some(point => point.x === 3.5 && point.y === 2.5)).toBe(true);
    expect(findPath(state, start, goal, 0, false, occupied)).toEqual([]);
    occupied.clear();
    expect(findPath(state, start, goal, 0, false, undefined, occupied)).toEqual(queued);
  });
});
