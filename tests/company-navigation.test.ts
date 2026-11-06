import { describe, expect, it } from 'vitest';
import { Navigation, type NavigationWorld, type Point } from '../dev/company-lab/navigation';
import { createWorld, SCENARIOS } from '../dev/company-lab/scenarios';

const world = (width = 12, height = 9): NavigationWorld => ({ width, height,
  tiles: new Uint8Array(width * height), elevations: new Int8Array(width * height),
  stairDir: new Int8Array(width * height).fill(-1) });
function follow(nav: Navigation, from: Point, to: Point): Point[] {
  const field = nav.field(to, from), route = [from];
  for (let steps = 0; steps < nav.world.tiles.length; steps++) {
    const current = route.at(-1)!;
    if (current.x === field.goal.x && current.y === field.goal.y) return route;
    const next = nav.choices(current.x, current.y, field)[0];
    expect(next).toBeDefined();
    expect(nav.canStep(current.x, current.y, next.x, next.y)).toBe(true);
    expect(nav.distance(next.x, next.y, field)).toBeLessThan(nav.distance(current.x, current.y, field));
    route.push(next);
  }
  throw Error('Flow route did not converge.');
}

describe('company shared flow navigation', () => {
  it('routes around solid terrain and never cuts blocked diagonal corners', () => {
    const map = world();
    for (let y = 0; y < 7; y++) map.tiles[y * map.width + 5] = 4;
    map.tiles[1 * map.width + 2] = 2;
    const nav = new Navigation(map);
    expect(nav.canStep(1.5, 1.5, 2.5, 2.5)).toBe(false);
    const route = follow(nav, { x: 2.5, y: 2.5 }, { x: 9.5, y: 2.5 });
    expect(route.some(point => point.y >= 7.5)).toBe(true);
    expect(route.every(point => nav.passable(point.x, point.y))).toBe(true);
  });

  it('crosses a cliff only on an oriented stair and supports the reverse trip', () => {
    const map = world();
    for (let y = 0; y < map.height; y++) for (let x = 5; x < map.width; x++) {
      map.tiles[y * map.width + x] = 7; map.elevations[y * map.width + x] = 1;
    }
    const stair = 4 * map.width + 5;
    map.tiles[stair] = 8; map.stairDir![stair] = 1;
    const nav = new Navigation(map), low = { x: 2.5, y: 2.5 }, high = { x: 9.5, y: 2.5 };
    expect(nav.canStep(4, 3, 5, 3)).toBe(false);
    expect(nav.canStep(4, 3, 5, 4)).toBe(false);
    expect(nav.canStep(4, 4, 5, 4)).toBe(true);
    for (const route of [follow(nav, low, high), follow(nav, high, low)])
      expect(route).toContainEqual({ x: 5.5, y: 4.5 });
    map.stairDir![stair] = 3; nav.clearCache();
    expect(nav.canStep(4, 4, 5, 4)).toBe(false);
    expect(nav.distance(low.x, low.y, nav.field(high))).toBe(Infinity);
  });

  it('snaps blocked or disconnected orders to the origin’s reachable component', () => {
    const map = world();
    for (let y = 0; y < map.height; y++) map.tiles[y * map.width + 5] = 3;
    const nav = new Navigation(map), from = { x: 2.5, y: 4.5 };
    expect(nav.field({ x: 9.5, y: 4.5 }).distances[4 * map.width + 2]).toBe(Infinity);
    const field = nav.field({ x: 9.5, y: 4.5 }, from);
    expect(field.goal).toEqual({ x: 4.5, y: 4.5 });
    expect(follow(nav, from, { x: 9.5, y: 4.5 }).at(-1)).toEqual(field.goal);
    expect(nav.nearestOpen({ x: 5.5, y: 4.5 }, from)).toEqual(field.goal);
    expect(nav.nearestOpen({ x: -30, y: 100 })).toEqual({ x: .5, y: 8.5 });
  });

  it('shares fields between hundreds of soldiers and bounds the destination cache', () => {
    const map = world(96, 64), nav = new Navigation(map, 2);
    const first = nav.field({ x: 80.5, y: 20.5 });
    for (let soldier = 0; soldier < 720; soldier++)
      expect(nav.field({ x: 80.1, y: 20.9 }, { x: soldier % 20 + .5, y: soldier % 50 + .5 })).toBe(first);
    expect(nav.stats.searches).toBe(1); expect(nav.stats.cacheHits).toBe(720);
    expect(nav.stats.expanded).toBe(96 * 64);
    nav.field({ x: 80.5, y: 40.5 }); nav.field({ x: 80.5, y: 50.5 });
    expect(nav.field(first.goal)).not.toBe(first);
    expect(nav.stats.searches).toBe(4);
    nav.resetStats();
    expect(nav.stats).toEqual({ searches: 0, cacheHits: 0, expanded: 0, totalMs: 0, maxMs: 0 });
  });

  it.each(SCENARIOS)('connects both deployments across $name at normal and stress sizes', ({ id }) => {
    for (const stress of [false, true]) {
      const map = createWorld(id, stress), nav = new Navigation(map);
      const forward = nav.field(map.bases[1]), reverse = nav.field(map.bases[0]);
      expect(Number.isFinite(nav.distance(map.bases[0].x, map.bases[0].y, forward))).toBe(true);
      expect(nav.distance(map.bases[0].x, map.bases[0].y, forward)).toBeCloseTo(nav.distance(map.bases[1].x, map.bases[1].y, reverse));
      expect(follow(nav, map.bases[0], map.bases[1]).at(-1)).toEqual(map.bases[1]);
    }
  });
});
