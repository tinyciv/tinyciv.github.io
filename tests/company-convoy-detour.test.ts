import { describe, expect, it } from 'vitest';
import { findConvoyDetour } from '../dev/company-lab/convoy-detour';
import { Navigation, type NavigationWorld, type Point } from '../dev/company-lab/navigation';

function setup(width = 10, height = 9) {
  const world: NavigationWorld = { width, height, tiles: new Uint8Array(width * height), elevations: new Int8Array(width * height) };
  return { world, nav: new Navigation(world) };
}
const cell = (nav: Navigation, point: Point) => Math.floor(point.y) * nav.world.width + Math.floor(point.x);
function replay(nav: Navigation, train: Point[], route: Point[], blocked: ReadonlySet<number>): Point[] {
  let current = train;
  for (const next of route) {
    expect(current.some(point => cell(nav, point) === cell(nav, next))).toBe(false);
    expect(blocked.has(cell(nav, next))).toBe(false);
    const targets = [next, ...current.slice(0, -1)];
    for (let i = 0; i < current.length; i++) expect(nav.canStep(current[i].x, current[i].y, targets[i].x, targets[i].y)).toBe(true);
    for (let progress = 0; progress <= 1; progress += .05) {
      const positions = current.map((point, i) => ({ x: point.x + (targets[i].x - point.x) * progress,
        y: point.y + (targets[i].y - point.y) * progress }));
      for (let a = 0; a < positions.length; a++) for (let b = a + 1; b < positions.length; b++)
        expect(Math.hypot(positions[a].x - positions[b].x, positions[a].y - positions[b].y)).toBeGreaterThanOrEqual(.6 - 1e-7);
    }
    current = targets;
  }
  return current;
}

describe('company configuration-space detours', () => {
  it('can reach a docking goal initially occupied by its own tail after that cell is vacated', () => {
    const { nav } = setup(), train = [{ x: 4.5, y: 4.5 }, { x: 3.5, y: 4.5 }, { x: 2.5, y: 4.5 }], goal = train[2];
    const blocked = new Set<number>(), targetFootprint = new Set(train.map(point => cell(nav, point)));
    const result = findConvoyDetour({ nav, train, goal, field: nav.field(goal), blocked, targetFootprint, firstStepSafe: () => true });
    expect(result.reachedGoal).toBe(true); expect(result.route.length).toBeGreaterThan(2);
    const final = replay(nav, train, result.route, blocked);
    expect(final[0]).toEqual(goal);
    expect(new Set(final.map(point => cell(nav, point)))).toEqual(targetFootprint);
  });

  it('does not park a tail outside its allocated footprint when the head arrives first', () => {
    const { nav } = setup(), train = [{ x: 4.5, y: 4.5 }, { x: 3.5, y: 4.5 }, { x: 2.5, y: 4.5 }];
    const goal = train[0], targetFootprint = new Set([goal, { x: 4.5, y: 3.5 }, { x: 4.5, y: 2.5 }].map(point => cell(nav, point)));
    const result = findConvoyDetour({ nav, train, goal, field: nav.field(goal), blocked: new Set(), targetFootprint, firstStepSafe: () => true });
    expect(result.reachedGoal).toBe(true); expect(result.route.length).toBeGreaterThan(0);
    const final = replay(nav, train, result.route, new Set());
    expect(final.every(point => targetFootprint.has(cell(nav, point)))).toBe(true);
  });

  it('rejects the sharp 135-degree shortcut that intersects an advancing follower', () => {
    const { nav } = setup(), train = [{ x: 4.5, y: 4.5 }, { x: 3.5, y: 4.5 }, { x: 2.5, y: 4.5 }], goal = { x: 3.5, y: 3.5 };
    const rejected = findConvoyDetour({ nav, train, goal, field: nav.field(goal), blocked: new Set(),
      firstStepSafe: point => point.x === goal.x && point.y === goal.y });
    expect(rejected.route).toEqual([]);
    const safe = findConvoyDetour({ nav, train, goal, field: nav.field(goal), blocked: new Set(), firstStepSafe: () => true });
    expect(safe.reachedGoal).toBe(true); expect(safe.route[0]).not.toEqual(goal);
    replay(nav, train, safe.route, new Set());
  });

  it('takes a safe first step around reservations and returns bounded progress toward a distant goal', () => {
    const { nav } = setup(24, 12), train = [{ x: 4.5, y: 5.5 }, { x: 3.5, y: 5.5 }, { x: 2.5, y: 5.5 }], goal = { x: 20.5, y: 5.5 };
    const blocked = new Set([cell(nav, { x: 5.5, y: 5.5 }), cell(nav, { x: 5.5, y: 6.5 })]);
    const field = nav.field(goal), result = findConvoyDetour({ nav, train, goal, field, blocked,
      firstStepSafe: point => point.y < train[0].y });
    expect(result.route.length).toBeGreaterThanOrEqual(3);
    expect(result.route[0].y).toBeLessThan(train[0].y);
    const final = replay(nav, train, result.route, blocked);
    expect(field.distances[cell(nav, final[0])]).toBeLessThanOrEqual(field.distances[cell(nav, train[0])] - 3);
    expect(result.stats.expanded).toBeLessThanOrEqual(1500);
  });

  it.each([1, 2, 3])('routes a %i-member company and respects the configured expansion budget', size => {
    const { nav } = setup(24, 12), train = Array.from({ length: size }, (_, i) => ({ x: 4.5 - i, y: 5.5 })), goal = { x: 20.5, y: 5.5 };
    const options = { nav, train, goal, field: nav.field(goal), blocked: new Set<number>(), firstStepSafe: () => true };
    const short = findConvoyDetour({ ...options, maxExpanded: 1 });
    expect(short.route).toEqual([]); expect(short.stats).toMatchObject({ expanded: 1, limitReached: true });
    const route = findConvoyDetour(options);
    expect(route.route.length).toBeGreaterThan(0); replay(nav, train, route.route, new Set());
  });
});
