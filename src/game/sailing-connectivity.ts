import { canTraverseEdge } from './pathfinding';
import { type Point, type World } from './types';

/** Cheap necessary reachability check before the more expensive oriented-hull
 * search. This cache lives for one navigation query, so traffic or construction
 * changes cannot leave stale water components behind. Cardinal connectivity is
 * sufficient for a hull one tile wide: touching diagonal water corners alone
 * never provides clearance. */
export function createSailingConnectivity(world: World, cell: (x: number, y: number) => boolean): (from: Point, to: Point) => boolean {
  // Movement-only navigation queries do not need a flood or world-sized buffers.
  let connected: ((from: Point, to: Point) => boolean) | undefined;
  return (from, to) => (connected ??= buildConnectivity(world, cell))(from, to);
}

function buildConnectivity(world: World, cell: (x: number, y: number) => boolean): (from: Point, to: Point) => boolean {
  const size = world.width * world.height;
  // 0 is unvisited, -1 blocked, positive values identify a complete component.
  const components = new Int32Array(size), queue = new Int32Array(size);
  let sequence = 0;
  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  const index = (point: Point): number => {
    const x = Math.floor(point.x), y = Math.floor(point.y);
    return x >= 0 && y >= 0 && x < world.width && y < world.height ? y * world.width + x : -1;
  };
  const open = (key: number): boolean => {
    if (key < 0 || components[key] === -1) return false;
    if (components[key] > 0) return true;
    if (cell(key % world.width, Math.floor(key / world.width))) return true;
    components[key] = -1; return false;
  };
  const flood = (origin: number): number => {
    if (components[origin] > 0) return components[origin];
    const component = ++sequence;
    components[origin] = component; queue[0] = origin;
    let head = 0, tail = 1;
    while (head < tail) {
      const current = queue[head++], x = current % world.width, y = Math.floor(current / world.width);
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        const next = ny * world.width + nx;
        if (components[next] !== 0 || !open(next)
          || !canTraverseEdge(world, { x: x + .5, y: y + .5 }, { x: nx + .5, y: ny + .5 })) continue;
        components[next] = component; queue[tail++] = next;
      }
    }
    return component;
  };
  return (from, to) => {
    const start = index(from), target = index(to);
    if (!open(start) || !open(target)) return false;
    if (start === target) return true;
    const component = flood(start);
    return components[target] === component;
  };
}
