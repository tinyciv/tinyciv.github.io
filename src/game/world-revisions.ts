import type { World } from './types';

/** Buildings/roads change navigation without necessarily changing the terrain
 * image, woodland sight costs, or the ground on which territory can be claimed. */
export type WorldChange = 'structure' | 'appearance' | 'sight' | 'geometry';
export interface WorldRevisions { readonly appearance: number; readonly sight: number; readonly geometry: number }
interface TrackedWorld {
  raw: number | undefined; tiles: World['tiles']; width: number; height: number; seed: string;
  versions: WorldRevisions; structure: number; unversioned?: string;
}
const revisions = new WeakMap<World, TrackedWorld>();

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
    `${tile.terrain},${tile.overlay},${Number(!!tile.palm)},${Number(!!tile.marsh)},${Number(tile.farm !== undefined)},${Number(!!tile.beach)},${tile.variation},${tile.ridge ?? 0},${tile.ridgeTier ?? 1},${tile.stair ?? ''},${Number(!!tile.villageTrail)},${Number(!!tile.creek)},${tile.creekGround ?? ''},${tile.riverArt ?? ''},${tile.waterfall ?? ''}`).join(';') : undefined;
  let record = revisions.get(world);
  if (!record) {
    record = { raw: world.revision, tiles: world.tiles, width: world.width, height: world.height, seed: world.seed,
      versions: { appearance: 0, sight: 0, geometry: 0 }, structure: 0, unversioned };
    revisions.set(world, record);
  } else if (record.unversioned !== unversioned || record.raw !== world.revision || record.tiles !== world.tiles
    || record.width !== world.width || record.height !== world.height || record.seed !== world.seed) {
    advance(record, 'geometry');
    record.raw = world.revision; record.tiles = world.tiles; record.width = world.width; record.height = world.height; record.seed = world.seed;
    record.unversioned = unversioned;
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
export function markWorldChanged(world: World, change: WorldChange = 'structure'): void {
  worldRevisions(world);
  const record = revisions.get(world)!;
  world.revision = (world.revision ?? 0) + 1;
  record.raw = world.revision;
  record.unversioned = undefined;
  advance(record, change);
}
