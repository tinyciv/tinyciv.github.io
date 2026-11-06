import TinyQueue from 'tinyqueue';
import { WATER, type Tile, type World } from '../game/types';
import { ridgeEdgeAllowed, ridgeGroundWalkable, ridgeIsLedge, ridgeLevel } from '../game/ridges';
import { terrainYields } from './generator';
import { refreshRiverRunoff } from './river-network';

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const dry = (tile: Tile) => !WATER.has(tile.terrain);
const downstream = (tile: Tile) => tile.channelNext ?? tile.drainage ?? -1;
const at = (world: World, x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height
  ? y * world.width + x : -1;

/** The available waterfall is a complete south-facing cliff tile. Its north
 * port lies on the upper floor; its south port has one full lower floor cell.
 * Keeping both rocky flanks excludes corners, stairs and unsupported ledges. */
export function isSouthWaterfallLip(world: World, cell: number): boolean {
  const { tiles, width, height } = world, x = cell % width, y = Math.floor(cell / width), tile = tiles[cell];
  if (!tile?.ridge || tile.stair || x < 1 || x + 1 >= width || y < 1 || y + 1 >= height) return false;
  const level = ridgeLevel(tile), north = cell - width, south = cell + width;
  if (ridgeLevel(tiles[south]) !== level - 1 || tiles[south].stair
    || ridgeIsLedge(world, x, y + 1) || ridgeIsLedge(world, x, y - 1)) return false;
  if ([north, cell - 1, cell + 1].some(next => tiles[next].ridge !== tile.ridge || ridgeLevel(tiles[next]) !== level || tiles[next].stair)) return false;
  return dry(tiles[cell - 1]) && dry(tiles[cell + 1]);
}

function channelGround(world: World, cell: number): NonNullable<Tile['creekGround']> {
  const { tiles, width, height } = world, tile = tiles[cell];
  let sand = 0, grass = 0;
  const x = cell % width, y = Math.floor(cell / width);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const other = tiles[ny * width + nx];
    if (!dry(other) || tile.ridge && other.ridge !== tile.ridge) continue;
    if (other.terrain === 'desert' || other.terrain === 'plains') sand++; else grass++;
  }
  return sand > grass ? 'desert' : 'grassland';
}

/** Mark existing, genuinely downhill crossings, then use the same native
 * banked channel throughout their connected narrow reach. Major rivers remain
 * broad, and unrelated creeks keep their four-pixel artwork. */
export function markRiverWaterfalls(world: World, promoteConnectedReaches = true): number[] {
  const { tiles, width } = world, falls: number[] = [];
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    delete tile.waterfall;
    if (tile.terrain !== 'river' || !isSouthWaterfallLip(world, cell)) continue;
    const north = tiles[cell - width], south = tiles[cell + width];
    if (north.terrain !== 'river' || south.terrain !== 'river' || downstream(tile) !== cell + width
      || downstream(north) !== cell || north.elevation + 1e-9 < tile.elevation || tile.elevation + 1e-9 < south.elevation) continue;
    tile.waterfall = 'south'; tile.overlay = 'none';
    delete tile.fordAxis; delete tile.marsh; delete tile.palm; delete tile.treeClass;
    falls.push(cell);
  }
  const seen = new Uint8Array(tiles.length), queue = falls.slice();
  for (const cell of queue) seen[cell] = 1;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], tile = tiles[cell], x = cell % width, y = Math.floor(cell / width);
    tile.riverArt = 'banked'; tile.creekGround = channelGround(world, cell);
    if (!promoteConnectedReaches) continue;
    for (const [dx, dy] of CARDINAL) {
      const next = at(world, x + dx, y + dy);
      if (next < 0 || seen[next]) continue;
      const other = tiles[next];
      if (other.terrain !== 'river' || !other.creek && (other.channel !== 'tributary' || (other.channelWidth ?? 1) > 1)) continue;
      seen[next] = 1; queue.push(next);
    }
  }
  return falls;
}

export interface WaterfallTributaries { paths: number[][]; falls: number[]; }
export interface WaterfallTributaryOptions {
  /** Restrict new headwaters to a geographic area; existing rivers stay intact. */
  sourceRegion?: (cell: number, world: World) => boolean;
  maxPaths?: number;
  minimumDropSpacing?: number;
  /** Preserve mapped routing and validate narrow terrace banks with level fords. */
  geographic?: boolean;
}

function accessibleGround(world: World, includeFords = false): Uint8Array {
  const { tiles, width } = world, reached = new Uint8Array(tiles.length), queue: number[] = [];
  const walkable = (tile: Tile) => dry(tile) || includeFords && tile.terrain === 'river' && tile.overlay === 'ford';
  for (let cell = 0; cell < tiles.length; cell++) if (!tiles[cell].ridge && walkable(tiles[cell])) { reached[cell] = 1; queue.push(cell); }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx, ny = y + dy, next = at(world, nx, ny);
      if (next < 0 || reached[next] || !walkable(tiles[next]) || !ridgeGroundWalkable(world, nx, ny)
        || !ridgeEdgeAllowed(world, { x, y }, { x: nx, y: ny })) continue;
      reached[next] = 1; queue.push(next);
    }
  }
  return reached;
}

/** Expose a few small headwater tributaries on surviving geological shelves.
 * These follow a descending surface to an existing river/lake/sea; they never
 * raise a ledge, cross a stair, climb a shelf, or replace the main river graph.
 * Only the authored south face can be used for a drop. */
export function addWaterfallTributaries(world: World, options: WaterfallTributaryOptions = {}): WaterfallTributaries {
  const { tiles, width, height } = world, count = tiles.length;
  const levels = Uint8Array.from(tiles, tile => ridgeLevel(tile));
  const ledges = Uint8Array.from(tiles, (_, cell) => Number(ridgeIsLedge(world, cell % width, Math.floor(cell / width))));
  const lips = Uint8Array.from(tiles, (_, cell) => Number(isSouthWaterfallLip(world, cell)));
  const reserved = new Uint8Array(count);
  for (const town of [...world.spawns, ...(world.secondarySpawns ?? [])]) {
    for (let y = Math.max(0, Math.floor(town.y - 7)); y <= Math.min(height - 1, Math.ceil(town.y + 7)); y++)
      for (let x = Math.max(0, Math.floor(town.x - 7)); x <= Math.min(width - 1, Math.ceil(town.x + 7)); x++)
        if (Math.hypot(x + .5 - town.x, y + .5 - town.y) < 7) reserved[y * width + x] = 1;
  }
  // Protect a stair and its actual low/high landings, including both dry banks.
  for (let cell = 0; cell < count; cell++) if (tiles[cell].stair) {
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const next = at(world, x + dx, y + dy); if (next >= 0) reserved[next] = 1;
    }
  }
  const canFlow = (from: number, to: number): boolean => {
    const a = tiles[from], b = tiles[to];
    if (reserved[from] || a.stair || b.stair || !dry(a) || a.overlay === 'volcano' || a.overlay === 'glacier'
      || a.elevation + 1e-9 < b.elevation) return false;
    if (levels[from] === levels[to]) {
      if (ledges[from]) return false;
      if (ledges[to]) return !!lips[to] && from === to - width;
      return !levels[from] || a.ridge === b.ridge;
    }
    return levels[from] === levels[to] + 1 && !!lips[from] && to === from + width;
  };
  const costs = new Float64Array(count).fill(Infinity), next = new Int32Array(count).fill(-1);
  const queue = new TinyQueue<{ cell: number; cost: number }>([], (a, b) => a.cost - b.cost || a.cell - b.cell);
  for (let cell = 0; cell < count; cell++) if (WATER.has(tiles[cell].terrain) && !ledges[cell]) {
    costs[cell] = 0; queue.push({ cell, cost: 0 });
  }
  while (queue.length) {
    const current = queue.pop()!;
    if (current.cost !== costs[current.cell] || current.cost > 70) continue;
    const x = current.cell % width, y = Math.floor(current.cell / width);
    for (const [dx, dy] of CARDINAL) {
      const from = at(world, x + dx, y + dy);
      if (from < 0 || !canFlow(from, current.cell)) continue;
      // Follow the pre-existing drainage direction where possible; otherwise
      // choose a short descending reach with the same cardinal art geometry.
      const cost = current.cost + (tiles[from].drainage === current.cell ? 1 : 1.3);
      if (cost >= costs[from]) continue;
      costs[from] = cost; next[from] = current.cell; queue.push({ cell: from, cost });
    }
  }
  const candidates: { path: number[]; drops: number[]; score: number }[] = [];
  for (let source = 0; source < count; source++) {
    if (options.sourceRegion && !options.sourceRegion(source, world)
      || !levels[source] || ledges[source] || !dry(tiles[source]) || costs[source] > 60 || costs[source] < 5
      || (tiles[source].flow ?? 4) < 4) continue;
    // A dry route around the headwater tip keeps its two banks connected.
    if (!options.geographic && CARDINAL.some(([dx, dy]) => {
      const adjacent = at(world, source % width + dx, Math.floor(source / width) + dy);
      return adjacent < 0 || ledges[adjacent] || !dry(tiles[adjacent]) || levels[adjacent] !== levels[source];
    })) continue;
    const path: number[] = [], drops: number[] = [];
    let cell = source;
    while (cell >= 0 && dry(tiles[cell]) && path.length < 48) {
      if (lips[cell]) drops.push(cell);
      path.push(cell); cell = next[cell];
    }
    if (cell < 0 || !WATER.has(tiles[cell].terrain) || !drops.length || path.indexOf(drops[0]) < 2) continue;
    // A headwater must not silently join another channel before its declared
    // outlet, or form an accidental shortcut between separate watersheds.
    if (path.slice(0, -1).some(cell => CARDINAL.some(([dx, dy]) => {
      const adjacent = at(world, cell % width + dx, Math.floor(cell / width) + dy);
      return adjacent >= 0 && WATER.has(tiles[adjacent].terrain);
    }))) continue;
    path.push(cell);
    candidates.push({ path, drops, score: Math.min(tiles[source].flow ?? 4, 36) + drops.length * 8 - path.length * .25 });
  }
  candidates.sort((a, b) => b.score - a.score || a.path[0] - b.path[0]);
  const paths: number[][] = [], chosenDrops: number[] = [], painted = new Set<number>();
  const land = tiles.reduce((sum, tile) => sum + Number(dry(tile)), 0), target = options.maxPaths ?? Math.max(1, Math.min(4, Math.round(land / 4500)));
  const accessible = candidates.length ? accessibleGround(world, options.geographic) : undefined;
  for (const candidate of candidates) {
    if (paths.length >= target) break;
    if (candidate.drops.some(cell => chosenDrops.some(other => Math.hypot(cell % width - other % width,
      Math.floor(cell / width) - Math.floor(other / width)) < (options.minimumDropSpacing ?? 12)))) continue;
    if (candidate.path.slice(0, -1).some(cell => painted.has(cell) || CARDINAL.some(([dx, dy]) => {
      const adjacent = at(world, cell % width + dx, Math.floor(cell / width) + dy); return painted.has(adjacent);
    }))) continue;
    const previous = candidate.path.slice(0, -1).map(cell => ({ ...tiles[cell] }));
    for (let index = 0; index < candidate.path.length - 1; index++) {
      const cell = candidate.path[index], tile = tiles[cell];
      const ground = tile.terrain === 'desert' || tile.terrain === 'plains' ? tile.terrain : 'grassland';
      tile.terrain = 'river'; tile.overlay = 'none'; tile.channel = 'tributary'; tile.channelWidth = 1;
      tile.channelNext = tile.drainage = candidate.path[index + 1]; tile.creek = true; tile.creekGround = ground;
      tile.riverArt = 'banked'; tile.moisture = 1; Object.assign(tile, terrainYields('river', 'none'));
      delete tile.fordAxis; delete tile.treeClass; delete tile.palm; delete tile.marsh; delete tile.beach;
    }
    // A mapped Alpine shelf can be only one walkable cell wide. A level ford
    // preserves that bank route; the waterfall face itself never becomes a ford.
    if (options.geographic) for (const cell of candidate.path.slice(0, -1)) {
      if (ledges[cell]) continue;
      const x = cell % width, y = Math.floor(cell / width);
      for (const [dx, dy, axis] of [[1, 0, 'horizontal'], [0, 1, 'vertical']] as const) {
        const a = at(world, x - dx, y - dy), b = at(world, x + dx, y + dy);
        if (a < 0 || b < 0 || !dry(tiles[a]) || !dry(tiles[b]) || levels[a] !== levels[cell] || levels[b] !== levels[cell]
          || !ridgeGroundWalkable(world, x - dx, y - dy) || !ridgeGroundWalkable(world, x + dx, y + dy)) continue;
        tiles[cell].overlay = 'ford'; tiles[cell].fordAxis = axis; break;
      }
    }
    const after = accessibleGround(world, options.geographic);
    if (tiles.some((tile, cell) => accessible![cell] && tile.ridge && dry(tile) && !after[cell])) {
      candidate.path.slice(0, -1).forEach((cell, index) => { tiles[cell] = previous[index]; });
      continue;
    }
    for (const cell of candidate.path.slice(0, -1)) painted.add(cell);
    paths.push(candidate.path); chosenDrops.push(...candidate.drops);
  }
  if (paths.length && !options.geographic) refreshRiverRunoff(world);
  return { paths, falls: markRiverWaterfalls(world, !options.geographic) };
}
