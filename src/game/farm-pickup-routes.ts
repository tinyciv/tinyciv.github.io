import { canMove, canTraverseEdge, canWalk, findPath, movementMultiplier, withNavigationFrame } from './pathfinding';
import type { GameState, Point } from './types';

interface PickupRouteStats { local: number; fallbacks: number }
const statistics = new WeakMap<GameState, PickupRouteStats>();
export function farmPickupRouteStats(state: GameState): Readonly<PickupRouteStats> {
  return { ...(statistics.get(state) ?? { local: 0, fallbacks: 0 }) };
}

/** A small pickup neighborhood is a tiny weighted graph. Only use its shortest
 * route when even an ideal road outside it cannot beat it; unusual terrain
 * and blocked cells retain the ordinary complete-path search. */
export function farmPickupPath(state: GameState, from: Point, goal: Point, faction: number, farm: Point): Point[] {
  return withNavigationFrame(state, () => {
    let stats = statistics.get(state);
    if (!stats) { stats = { local: 0, fallbacks: 0 }; statistics.set(state, stats); }
    const fallback = (): Point[] => {
      stats.fallbacks++;
      return findPath(state, from, goal, faction, false, undefined, undefined, undefined, false, true);
    };
    const x = Math.floor(farm.x), y = Math.floor(farm.y);
    const sx = Math.floor(from.x) - x, sy = Math.floor(from.y) - y;
    const gx = Math.floor(goal.x) - x, gy = Math.floor(goal.y) - y;
    if (![sx, sy, gx, gy].every(value => value === 0 || value === 1)
      || goal.x !== x + gx + .5 || goal.y !== y + gy + .5) return fallback();
    // A cardinal neighbor is already globally cheapest: any detour pays at
    // least the same two endpoint half-costs plus positive intermediate costs.
    // Most pickup sweeps take only these steps, with no graph or cost arrays.
    if ((sx === gx || sy === gy) && canMove(state, from, goal, faction, undefined, true)) {
      stats.local++;
      return [{ ...goal }];
    }
    const start = sy * 2 + sx, target = gy * 2 + gx;
    const points = Array.from({ length: 4 }, (_, i) => ({ x: x + i % 2 + .5, y: y + Math.floor(i / 2) + .5 }));
    const open = points.map(point => canWalk(state, point.x, point.y, faction, undefined, true));
    if (!open[start] || !open[target]) return fallback();
    if (start === target) { stats.local++; return [{ ...goal }]; }
    const terrain = points.map((point, i) => open[i] ? 1 / movementMultiplier(state, point.x, point.y) : Infinity);
    const costs = [Infinity, Infinity, Infinity, Infinity], previous = [-1, -1, -1, -1];
    let closed = 0;
    costs[start] = 0;
    for (let step = 0; step < 4; step++) {
      let current = -1;
      for (let i = 0; i < 4; i++) if (!(closed & (1 << i)) && (current < 0 || costs[i] < costs[current])) current = i;
      if (current < 0 || !Number.isFinite(costs[current]) || current === target) break;
      closed |= 1 << current;
      for (let next = 0; next < 4; next++) {
        if (!open[next] || closed & (1 << next) || !canTraverseEdge(state.world, points[current], points[next])) continue;
        const diagonal = current % 2 !== next % 2 && Math.floor(current / 2) !== Math.floor(next / 2);
        const cost = costs[current] + (diagonal ? Math.SQRT2 : 1) * (terrain[current] + terrain[next]) * .5;
        if (cost < costs[next]) { costs[next] = cost; previous[next] = current; }
      }
    }
    // Roads are the fastest possible cells (1.5x). Any route leaving this 2x2
    // square travels at least 1+sqrt(2) cells for adjacent plots, or 2+sqrt(2)
    // for opposite plots. Its first/last edges must also pay the actual plot
    // costs, each for at least one cell of travel.
    const cheapest = 1 / 1.5;
    const outsideDistance = (sx !== gx && sy !== gy ? 2 : 1) + Math.SQRT2;
    const outsideBound = outsideDistance * cheapest + (terrain[start] + terrain[target] - 2 * cheapest) * .5;
    if (!Number.isFinite(costs[target]) || costs[target] > outsideBound + 1e-9) return fallback();
    const path: Point[] = [];
    for (let step = target; step !== start; step = previous[step]) path.push(points[step]);
    path.reverse();
    // Like A*, center a fractional arrival before a diagonal that would sweep
    // a neighboring obstacle. Validate the actual first step, not just cells.
    if (!canMove(state, from, path[0], faction, undefined, true)) {
      if (!canMove(state, from, points[start], faction, undefined, true)) return fallback();
      path.unshift(points[start]);
    }
    stats.local++;
    return path;
  });
}
