import { rustEngine } from '../game/rust-engine';
import type { World } from '../game/types';
import { tundraBoundary } from './tundra';

const COLD_LAND = 1, SNOW_GROUND = 2, OPEN_SEA = 4, COLD_SEA = 8;
const SEA_ICE = 1 << 15;

/** Pass the final land and climate to the native winter terrain generator once. */
export function generateWinterTerrain(world: World): void {
  const polar = tundraBoundary(world), count = world.tiles.length;
  let seed = 2166136261;
  for (const character of `${world.seed}:frost`) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  const input = rustEngine.frost_input(count);
  const terrain = new Uint8Array(rustEngine.memory.buffer, input, count);
  for (let cell = 0; cell < count; cell++) {
    const tile = world.tiles[cell];
    if (tile.terrain === 'tundra') {
      const snowGround = !tile.creek && !tile.relief && !tile.geothermal && !tile.marsh && tile.rockHost === undefined;
      terrain[cell] = COLD_LAND | (snowGround ? SNOW_GROUND : 0);
    } else if ((tile.terrain === 'ocean' || tile.terrain === 'coast') && !tile.creek && !tile.relief && !tile.waterfall && !tile.riverArt) {
      const cold = tile.fjord !== 'water' && polar(cell % world.width, Math.floor(cell / world.width)) <= 0;
      terrain[cell] = OPEN_SEA | (cold ? COLD_SEA : 0);
    } else terrain[cell] = 0;
  }
  const output = rustEngine.frost_generate(world.width, world.height, seed >>> 0);
  const art = new Uint16Array(rustEngine.memory.buffer, output, count);
  for (let cell = 0; cell < count; cell++) {
    if (art[cell] & SEA_ICE) world.tiles[cell].seaIce = art[cell] & ~SEA_ICE;
    else if (art[cell]) world.tiles[cell].snow = art[cell];
  }
}
