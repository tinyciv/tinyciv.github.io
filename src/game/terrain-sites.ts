import { rustEngine } from './rust-engine';
import { reliefFlags, reliefFootprintAllowed } from './relief';
import { worldRevisions } from './world-revisions';
import { WATER, type World } from './types';

export const SETTLEMENT_MOUNTAIN_GAP = rustEngine.terrain_sites_mountain_gap();
interface TerrainMask { revision: number; width: number; height: number; tiles: World['tiles']; values: Uint8Array }
const masks = new WeakMap<World, TerrainMask>();
/** A single native field serves world generation, settlement planning and previews. */
export function settlementTerrainMask(world: World): Uint8Array {
  const revision = worldRevisions(world).geometry, old = masks.get(world);
  if (old && old.revision === revision && old.width === world.width && old.height === world.height && old.tiles === world.tiles) return old.values;
  const count = world.tiles.length, pointer = rustEngine.terrain_sites_input(count);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, count);
  world.tiles.forEach((tile, cell) => {
    const flags = reliefFlags(tile);
    input[cell] = (tile.ridge ? 1 : flags & 2 ? 0 : flags & 1 ? 1 : 2)
      | Number(WATER.has(tile.terrain) || !!tile.creek || !!tile.waterfall || tile.overlay === 'volcano' || tile.overlay === 'glacier') << 2;
  });
  const result = rustEngine.terrain_sites_calculate(world.width, world.height);
  const values = new Uint8Array(rustEngine.memory.buffer, result, count).slice();
  masks.set(world, { revision, width: world.width, height: world.height, tiles: world.tiles, values }); return values;
}
export function settlementFootprintAllowed(world: World, x: number, y: number, width = 1, height = width): boolean {
  x = Math.floor(x); y = Math.floor(y);
  if (!reliefFootprintAllowed(world, x, y, width, height)) return false;
  const mask = settlementTerrainMask(world);
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++)
    if ((mask[(y + dy) * world.width + x + dx] & 3) !== 3) return false;
  return true;
}
export function unitSpawnTerrainAllowed(world: World, x: number, y: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  return reliefFootprintAllowed(world, x, y) && !!(settlementTerrainMask(world)[y * world.width + x] & 4);
}
