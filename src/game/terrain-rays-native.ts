import { rustEngine } from './rust-engine';
import { worldRevisions, worldSightChangesSince } from './world-revisions';
import type { Point, World } from './types';
import type { FogView, SightSource } from './fog';
import { reliefFlags, rockFootprint } from './relief';

interface TerrainField {
  handle: number; revision: number; journal?: number;
  width: number; height: number; tiles: World['tiles']; pointer: number;
}
const fields = new WeakMap<World, TerrainField>();
const release = new FinalizationRegistry<number>(handle => rustEngine.terrain_rays_drop(handle));
const reliefCode = (tile: World['tiles'][number] | undefined): number => {
  const flags = reliefFlags(tile);
  return !tile || flags & 2 ? 0 : flags & 1 ? 2 : rockFootprint(tile) ? 3 : 1;
};

/** Terrain observations only. Rust owns obstruction policy and traversal.
 * A field is shared by fog, combat, territory and all projectile kinds.
 * Tree edits only compare their journaled cells; unchanged relief fields
 * retain their immutable native grid and prefix index. */
export function mountainTerrainHandle(world: World): number {
  const revision = worldRevisions(world).sight;
  let field = fields.get(world);
  if (field && field.revision === revision && field.width === world.width && field.height === world.height && field.tiles === world.tiles)
    return field.handle;
  const fresh = !field || field.width !== world.width || field.height !== world.height || field.tiles !== world.tiles;
  if (!field) {
    field = { handle: rustEngine.terrain_rays_create(), revision: -1, width: world.width, height: world.height, tiles: world.tiles, pointer: 0 };
    fields.set(world, field); release.register(field, field.handle);
  }
  const changes = worldSightChangesSince(world, fresh ? undefined : field.journal);
  const count = world.width * world.height;
  if (fresh) field.pointer = rustEngine.terrain_rays_input(field.handle, count);
  const input = new Float64Array(rustEngine.memory.buffer, field.pointer, count);
  let changed = fresh;
  if (fresh || changes.full) {
    for (let cell = 0; cell < count; cell++) {
      const value = reliefCode(world.tiles[cell]);
      if (input[cell] !== value) { input[cell] = value; changed = true; }
    }
  } else for (const cell of changes.cells) {
    const value = reliefCode(world.tiles[cell]);
    if (input[cell] !== value) { input[cell] = value; changed = true; }
  }
  if (changed) rustEngine.terrain_rays_commit(field.handle, world.width, world.height);
  field.width = world.width; field.height = world.height; field.tiles = world.tiles;
  field.revision = revision; field.journal = changes.revision;
  return field.handle;
}

export function mountainLineClear(world: World, from: Point, target: Point, visibleTarget = false): boolean {
  return !!rustEngine.terrain_rays_clear(mountainTerrainHandle(world), from.x, from.y, target.x, target.y, Number(visibleTarget));
}

export function hasMountainCover(world: World, source: Point, radius: number): boolean {
  return !!rustEngine.terrain_rays_nearby(mountainTerrainHandle(world), source.x, source.y, radius);
}

const landmarkObservers = new WeakMap<World, readonly SightSource[]>();
/** Transport sampled observers once. Rust indexes sources and caches horizon
 * rays; rendering requests only relief cells in the current viewport. */
export function landmarkSight(fog: FogView): (cell: number) => boolean {
  const world = fog.world;
  if (!world) return () => false;
  const handle = mountainTerrainHandle(world);
  if (landmarkObservers.get(world) !== fog.sources) {
    const pointer = rustEngine.terrain_rays_observers_input(handle, fog.sources.length);
    const input = new Float64Array(rustEngine.memory.buffer, pointer, fog.sources.length * 2);
    fog.sources.forEach((source, i) => { input[i * 2] = source.x; input[i * 2 + 1] = source.y; });
    rustEngine.terrain_rays_observe(handle);
    landmarkObservers.set(world, fog.sources);
  }
  return cell => !!rustEngine.terrain_rays_landmark_visible(handle, cell, world.tiles[cell]?.relief === 'mountains' ? 2 : 1);
}
