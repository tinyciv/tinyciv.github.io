import { rustEngine } from './rust-engine';
import { reliefFlags, reliefFootprintAllowed, reliefLevel } from './relief';
import { forestBlocksConstruction } from './geography';
import { worldRevisions } from './world-revisions';
import { WATER, type World } from './types';

export const SETTLEMENT_MOUNTAIN_GAP = rustEngine.terrain_sites_mountain_gap();
export const STARTING_RESOURCE_CLEARANCE = 8;
const FLAT_DRY_GROUND = 1;
const MOUNTAIN_CLEARANCE = 2;
interface TerrainMask { revision: number; width: number; height: number; tiles: World['tiles']; values: Uint8Array }
const masks = new WeakMap<World, TerrainMask>();
/** The native field caches landform constraints. Site queries check live
 * obstacles in the footprint so felling a tree need not rebuild this field. */
export function settlementTerrainMask(world: World): Uint8Array {
  const revision = worldRevisions(world).geometry, old = masks.get(world);
  if (old && old.revision === revision && old.width === world.width && old.height === world.height && old.tiles === world.tiles) return old.values;
  const count = world.tiles.length, pointer = rustEngine.terrain_sites_input(count);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, count);
  world.tiles.forEach((tile, cell) => {
    // Solid formations are local obstructions. Only regional mountains
    // contribute to the wider gap used by starting-site selection.
    const landform = reliefLevel(tile) === 2 ? 2 : tile.rockHost !== undefined || !(reliefFlags(tile) & 2) ? 1 : 0;
    input[cell] = landform
      | Number(WATER.has(tile.terrain) || !!tile.creek || !!tile.waterfall || tile.overlay === 'volcano' || tile.overlay === 'glacier') << 2
      | Number(!!tile.resource) << 3;
  });
  const result = rustEngine.terrain_sites_calculate(world.width, world.height);
  const values = new Uint8Array(rustEngine.memory.buffer, result, count).slice();
  masks.set(world, { revision, width: world.width, height: world.height, tiles: world.tiles, values }); return values;
}
function allowsSettlementFootprint(world: World, x: number, y: number, width: number, height: number, required: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  if (!reliefFootprintAllowed(world, x, y, width, height)) return false;
  const mask = settlementTerrainMask(world);
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++)
    if ((mask[(y + dy) * world.width + x + dx] & required) !== required) return false;
  return true;
}
export function settlementFootprintAllowed(world: World, x: number, y: number, width = 1, height = width, requireResourceClearance = false): boolean {
  return allowsSettlementFootprint(world, x, y, width, height, FLAT_DRY_GROUND | MOUNTAIN_CLEARANCE
    | (requireResourceClearance ? STARTING_RESOURCE_CLEARANCE : 0));
}
/** Orders need clear land under the buildings. Opening towns also need room
 * for their generated roads, housing and civilian jobs. */
export function settlementConstructionAllowed(world: World, x: number, y: number, width: number, height: number): boolean {
  return allowsSettlementFootprint(world, x, y, width, height, FLAT_DRY_GROUND);
}
export function unitSpawnTerrainAllowed(world: World, x: number, y: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  const cell = y * world.width + x;
  return !forestBlocksConstruction(world.tiles[cell]) && reliefFootprintAllowed(world, x, y) && !!(settlementTerrainMask(world)[cell] & 4);
}
