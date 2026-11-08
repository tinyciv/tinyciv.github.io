import { WATER, type World } from '../game/types';
import { baseSoilFertility, freshwaterFertilityBonus, FERTILITY_BONUS_DISTANCE } from '../game/fertility';
import { settlementCoreMask, terrainDistance } from './environment-fields';

/** Soil is a direct harvest multiplier. Vegetation and wetland ecology remain
 * separate, so clearing trees does not alter the underlying fertility. */
export function applySoilFertility(world: World): void {
  const { width, height, tiles } = world;
  const freshwater = terrainDistance(world, tile => tile.terrain === 'river' || tile.terrain === 'lake', FERTILITY_BONUS_DISTANCE);
  const cores = settlementCoreMask(world);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x, tile = tiles[cell];
    if (WATER.has(tile.terrain)) { tile.fertility = 0; continue; }
    let slope = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = tiles[ny * width + nx];
      if (!WATER.has(other.terrain)) slope = Math.max(slope, Math.abs(other.elevation - tile.elevation));
    }
    const wetness = tile.moisture, temperature = tile.temperature ?? .55;
    const wetland = tile.terrain !== 'tundra' && !tile.ridge && !tile.beach && !cores[cell] && freshwater[cell] <= 2
      && wetness > .67 && temperature > .25 && slope < .09;
    if (wetland) tile.biome = 'wetland';
    tile.fertility = baseSoilFertility(tile.terrain) + freshwaterFertilityBonus(freshwater[cell]);
  }
}
