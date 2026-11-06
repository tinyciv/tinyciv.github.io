import { createNoise2D } from 'simplex-noise';
import { WATER, type RegionalResource, type World } from '../game/types';
import { environmentRandom, settlementCoreMask, terrainDistance } from './environment-fields';

/** Deposits follow broad geological patches with smaller seams. They are
 * economic metadata using existing ground artwork, never blocking objects. */
export function assignRegionalResources(world: World): void {
  const { width, height, tiles } = world, random = environmentRandom(`${world.seed}:resource-provinces`);
  const geology = createNoise2D(random), seams = createNoise2D(random);
  const fresh = terrainDistance(world, tile => tile.terrain === 'river' || tile.terrain === 'lake', 5);
  const coast = terrainDistance(world, tile => tile.terrain === 'coast' || tile.terrain === 'ocean', 5);
  const land = terrainDistance(world, tile => !WATER.has(tile.terrain), 5), cores = settlementCoreMask(world);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x, tile = tiles[cell];
    delete tile.resource;
    if (cores[cell] || tile.stair || tile.mountainPass) continue;
    const patch = .5 + geology(x * .047, y * .047) * .34 + seams(x * .16 + 29, y * .16 - 37) * .16;
    if (patch < .67) continue;
    let resource: RegionalResource | undefined;
    if (WATER.has(tile.terrain)) {
      if (tile.terrain !== 'ocean' && land[cell] <= 3 && (tile.temperature ?? .5) > .2) resource = 'fish';
    } else if (coast[cell] <= 2 && tile.moisture < .54 && !tile.ridge) resource = 'salt';
    else if (fresh[cell] <= 3 && !tile.ridge && (tile.fertility ?? .5) > .5) resource = 'clay';
    else if (tile.ridge || tile.elevation > .51) {
      resource = tile.elevation > .66 && geology(x * .022 + 170, y * .022 - 83) > .08 ? 'iron' : 'stone';
    }
    if (resource) tile.resource = resource;
  }
}
