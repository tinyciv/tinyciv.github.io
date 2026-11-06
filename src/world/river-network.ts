import { createNoise2D } from 'simplex-noise';
import { WATER, type Tile, type World } from '../game/types';
import { buildDrainage, type Drainage } from './hydrology';
import { environmentRandom } from './environment-fields';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';

const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
export const RIVER_DISCHARGE = { tributary: 36, main: 200 } as const;
export interface RiverNetwork {
  directions: Int32Array;
  flow: Float64Array;
  channel: Uint8Array;
  widthTiles: Float32Array;
  sources: number[];
  paths: number[][];
  waterCells: number[];
  cutCells: number[];
  diagnostics: { tributaries: number; main: number; sources: number; confluences: number; catchments: number };
}

function adjacent(cell: number, width: number, height: number, visit: (next: number) => void): void {
  const x = cell % width, y = Math.floor(cell / width);
  for (const [dx, dy] of CARDINAL) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height) visit(ny * width + nx);
  }
}
const sea = (tile: Tile) => tile.terrain === 'ocean' || tile.terrain === 'coast';

/** Retain broad geology while allowing rivers to incise the native ledge
 * footprint. Sampling a warped, smoothed surface produces changing valley
 * directions instead of routing around every individual ridge tile. */
function planningSurface(world: World, parameters: LandscapeParameters): Tile[] {
  const { tiles, width, height } = world;
  const noise = createNoise2D(environmentRandom(`${world.seed}:river-valleys`));
  const raw = Float64Array.from(tiles, tile => tile.elevation);
  const smooth = new Float64Array(tiles.length), radius = 4;
  const summed = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y + 1) * (width + 1) + x + 1;
    summed[i] = raw[y * width + x] + summed[i - 1] + summed[i - width - 1] - summed[i - width - 2];
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    smooth[y * width + x] = (summed[y1 * (width + 1) + x1] - summed[y0 * (width + 1) + x1]
      - summed[y1 * (width + 1) + x0] + summed[y0 * (width + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  }
  const sample = (x: number, y: number) => {
    x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    return (smooth[y0 * width + x0] * (1 - fx) + smooth[y0 * width + x1] * fx) * (1 - fy)
      + (smooth[y1 * width + x0] * (1 - fx) + smooth[y1 * width + x1] * fx) * fy;
  };
  return tiles.map((tile, cell) => {
    if (sea(tile)) return { ...tile, elevation: 0 };
    const x = cell % width, y = Math.floor(cell / width), meander = parameters.riverMeander;
    const wx = x + noise(x * .045 + 19, y * .045 - 33) * 7 * meander;
    const wy = y + noise(x * .045 - 72, y * .045 + 45) * 7 * meander;
    const shoulder = noise(wx * .095 + 133, wy * .095 - 77) * .048 * meander;
    const elevation = Math.max(.015, sample(wx, wy) * .65 + shoulder);
    return { ...tile, elevation };
  });
}

/** Resolve depressions first, then follow a continuous resistance field on
 * that surface. This removes the long row/column tie-breaks of flat priority
 * floods. Lakes are contracted to one reservoir when its cheapest outlet is
 * reached, so its interior cannot acquire competing spillways. */
function windingDrainage(tiles: Tile[], width: number, height: number, seed: string, meander: number): Drainage {
  buildDrainage(tiles, width, height);
  const count = tiles.length, directions = new Int32Array(count).fill(-1);
  const distance = new Float64Array(count).fill(Infinity), expanded = new Uint8Array(count);
  const noise = createNoise2D(environmentRandom(`${seed}:river-route-resistance`)), cost = new Float64Array(count);
  const lakeGroup = new Int32Array(count).fill(-1), lakes: number[][] = [];
  for (let cell = 0; cell < count; cell++) {
    const x = cell % width, y = Math.floor(cell / width);
    const wx = x + noise(x * .049 + 81, y * .049 - 31) * 5;
    const wy = y + noise(x * .049 - 54, y * .049 + 92) * 5;
    cost[cell] = .25 + Math.exp(noise(wx * .12 + 37, wy * .12 - 64) * 3.4 * meander);
    if (tiles[cell].terrain !== 'lake' || lakeGroup[cell] >= 0) continue;
    const group = lakes.length, cells = [cell]; lakeGroup[cell] = group;
    for (let n = 0; n < cells.length; n++) adjacent(cells[n], width, height, next => {
      if (tiles[next].terrain === 'lake' && lakeGroup[next] < 0) { lakeGroup[next] = group; cells.push(next); }
    });
    lakes.push(cells);
  }
  const openLake = new Uint8Array(lakes.length), heap: { cell: number; value: number }[] = [];
  function push(cell: number, value: number): void {
    const entry = { cell, value }; let at = heap.length; heap.push(entry);
    while (at > 0) { const parent = (at - 1) >> 1; if (heap[parent].value <= value) break; heap[at] = heap[parent]; at = parent; }
    heap[at] = entry;
  }
  function pop(): { cell: number; value: number } {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) { let at = 0;
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].value < heap[child].value) child++;
        if (heap[child].value >= last.value) break;
        heap[at] = heap[child]; at = child;
      }
      heap[at] = last;
    }
    return first;
  }
  for (let cell = 0; cell < count; cell++) if (sea(tiles[cell])) { distance[cell] = 0; push(cell, 0); }
  if (!heap.length) for (let cell = 0; cell < count; cell++) {
    const x = cell % width, y = Math.floor(cell / width);
    if (!x || !y || x === width - 1 || y === height - 1) { distance[cell] = 0; push(cell, 0); }
  }
  while (heap.length) {
    const { cell, value } = pop();
    if (value !== distance[cell] || expanded[cell]) continue;
    const group = lakeGroup[cell];
    if (group >= 0 && !openLake[group]) {
      openLake[group] = 1;
      const queue = [cell], seen = new Set(queue);
      for (let n = 0; n < queue.length; n++) adjacent(queue[n], width, height, next => {
        if (lakeGroup[next] !== group || seen.has(next)) return;
        seen.add(next); queue.push(next); directions[next] = queue[n]; distance[next] = value; push(next, value);
      });
    }
    expanded[cell] = 1;
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height || expanded[next] || sea(tiles[next])) continue;
      if (lakeGroup[next] >= 0 && openLake[lakeGroup[next]]) continue;
      // A compact reservoir is a local basin, not a cheap shortcut for the
      // entire watershed. Route the main drainage around it; small inlets are
      // attached below after their catchment discharge is known.
      if (lakeGroup[cell] >= 0 && lakeGroup[next] < 0) continue;
      if (dx && dy) {
        // Never cross another diagonal receiver without a real confluence.
        const a = y * width + nx, b = ny * width + x;
        if (directions[a] === b || directions[b] === a) continue;
        // Reservoir shore crossings are cardinal; this preserves a complete
        // connected water outlet in the full-tile rendering and movement mask.
        if (tiles[cell].terrain === 'lake' || tiles[next].terrain === 'lake') continue;
      }
      const ascent = Math.max(0, tiles[cell].elevation - tiles[next].elevation);
      const step = ((cost[cell] + cost[next]) * .5 + ascent * 160) * (dx && dy ? Math.SQRT2 : 1);
      const candidate = value + step;
      if (candidate >= distance[next]) continue;
      distance[next] = candidate; directions[next] = cell; push(next, candidate);
    }
  }
  for (let cell = 0; cell < count; cell++) tiles[cell].drainage = directions[cell];
  const order = graphOrder(tiles), flow = Float64Array.from(tiles, tile => sea(tile) ? 0 : .15 + (tile.rainfall ?? tile.moisture) * .85);
  for (const cell of order) {
    const next = directions[cell]; if (next >= 0) flow[next] += flow[cell];
  }
  for (const lake of lakes) {
    const outlet = lake.find(cell => directions[cell] >= 0 && lakeGroup[directions[cell]] !== lakeGroup[cell]);
    if (outlet === undefined) continue;
    const outletPath = new Set<number>();
    for (let at = outlet; at >= 0; at = directions[at]) outletPath.add(at);
    const maximumInlet = RIVER_DISCHARGE.main * .7 - flow[outlet];
    let inlet = -1, shore = -1, largest = 0;
    for (const cell of lake) adjacent(cell, width, height, next => {
      if (sea(tiles[next]) || lakeGroup[next] >= 0 || outletPath.has(next)
        || flow[next] < RIVER_DISCHARGE.tributary || flow[next] > maximumInlet || flow[next] <= largest) return;
      inlet = next; shore = cell; largest = flow[next];
    });
    // At most one modest feeder joins each lake, leaving room for local runoff.
    // Its downstream path cannot lead back to the inlet, so no cycle is added.
    if (inlet >= 0) { directions[inlet] = shore; tiles[inlet].drainage = shore; }
  }
  const finalOrder = graphOrder(tiles), finalFlow = Float64Array.from(tiles,
    tile => sea(tile) ? 0 : .15 + (tile.rainfall ?? tile.moisture) * .85);
  for (const cell of finalOrder) {
    const next = directions[cell]; if (next >= 0) finalFlow[next] += finalFlow[cell];
  }
  return { directions, flow: finalFlow, order: finalOrder };
}

function graphOrder(tiles: Tile[]): number[] {
  const incoming = new Uint8Array(tiles.length), queue: number[] = [];
  for (const tile of tiles) if ((tile.drainage ?? -1) >= 0) incoming[tile.drainage!]++;
  for (let cell = 0; cell < tiles.length; cell++) if (!incoming[cell]) queue.push(cell);
  for (let n = 0; n < queue.length; n++) {
    const next = tiles[queue[n]].drainage ?? -1;
    if (next >= 0 && --incoming[next] === 0) queue.push(next);
  }
  if (queue.length !== tiles.length) throw new Error('River network contains a receiver cycle.');
  return queue;
}

/** Reaccumulate the retained graph; never reroute a visible river through a
 * dry neighboring cell merely because its bank is slightly lower. */
export function refreshRiverRunoff(world: World): Float64Array {
  const { tiles } = world, flow = Float64Array.from(tiles, tile => sea(tile) ? 0 : .15 + (tile.rainfall ?? tile.moisture) * .85);
  const order = graphOrder(tiles);
  for (const cell of order) {
    const next = tiles[cell].drainage ?? -1;
    if (next >= 0) flow[next] += flow[cell];
  }
  for (let cell = 0; cell < tiles.length; cell++) tiles[cell].flow = flow[cell];
  return flow;
}

/** Native canyon contours may raise or lower dry bank cells after routing.
 * Repair their downhill elevation profile without lifting the incised channel
 * bed. Flow and centerline geometry are unchanged. */
export function repairRiverDrainage(world: World): number {
  const { tiles } = world, order = graphOrder(tiles); let changed = 0;
  for (let n = order.length - 1; n >= 0; n--) {
    const cell = order[n], tile = tiles[cell], next = tile.drainage ?? -1;
    if (next < 0 || tile.channel || WATER.has(tile.terrain)) continue;
    const floor = tiles[next].elevation + .00001;
    if (tile.elevation < floor) { tile.elevation = floor; changed++; }
  }
  return changed;
}

/** Build the channel tree after the authored landforms. Sources are tributary
 * leaves of real catchments, never independently drawn rivers or comb teeth. */
export function generateRiverNetwork(world: World, parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): RiverNetwork {
  const { tiles, width, height } = world, count = tiles.length;
  const originalRelief = Uint8Array.from(tiles, tile => Number(!!tile.ridge || !!tile.relief));
  const virtual = planningSurface(world, parameters), drainage = windingDrainage(virtual, width, height, world.seed, parameters.riverMeander);
  const parents: number[][] = Array.from({ length: count }, () => []);
  for (let cell = 0; cell < count; cell++) {
    tiles[cell].drainage = drainage.directions[cell]; tiles[cell].flow = drainage.flow[cell];
    delete tiles[cell].channel; delete tiles[cell].channelWidth; delete tiles[cell].channelNext;
    const next = drainage.directions[cell]; if (next >= 0) parents[next].push(cell);
  }
  const candidates = tiles.map((tile, cell) => ({ cell, flow: drainage.flow[cell] }))
    .filter(({ cell, flow }) => !sea(tiles[cell]) && drainage.directions[cell] >= 0
      && sea(tiles[drainage.directions[cell]]) && flow >= 24)
    .sort((a, b) => b.flow - a.flow);
  const landCount = tiles.reduce((sum, tile) => sum + Number(!sea(tile)), 0);
  // Development maps reserve the same eleven starting settlements in much
  // less land. Scale their watershed count; normal-sized worlds are unchanged.
  const developmentScale = Math.min(width, height) < 128 ? Math.min(1, width * height / (128 * 128)) : 1;
  const target = Math.max(2, Math.round(parameters.riverCount * Math.min(1, landCount / 7000) * developmentScale));
  const selected = new Uint8Array(count), watershedRoots: number[] = [];
  for (const { cell } of candidates) {
    if (watershedRoots.length >= target) break;
    const near = watershedRoots.some(other => Math.hypot(other % width - cell % width,
      Math.floor(other / width) - Math.floor(cell / width)) < 9);
    if (near && watershedRoots.length > 1) continue;
    watershedRoots.push(cell);
    const queue = [cell]; selected[cell] = 1;
    for (let n = 0; n < queue.length; n++) for (const parent of parents[queue[n]]) if (!selected[parent]) {
      selected[parent] = 1; queue.push(parent);
    }
  }
  // Hillslope runoff stays implicit. Visible channels begin only once enough
  // discharge has accumulated for a full one-tile river.
  const skeleton = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) if (selected[cell] && drainage.flow[cell] >= RIVER_DISCHARGE.tributary
    && !sea(tiles[cell])) skeleton[cell] = 1;
  // Every reservoir keeps its one real outlet, including lakes outside the
  // selected major catchments. Marking a lake never replaces its terrain.
  for (let cell = 0; cell < count; cell++) if (tiles[cell].terrain === 'lake') {
    let at = cell;
    while (at >= 0 && !sea(tiles[at]) && !skeleton[at]) { skeleton[at] = 1; at = drainage.directions[at]; }
  }
  const leafOrder = graphOrder(tiles);
  // Carve the connected bed before deriving canyon ledges. A downstream cap
  // propagates any incision through the outlet, including level lake interiors.
  const bed = Float64Array.from(virtual, tile => tile.elevation);
  for (const cell of leafOrder) {
    if (!skeleton[cell] && tiles[cell].terrain !== 'lake') continue;
    bed[cell] = Math.min(bed[cell], tiles[cell].elevation);
    const next = drainage.directions[cell];
    if (next >= 0 && !sea(tiles[next])) bed[next] = Math.min(bed[next], bed[cell] - (tiles[cell].terrain === 'lake' ? 0 : .00001));
  }
  // A reservoir is one surface even if its incoming branch incises one bank.
  const lakeSeen = new Uint8Array(count);
  for (let start = 0; start < count; start++) if (tiles[start].terrain === 'lake' && !lakeSeen[start]) {
    const cells = [start]; lakeSeen[start] = 1;
    for (let n = 0; n < cells.length; n++) adjacent(cells[n], width, height, next => {
      if (tiles[next].terrain === 'lake' && !lakeSeen[next]) { lakeSeen[next] = 1; cells.push(next); }
    });
    const level = Math.min(...cells.map(cell => bed[cell]));
    for (const cell of cells) bed[cell] = level;
  }
  for (const cell of leafOrder) {
    const next = drainage.directions[cell];
    if ((skeleton[cell] || tiles[cell].terrain === 'lake') && next >= 0 && !sea(tiles[next]))
      bed[next] = Math.min(bed[next], bed[cell] - (tiles[cell].terrain === 'lake' ? 0 : .00001));
  }
  for (let cell = 0; cell < count; cell++) if (skeleton[cell] || tiles[cell].terrain === 'lake') tiles[cell].elevation = Math.max(.001, bed[cell]);
  const channel = new Uint8Array(count), widthTiles = new Float32Array(count), painted = new Uint8Array(count);
  const lakeMargin = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) if (tiles[cell].terrain === 'lake') {
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) lakeMargin[ny * width + nx] = 1;
    }
  }
  const widthScale = parameters.riverWidth / DEFAULT_LANDSCAPE_PARAMETERS.riverWidth;
  const classify = () => {
    for (let cell = 0; cell < count; cell++) if (skeleton[cell] && tiles[cell].terrain !== 'lake' && !sea(tiles[cell])) {
      const q = tiles[cell].flow ?? 0;
      // The shore connection stays a narrow stream even where it joins a
      // larger channel nearby. Major reaches never begin or end at a lake.
      const kind = q < RIVER_DISCHARGE.main || lakeMargin[cell] ? 2 : 3;
      channel[cell] = kind;
      widthTiles[cell] = kind === 2 ? 1 : Math.max(2, Math.min(4, 2 * Math.sqrt(q / RIVER_DISCHARGE.main) * widthScale));
      tiles[cell].channel = kind === 2 ? 'tributary' : 'main';
      tiles[cell].channelWidth = widthTiles[cell]; tiles[cell].channelNext = drainage.directions[cell];
    }
  };
  classify();
  let paintedCount = 0;
  function paint(cell: number): void {
    if (sea(tiles[cell]) || tiles[cell].terrain === 'lake') return;
    if (!painted[cell]) paintedCount++;
    painted[cell] = 1; tiles[cell].terrain = 'river'; tiles[cell].overlay = 'none';
    delete tiles[cell].palm; delete tiles[cell].beach; delete tiles[cell].fordAxis;
  }
  let flow = drainage.flow;
  for (let pass = 0; pass < 8; pass++) {
    const beforePaint = paintedCount;
    for (let cell = 0; cell < count; cell++) if (channel[cell] >= 2) {
      paint(cell);
      const receiver = drainage.directions[cell];
      if (receiver >= 0 && receiver % width !== cell % width && Math.floor(receiver / width) !== Math.floor(cell / width)) {
        const a = Math.floor(cell / width) * width + receiver % width;
        const b = Math.floor(receiver / width) * width + cell % width;
        const elbow = skeleton[a] ? b : skeleton[b] ? a : virtual[a].elevation <= virtual[b].elevation ? a : b;
        paint(elbow);
      }
      if (channel[cell] === 2) continue;
      // Quantize the bankfull width to 2–4 map cells. Even widths sit halfway
      // between cell centers; a radius2 disk at an integer center was actually
      // five cells wide, despite being labelled as a four-cell channel.
      const diameter = Math.round(widthTiles[cell]), offset = diameter % 2 ? 0 : .5;
      const x = cell % width, y = Math.floor(cell / width), radius = diameter / 2 - .2;
      for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || Math.hypot(dx - offset, dy - offset) > radius) continue;
        const bank = ny * width + nx;
        if (!lakeMargin[bank]) paint(bank);
      }
    }
    // Route newly widened bank cells through water to their fixed spine. All
    // visible centerline receivers stay pinned; the added water cannot drain
    // into dry ground or introduce a receiver cycle.
    const bankDistance = new Int16Array(count).fill(-1), bankQueue: number[] = [];
    for (let cell = 0; cell < count; cell++) if (WATER.has(tiles[cell].terrain) && (!painted[cell] || skeleton[cell])) {
      bankDistance[cell] = 0; bankQueue.push(cell);
    }
    for (let n = 0; n < bankQueue.length; n++) adjacent(bankQueue[n], width, height, next => {
      if (!painted[next] || skeleton[next] || bankDistance[next] >= 0) return;
      bankDistance[next] = bankDistance[bankQueue[n]] + 1;
      tiles[next].drainage = bankQueue[n]; bankQueue.push(next);
      tiles[next].elevation = Math.min(tiles[next].elevation, tiles[bankQueue[n]].elevation + .00001);
    });
    flow = refreshRiverRunoff(world);
    // Reclassify using exact accumulated runoff, then repaint any promotions
    // on the next pass. Widening only grows a connected bankfull envelope.
    classify();
    if (pass > 0 && paintedCount === beforePaint) break;
  }
  const finalOrder = graphOrder(tiles);
  for (let n = finalOrder.length - 1; n >= 0; n--) {
    const cell = finalOrder[n], next = tiles[cell].drainage ?? -1;
    if (next >= 0) tiles[cell].elevation = Math.max(tiles[cell].elevation, tiles[next].elevation + (tiles[cell].terrain === 'lake' ? 0 : .00001));
  }
  const sources = Array.from(channel.keys()).filter(cell => channel[cell] > 0 && !parents[cell].some(parent => channel[parent] > 0));
  const paths: number[][] = [];
  for (const source of sources) {
    const path: number[] = []; let cell = source;
    while (cell >= 0 && !sea(tiles[cell])) { path.push(cell); cell = tiles[cell].channelNext ?? tiles[cell].drainage ?? -1; }
    paths.push(path);
  }
  const waterCells = Array.from(painted.keys()).filter(cell => painted[cell]);
  const cutCells = waterCells.filter(cell => originalRelief[cell]);
  return { directions: Int32Array.from(tiles, tile => tile.drainage ?? -1), flow, channel, widthTiles, sources, paths, waterCells, cutCells,
    diagnostics: { tributaries: channel.filter(kind => kind === 2).length,
      main: channel.filter(kind => kind === 3).length, sources: sources.length,
      confluences: Array.from(channel.keys()).filter(cell => channel[cell] && parents[cell].filter(parent => channel[parent]).length > 1).length,
      catchments: watershedRoots.length } };
}

/** Place crossings independently along each tributary, after canyon banks
 * exist. Broad main rivers remain barriers; short tributaries are not deprived
 * of crossings by an unrelated nearby branch's Euclidean exclusion zone. */
export function placeNetworkFords(world: World): boolean {
  const { tiles, width } = world, parents: number[][] = Array.from({ length: tiles.length }, () => []);
  for (let cell = 0; cell < tiles.length; cell++) {
    const next = tiles[cell].channelNext ?? -1;
    if (tiles[cell].channel && next >= 0) parents[next].push(cell);
  }
  const oldFords = tiles.map(tile => tile.overlay === 'ford' ? tile.fordAxis : undefined);
  for (const tile of tiles) if (tile.terrain === 'river' && tile.overlay === 'ford') { tile.overlay = 'none'; delete tile.fordAxis; }
  const dry = (cell: number) => !!tiles[cell] && !WATER.has(tiles[cell].terrain) && !tiles[cell].ridge && !tiles[cell].stair
    && tiles[cell].overlay !== 'volcano' && tiles[cell].overlay !== 'glacier';
  const install = (cell: number): boolean => {
    const tile = tiles[cell], next = tile.channelNext ?? -1;
    if (next < 0 || parents[cell].length > 1 || tile.terrain !== 'river') return false;
    const previous = parents[cell][0] ?? cell;
    const dx = next % width - previous % width, dy = Math.floor(next / width) - Math.floor(previous / width);
    const axis = Math.abs(dx) >= Math.abs(dy) ? 'vertical' : 'horizontal', step = axis === 'horizontal' ? 1 : width;
    const cells = [cell];
    for (const sign of [-1, 1]) {
      let bank = false;
      for (let distance = 1; distance <= 6; distance++) {
        const at = cell + step * distance * sign;
        if (at < 0 || at >= tiles.length || axis === 'horizontal' && Math.floor(at / width) !== Math.floor(cell / width)) return false;
        if (dry(at)) { bank = true; break; }
        if (tiles[at].terrain !== 'river' || tiles[at].ridge || tiles[at].stair || parents[at].length > 1) return false;
        cells.push(at);
      }
      if (!bank) return false;
    }
    if (cells.length > 4 || cells.some(at => tiles[at].overlay === 'ford'
      || tiles[at].channel === 'main' && (tiles[at].channelWidth! > 2.5 || cells.length > 3))) return false;
    for (const at of cells) { tiles[at].overlay = 'ford'; tiles[at].fordAxis = axis; }
    return true;
  };
  for (let cell = 0; cell < tiles.length; cell++) {
    if (tiles[cell].channel !== 'tributary' || parents[cell].length === 1 && tiles[parents[cell][0]].channel === 'tributary') continue;
    const reach = [cell]; let next = tiles[cell].channelNext ?? -1;
    while (next >= 0 && tiles[next].channel === 'tributary' && parents[next].length === 1) { reach.push(next); next = tiles[next].channelNext ?? -1; }
    const spacing = 7, start = Math.min(4, Math.max(1, Math.floor(reach.length / 2)));
    for (let n = start; n < reach.length; n += spacing) {
      for (const shift of [0, -1, 1, -2, 2]) if (n + shift >= 0 && n + shift < reach.length && install(reach[n + shift])) break;
    }
  }
  return tiles.some((tile, cell) => (tile.overlay === 'ford' ? tile.fordAxis : undefined) !== oldFords[cell]);
}
