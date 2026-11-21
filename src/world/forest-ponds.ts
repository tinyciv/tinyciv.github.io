import { rustEngine } from '../game/rust-engine';
import { WATER, type World } from '../game/types';
import { environmentRandom, terrainDistance } from './environment-fields';
import { terrainYields } from './generator';
import type { LandscapeParameters } from './options';
import { createTerrainEnvironment } from './terrain-ecology';
import { tundraBoundary } from './tundra';

/** Reserve small woodland basins before river routing and settlement siting. */
export function placeForestPonds(world: World, parameters: LandscapeParameters): void {
  const { tiles, width, height } = world;
  const { woodland } = createTerrainEnvironment(tiles, width, height, world.seed, parameters);
  const existingWater = terrainDistance(world, tile => WATER.has(tile.terrain), 3);
  const polar = tundraBoundary(world);
  const pointer = rustEngine.woodland_input(tiles.length);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, tiles.length * 2);
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    input[cell * 2 + 1] = tile.elevation;
    if (tile.terrain === 'grassland' && (tile.biome === 'temperate' || tile.biome === 'taiga')
      && existingWater[cell] > 3 && polar(cell % width, Math.floor(cell / width)) > 3) {
      input[cell * 2] = 1 + woodland[cell] - parameters.forestThreshold;
    }
  }
  const seed = Math.floor(environmentRandom(`${world.seed}:forest-ponds`)() * 0x100000000);
  const output = rustEngine.forest_ponds_generate(width, height, seed, parameters.lakeDensity);
  const cover = new Uint8Array(rustEngine.memory.buffer, output, tiles.length);
  const seen = new Uint8Array(tiles.length);
  const basin: number[] = [];
  for (let start = 0; start < tiles.length; start++) {
    if (!cover[start] || seen[start]) continue;
    basin.length = 0;
    basin.push(start);
    seen[start] = 1;
    let rim = Infinity;
    for (let head = 0; head < basin.length; head++) {
      const cell = basin[head];
      for (const next of [cell - 1, cell + 1, cell - width, cell + width]) {
        if (!cover[next]) rim = Math.min(rim, tiles[next].elevation);
        else if (!seen[next]) { seen[next] = 1; basin.push(next); }
      }
    }
    const elevation = Math.max(.015, rim - .012);
    for (const cell of basin) {
      const tile = tiles[cell];
      tile.terrain = 'lake';
      tile.overlay = 'none';
      tile.lakeShape = 'forest-pond';
      tile.elevation = elevation;
      delete tile.biome;
      Object.assign(tile, terrainYields('lake', 'none'));
    }
  }
}
