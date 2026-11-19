import { rustEngine } from '../game/rust-engine';
import { reliefBuildable, reliefGroundWalkable } from '../game/relief';
import { ridgeStairAccess } from '../game/ridges';
import { WATER, type Tile, type World } from '../game/types';
import { resourceBlocksGround } from '../game/resource-terrain';

const depositResources = ['copper', 'iron', 'gold', 'marble', 'peat', 'grapes', 'coal'] as const;
const INPUT_STRIDE = 6;

/** Native habitat bits: salt=1, fish-bearing water=2, available dry ground=4. */
export function resourceHabitats(world: World): Float64Array {
  const n = world.tiles.length, pointer = rustEngine.ore_input(n);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, n);
  world.tiles.forEach((tile, cell) => {
    input[cell] = tile.geothermal || tile.overlay === 'volcano' || tile.overlay === 'glacier' ? 4
      : tile.terrain === 'ocean' ? 3 : WATER.has(tile.terrain) ? 2 : tile.terrain === 'tundra' ? 1 : 0;
  });
  const output = rustEngine.resource_habitats(world.width, world.height);
  return new Float64Array(rustEngine.memory.buffer, output, n).slice();
}
export const saltPanLimit = (): number => rustEngine.resource_group_limit(6);

/** Transport only: native ECS owns deposit placement, footprints and access. */
export function assignOreDeposits(world: World, cores: Uint8Array, tutorial = false, marbleSites?: Uint8Array): number {
  const n = world.tiles.length, pointer = rustEngine.ore_input(n * INPUT_STRIDE);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, n * INPUT_STRIDE);
  const starts = new Map<number, number>();
  world.spawns.forEach((point, faction) => starts.set(Math.floor(point.y) * world.width + Math.floor(point.x), faction + 1));
  world.secondarySpawns?.forEach((point, index) => starts.set(Math.floor(point.y) * world.width + Math.floor(point.x), index + 2));
  world.tiles.forEach((tile, cell) => {
    const x = cell % world.width, y = Math.floor(cell / world.width);
    const dry = !WATER.has(tile.terrain) && !tile.creek;
    const lowGround = !tile.ridge && !tile.stair && !tile.waterfall;
    const walk = lowGround && (dry || tile.terrain === 'river' && tile.overlay === 'ford');
    const replacedOre=tutorial&&['copper','iron','gold'].includes(tile.resource??'');
    const depositGround = dry && lowGround && !cores[cell] && reliefBuildable(tile) && (!tile.resource||replacedOre) && !tile.beach
      && !tile.geothermal && tile.farm === undefined && ['none', 'forest', 'jungle'].includes(tile.overlay) && !ridgeStairAccess(world, x, y);
    const eligible = depositGround && !tile.marsh;
    input.set([Number(walk && (!resourceBlocksGround(tile,false,cell,world.width)||replacedOre) && reliefGroundWalkable(world, x, y)
      && tile.overlay !== 'volcano' && tile.overlay !== 'glacier') | Number(eligible) << 1
      | Number(tile.overlay === 'forest' || tile.overlay === 'jungle') << 2
      | Number(tutorial && starts.has(cell)) << 3
      | Number(!!marbleSites?.[cell]) << 4
      | Number(depositGround) << 5
      | (starts.get(cell) ?? 0) << 6,
      tile.elevation, ['grassland', 'plains', 'desert', 'tundra'].indexOf(tile.terrain), Number(dry),
      tile.temperature ?? .5, tile.moisture], cell * INPUT_STRIDE);
  });
  let seed = 2166136261; for (const ch of `${world.seed}:ore`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const firstGroup = tutorial ? world.tiles.reduce((max, tile) => Math.max(max, tile.resourceGroup ?? 0), 0) + 1 : 1;
  const result = rustEngine.ore_generate(world.width, world.height, seed >>> 0, firstGroup, Number(tutorial));
  const rows = new Float64Array(rustEngine.memory.buffer, result, n * 8).slice();
  let nextGroup = firstGroup;
  for (let cell = 0; cell < n; cell++) {
    const at = cell * 8, kind = rows[at];
    if(tutorial&&['copper','iron','gold'].includes(world.tiles[cell].resource??'')) {
      const tile=world.tiles[cell];delete tile.resource;delete tile.resourceGroup;delete tile.resourceDeveloped;
      delete tile.oreAnchor;delete tile.oreFamily;delete tile.oreVariant;delete tile.oreWidth;delete tile.oreHeight;
    }
    const resource = depositResources[kind - 1];
    if (!resource) continue;
    const tile = world.tiles[cell]; tile.resource = resource;
    tile.resourceGroup = rows[at + 1]; tile.oreAnchor = rows[at + 2]; tile.oreFamily = rows[at + 3] as Tile['oreFamily'];
    tile.oreVariant = rows[at + 4] as 0 | 1; tile.oreWidth = rows[at + 5]; tile.oreHeight = rows[at + 6];
    tile.overlay = 'none'; delete tile.palm; delete tile.marsh; delete tile.treeClass;
    nextGroup = Math.max(nextGroup, tile.resourceGroup + 1);
  }
  return nextGroup;
}
