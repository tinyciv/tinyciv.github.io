/** An illustrative drainage-first catchment. This module is independent of the
 * game generator: geometry is designed for explanation; runoff is conserved. */
export interface RiverDesignParameters { seed: string; density: number; rainfall: number; fordSpacing: number }
export interface RiverPoint { x: number; y: number; cell: number }
export interface RiverCrossing extends RiverPoint {
  kind: 'stream' | 'ford'; axis: 'horizontal' | 'vertical'; cells: number[]; banks: [RiverPoint, RiverPoint];
}
export interface RiverDesignModel {
  width: number; height: number; parameters: RiverDesignParameters;
  receiver: Int32Array; flow: Float32Array; localRunoff: Float32Array; elevation: Float32Array;
  streamOrder: Uint8Array; channel: Uint8Array; widthTiles: Float32Array;
  waterMask: Uint8Array; fordMask: Uint8Array; seaMask: Uint8Array;
  sources: RiverPoint[]; mouth: RiverPoint; crossings: RiverCrossing[];
  thresholds: { stream: number; river: number; main: number };
  diagnostics: { heads: number; tributaries: number; confluences: number; inputFlow: number; mouthFlow: number;
    massBalanceError: number; maxWidth: number; classCounts: number[]; coveredCells: number;
    fordCount: number; longestFordGap: number; fordGaps: number; reaches: number };
}
export const DEFAULT_RIVER_DESIGN: RiverDesignParameters = { seed: 'MANY-TO-ONE', density: 1, rainfall: 1, fordSpacing: 8 };
const W = 96, H = 72, SEA_Y = 70;
const THRESHOLDS = { stream: 0, river: 64, main: 640 };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
function randomStream(seed: string): () => number {
  let state = 2166136261;
  for (let n = 0; n < seed.length; n++) state = Math.imul(state ^ seed.charCodeAt(n), 16777619);
  return () => { state += 0x6d2b79f5; let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const point = (cell: number): RiverPoint => ({ x: cell % W, y: Math.floor(cell / W), cell });
const cellAt = (x: number, y: number) => Math.round(clamp(y, 1, SEA_Y - 1)) * W + Math.round(clamp(x, 2, W - 3));
function line(a: number, b: number): number[] {
  let { x, y } = point(a); const end = point(b), dx = Math.abs(end.x - x), dy = Math.abs(end.y - y);
  const sx = x < end.x ? 1 : -1, sy = y < end.y ? 1 : -1; let error = dx - dy;
  const cells = [a];
  while (x !== end.x || y !== end.y) {
    const twice = 2 * error;
    if (twice > -dy) { error -= dy; x += sx; }
    if (twice < dx) { error += dx; y += sy; }
    cells.push(y * W + x);
  }
  return cells;
}

/** Asymmetric bend trains with changing wavelength and quiet connectors. */
function windingPath(a: number, b: number, random: () => number, scale: number, spacingScale = scale): number[] {
  const from = point(a), to = point(b), dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
  if (length < 3) return [a, b];
  const knots = [{ along: 0, offset: 0 }];
  let along = Math.min(2, length * .1), side = random() < .5 ? -1 : 1;
  knots.push({ along, offset: 0 });
  while (along < length - 3) {
    along = Math.min(length - 1.5, along + spacingScale * (1.8 + random() * 1.8));
    const taper = Math.min(1, along / 5, (length - along) / 5);
    const quiet = knots.length > 2 && Math.abs(knots[knots.length - 1].offset) > scale * .3 && random() < .24;
    knots.push({ along, offset: side * scale * (.65 + random() * .6) * taper * (quiet ? .12 : 1) });
    if (quiet && along + 3 < length - 2) {
      along += 2 + random() * 2; knots.push({ along, offset: knots[knots.length - 1].offset });
    }
    side *= -1;
  }
  knots.push({ along: length, offset: 0 });
  const path: number[] = [a]; let segment = 0;
  for (let s = .35; s < length; s += .35) {
    while (segment + 1 < knots.length - 1 && s > knots[segment + 1].along) segment++;
    const k0 = knots[segment], k1 = knots[segment + 1], t = (s - k0.along) / (k1.along - k0.along);
    const ease = t * t * (3 - 2 * t), offset = k0.offset + (k1.offset - k0.offset) * ease;
    const cell = cellAt(from.x + dx * s / length + nx * offset, from.y + dy * s / length + ny * offset);
    if (cell !== path[path.length - 1]) path.push(cell);
  }
  if (path[path.length - 1] !== b) path.push(b); return path;
}

export function createRiverDesignModel(overrides: Partial<RiverDesignParameters> = {}): RiverDesignModel {
  const parameters = { ...DEFAULT_RIVER_DESIGN, ...overrides };
  parameters.density = clamp(Number.isFinite(parameters.density) ? parameters.density : 1, .4, 2);
  parameters.rainfall = clamp(Number.isFinite(parameters.rainfall) ? parameters.rainfall : 1, .2, 2.5);
  parameters.fordSpacing = clamp(Number.isFinite(parameters.fordSpacing) ? parameters.fordSpacing : 8, 4, 18);
  const random = randomStream(parameters.seed), phase = random() * Math.PI * 2, rainPhase = random() * Math.PI * 2;
  const count = W * H, receiver = new Int32Array(count).fill(-1), skeleton = new Uint8Array(count);
  const seaMask = new Uint8Array(count), localRunoff = new Float32Array(count);
  // This field deliberately does not depend on density: adding tributaries
  // redistributes an unchanged basin's rainfall rather than creating water.
  for (let cell = 0; cell < count; cell++) {
    const { x, y } = point(cell);
    if (y >= SEA_Y) seaMask[cell] = 1;
    else localRunoff[cell] = parameters.rainfall * (.7 + .25 * (2 + Math.sin(x * .08 + rainPhase) + Math.cos(y * .11 - rainPhase)) / 4);
  }
  const trunkWaypoints = windingPath(cellAt(46 + Math.sin(phase) * 5, 4), cellAt(48 + Math.cos(phase) * 6, SEA_Y - 1), random, 8.5, 5);
  const trunk: number[] = [];
  for (let n = 1; n < trunkWaypoints.length; n++) trunk.push(...line(trunkWaypoints[n - 1], trunkWaypoints[n]).slice(n === 1 ? 0 : 1));
  trunk.forEach((cell, n) => { skeleton[cell] = 1; receiver[cell] = trunk[n + 1] ?? -1; });
  const mouth = point(trunk[trunk.length - 1]);
  // Every new branch attaches to an already-draining branch. Encountering an
  // earlier branch produces a real junction, never two overlapping fake lines.
  function addBranch(waypoints: number[]): number[] {
    const path: number[] = [];
    for (let n = 1; n < waypoints.length; n++) path.push(...line(waypoints[n - 1], waypoints[n]).slice(n === 1 ? 0 : 1));
    const clean: number[] = [], index = new Map<number, number>();
    for (const cell of path) {
      const old = index.get(cell);
      if (old !== undefined) { for (const removed of clean.splice(old + 1)) index.delete(removed); }
      else { index.set(cell, clean.length); clean.push(cell); }
    }
    if (!clean.length || skeleton[clean[0]]) return [];
    let end = -1;
    for (let n = 0; n < clean.length; n++) {
      if (skeleton[clean[n]]) { end = n; break; }
      if (n + 1 >= clean.length) continue;
      const a = point(clean[n]), b = point(clean[n + 1]);
      if (a.x !== b.x && a.y !== b.y) {
        const oppositeA = a.y * W + b.x, oppositeB = b.y * W + a.x;
        if (skeleton[oppositeA] && skeleton[oppositeB]
          && (receiver[oppositeA] === oppositeB || receiver[oppositeB] === oppositeA)) {
          clean.splice(n + 1, clean.length - n - 1, oppositeA); end = n + 1; break;
        }
      }
    }
    if (end < 1) return [];
    const branch = clean.slice(0, end + 1);
    for (let n = 0; n < branch.length - 1; n++) { skeleton[branch[n]] = 1; receiver[branch[n]] = branch[n + 1]; }
    return branch;
  }
  const tributaryCount = Math.round(clamp(12 * Math.pow(parameters.density, .45), 8, 16));
  let tributaries = 0;
  for (let n = 0; n < tributaryCount; n++) {
    const left = n % 2 === 0, sign = left ? -1 : 1;
    const joinY = Math.round(clamp(11 + n / Math.max(1, tributaryCount - 1) * 51 + (random() - .5) * 4, 9, 65));
    const target = trunk.reduce((best, cell) => Math.abs(point(cell).y - joinY) < Math.abs(point(best).y - joinY) ? cell : best, trunk[0]);
    const sourceX = left ? 5 + random() * 9 : W - 6 - random() * 9;
    const sourceY = clamp(joinY - 4 - random() * 11, 2, SEA_Y - 5);
    const branch = addBranch(windingPath(cellAt(sourceX, sourceY), target, random, 2.1 + random() * 1.25));
    if (!branch.length) continue;
    tributaries++;
    // Unequal forks on the tributaries, rather than parallel teeth on a trunk.
    const forks = n % 2 === 0 ? 2 : 1;
    for (let fork = 0; fork < forks; fork++) {
      const fraction = fork ? .65 + random() * .12 : .28 + random() * .15;
      const junction = branch[Math.floor((branch.length - 1) * fraction)], p = point(junction);
      const direction = (n + fork) % 3 === 0 ? 1 : -1;
      const tip = cellAt(p.x + sign * (5 + random() * 10), p.y + direction * (5 + random() * 6));
      addBranch(windingPath(tip, junction, random, 1.5 + random() * .8));
    }
  }
  // A correlated valley-cost field steers tiny feeders around local shoulders.
  // Eight-way routing avoids long cardinal source extensions. Positive costs
  // make receivers strictly downhill in routing distance; this is a designed
  // valley field, not a physical erosion solver.
  const distance = new Float64Array(count).fill(Infinity), cost = new Float32Array(count);
  for (let cell = 0; cell < count; cell++) {
    const { x, y } = point(cell);
    const valley = Math.sin(x * .31 + Math.sin(y * .21 + phase) * 1.7 + phase)
      + Math.cos(y * .39 + Math.sin(x * .17 - phase) * 1.4 - phase);
    cost[cell] = Math.exp(valley * 1.45);
  }
  const heap: { cell: number; distance: number }[] = [];
  function push(cell: number, value: number): void {
    const entry = { cell, distance: value }; let at = heap.length; heap.push(entry);
    while (at > 0) { const parent = (at - 1) >> 1; if (heap[parent].distance <= value) break; heap[at] = heap[parent]; at = parent; }
    heap[at] = entry;
  }
  function pop(): { cell: number; distance: number } {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) { let at = 0;
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].distance < heap[child].distance) child++;
        if (heap[child].distance >= last.distance) break;
        heap[at] = heap[child]; at = child;
      }
      heap[at] = last;
    }
    return first;
  }
  for (let cell = 0; cell < count; cell++) if (skeleton[cell]) { distance[cell] = 0; push(cell, 0); }
  while (heap.length) {
    const current = pop(); if (current.distance !== distance[current.cell]) continue;
    const p = point(current.cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = p.x + dx, y = p.y + dy, next = y * W + x;
      if ((!dx && !dy) || x < 0 || x >= W || y < 0 || y >= SEA_Y || skeleton[next]) continue;
      if (dx && dy) {
        const a = p.y * W + x, b = y * W + p.x;
        if (receiver[a] === b || receiver[b] === a) continue;
      }
      const value = current.distance + (cost[current.cell] + cost[next]) * (dx && dy ? Math.SQRT1_2 : .5);
      if (value >= distance[next]) continue;
      distance[next] = value; receiver[next] = current.cell; push(next, value);
    }
  }
  // A designed arm can already collect substantial hillslope runoff at its
  // first cell. Follow its real receiver tree uphill to a leaf so the visible
  // head is a genuine small source, rather than forcing its discharge/width.
  const catchmentParents: number[][] = Array.from({ length: count }, () => []), skeletonIncoming = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) if (receiver[cell] >= 0) {
    catchmentParents[receiver[cell]].push(cell);
    if (skeleton[cell]) skeletonIncoming[receiver[cell]]++;
  }
  const originalHeads: number[] = [];
  for (let cell = 0; cell < count; cell++) if (skeleton[cell] && !skeletonIncoming[cell]) originalHeads.push(cell);
  const uphillLength = new Int16Array(count).fill(-1);
  function longestUphill(cell: number): number {
    if (uphillLength[cell] >= 0) return uphillLength[cell];
    let length = 0;
    for (const parent of catchmentParents[cell]) length = Math.max(length, 1 + longestUphill(parent));
    return uphillLength[cell] = length;
  }
  for (const head of originalHeads) {
    let cell = head;
    while (catchmentParents[cell].length) {
      cell = catchmentParents[cell].reduce((best, parent) => longestUphill(parent) > longestUphill(best) ? parent : best);
      skeleton[cell] = 1;
    }
  }
  const incoming = new Int32Array(count), parents: number[][] = Array.from({ length: count }, () => []);
  for (let cell = 0; cell < count; cell++) if (receiver[cell] >= 0) {
    incoming[receiver[cell]]++;
    if (skeleton[cell]) parents[receiver[cell]].push(cell);
  }
  const order: number[] = [];
  for (let cell = 0; cell < count; cell++) if (!incoming[cell]) order.push(cell);
  const exactFlow = Float64Array.from(localRunoff), streamOrder = new Uint8Array(count);
  for (let n = 0; n < order.length; n++) {
    const cell = order[n], next = receiver[cell];
    if (skeleton[cell]) {
      const maximum = Math.max(0, ...parents[cell].map(parent => streamOrder[parent]));
      streamOrder[cell] = maximum ? maximum + (parents[cell].filter(parent => streamOrder[parent] === maximum).length > 1 ? 1 : 0) : 1;
    }
    if (next >= 0) { exactFlow[next] += exactFlow[cell]; if (--incoming[next] === 0) order.push(next); }
  }
  if (order.length !== count) throw new Error('Illustrative watershed contains a drainage cycle.');
  const flow = Float32Array.from(exactFlow), elevation = new Float32Array(count);
  for (let n = order.length - 1; n >= 0; n--) {
    const cell = order[n], next = receiver[cell];
    if (next >= 0) elevation[cell] = elevation[next] + (skeleton[cell] ? .0035 : .007);
  }
  const channel = new Uint8Array(count), widthTiles = new Float32Array(count), waterMask = seaMask.slice();
  const classCounts = [0, 0, 0, 0];
  for (let cell = 0; cell < count; cell++) {
    if (!skeleton[cell]) { classCounts[0]++; continue; }
    const q = flow[cell]; channel[cell] = q < THRESHOLDS.river ? 1 : q < THRESHOLDS.main ? 2 : 3;
    widthTiles[cell] = channel[cell] === 1 ? .125 + .3125 * Math.sqrt(q / THRESHOLDS.river)
      : channel[cell] === 2 ? 1 : Math.min(5, 2 * Math.sqrt(q / THRESHOLDS.main));
    classCounts[channel[cell]]++;
    if (channel[cell] === 1) continue;
    waterMask[cell] = 1;
    if (channel[cell] === 2) continue;
    const p = point(cell), radius = widthTiles[cell] / 2;
    for (let y = Math.max(0, Math.floor(p.y - radius)); y <= Math.min(H - 1, Math.ceil(p.y + radius)); y++)
      for (let x = Math.max(0, Math.floor(p.x - radius)); x <= Math.min(W - 1, Math.ceil(p.x + radius)); x++)
        if (Math.hypot(x - p.x, y - p.y) <= radius) waterMask[y * W + x] = 1;
  }
  const fordMask = new Uint8Array(count), crossings: RiverCrossing[] = [];
  function crossingAt(cell: number): RiverCrossing | undefined {
    const next = receiver[cell]; if (next < 0 || parents[cell].length > 1) return;
    const p = point(cell), to = point(next), previous = parents[cell].length ? point(parents[cell][0]) : p;
    const dx = to.x - previous.x, dy = to.y - previous.y;
    const axis = Math.abs(dx) >= Math.abs(dy) ? 'vertical' : 'horizontal';
    const step = axis === 'horizontal' ? 1 : W, cells = [cell], banks: RiverPoint[] = [];
    for (const sign of [-1, 1]) {
      let found = false;
      for (let reach = 1; reach <= 8; reach++) {
        const at = cell + step * sign * reach, q = point(at);
        if (at < 0 || at >= count || seaMask[at] || (axis === 'horizontal' && q.y !== p.y)) return;
        if (!waterMask[at]) { banks.push(q); found = true; break; }
        if (channel[at] && parents[at].length > 1) return;
        cells.push(at);
      }
      if (!found) return;
    }
    if (cells.length > 8 || cells.some(at => fordMask[at])) return;
    return { ...p, kind: channel[cell] === 1 ? 'stream' : 'ford', axis, cells, banks: banks as [RiverPoint, RiverPoint] };
  }
  function installFord(cell: number): boolean {
    const crossing = crossingAt(cell); if (!crossing || crossing.kind !== 'ford') return false;
    // Broad main rivers require a bridge. Only an unusually narrow main-reach
    // section may have a natural ford in this design study.
    if (crossing.cells.some(wet => channel[wet] === 3 && (widthTiles[wet] > 2.5 || crossing.cells.length > 3))) return false;
    for (const wet of crossing.cells) fordMask[wet] = 1;
    crossings.push(crossing); return true;
  }
  const reaches: number[][] = [];
  for (let cell = 0; cell < count; cell++) if (channel[cell] === 2
    && (parents[cell].length !== 1 || channel[parents[cell][0]] !== 2)) {
    const reach = [cell]; let next = receiver[cell];
    while (next >= 0 && channel[next] === 2 && parents[next].length === 1) { reach.push(next); next = receiver[next]; }
    reaches.push(reach);
  }
  let longestFordGap = 0, fordGaps = 0;
  for (const reach of reaches) {
    const selected: number[] = [];
    const spacing = Math.round(parameters.fordSpacing), start = Math.max(1, Math.min(spacing - 2, Math.floor(reach.length / 2)));
    for (let n = start; n < reach.length - 1; n += spacing) {
      for (const shift of [0, -1, 1, -2, 2]) {
        const at = n + shift;
        if (at < 1 || at >= reach.length - 1 || selected.some(old => Math.abs(old - at) < Math.max(3, spacing - 3))) continue;
        if (installFord(reach[at])) { selected.push(at); break; }
      }
    }
    const markers = [0, ...selected.sort((a, b) => a - b), reach.length - 1];
    let gap = 0; for (let n = 1; n < markers.length; n++) gap = Math.max(gap, markers[n] - markers[n - 1]);
    longestFordGap = Math.max(longestFordGap, gap);
    if (gap > spacing + 3) fordGaps++;
  }
  // Wide crossings are scarce and measured along the dominant channel through
  // its junctions, not restarted on every short confluence-to-confluence reach.
  const mainPath: number[] = []; let upstream = mouth.cell;
  while (upstream >= 0) {
    if (channel[upstream] === 3) mainPath.push(upstream);
    upstream = parents[upstream].reduce((best, parent) => best < 0 || flow[parent] > flow[best] ? parent : best, -1);
  }
  mainPath.reverse(); const mainSpacing = Math.max(22, Math.round(parameters.fordSpacing * 3));
  for (let n = Math.floor(mainSpacing * .6); n < mainPath.length - 5; n += mainSpacing)
    for (const shift of [0, -1, 1, -2, 2, -3, 3]) if (n + shift >= 2 && n + shift < mainPath.length - 3 && installFord(mainPath[n + shift])) break;
  const sources = Array.from({ length: count }, (_, cell) => cell).filter(cell => skeleton[cell] && !parents[cell].length).map(point);
  for (const source of sources.filter((_, n) => n % 4 === 0)) {
    let cell = source.cell;
    for (let step = 0; step < 3 && channel[receiver[cell]] === 1; step++) cell = receiver[cell];
    if (channel[cell] === 1) { const crossing = crossingAt(cell); if (crossing) crossings.push(crossing); }
  }
  const inputFlow = localRunoff.reduce((sum, q) => sum + q, 0), mouthFlow = exactFlow[mouth.cell];
  return { width: W, height: H, parameters, receiver, flow, localRunoff, elevation, streamOrder, channel, widthTiles,
    waterMask, fordMask, seaMask, sources, mouth, crossings, thresholds: { ...THRESHOLDS }, diagnostics: {
      heads: sources.length, tributaries, confluences: parents.filter(p => p.length > 1).length, inputFlow, mouthFlow,
      massBalanceError: Math.abs(inputFlow - mouthFlow), maxWidth: Math.max(...widthTiles), classCounts,
      coveredCells: waterMask.reduce((sum, wet, cell) => sum + (wet && !seaMask[cell] ? 1 : 0), 0),
      fordCount: crossings.filter(c => c.kind === 'ford').length, longestFordGap, fordGaps, reaches: reaches.length,
    } };
}
