import { describe, expect, it, vi } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { infantryRoute, infantrySegmentClear } from '../src/game/infantry-drill';
import * as navigation from '../src/game/pathfinding';
import { entityStore } from '../src/game/entity-store';
import type { GameState, Point } from '../src/game/types';

/** Original full-rectangle geometric oracle. */
function fullRectangle(state: GameState, from: Point, to: Point): boolean {
  if (!navigation.canMove(state, from, to, 0)) return false;
  const radius = .17, dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const segment = (x: number, y: number) => {
    const t = length ? clamp(((x - from.x) * dx + (y - from.y) * dy) / length, 0, 1) : 0;
    return (x - from.x - t * dx) ** 2 + (y - from.y - t * dy) ** 2;
  };
  const blockers = navigation.buildingBlockerView(state, 0);
  for (let y = Math.floor(Math.min(from.y, to.y) - radius); y <= Math.floor(Math.max(from.y, to.y) + radius); y++)
    for (let x = Math.floor(Math.min(from.x, to.x) - radius); x <= Math.floor(Math.max(from.x, to.x) + radius); x++) {
      if (navigation.canWalk(state, x, y, 0, blockers)) continue;
      const endpoint = (p: Point) => (p.x - clamp(p.x, x, x + 1)) ** 2 + (p.y - clamp(p.y, y, y + 1)) ** 2;
      if (Math.min(endpoint(from), endpoint(to), segment(x, y), segment(x + 1, y), segment(x, y + 1), segment(x + 1, y + 1)) < radius * radius - 1e-9) return false;
    }
  return true;
}

describe('formation swept-body clearance', () => {
  it('smooths a long winding route with bounded probes and collision-safe segments', () => {
    const state = scenario('Open melee'); entityStore(state).buildings.replace([]);
    const tile = state.world.tiles[0]; state.world.width = 170; state.world.height = 20;
    state.world.tiles = Array.from({ length: 170 * 20 }, () => ({ ...tile }));
    for (const y of [5, 10, 15]) for (let x = 0; x < 170; x++)
      if (y === 10 ? x > 2 : x < 167) state.world.tiles[y * 170 + x].terrain = 'lake';
    state.world.revision!++;
    const from = { x: 2.5, y: 2.5 }, goal = { x: 168.5, y: 18.5 };
    expect(navigation.findPath(state, from, goal, 0, false, undefined, undefined, undefined, true).length).toBeGreaterThan(490);
    const move = vi.spyOn(navigation, 'canMove');
    let route: Point[];
    try {
      route = infantryRoute(state, from, goal, 0);
      // The previous reverse scan repeatedly revisited hundreds of distant
      // points beyond the next turn. Doubling only probes around that turn.
      expect(move.mock.calls.length).toBeLessThan(160);
    } finally { move.mockRestore(); }
    expect(route.at(-1)).toEqual(goal);
    let previous = from;
    for (const next of route) {
      expect(infantrySegmentClear(state, previous, next, 0)).toBe(true);
      previous = next;
    }
  });

  it('matches full-rectangle geometry for corners, reverse, horizontal and fractional segments', () => {
    const state = scenario('Open melee'); entityStore(state).buildings.replace([]);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++)
      if ((x * 7 + y * 11) % 17 === 0) state.world.tiles[y * state.world.width + x].terrain = 'lake';
    state.world.revision!++;
    let seed = 1234;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 0x100000000);
    navigation.withNavigationFrame(state, () => {
      for (let i = 0; i < 2000; i++) {
        const from = { x: 1 + random() * 14, y: 1 + random() * 14 };
        const to = { x: i % 5 === 0 ? from.x : 1 + random() * 14, y: i % 7 === 0 ? from.y : 1 + random() * 14 };
        expect(infantrySegmentClear(state, from, to, 0)).toBe(fullRectangle(state, from, to));
      }
    });
  });

  it('checks a linear number of tiles for a long clear diagonal', () => {
    const state = scenario('Open melee'); entityStore(state).buildings.replace([]);
    const tile = state.world.tiles[0]; state.world.width = state.world.height = 128;
    state.world.tiles = Array.from({ length: 128 * 128 }, () => ({ ...tile })); state.world.revision!++;
    const walk = vi.spyOn(navigation, 'canWalk');
    try {
      expect(infantrySegmentClear(state, { x: 2.5, y: 2.5 }, { x: 120.5, y: 120.5 }, 0)).toBe(true);
      // The former rectangle tests over 14,000 cells for this same segment.
      expect(walk.mock.calls.length).toBeLessThan(400);
    } finally { walk.mockRestore(); }
  });
});
