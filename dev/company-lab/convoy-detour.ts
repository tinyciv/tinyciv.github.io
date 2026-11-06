import type { FlowField, Navigation, Point } from './navigation';

export interface ConvoyDetourOptions {
  nav: Navigation;
  /** Ordered head to tail, at tile centers. */
  train: readonly Point[];
  goal: Point;
  field: FlowField;
  /** Other units/reservations, excluding this train's initial occupied cells. */
  blocked: ReadonlySet<number>;
  /** Exact collision check against in-flight units for the initial move. */
  firstStepSafe: (point: Point) => boolean;
  targetFootprint?: ReadonlySet<number>;
  maxExpanded?: number;
}
export interface ConvoyDetourResult {
  /** Successive head positions; current head is omitted. Empty means no route. */
  route: Point[];
  reachedGoal: boolean;
  stats: { expanded: number; totalMs: number; limitReached: boolean };
}
interface Node { cells: number[]; g: number; h: number; parent: number; depth: number }
const MIN_SPACING_SQUARED = .6 ** 2 - 1e-9;

/** Minimum separation during two simultaneous, equal-duration linear moves. */
function separated(a: Point, endA: Point, b: Point, endB: Point): boolean {
  const x = a.x - b.x, y = a.y - b.y;
  const dx = endA.x - a.x - endB.x + b.x, dy = endA.y - a.y - endB.y + b.y;
  const time = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)));
  return (x + dx * time) ** 2 + (y + dy * time) ** 2 >= MIN_SPACING_SQUARED;
}

/** Search the whole three-cell configuration, not just its head. Vacated body
 * cells become available naturally; sharp turns that cross members do not. */
export function findConvoyDetour(options: ConvoyDetourOptions): ConvoyDetourResult {
  const started = performance.now(), { nav, train, goal, field, blocked, firstStepSafe, targetFootprint } = options;
  const width = nav.world.width, count = width * nav.world.height;
  const maximum = Math.max(0, Math.min(1500, Math.floor(options.maxExpanded ?? 1500)));
  const key = (point: Point) => Math.floor(point.y) * width + Math.floor(point.x);
  const center = (index: number): Point => ({ x: index % width + .5, y: Math.floor(index / width) + .5 });
  let expanded = 0;
  const finish = (route: Point[], reachedGoal: boolean, limitReached = false): ConvoyDetourResult =>
    ({ route, reachedGoal, stats: { expanded, totalMs: performance.now() - started, limitReached } });
  if (!train.length || train.length > 3 || train.some(point => !nav.passable(point.x, point.y))
    || !nav.passable(goal.x, goal.y)) return finish([], false);
  const initial = train.map(key), goalCell = key(goal);
  if (new Set(initial).size !== initial.length || initial.some(cell => cell < 0 || cell >= count)) return finish([], false);
  if (blocked.has(goalCell) || targetFootprint
    && [...targetFootprint].filter(cell => !blocked.has(cell) && nav.passable(center(cell).x, center(cell).y)).length < train.length)
    return finish([], false);
  const startDistance = field.distances[initial[0]];
  const complete = (cells: number[]) => cells[0] === goalCell && (!targetFootprint || cells.every(cell => targetFootprint.has(cell)));
  // A step costs one. The field's largest possible edge is sqrt(2)*1.15;
  // dividing by that keeps the lower bound admissible even on weighted roads.
  const estimate = (cells: number[]): number => {
    const distance = field.distances[cells[0]], head = center(cells[0]);
    const headSteps = Number.isFinite(distance) ? distance / (Math.SQRT2 * 1.15)
      : Math.max(Math.abs(head.x - goal.x), Math.abs(head.y - goal.y));
    const outside = targetFootprint ? cells.filter(cell => !targetFootprint.has(cell)).length : 0;
    return Math.max(headSteps, outside);
  };
  if (complete(initial)) return finish([], true);
  const nodes: Node[] = [{ cells: initial, g: 0, h: estimate(initial), parent: -1, depth: 0 }];
  const known = new Map<string, number>([[initial.join(','), 0]]);
  const heap: number[] = [], positions: number[] = [];
  const before = (a: number, b: number): boolean => {
    const left = nodes[a], right = nodes[b];
    return left.g + left.h < right.g + right.h
      || left.g + left.h === right.g + right.h && (left.h < right.h || left.h === right.h && a < b);
  };
  const push = (index: number): void => {
    let slot = positions[index] ?? -1;
    if (slot < 0) { slot = heap.length; heap.push(index); }
    while (slot > 0) {
      const parent = (slot - 1) >>> 1, other = heap[parent];
      if (!before(index, other)) break;
      heap[slot] = other; positions[other] = slot; slot = parent;
    }
    heap[slot] = index; positions[index] = slot;
  };
  const pop = (): number => {
    const result = heap[0], last = heap.pop()!; positions[result] = -1;
    if (!heap.length) return result;
    let slot = 0;
    while (slot * 2 + 1 < heap.length) {
      let child = slot * 2 + 1;
      if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
      if (!before(heap[child], last)) break;
      heap[slot] = heap[child]; positions[heap[slot]] = slot; slot = child;
    }
    heap[slot] = last; positions[last] = slot; return result;
  };
  push(0);
  while (heap.length && expanded < maximum) {
    const index = pop(), node = nodes[index]; expanded++;
    const exact = complete(node.cells);
    if (exact || !targetFootprint && node.depth >= 3 && field.distances[node.cells[0]] <= startDistance - 3) {
      const route: Point[] = [];
      for (let cursor = index; nodes[cursor].parent !== -1; cursor = nodes[cursor].parent) route.push(center(nodes[cursor].cells[0]));
      route.reverse(); return finish(route, exact);
    }
    const points = node.cells.map(center), head = points[0];
    // Followers must be able to move into the previous member's cell. A stale
    // or disconnected input train cannot be repaired by teleporting its tail.
    if (points.some((point, i) => i > 0 && !nav.canStep(point.x, point.y, points[i - 1].x, points[i - 1].y))) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const next = { x: head.x + dx, y: head.y + dy }, nextCell = key(next);
      if (!nav.canStep(head.x, head.y, next.x, next.y) || blocked.has(nextCell) || node.cells.includes(nextCell)
        || node.parent === -1 && !firstStepSafe(next)) continue;
      const targets = [next, ...points.slice(0, -1)];
      let safe = true;
      for (let a = 0; a < points.length && safe; a++) for (let b = a + 1; b < points.length; b++)
        if (!separated(points[a], targets[a], points[b], targets[b])) { safe = false; break; }
      if (!safe) continue;
      const cells = [nextCell, ...node.cells.slice(0, -1)], signature = cells.join(','), cost = node.g + 1;
      const previous = known.get(signature);
      if (previous !== undefined) {
        if (nodes[previous].g <= cost) continue;
        Object.assign(nodes[previous], { g: cost, parent: index, depth: node.depth + 1 }); push(previous);
      } else {
        const nextIndex = nodes.length;
        nodes.push({ cells, g: cost, h: estimate(cells), parent: index, depth: node.depth + 1 });
        known.set(signature, nextIndex); push(nextIndex);
      }
    }
  }
  return finish([], false, heap.length > 0 && expanded >= maximum);
}
