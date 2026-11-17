import { rustEngine } from '../game/rust-engine';
import { reliefBuildable, reliefGroundWalkable } from '../game/relief';
import { WATER, type World } from '../game/types';
import { resourceBlocksGround } from '../game/resource-terrain';

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

/** Transport only: native ECS owns geology adjacency, footprints and access. */
export function assignOreDeposits(world: World, cores: Uint8Array, tutorial=false): number {
  const n = world.tiles.length, pointer = rustEngine.ore_input(n * 4);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, n * 4);
  world.tiles.forEach((tile, cell) => {
    const dry = !WATER.has(tile.terrain) && !tile.creek;
    const walk = dry || tile.terrain === 'river' && tile.overlay === 'ford';
    const replacedOre=tutorial&&['copper','iron','gold'].includes(tile.resource??'');
    const eligible = dry && !cores[cell] && reliefBuildable(tile) && (!tile.resource||replacedOre) && !tile.beach && !tile.marsh
      && tile.farm === undefined && ['none', 'forest', 'jungle'].includes(tile.overlay);
    input.set([Number(walk && (!resourceBlocksGround(tile,false,cell,world.width)||replacedOre) && reliefGroundWalkable(world, cell % world.width, Math.floor(cell / world.width))
      && tile.overlay !== 'volcano' && tile.overlay !== 'glacier') | Number(eligible) << 1
      | Number(tile.overlay === 'forest' || tile.overlay === 'jungle') << 2
      | Number(tutorial&&world.spawns.some(p=>p.y*world.width+p.x===cell)) << 3,
      Number(!!tile.relief), ['grassland', 'plains', 'desert', 'tundra'].indexOf(tile.terrain), Number(dry)], cell * 4);
  });
  let seed = 2166136261; for (const ch of `${world.seed}:mountain-ore`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const firstGroup=tutorial?Math.max(0,...world.tiles.map(tile=>tile.resourceGroup??0))+1:1;
  const result = rustEngine.ore_generate(world.width, world.height, seed >>> 0, firstGroup, Number(tutorial));
  const rows = new Float64Array(rustEngine.memory.buffer, result, n * 8).slice();
  let nextGroup = 1;
  for (let cell = 0; cell < n; cell++) {
    const at = cell * 8, kind = rows[at];
    if(tutorial&&['copper','iron','gold'].includes(world.tiles[cell].resource??'')) {
      const tile=world.tiles[cell];delete tile.resource;delete tile.resourceGroup;delete tile.resourceDeveloped;
      delete tile.oreAnchor;delete tile.oreFamily;delete tile.oreVariant;delete tile.oreWidth;delete tile.oreHeight;
    }
    if (!kind) continue;
    const tile = world.tiles[cell]; tile.resource = kind === 1 ? 'copper' : kind === 2 ? 'iron' : 'gold';
    tile.resourceGroup = rows[at + 1]; tile.oreAnchor = rows[at + 2]; tile.oreFamily = rows[at + 3] as 0 | 1 | 2;
    tile.oreVariant = rows[at + 4] as 0 | 1; tile.oreWidth = rows[at + 5]; tile.oreHeight = rows[at + 6];
    tile.overlay = 'none'; delete tile.palm; delete tile.marsh; delete tile.treeClass;
    nextGroup = Math.max(nextGroup, tile.resourceGroup + 1);
  }
  return nextGroup;
}
