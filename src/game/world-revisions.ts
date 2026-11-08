import type { World } from './types';

/** Buildings/roads change navigation without necessarily changing the terrain
 * image, woodland sight costs, or the ground on which territory can be claimed. */
export type WorldChange = 'structure' | 'appearance' | 'sight' | 'geometry';
export interface WorldRevisions { readonly appearance: number; readonly sight: number; readonly geometry: number }
interface TrackedWorld {
  raw: number | undefined; tiles: World['tiles']; width: number; height: number; seed: string;
  versions: WorldRevisions; structure: number; unversioned?: string;
  journal: number; fullAt: number; history: { revision: number; cells: Uint32Array }[];
  historyStart: number; historyCells: number; seen?: Uint32Array; stamp: number;
}
const revisions = new WeakMap<World, TrackedWorld>();
const HISTORY_LIMIT = 1024;
const NO_CELLS: readonly number[] = Object.freeze([]);
const EMPTY_CELL_BUFFER = new Uint32Array(0);

/** Each consumer keeps its own cursor. Slow readers can safely fall back to a
 * full refresh; they never keep an unbounded edit log alive. */
export interface WorldCellChanges { revision: number; full: boolean; cells: readonly number[] }
function recordCells(record: TrackedWorld, cells?: Iterable<number>): void {
  if (cells === undefined) {
    record.fullAt = ++record.journal; record.history = []; record.historyStart = 0; record.historyCells = 0;
    return;
  }
  const values: number[] = [];
  for (const cell of cells) if (Number.isInteger(cell) && cell >= 0 && cell < record.tiles.length) values.push(cell);
  if (!values.length) return;
  const revision = ++record.journal;
  record.history.push({ revision, cells: Uint32Array.from(values) }); record.historyCells += values.length;
  while (record.history.length - record.historyStart > HISTORY_LIMIT || record.historyCells > Math.max(4096, record.tiles.length * 2)) {
    const removed = record.history[record.historyStart++];
    record.fullAt = removed.revision; record.historyCells -= removed.cells.length;
    removed.cells = EMPTY_CELL_BUFFER;
  }
  if (record.historyStart >= HISTORY_LIMIT) { record.history = record.history.slice(record.historyStart); record.historyStart = 0; }
}

function advance(record: TrackedWorld, change: WorldChange): void {
  if (change === 'structure' || change === 'geometry') record.structure++;
  const { appearance, sight, geometry } = record.versions;
  record.versions = {
    appearance: appearance + Number(change !== 'structure'),
    sight: sight + Number(change === 'sight' || change === 'geometry'),
    geometry: geometry + Number(change === 'geometry'),
  };
}

/** Unknown raw edits stay conservative, including direct test/editor edits.
 * Unversioned fixtures compare exact terrain scalars; live games initialize a
 * revision and never pay for this scan. Keep repeated unversioned reads stable. */
export function worldRevisions(world: World): WorldRevisions {
  const unversioned = world.revision === undefined ? world.tiles.map(tile =>
    `${tile.terrain},${tile.overlay},${Number(!!tile.palm)},${Number(!!tile.marsh)},${Number(tile.farm !== undefined)},${Number(!!tile.beach)},${tile.variation},${tile.ridge ?? 0},${tile.ridgeTier ?? 1},${tile.stair ?? ''},${Number(!!tile.villageTrail)},${Number(!!tile.creek)},${tile.creekGround ?? ''},${tile.riverArt ?? ''},${tile.waterfall ?? ''},${tile.resource ?? ''},${tile.resourceGroup ?? ''},${Number(!!tile.resourceDeveloped)}`).join(';') : undefined;
  let record = revisions.get(world);
  if (!record) {
    record = { raw: world.revision, tiles: world.tiles, width: world.width, height: world.height, seed: world.seed,
      versions: { appearance: 0, sight: 0, geometry: 0 }, structure: 0, unversioned,
      journal: 0, fullAt: 0, history: [], historyStart: 0, historyCells: 0, stamp: 0 };
    revisions.set(world, record);
  } else if (record.unversioned !== unversioned || record.raw !== world.revision || record.tiles !== world.tiles
    || record.width !== world.width || record.height !== world.height || record.seed !== world.seed) {
    advance(record, 'geometry');
    record.raw = world.revision; record.tiles = world.tiles; record.width = world.width; record.height = world.height; record.seed = world.seed;
    record.unversioned = unversioned;
    recordCells(record);
  }
  return record.versions;
}

/** Structural consumers ignore cosmetic road wear and crop appearance. */
export function worldStructureRevision(world: World): number {
  worldRevisions(world);
  return revisions.get(world)!.structure;
}

/** Call in place of a raw revision increment, after making a classified edit.
 * Inspect the previous raw value first so an earlier unknown edit cannot be
 * accidentally hidden by a subsequent known road/building change. */
export function markWorldChanged(world: World, change: WorldChange = 'structure', cells?: Iterable<number>): void {
  worldRevisions(world);
  const record = revisions.get(world)!;
  world.revision = (world.revision ?? 0) + 1;
  record.raw = world.revision;
  record.unversioned = undefined;
  advance(record, change);
  // A structural edit changes entities, not tiles, unless its caller explicitly
  // supplies a footprint. Other unlocated edits require conservative refresh.
  if (cells !== undefined || change !== 'structure') recordCells(record, cells);
}

/** Register tile-only metadata changes that already have their own semantic
 * invalidation (for example clearing nonblocking decoration during registration). */
export function recordWorldTileChanges(world: World, cells: Iterable<number>): void {
  worldRevisions(world);
  recordCells(revisions.get(world)!, cells);
}

export function worldChangesSince(world: World, cursor?: number): WorldCellChanges {
  worldRevisions(world);
  const record = revisions.get(world)!;
  if (cursor === undefined || !Number.isSafeInteger(cursor) || cursor < record.fullAt || cursor > record.journal)
    return { revision: record.journal, full: true, cells: NO_CELLS };
  if (cursor === record.journal) return { revision: record.journal, full: false, cells: NO_CELLS };
  if (record.seen?.length !== world.tiles.length) { record.seen = new Uint32Array(world.tiles.length); record.stamp = 0; }
  record.stamp = (record.stamp + 1) >>> 0;
  if (!record.stamp) { record.seen.fill(0); record.stamp = 1; }
  const cells: number[] = [], { seen, stamp, history } = record;
  // Newest edits are normally a tiny suffix, even if other readers are slow.
  for (let i = history.length - 1; i >= record.historyStart && history[i].revision > cursor; i--)
    for (const cell of history[i].cells) if (seen[cell] !== stamp) { seen[cell] = stamp; cells.push(cell); }
  return { revision: record.journal, full: false, cells };
}
