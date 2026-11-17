/** Group composition follows docs/relief-art-direction.md. */
import { WATER, type Tile } from './types';

export type ReliefPalette = 'grassland' | 'plains' | 'desert' | 'tundra';
export type ReliefSizeBand = 0 | 1 | 2;
/** Source dimensions are native pixels; placement never stretches a sprite. */
export interface ReliefLayoutSource {
  style: number; slot: number; width: number; height: number; band: ReliefSizeBand;
  rowSpans?: readonly (readonly number[] | null)[];
  opaqueRows?: readonly (readonly (readonly number[])[])[];
}
export interface ReliefStamp {
  x: number; y: number; width: number; height: number; depth: number;
  cell: number; style: number; slot: number; palette: ReliefPalette;
  rangeId?: number; sizeBand?: ReliefSizeBand; rocky?: boolean;
}
type LayoutTile = Pick<Tile, 'terrain' | 'relief' | 'reliefRegion' | 'reliefRuggedness' | 'creek'>;
export interface ReliefLayoutWorld {
  width: number; height: number; seed: string; tiles: readonly LayoutTile[];
}
type Family = 'hills' | 'rockyHills' | 'mountains';
export type ReliefLayoutSources = Readonly<Record<Family, readonly ReliefLayoutSource[]>>;
export type ReliefLayoutCatalog = Readonly<Record<Family, readonly (readonly ReliefLayoutSource[])[]>>;

export const RELIEF_CHUNK_SIZE = 16;
const PIXELS = 16, MIN_BODY_WIDTH = 5, MIN_STAMPS = 8, MAX_GROUP_LENGTH = 25;
const pixel = (value: number): number => Math.round(value * PIXELS) / PIXELS;

export interface ReliefLayoutGroup {
  id: number; kind: 'hills' | 'mountains'; bounds: { x: number; y: number; width: number; height: number };
  stamps: readonly ReliefStamp[]; stampCount: number; mountainCount: number; terminalCount: number; bodyWidth: number;
  geometry?: RangeGeometry; bodyMaxWidth?: number; rockyHillCount?: number; mountainCoreCount?: number;
}
export interface ReliefLayoutPlan {
  stamps: readonly ReliefStamp[];
  chunks: ReadonlyMap<number, readonly ReliefStamp[]>;
  groups: readonly ReliefLayoutGroup[];
}
interface Run { y: number; left: number; right: number }
interface Component { id: number; count: number; first: number; runs: Run[] }
interface RoutePoint extends Run { center: number }
interface Placed extends ReliefStamp { source: ReliefLayoutSource; mountain: boolean; terminal?: boolean; rocky?: boolean }
interface Station { x: number; y: number; stamps: Placed[]; width: number }
interface Interval { left: number; right: number; stamp: number }
type RowIndex = Map<number, Interval[]>;
interface SourceLimits { minimumHeight?: number; maximumHeight?: number; maximumWidth?: number }
type RangeGeometry = 'arc' | 's-bend' | 'offset-massif' | 'waisted' | 'spur';
interface RangeProfile {
  geometry: RangeGeometry; token: number; length: number; bend: number; width: number;
  rockiness: number; side: number; phase: number;
}
interface RangeRoute { points: RoutePoint[]; profile: RangeProfile }

export function reliefLayoutSeed(seed: string): number {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value;
}

function hash(seed: number, x: number, y: number, salt: number): number {
  let value = seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ Math.imul(salt, 0x6c8e9cf5);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

function wave(seed: number, lane: number, distance: number, salt: number): number {
  const index = Math.floor(distance), fraction = distance - index;
  const blend = fraction * fraction * (3 - 2 * fraction);
  return (hash(seed, lane, index, salt) * (1 - blend) + hash(seed, lane, index + 1, salt) * blend) * 2 - 1;
}

function rangeProfile(seed: number, component: Component, firstY: number): RangeProfile {
  const choices: RangeGeometry[] = ['arc', 's-bend', 'offset-massif', 'waisted', 'spur'];
  const random = (salt: number): number => hash(seed, component.first, firstY, salt);
  return { geometry: choices[Math.floor(random(91) * choices.length)], token: firstY * 193 + component.first,
    length: Math.min(MAX_GROUP_LENGTH, 14 + Math.floor(random(92) * 12)),
    bend: (.4 + random(93) * 1.1) * (random(94) < .5 ? -1 : 1),
    width: random(95) > .86 ? 8.5 + random(96) * .5 : 6 + random(96) * 1.8,
    rockiness: .15 + random(97) * .45, side: random(98) < .5 ? -1 : 1, phase: random(99) };
}

function curve(profile: RangeProfile, progress: number): number {
  if (profile.geometry === 'arc') return Math.sin(progress * Math.PI) * profile.bend;
  if (profile.geometry === 's-bend') return Math.sin((progress - .12) * Math.PI * 2) * profile.bend;
  if (profile.geometry === 'offset-massif') return Math.tanh((progress - .45) * 5) * profile.bend;
  return Math.sin((progress + profile.phase * .3) * Math.PI * 2) * profile.bend * .7;
}

function targetWidth(profile: RangeProfile, progress: number): number {
  const bulge = profile.geometry === 'waisted' ? .25 + .75 * Math.sin(progress * Math.PI * 2) ** 2
    : profile.geometry === 'offset-massif' ? .3 + .7 * Math.max(Math.exp(-Math.pow((progress - .25) / .22, 2)), Math.exp(-Math.pow((progress - .76) / .18, 2)) * .72)
      : .2 + .8 * Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI) ** 2;
  return 5.2 + (profile.width - 5.2) * bulge;
}

/** Build once when the source atlas catalog changes, outside frame work. */
export function createReliefLayoutCatalog(sources: ReliefLayoutSources): ReliefLayoutCatalog {
  const group = (items: readonly ReliefLayoutSource[]): readonly (readonly ReliefLayoutSource[])[] => {
    const bins: ReliefLayoutSource[][] = [[], [], []];
    for (const source of items) bins[source.band].push(Object.freeze({ ...source }));
    return Object.freeze(bins.map(bin => Object.freeze(bin)));
  };
  return Object.freeze({ hills: group(sources.hills), rockyHills: group(sources.rockyHills), mountains: group(sources.mountains) });
}

function paletteOf(tile: LayoutTile): ReliefPalette {
  return tile.terrain === 'plains' || tile.terrain === 'desert' || tile.terrain === 'tundra' ? tile.terrain : 'grassland';
}

function dry(tile: LayoutTile | undefined): tile is LayoutTile {
  return !!tile?.relief && !tile.creek && !WATER.has(tile.terrain);
}

/** Linear, cold geometry index. Creek cuts and palette boundaries split groups. */
function components(world: ReliefLayoutWorld): { labels: Int32Array; groups: Component[] } {
  const count = world.width * world.height, labels = new Int32Array(count), queue = new Uint32Array(count);
  const eligible = new Uint8Array(count), palettes = new Uint8Array(count), groups: Component[] = [];
  for (let cell = 0; cell < count; cell++) {
    const tile = world.tiles[cell];
    if (!dry(tile)) continue;
    eligible[cell] = 1;
    palettes[cell] = tile.terrain === 'plains' ? 1 : tile.terrain === 'desert' ? 2 : tile.terrain === 'tundra' ? 3 : 0;
  }
  for (let first = 0; first < count; first++) {
    if (!eligible[first] || labels[first]) continue;
    const id = groups.length + 1, region = world.tiles[first].reliefRegion, palette = palettes[first];
    const group: Component = { id, count: 0, first, runs: [] };
    let head = 0, tail = 1; queue[0] = first; labels[first] = id;
    const enqueue = (cell: number): void => {
      if (eligible[cell] && !labels[cell] && palettes[cell] === palette && world.tiles[cell].reliefRegion === region) {
        labels[cell] = id; queue[tail++] = cell;
      }
    };
    while (head < tail) {
      const cell = queue[head++], x = cell % world.width; group.count++;
      if (x) enqueue(cell - 1);
      if (x + 1 < world.width) enqueue(cell + 1);
      if (cell >= world.width) enqueue(cell - world.width);
      if (cell + world.width < count) enqueue(cell + world.width);
    }
    groups.push(group);
  }
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width;) {
    const id = labels[y * world.width + x], left = x++;
    if (!id) continue;
    while (x < world.width && labels[y * world.width + x] === id) x++;
    groups[id - 1].runs.push({ y, left, right: x });
  }
  return { labels, groups };
}

function sourceRuns(source: ReliefLayoutSource, row: number): readonly (readonly number[])[] {
  if (source.opaqueRows) return source.opaqueRows[row] ?? [];
  const span = source.rowSpans?.[row];
  if (span) return [span];
  if (span === null) return [];
  // Preview callers can omit profiles; production always carries exact runs.
  const inset = Math.round(source.width * .5 * (1 - Math.min(1, .18 + (row + .5) / source.height * 1.2)));
  return [[inset, source.width - inset]];
}

function rowIndex(stamps: readonly Placed[], hillsOnly = false): RowIndex {
  const rows: RowIndex = new Map();
  for (let index = 0; index < stamps.length; index++) {
    const stamp = stamps[index]; if (hillsOnly && stamp.mountain) continue;
    const x = Math.round(stamp.x * PIXELS), y = Math.round(stamp.y * PIXELS);
    for (let row = 0; row < stamp.source.height; row++) for (const run of sourceRuns(stamp.source, row)) {
      if (run[1] <= run[0]) continue;
      let intervals = rows.get(y + row); if (!intervals) rows.set(y + row, intervals = []);
      intervals.push({ left: x + run[0], right: x + run[1], stamp: index });
    }
  }
  for (const intervals of rows.values()) intervals.sort((a, b) => a.left - b.left || b.right - a.right || a.stamp - b.stamp);
  return rows;
}

function widest(intervals: readonly Interval[] | undefined, minimumSources = 2): number {
  if (!intervals?.length) return 0;
  let left = intervals[0].left, right = intervals[0].right, members = new Set([intervals[0].stamp]), width = 0;
  for (let index = 1; index <= intervals.length; index++) {
    const interval = intervals[index];
    if (interval && interval.left <= right) { right = Math.max(right, interval.right); members.add(interval.stamp); continue; }
    if (members.size >= minimumSources) width = Math.max(width, right - left);
    if (interval) { left = interval.left; right = interval.right; members = new Set([interval.stamp]); }
  }
  return width / PIXELS;
}

function covered(intervals: readonly Interval[] | undefined, left: number, right: number): boolean {
  if (!intervals?.length) return false;
  let from = intervals[0].left, to = intervals[0].right;
  for (let index = 1; index <= intervals.length; index++) {
    const interval = intervals[index];
    if (interval && interval.left <= to) { to = Math.max(to, interval.right); continue; }
    if (from <= left && to >= right) return true;
    if (interval) { from = interval.left; to = interval.right; }
  }
  return false;
}

/** Project the peak's complete opaque outline onto its ground footprint.
 * The tall crest remains visible above the grass; its lower/middle flanks
 * still need a continuous grassy margin around every projected scanline. */
function peakEnclosed(peak: Placed, hillRows: RowIndex): boolean {
  const x = Math.round(peak.x * PIXELS), foot = (peak.y + peak.height) * PIXELS;
  const depth = Math.min(14, Math.round(peak.source.width * .22)), margin = 2;
  for (let row = 0; row < peak.source.height; row++) {
    const groundY = Math.floor(foot - depth + (row + .5) / peak.source.height * depth);
    for (const run of sourceRuns(peak.source, row))
      if (!covered(hillRows.get(groundY), x + run[0] - margin, x + run[1] + margin)) return false;
  }
  return true;
}

function overlaps(a: Placed, b: Placed): boolean {
  const ax = Math.round(a.x * PIXELS), ay = Math.round(a.y * PIXELS), bx = Math.round(b.x * PIXELS), by = Math.round(b.y * PIXELS);
  const top = Math.max(ay, by), bottom = Math.min(ay + a.source.height, by + b.source.height);
  if (top >= bottom || ax >= bx + b.source.width || bx >= ax + a.source.width) return false;
  let shared = 0;
  for (let y = top; y < bottom; y++) for (const ar of sourceRuns(a.source, y - ay)) for (const br of sourceRuns(b.source, y - by)) {
    shared += Math.max(0, Math.min(ax + ar[1], bx + br[1]) - Math.max(ax + ar[0], bx + br[0]));
    if (shared >= 3) return true;
  }
  return false;
}

/** A small spatial hash bounds overlap comparisons to neighboring sprites. */
function overlapComponents(stamps: readonly Placed[]): number[][] {
  const parents = stamps.map((_, index) => index), buckets = new Map<string, number[]>();
  const find = (value: number): number => { while (parents[value] !== value) { parents[value] = parents[parents[value]]; value = parents[value]; } return value; };
  for (let index = 0; index < stamps.length; index++) {
    const stamp = stamps[index], nearby = new Set<number>();
    const x0 = Math.floor(stamp.x / 2), x1 = Math.floor((stamp.x + stamp.width - .001) / 2);
    const y0 = Math.floor(stamp.y / 2), y1 = Math.floor((stamp.y + stamp.height - .001) / 2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      for (const other of buckets.get(`${x},${y}`) ?? []) nearby.add(other);
    for (const other of nearby) if (overlaps(stamp, stamps[other])) parents[find(index)] = find(other);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = `${x},${y}`; let bucket = buckets.get(key); if (!bucket) buckets.set(key, bucket = []); bucket.push(index);
    }
  }
  const groups = new Map<number, number[]>();
  for (let index = 0; index < stamps.length; index++) {
    const root = find(index); let group = groups.get(root); if (!group) groups.set(root, group = []); group.push(index);
  }
  return [...groups.values()];
}

function bounds(stamps: readonly ReliefStamp[]): ReliefLayoutGroup['bounds'] {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const stamp of stamps) { x = Math.min(x, stamp.x); y = Math.min(y, stamp.y); right = Math.max(right, stamp.x + stamp.width); bottom = Math.max(bottom, stamp.y + stamp.height); }
  return { x, y, width: right - x, height: bottom - y };
}

function routes(component: Component, seed: number): RangeRoute[] {
  const result: RangeRoute[] = []; let path: RoutePoint[] = [], previous = NaN, profile: RangeProfile | undefined;
  const flush = (): void => { if (path.length >= 5 && profile) result.push({ points: path, profile }); path = []; previous = NaN; profile = undefined; };
  for (let index = 0; index < component.runs.length;) {
    const y = component.runs[index].y; let best: Run | undefined, score = -Infinity;
    while (index < component.runs.length && component.runs[index].y === y) {
      const run = component.runs[index++], width = run.right - run.left;
      if (width < 6) continue;
      const value = Math.min(width, 14) - (Number.isNaN(previous) ? 0 : Math.abs((run.left + run.right) / 2 - previous) * .6);
      if (value > score) { best = run; score = value; }
    }
    if (!best) { if (path.length && y - path[path.length - 1].y > 1) flush(); continue; }
    if (path.length && (y - path[path.length - 1].y > 1 || y - path[0].y >= profile!.length)) flush();
    profile ??= rangeProfile(seed, component, y);
    const middle = (best.left + best.right) / 2;
    const progress = (y - (path[0]?.y ?? y)) / profile.length;
    const offset = curve(profile, progress) + wave(seed, component.first, y / 6, 71) * .35;
    const desired = middle + Math.max(-(best.right - best.left - 5.5) / 2, Math.min((best.right - best.left - 5.5) / 2, offset));
    let center = Number.isNaN(previous) ? desired : previous * .55 + desired * .45;
    center = Math.max(best.left + 2.75, Math.min(best.right - 2.75, center));
    if (path.length && Math.abs(center - previous) > 2.5) { flush(); profile = rangeProfile(seed, component, y); }
    path.push({ ...best, center }); previous = center;
  }
  flush(); return result;
}

/** Complete groups are validated before they enter the chunk index. This is
 * cold geometry work; frame lookups never scan or rebuild the world. */
export function createReliefLayoutPlan(world: ReliefLayoutWorld, catalog: ReliefLayoutCatalog, seed: string | number = world.seed): ReliefLayoutPlan {
  const value = typeof seed === 'number' ? seed : reliefLayoutSeed(seed);
  const index = components(world), groups: ReliefLayoutGroup[] = [], all: ReliefStamp[] = [];
  let nextId = 1;
  const fit = (component: Component, source: ReliefLayoutSource, anchorX: number, anchorY: number, mountain = false): Placed | undefined => {
    const width = source.width / PIXELS, height = source.height / PIXELS;
    const x = pixel(anchorX - width / 2), y = pixel(anchorY - height), foot = y + height;
    const x0 = Math.floor(x), x1 = Math.ceil(x + width - .001), y0 = Math.floor(y), y1 = Math.ceil(foot - .001);
    if (x0 < 0 || y0 < 0 || x1 > world.width || y1 > world.height) return;
    for (let row = y0; row < y1; row++) for (let column = x0; column < x1; column++)
      if (index.labels[row * world.width + column] !== component.id) return;
    const cell = Math.floor(foot - 1 / 32) * world.width + Math.floor(x + width / 2), tile = world.tiles[cell];
    if (mountain && tile.relief !== 'mountains') return;
    return { x, y, width, height, depth: foot - .08, cell, style: source.style, slot: source.slot,
      palette: paletteOf(tile), sizeBand: source.band, source, mountain };
  };
  const pick = (component: Component, family: ReliefLayoutCatalog[Family], x: number, y: number, token: number,
    bands: readonly ReliefSizeBand[], minimumWidth: number, mountain = false, limits: SourceLimits = {},
    accept?: (stamp: Placed) => boolean): Placed | undefined => {
    const eligible: ReliefLayoutSource[] = [];
    for (const band of bands) {
      for (const source of family[band]) {
        if (source.width < minimumWidth * PIXELS || source.height < (limits.minimumHeight ?? 0)
          || source.height > (limits.maximumHeight ?? Infinity) || source.width > (limits.maximumWidth ?? Infinity)) continue;
        eligible.push(source);
      }
    }
    // All compatible silhouettes participate, rather than using the first
    // size band as an almost-exclusive pool and treating the rest as fallback.
    const offset = Math.floor(hash(value, component.first, token, 72) * eligible.length);
    for (let attempt = 0; attempt < eligible.length; attempt++) {
      const source = eligible[(offset + attempt) % eligible.length], stamp = fit(component, source, x, y, mountain);
      if (stamp && (!accept || accept(stamp))) { stamp.rocky = family === catalog.rockyHills; return stamp; }
    }
    return;
  };
  const publish = (component: Component, stations: Station[], profile: RangeProfile): void => {
    if (stations.length < 3) return;
    const body = stations.flatMap(station => station.stamps);
    if (body.length < MIN_STAMPS || overlapComponents(body).length !== 1) return;
    const hills = [...body], bodyBounds = bounds(body);
    const visualToken = Math.round(stations[0].y * PIXELS) * 131 + Math.round(stations[0].x * PIXELS);
    // Paired low shoulders narrow the broad body before its single terminal
    // hill. A transition is atomic and must overlap both itself and the body.
    const first = body.reduce((a, b) => a.y < b.y ? a : b), last = body.reduce((a, b) => a.y + a.height > b.y + b.height ? a : b);
    for (const north of [true, false]) {
      const end = stations[north ? 0 : stations.length - 1], token = visualToken + (north ? 171 : 241);
      const foot = north ? bodyBounds.y + .35 : bodyBounds.y + bodyBounds.height + .45;
      const limits: SourceLimits = { minimumHeight: 10, maximumHeight: 16, maximumWidth: 40 };
      const left = pick(component, catalog.hills, end.x - .55, foot, token, [1, 0], 2, false, limits);
      const right = pick(component, catalog.hills, end.x + .55,
        foot + (hash(value, component.first, token, 83) - .5) * .125, token + 29, [1, 0], 2, false, limits);
      let paired = false;
      if (left && right && overlaps(left, right) && [left, right].some(shoulder => body.some(stamp => overlaps(shoulder, stamp)))) {
        const pair = [left, right], width = Math.max(0, ...[...rowIndex(pair).values()].map(row => widest(row)));
        if (width >= 3 && width <= 4.5) { hills.push(...pair); paired = true; }
      }
      const neighbor = north ? first : last, x = paired ? end.x : neighbor.x + neighbor.width / 2;
      const frame = bounds(hills);
      // At most one single grassy hill is added at the true north/south tip.
      const options = catalog.hills[0], offset = Math.floor(hash(value, component.first, visualToken, north ? 73 : 74) * options.length);
      for (let attempt = 0; attempt < options.length; attempt++) {
        const source = options[(offset + attempt) % options.length]; if (source.width > 3 * PIXELS) continue;
        const height = source.height / PIXELS, capFoot = north ? frame.y + height * .5 : frame.y + frame.height + height * .5;
        const cap = fit(component, source, x, capFoot);
        if (cap && hills.some(stamp => overlaps(cap, stamp))) { cap.terminal = true; hills.push(cap); break; }
      }
    }
    // A range that cannot close both ends stays open ground, rather than
    // publishing a broad cut-off end or a detached terminal substitute.
    if (hills.filter(stamp => stamp.terminal).length !== 2) return;
    const hillRows = rowIndex(hills), envelope = bounds(hills), peaks: Placed[] = [];
    const acceptPeak = (peak: Placed): boolean => peak.x >= envelope.x + .5
      && peak.x + peak.width <= envelope.x + envelope.width - .5
      && peak.y >= envelope.y + .4 && peak.y + peak.height <= envelope.y + envelope.height - .5
      && peakEnclosed(peak, hillRows);
    for (let station = 2; station + 2 < stations.length; station++) {
      const point = stations[station], token = visualToken + station * 97;
      const dominant = station % 3 === Math.floor(profile.phase * 3);
      if (!dominant && wave(value, component.first, point.y / 3.2, 101) < -.5) continue;
      const bend = wave(value, component.first, point.y / 2.7, 102) * Math.min(.8, Math.max(.15, (point.width - 4.5) / 3));
      for (const offset of [0, -.5, .5]) {
        const peak = pick(component, catalog.mountains, point.x + bend + offset + (hash(value, component.first, token, 75) - .5) * .3,
          point.y - (dominant ? .3 : .18), token, [2, 1, 0], dominant ? 3.5 : 3, true,
          { minimumHeight: dominant ? 26 : 18 }, acceptPeak);
        if (peak) { peaks.push(peak); break; }
      }
    }
    // A mountain is a supported core of several overlapping peaks, never a
    // lone peak or a side ornament detached from the grassy body.
    let mountainCoreCount = 0;
    const isDominant = (peak: Placed): boolean => peak.source.width >= 56 && peak.source.height >= 26;
    for (const core of overlapComponents(peaks)) if (core.length >= 3 && core.some(peak => isDominant(peaks[peak]))) {
      let selected = core.map(peak => peaks[peak]);
      if (selected.length >= 5) {
        const spaced = selected.filter((_, index) => index % 2 === 0);
        if (spaced.length >= 3 && spaced.some(isDominant) && overlapComponents(spaced).length === 1) selected = spaced;
      }
      hills.push(...selected); mountainCoreCount++;
    }
    if (overlapComponents(hills).length !== 1) return;
    const id = nextId++, stamps = hills.map(({ source: _source, mountain: _mountain, terminal: _terminal, ...stamp }) => Object.freeze({ ...stamp, rangeId: id }));
    stamps.sort((a, b) => a.depth - b.depth || a.x - b.x || a.style - b.style || a.slot - b.slot);
    const mountainCount = hills.filter(stamp => stamp.mountain).length;
    const group: ReliefLayoutGroup = { id, kind: mountainCount ? 'mountains' : 'hills', bounds: bounds(stamps),
      stamps: Object.freeze(stamps), stampCount: stamps.length, mountainCount,
      terminalCount: hills.filter(stamp => stamp.terminal).length, bodyWidth: Math.min(...stations.map(station => station.width)),
      bodyMaxWidth: Math.max(...stations.map(station => station.width)), geometry: profile.geometry,
      rockyHillCount: hills.filter(stamp => !stamp.mountain && stamp.rocky).length, mountainCoreCount };
    groups.push(Object.freeze(group));
    all.push(...stamps);
  };

  for (const component of index.groups) {
    if (component.count < 20) continue;
    for (const route of routes(component, value)) {
      const { points: path, profile } = route;
      let stations: Station[] = [], cursor = 0, step = 0;
      const mountainRoute = path.some(point => [-1, 0, 1].some(offset => {
        const x = Math.floor(point.center + offset);
        return x >= point.left && x < point.right && world.tiles[point.y * world.width + x].relief === 'mountains';
      }));
      const limits: SourceLimits = mountainRoute ? { maximumHeight: 18 } : {};
      const bands: readonly ReliefSizeBand[] = mountainRoute ? [2, 1, 0] : [2, 1];
      const stop = path[path.length - 1].y - .35;
      const stride = mountainRoute ? .5 : .88, strideVariation = mountainRoute ? .18 : .2;
      // More space between native-size layers; opaque overlap still decides
      // whether the complete group is connected enough to publish. Low mountain
      // skirts need closer support than taller hills to enclose peak footprints.
      for (let y = path[0].y + 2.25; y <= stop; y += stride + hash(value, component.first, step++, 76) * strideVariation) {
        while (cursor + 1 < path.length && path[cursor + 1].y <= y) cursor++;
        const point = path[cursor], next = path[Math.min(cursor + 1, path.length - 1)], blend = Math.min(1, Math.max(0, y - point.y));
        const center = point.center * (1 - blend) + next.center * blend;
        const sample = world.tiles[Math.floor(y) * world.width + Math.floor(center)];
        const token = step + path[0].y * 100, jitter = (salt: number): number => hash(value, component.first, token, salt);
        const progress = (y - path[0].y) / profile.length;
        const wanted = targetWidth(profile, progress);
        const room = Math.max(5.2, Math.min(center - point.left, point.right - center) * 2 - .25);
        const spread = 1.02 + Math.max(0, Math.min(wanted, room) - 5.2) * .18;
        const rockiness = Math.max(.1, Math.min(.7, profile.rockiness * (.55 + (sample.reliefRuggedness ?? 0))
          + wave(value, component.first, y / 2.4, 103) * .2));
        const familyFor = (side: number): ReliefLayoutCatalog[Family] => catalog.rockyHills.some(bin => bin.length)
          && hash(value, component.first, Math.floor(y / 2.1), 104 + side) < rockiness ? catalog.rockyHills : catalog.hills;
        const leftFoot = mountainRoute ? y - .08 + jitter(78) * .12 : y - .15 + jitter(78) * .2;
        const rightFoot = mountainRoute ? y + .02 + jitter(80) * .15 : y + .05 + jitter(80) * .25;
        const left = pick(component, familyFor(0), center - spread - jitter(77) * .22, leftFoot, token, bands, 3, false, limits);
        const right = pick(component, familyFor(1), center + spread + jitter(79) * .22, rightFoot, token + 31, bands, 3, false, limits);
        // A low central ground form closes the grass envelope behind the
        // peak. Its footing and height keep it below the visible stone core.
        const middle = pick(component, familyFor(2), center + (jitter(81) - .5) * .65,
          mountainRoute ? y - .2 : y + .3 + jitter(82) * .2, token + 61, bands, 2.5,
          false, mountainRoute ? { maximumHeight: 12 } : {});
        const members = [left, right, middle].filter((stamp): stamp is Placed => !!stamp);
        let width = Math.max(0, ...[...rowIndex(members).values()].map(row => widest(row)));
        if (!left || !right || members.length < 2 || width < MIN_BODY_WIDTH || overlapComponents(members).length !== 1
          || stations.length && !members.some(member => stations[stations.length - 1].stamps.some(previous => overlaps(member, previous)))) {
          publish(component, stations, profile); stations = []; continue;
        }
        // Wider waists and one-sided massifs grow from the connected body.
        // Optional lobes must fit local geology and overlap an existing member.
        if (wanted > 6.3 && progress > .15 && progress < .88) {
          const sides = profile.geometry === 'spur' || wanted < 7.2 ? [profile.side] : [profile.side, -profile.side];
          for (const side of sides) {
            const strength = .5 + wave(value, component.first, y / 3.1, side < 0 ? 105 : 106) * .5;
            if (strength < .28) continue;
            const offset = 1.8 + (wanted - 5.2) * .3;
            const shoulder = pick(component, familyFor(side < 0 ? 3 : 4), center + side * offset,
              y + (strength - .5) * .65, token + (side < 0 ? 101 : 151), [0, 1, 2], 2.5, false,
              { maximumWidth: 56, maximumHeight: mountainRoute ? 18 : 26 });
            if (shoulder && members.some(member => overlaps(shoulder, member))) members.push(shoulder);
          }
          width = Math.max(0, ...[...rowIndex(members).values()].map(row => widest(row)));
        }
        stations.push({ x: center, y, stamps: members, width });
      }
      publish(component, stations, profile);
    }
  }
  all.sort((a, b) => a.depth - b.depth || a.x - b.x || a.style - b.style || a.slot - b.slot);
  const chunks = new Map<number, ReliefStamp[]>(), columns = Math.ceil(world.width / RELIEF_CHUNK_SIZE);
  for (const stamp of all) {
    const cx = Math.floor((stamp.x + stamp.width / 2) / RELIEF_CHUNK_SIZE), cy = Math.floor((stamp.y + stamp.height - 1 / 32) / RELIEF_CHUNK_SIZE);
    const key = cy * columns + cx; let chunk = chunks.get(key); if (!chunk) chunks.set(key, chunk = []); chunk.push(stamp);
  }
  const frozenChunks = new Map<number, readonly ReliefStamp[]>();
  for (const [key, stamps] of chunks) frozenChunks.set(key, Object.freeze(stamps));
  return Object.freeze({ stamps: Object.freeze(all), chunks: frozenChunks, groups: Object.freeze(groups) });
}

export const getReliefLayoutPlan = createReliefLayoutPlan;

/** Passing a prepared plan keeps this a constant-time chunk lookup. */
export function layoutReliefChunk(world: ReliefLayoutWorld, seed: number, cx: number, cy: number,
  catalog: ReliefLayoutCatalog, prepared?: ReliefLayoutPlan): readonly ReliefStamp[] {
  const plan = prepared ?? createReliefLayoutPlan(world, catalog, seed);
  return plan.chunks.get(cy * Math.ceil(world.width / RELIEF_CHUNK_SIZE) + cx) ?? [];
}

/** Full-world helper for one-time standalone composition, never frame work. */
export function layoutReliefWorld(world: ReliefLayoutWorld, catalog: ReliefLayoutCatalog, seed = world.seed): readonly ReliefStamp[] {
  return createReliefLayoutPlan(world, catalog, seed).stamps;
}
