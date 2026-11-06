import { WATER, type Tile } from '../game/types';

const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
export interface Drainage { directions: Int32Array; flow: Float64Array; order: number[] }

/** Priority flooding resolves depressions at their lowest spillway. Each parent
 * is visited first, so even a flat lake has an acyclic route to the sea. Unlike
 * a least-cost path through noise, this surface never sends water uphill. */
export function buildDrainage(tiles: Tile[], width: number, height: number, followChannels = false): Drainage {
  const directions = new Int32Array(tiles.length).fill(-1), visited = new Uint8Array(tiles.length);
  const connectedWater = new Uint8Array(tiles.length), coast: number[] = [];
  if (followChannels) {
    for (let cell = 0; cell < tiles.length; cell++) if (tiles[cell].terrain === 'ocean' || tiles[cell].terrain === 'coast') {
      connectedWater[cell] = 1; coast.push(cell);
    }
    for (let n = 0; n < coast.length; n++) {
      const cell = coast[n], x = cell % width, y = Math.floor(cell / width);
      for (const [dx, dy] of CARDINAL) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || connectedWater[next] || !WATER.has(tiles[next].terrain)) continue;
        connectedWater[next] = 1; coast.push(next);
      }
    }
  }
  const heap: { cell: number; height: number }[] = [], order: number[] = [];
  const push = (cell: number) => {
    const node = { cell, height: tiles[cell].elevation }; let n = heap.length; heap.push(node);
    while (n) { const parent = (n - 1) >> 1;
      if (heap[parent].height < node.height || heap[parent].height === node.height && heap[parent].cell < cell) break;
      heap[n] = heap[parent]; n = parent;
    }
    heap[n] = node;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) { let n = 0;
      while (n * 2 + 1 < heap.length) { let child = n * 2 + 1;
        if (child + 1 < heap.length && (heap[child + 1].height < heap[child].height
          || heap[child + 1].height === heap[child].height && heap[child + 1].cell < heap[child].cell)) child++;
        if (last.height < heap[child].height || last.height === heap[child].height && last.cell < heap[child].cell) break;
        heap[n] = heap[child]; n = child;
      }
      heap[n] = last;
    }
    return first.cell;
  };
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    if (tile.terrain === 'ocean' || tile.terrain === 'coast') { visited[cell] = 1; push(cell); }
  }
  // Standalone terrain studies may have no sea; their open map rim drains out.
  if (!heap.length) for (let cell = 0; cell < tiles.length; cell++) {
    const x = cell % width, y = Math.floor(cell / width);
    if (!x || !y || x === width - 1 || y === height - 1) { visited[cell] = 1; push(cell); }
  }
  while (heap.length) {
    const cell = pop(), x = cell % width, y = Math.floor(cell / width); order.push(cell);
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || visited[next]) continue;
      // After widening, an established channel keeps its outlet through water;
      // a slightly lower bank pixel must not turn the river back into dry land.
      if (connectedWater[next] && !WATER.has(tiles[cell].terrain)) continue;
      visited[next] = 1; directions[next] = cell;
      // A tiny slope resolves land flats. Lake surfaces remain horizontal.
      const rise = tiles[next].terrain === 'lake' ? 0 : .00001;
      tiles[next].elevation = Math.max(tiles[next].elevation, tiles[cell].elevation + rise);
      push(next);
    }
  }
  // Treat each connected lake as one level reservoir and one spillway. Route
  // its interior to the earliest outlet; that outlet cannot lead back into it.
  const rank = new Int32Array(tiles.length), lakeSeen = new Uint8Array(tiles.length);
  order.forEach((cell, n) => { rank[cell] = n; });
  for (let start = 0; start < tiles.length; start++) {
    if (tiles[start].terrain !== 'lake' || lakeSeen[start]) continue;
    const cells = [start]; lakeSeen[start] = 1;
    let outlet = -1, first = Infinity, level = -Infinity;
    for (let n = 0; n < cells.length; n++) {
      const cell = cells[n], x = cell % width, y = Math.floor(cell / width), next = directions[cell];
      level = Math.max(level, tiles[cell].elevation);
      if (next >= 0 && tiles[next].terrain !== 'lake' && rank[next] < first) { first = rank[next]; outlet = cell; }
      for (const [dx, dy] of CARDINAL) {
        const nx = x + dx, ny = y + dy, adjacent = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || lakeSeen[adjacent] || tiles[adjacent].terrain !== 'lake') continue;
        lakeSeen[adjacent] = 1; cells.push(adjacent);
      }
    }
    if (outlet < 0) continue;
    const queued = new Set([outlet]), queue = [outlet];
    for (let n = 0; n < queue.length; n++) {
      const cell = queue[n], x = cell % width, y = Math.floor(cell / width);
      tiles[cell].elevation = level;
      for (const [dx, dy] of CARDINAL) {
        const nx = x + dx, ny = y + dy, adjacent = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || queued.has(adjacent) || tiles[adjacent].terrain !== 'lake') continue;
        queued.add(adjacent); queue.push(adjacent); directions[adjacent] = cell;
      }
    }
  }
  const flow = new Float64Array(tiles.length), upstream = new Uint8Array(tiles.length);
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    flow[cell] = tile.terrain === 'coast' || tile.terrain === 'ocean' ? 0
      : .15 + (tile.rainfall ?? tile.moisture) * .85;
    if (directions[cell] >= 0) upstream[directions[cell]]++;
  }
  const leaves: number[] = [];
  for (let cell = 0; cell < tiles.length; cell++) if (!upstream[cell]) leaves.push(cell);
  for (let n = 0; n < leaves.length; n++) {
    const cell = leaves[n], downstream = directions[cell];
    if (downstream >= 0) {
      flow[downstream] += flow[cell];
      if (--upstream[downstream] === 0) leaves.push(downstream);
    }
  }
  // Flattening a reservoir can slightly raise its shoreline. Propagate that
  // change upstream in drainage order so no incoming edge becomes uphill.
  for (let n = leaves.length - 1; n >= 0; n--) {
    const cell = leaves[n], downstream = directions[cell];
    if (downstream >= 0) tiles[cell].elevation = Math.max(tiles[cell].elevation,
      tiles[downstream].elevation + (tiles[cell].terrain === 'lake' ? 0 : .00001));
  }
  for (let cell = 0; cell < tiles.length; cell++) {
    tiles[cell].drainage = directions[cell]; tiles[cell].flow = flow[cell];
  }
  return { directions, flow, order };
}

/** River cross-sections respond to accumulated runoff, including every joining
 * tributary. The cap keeps the existing ford/bridge mechanics viable. */
export function riverRadius(flow: number, widthScale = 1): number {
  return Math.min(2.7, .8 + Math.log1p(Math.max(0, flow) / 9) * .34) * widthScale;
}
