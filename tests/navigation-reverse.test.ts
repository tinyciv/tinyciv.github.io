import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { canMove, findPath, movementMultiplier, ReversePathQuery, withNavigationFrame } from '../src/game/pathfinding';
import { STAIR_UP } from '../src/game/ridges';
import type { Building, GameState, Point } from '../src/game/types';

function fixture(width = 32, height = 24): GameState {
  return { world: { width, height, revision: 0, seed: 'reverse-navigation', source: 'test', spawns: [],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [], units: [], fields: [], factions: [{ id: 0, relation: 'self' }], time: 1,
  } as unknown as GameState;
}
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building =>
  ({ id, kind, x, y, faction, hp: 100, maxHp: 100, capacity: 0 });
const point = (x: number, y: number): Point => ({ x: x + .5, y: y + .5 });
function routeCost(state: GameState, from: Point, path: Point[]): number {
  return withNavigationFrame(state, () => {
    let total = 0, previous = from;
    for (const next of path) {
      expect(canMove(state, previous, next, 0, undefined, true)).toBe(true);
      total += Math.hypot(next.x - previous.x, next.y - previous.y)
        * (1 / movementMultiplier(state, previous.x, previous.y) + 1 / movementMultiplier(state, next.x, next.y)) * .5;
      previous = next;
    }
    return total;
  });
}
function expectOptimal(state: GameState, search: ReversePathQuery, from: Point, goal: Point): Point[] {
  const result = search.findReversePath(state, from, 4096);
  const expected = findPath(state, from, goal, 0, false, undefined, undefined, undefined, false, true);
  expect(result.path?.at(-1)).toEqual(goal);
  expect(routeCost(state, from, result.path!)).toBeCloseTo(routeCost(state, from, expected), 9);
  return result.path!;
}

describe('shared reverse navigation', () => {
  it('matches weighted A* for different starting cells while sharing settled work', () => {
    const state = fixture(), goal = point(3, 10), search = new ReversePathQuery(goal, 0);
    for (let y = 6; y < 16; y++) for (let x = 10; x < 20; x++) state.world.tiles[y * 32 + x].overlay = 'forest';
    for (let x = 4; x < 28; x++) entityStore(state).buildings.add(building(100 + x, 'road', x, 5));
    expectOptimal(state, search, point(28, 18), goal);
    const nearby = search.findReversePath(state, point(6, 6));
    expect(nearby.expanded).toBe(0);
    expect(nearby.path?.at(-1)).toEqual(goal);
    for (const from of [point(22, 8), point(17, 20), point(3, 2), point(28, 4)]) expectOptimal(state, search, from, goal);
  });

  it.each(['north', 'east', 'south', 'west'] as const)('respects %s stair orientation in both travel directions and after rotation', direction => {
    const state = fixture();
    for (let y = 6; y < 13; y++) for (let x = 8; x < 15; x++) state.world.tiles[y * 32 + x].ridge = 1;
    const high = direction === 'north' ? { x: 11, y: 12 } : direction === 'south' ? { x: 11, y: 6 }
      : direction === 'east' ? { x: 8, y: 9 } : { x: 14, y: 9 };
    const up = STAIR_UP[direction], low = point(high.x - up.x, high.y - up.y), inside = point(high.x + up.x, high.y + up.y);
    state.world.tiles[high.y * 32 + high.x].stair = direction;
    const ascent = new ReversePathQuery(inside, 0), descent = new ReversePathQuery(low, 0);
    expectOptimal(state, ascent, low, inside);
    expectOptimal(state, descent, inside, low);
    state.world.tiles[high.y * 32 + high.x].stair = direction === 'north' ? 'south' : direction === 'south' ? 'north' : direction === 'east' ? 'west' : 'east';
    state.world.revision!++;
    expect(ascent.findReversePath(state, low).path).toBeUndefined();
    expect(descent.findReversePath(state, inside).path).toBeUndefined();
  });

  it('retains explored work after remote construction and nonblocking farm changes', () => {
    const state = fixture(96, 96), goal = point(3, 8), from = point(12, 8), search = new ReversePathQuery(goal, 0);
    const original = search.findReversePath(state, from).path;
    entityStore(state).buildings.add(building(1, 'house', 80, 80), building(2, 'camp', 8, 7)); state.world.revision!++;
    const reused = search.findReversePath(state, from);
    expect(reused).toMatchObject({ expanded: 0, restarted: false, path: original });
    entityStore(state).buildings.add(building(3, 'wall', 8, 8)); state.world.revision!++;
    expect(search.findReversePath(state, from).restarted).toBe(true);
    expectOptimal(state, search, from, goal);
  });

  it('discovers a formerly unreachable entrance after a gate opens, including diplomacy changes', () => {
    const state = fixture(), from = point(26, 10), goal = point(4, 10), search = new ReversePathQuery(goal, 0);
    for (let y = 0; y < 24; y++) entityStore(state).buildings.add(building(100 + y, 'wall', 16, y, 1));
    expect(search.findReversePath(state, from).path).toBeUndefined();
    entityStore(state).buildings.add(building(200, 'road', 16, 10, 1));
    expect(search.findReversePath(state, from).path).toBeUndefined();
    state.factions.push({ id: 1, relation: 'confederated' } as GameState['factions'][number]);
    expectOptimal(state, search, from, goal);
    state.factions[1].relation = 'peace';
    expect(search.findReversePath(state, from).path).toBeUndefined();
  });

  it('restarts for new roads and forbidden cells in explored regions', () => {
    const state = fixture(), from = point(26, 10), goal = point(4, 10), search = new ReversePathQuery(goal, 0);
    const old = expectOptimal(state, search, from, goal);
    for (let x = 5; x < 26; x++) entityStore(state).buildings.add(building(100 + x, 'road', x, 9));
    const updated = expectOptimal(state, search, from, goal);
    expect(routeCost(state, from, updated)).toBeLessThan(routeCost(state, from, old));
    setForbiddenRectangle(state, updated[3], updated[3], true);
    expectOptimal(state, search, from, goal);
  });

  it('caps per-request expansion and retained nodes, with no repeated work after saturation', () => {
    const state = fixture(96, 96), from = point(90, 90), search = new ReversePathQuery(point(2, 2), 0, 128);
    const initial = search.findReversePath(state, from, 10);
    expect(initial.expanded).toBe(10); expect(initial.path).toBeUndefined();
    const filled = search.findReversePath(state, from, 4096);
    expect(filled.path).toBeUndefined(); expect(search.size).toBeLessThanOrEqual(128);
    expect(search.findReversePath(state, from, 4096).expanded).toBe(0);
  });

  it('handles invalid positions, same-cell endpoints and replacement worlds', () => {
    const state = fixture(), goal = { x: 4.3, y: 8.8 }, search = new ReversePathQuery(goal, 0);
    expect(search.findReversePath(state, { x: 4.9, y: 8.2 }).path).toEqual([goal]);
    for (const from of [{ x: NaN, y: 0 }, point(-1, 2), point(32, 2)]) expect(search.findReversePath(state, from).path).toBeUndefined();
    expect(new ReversePathQuery(point(100, 100), 0).findReversePath(state, point(2, 2)).path).toBeUndefined();
    search.findReversePath(state, point(20, 8));
    state.world = fixture().world;
    expect(search.findReversePath(state, point(20, 8)).restarted).toBe(true);
  });
});
