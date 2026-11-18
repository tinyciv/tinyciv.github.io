import { rustEngine } from '../game/rust-engine';
import { type Terrain, type Tile, type World } from '../game/types';
import { markWorldChanged } from '../game/world-revisions';
import { settlementCoreMask } from './environment-fields';

const STAIRS: readonly Tile['stair'][] = [undefined, 'north', 'east', 'south', 'west'];
// The native atlas has grassland and sandstone shelf palettes.
const ledgeTerrain: Partial<Record<Terrain, number>> = { grassland: 1, plains: 2, desert: 3 };

export function generateLedges(world: World, coverage: number): void {
  const { width, height, tiles } = world, cores = settlementCoreMask(world);
  const pointer = rustEngine.relief_input(tiles.length * 2);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, tiles.length * 2);
  tiles.forEach((tile, cell) => {
    const eligible = !cores[cell] && !tile.worldFeature && !tile.creek && !tile.marsh && !tile.beach && !tile.palm
      && !tile.waterfall && !tile.resource && !tile.geothermal
      && (tile.overlay === 'none' || tile.overlay === 'forest' || tile.overlay === 'jungle');
    input[cell * 2] = eligible ? ledgeTerrain[tile.terrain] ?? 0 : 0;
    input[cell * 2 + 1] = tile.elevation;
  });
  let seed = 2166136261;
  for (const ch of `${world.seed}:cliffs`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const output = rustEngine.ledge_generate(width, height, seed >>> 0, coverage);
  const rows = new Float64Array(rustEngine.memory.buffer, output, tiles.length * 3);
  const changed: number[] = [];
  for (let cell = 0; cell < tiles.length; cell++) {
    const ridge = rows[cell * 3], flags = rows[cell * 3 + 2];
    if (!ridge && !flags) continue;
    const tile = tiles[cell];
    if (ridge) {
      tile.ridge = ridge;
      tile.reliefLevel = 1;
      const stair = STAIRS[rows[cell * 3 + 1]];
      if (stair) tile.stair = stair;
    }
    tile.reliefFlags = flags;
    changed.push(cell);
  }
  if (changed.length) markWorldChanged(world, 'geometry', changed);
}
