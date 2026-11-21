import { fertilityGrassTerrain } from '../game/fertility';
import { rustEngine } from '../game/rust-engine';
import type { Tile, World } from '../game/types';

const GRASS_OR_PLAINS = 1, FRESHWATER = 2;
type Density = NonNullable<Tile['fertilityGrass']>;

/** Transport the finalized landscape once. Rust chooses patch coverage and density. */
export function generateFertilityGrass(world: World): void {
  const { tiles, width, height } = world;
  let seed = 2166136261;
  for (const character of `${world.seed}:fertility-grass`) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  const pointer = rustEngine.fertility_grass_input(tiles.length);
  const input = new Uint8Array(rustEngine.memory.buffer, pointer, tiles.length);
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    input[cell] = (fertilityGrassTerrain(tile) ? GRASS_OR_PLAINS : 0)
      | (tile.terrain === 'river' || tile.terrain === 'lake' ? FRESHWATER : 0);
  }
  const output = rustEngine.fertility_grass_generate(width, height, seed >>> 0, Number(world.scenario === 'musketry-deathmatch'));
  const density = new Uint8Array(rustEngine.memory.buffer, output, tiles.length);
  for (let cell = 0; cell < tiles.length; cell++) {
    if (density[cell]) tiles[cell].fertilityGrass = density[cell] as Density;
    else if (tiles[cell].fertilityGrass !== undefined) delete tiles[cell].fertilityGrass;
  }
}
