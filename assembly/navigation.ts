// Numeric weighted A* kernel. All storage is preallocated linear memory: no
// managed objects, imported callbacks, GC, or host calls in the expansion loop.
let count: i32 = 0, width: i32 = 0;
let edges: usize = 0, terrain: usize = 0, blocked: usize = 0, soft: usize = 0, penalty: usize = 0;
let costs: usize = 0, previous: usize = 0, seen: usize = 0, closed: usize = 0;
let heapIndices: usize = 0, heapScores: usize = 0, output: usize = 0;
let heapLength: i32 = 0, stamp: u32 = 0;
const ROOT2: f64 = 1.4142135623730951;

export function configure(cells: i32, columns: i32): void {
  count = cells; width = columns;
  let p: usize = 65536;
  edges = p; p += <usize>cells;
  blocked = p; p += <usize>cells;
  soft = p; p += <usize>cells;
  p = (p + 7) & ~<usize>7;
  terrain = p; p += <usize>cells * 8;
  penalty = p; p += <usize>cells * 8;
  costs = p; p += <usize>cells * 8;
  previous = p; p += <usize>cells * 4;
  seen = p; p += <usize>cells * 4;
  closed = p; p += <usize>cells * 4;
  output = p; p += <usize>cells * 4;
  heapIndices = p; p += <usize>(cells * 8 + 8) * 4;
  p = (p + 7) & ~<usize>7;
  heapScores = p; p += <usize>(cells * 8 + 8) * 8;
  const pages = <i32>((p + 65535) >> 16);
  if (pages > memory.size()) memory.grow(pages - memory.size());
  memory.fill(seen, 0, <usize>cells * 4);
  memory.fill(closed, 0, <usize>cells * 4);
  stamp = 0;
}
export function edgesOffset(): usize { return edges; }
export function terrainOffset(): usize { return terrain; }
export function blockedOffset(): usize { return blocked; }
export function softOffset(): usize { return soft; }
export function penaltyOffset(): usize { return penalty; }
export function outputOffset(): usize { return output; }
@inline function i4(p: usize, i: i32): usize { return p + (<usize>i << 2); }
@inline function i8(p: usize, i: i32): usize { return p + (<usize>i << 3); }
@inline function heuristic(x: i32, y: i32, gx: i32, gy: i32, cardinal: bool): f64 {
  const dx = abs(x - gx), dy = abs(y - gy);
  return (cardinal ? <f64>(dx + dy) : <f64>max(dx, dy) + (ROOT2 - 1) * <f64>min(dx, dy)) / 1.5;
}
function push(index: i32, score: f64): void {
  let i = heapLength++;
  while (i > 0) {
    const parent = (i - 1) >> 1, parentScore = load<f64>(i8(heapScores, parent));
    if (parentScore <= score) break;
    store<i32>(i4(heapIndices, i), load<i32>(i4(heapIndices, parent)));
    store<f64>(i8(heapScores, i), parentScore); i = parent;
  }
  store<i32>(i4(heapIndices, i), index); store<f64>(i8(heapScores, i), score);
}
function pop(): i32 {
  const first = load<i32>(heapIndices), length = --heapLength;
  if (!length) return first;
  const last = load<i32>(i4(heapIndices, length)), score = load<f64>(i8(heapScores, length));
  let i = 0;
  while (i * 2 + 1 < length) {
    let child = i * 2 + 1;
    if (child + 1 < length && load<f64>(i8(heapScores, child + 1)) < load<f64>(i8(heapScores, child))) child++;
    if (load<f64>(i8(heapScores, child)) >= score) break;
    store<i32>(i4(heapIndices, i), load<i32>(i4(heapIndices, child)));
    store<f64>(i8(heapScores, i), load<f64>(i8(heapScores, child))); i = child;
  }
  store<i32>(i4(heapIndices, i), last); store<f64>(i8(heapScores, i), score);
  return first;
}
function reconstruct(start: i32, end: i32): i32 {
  let size = 0;
  for (let step = end; step != start && step != -1; step = load<i32>(i4(previous, step))) {
    store<i32>(i4(output, size++), step);
  }
  for (let i = 0; i < size / 2; i++) {
    const a = load<i32>(i4(output, i)), b = load<i32>(i4(output, size - i - 1));
    store<i32>(i4(output, i), b); store<i32>(i4(output, size - i - 1), a);
  }
  return size;
}
// Returns -1 only when the search exhausts. Zero is a successful empty route
// (the start itself was already the nearest reachable point).
export function search(start: i32, gx: i32, gy: i32, goalOpen: bool, partial: bool, cardinal: bool, nearest: f64): i32 {
  stamp++;
  if (!stamp) { memory.fill(seen, 0, <usize>count * 4); memory.fill(closed, 0, <usize>count * 4); stamp = 1; }
  const sx = start % width, sy = start / width, goal = gy * width + gx;
  let closest = start, closestDistance = heuristic(sx, sy, gx, gy, cardinal);
  heapLength = 0; store<f64>(i8(costs, start), 0); store<u32>(i4(seen, start), stamp); store<i32>(i4(previous, start), -1);
  push(start, closestDistance);
  while (heapLength) {
    const current = pop();
    if (load<u32>(i4(closed, current)) == stamp) continue;
    if (current == goal && goalOpen) return reconstruct(start, goal);
    store<u32>(i4(closed, current), stamp);
    const x = current % width, y = current / width, remaining = heuristic(x, y, gx, gy, cardinal);
    if (nearest < Infinity && remaining <= nearest + 1e-8) return reconstruct(start, current);
    const currentCost = load<f64>(i8(costs, current)), currentTerrain = load<f64>(i8(terrain, current));
    const mask: i32 = <i32>load<u8>(edges + current) & (cardinal ? 90 : 255);
    if (remaining < closestDistance || remaining == closestDistance && currentCost < load<f64>(i8(costs, closest))) {
      closest = current; closestDistance = remaining;
    }
    for (let d = 0; d < 8; d++) if (mask & (1 << d)) {
      const dx = d == 0 || d == 3 || d == 5 ? -1 : d == 2 || d == 4 || d == 7 ? 1 : 0;
      const dy = d < 3 ? -1 : d > 4 ? 1 : 0;
      const next = current + dy * width + dx;
      if (load<u32>(i4(closed, next)) == stamp || next != start && load<u8>(blocked + next)) continue;
      const cost = currentCost + (dx && dy ? ROOT2 : 1) * (currentTerrain + load<f64>(i8(terrain, next))) * .5 + (load<u8>(soft + next) ? 2 : 0) + load<f64>(i8(penalty, next));
      if (load<u32>(i4(seen, next)) == stamp && cost >= load<f64>(i8(costs, next))) continue;
      store<f64>(i8(costs, next), cost); store<i32>(i4(previous, next), current); store<u32>(i4(seen, next), stamp);
      push(next, cost + heuristic(x + dx, y + dy, gx, gy, cardinal));
    }
  }
  return !cardinal && partial && closest != start ? reconstruct(start, closest) : -1;
}
