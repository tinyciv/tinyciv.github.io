import TinyQueue from 'tinyqueue';
import { canTraverseEdge } from './pathfinding';
import type { Point, World } from './types';

/** Reverse water-grid distances guide the heading-aware hull search around
 * islands. Nodes settle only as far as requested, and every shore candidate
 * shares the same multi-goal field. Physical hull clearance is still checked
 * by the finer search; this field only supplies obstacle-aware guidance. */
export function createSailingDistance(world: World, cell: (x: number, y: number) => boolean,
  goals: readonly Point[]): (point: Point) => number {
  type Node = { index: number; cost: number };
  const count = world.width * world.height;
  const costs = new Float64Array(count); costs.fill(Infinity);
  const settled = new Uint8Array(count), openCells = new Int8Array(count);
  const queue = new TinyQueue<Node>([], (a, b) => a.cost - b.cost || a.index - b.index);
  const steps = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]] as const;
  const key = (x: number, y: number) => y * world.width + x;
  const open = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
    const index = key(x,y);
    if (!openCells[index]) openCells[index] = cell(x,y) ? 1 : -1;
    return openCells[index] === 1;
  };
  for (const goal of goals) {
    const x = Math.floor(goal.x), y = Math.floor(goal.y);
    if (!open(x,y)) continue;
    const index = key(x,y);
    if (costs[index] === 0) continue;
    costs[index] = 0; queue.push({index,cost:0});
  }
  return point => {
    const x = Math.floor(point.x), y = Math.floor(point.y);
    if (!open(x,y)) return Infinity;
    const target = key(x,y);
    while (!settled[target] && queue.length) {
      const node = queue.pop()!;
      if (settled[node.index] || node.cost > costs[node.index]) continue;
      settled[node.index] = 1;
      const px = node.index % world.width, py = Math.floor(node.index / world.width);
      for (const [dx,dy] of steps) {
        const nx = px + dx, ny = py + dy;
        if (!open(nx,ny) || dx && dy && (!open(px+dx,py) || !open(px,py+dy))
          || !canTraverseEdge(world,{x:px+.5,y:py+.5},{x:nx+.5,y:ny+.5})) continue;
        const next = key(nx,ny), cost = node.cost + (dx && dy ? Math.SQRT2 : 1);
        if (cost >= costs[next]) continue;
        costs[next] = cost; queue.push({index:next,cost});
      }
    }
    return settled[target] ? costs[target] : Infinity;
  };
}
