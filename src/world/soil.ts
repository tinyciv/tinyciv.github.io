import { createNoise2D } from 'simplex-noise';
import { WATER, type World } from '../game/types';
import { clampUnit, environmentRandom, settlementCoreMask, terrainDistance } from './environment-fields';

/** Alluvial lowlands retain water and soil; exposed slopes and cold/arid ground
 * support smaller harvests. Kept separate from vegetation so clearing a forest
 * does not erase the underlying agricultural suitability. */
export function applySoilFertility(world: World): void {
  const { width, height, tiles } = world, noise = createNoise2D(environmentRandom(`${world.seed}:soil`));
  const freshwater = terrainDistance(world, tile => tile.terrain === 'river' || tile.terrain === 'lake', 16);
  const cores = settlementCoreMask(world);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x, tile = tiles[cell];
    if (WATER.has(tile.terrain)) { tile.fertility = 0; continue; }
    let slope = 0, surrounding = 0, neighbors = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = tiles[ny * width + nx];
      if (!WATER.has(other.terrain)) { slope = Math.max(slope, Math.abs(other.elevation - tile.elevation)); surrounding += other.elevation; neighbors++; }
    }
    const concavity = neighbors ? Math.max(-.2, Math.min(.2, surrounding / neighbors - tile.elevation)) : 0;
    const water = Math.exp(-freshwater[cell] / 3.5), lowland = tile.ridge ? .15 : 1;
    const wetness = tile.moisture, temperature = tile.temperature ?? .55;
    const drought = Math.max(0, .45 - wetness), cold = Math.max(0, .36 - temperature);
    let fertility = .59 + noise(x * .045 + 17, y * .045 - 51) * .11 + water * lowland * .23
      + concavity * .35 - slope * .55 - drought * .8 - cold * .85;
    if (tile.terrain === 'desert') fertility -= .22;
    if (tile.biome === 'alpine') fertility -= .15;
    if (tile.beach) fertility -= .25;
    const wetland = !tile.ridge && !tile.beach && !cores[cell] && freshwater[cell] <= 2
      && wetness > .67 && temperature > .25 && slope < .09;
    if (wetland) { tile.biome = 'wetland'; fertility -= .10; }
    tile.fertility = clampUnit(fertility);
  }
}
