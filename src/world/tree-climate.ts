import { type Tile, type TreeClass, type World } from '../game/types';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';

/** Zero at the configured equator; one near cold northern latitudes. */
export function treeClimateLatitude(y: number, height: number,
  parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): number {
  return Math.abs(y / Math.max(1, height - 1) - parameters.equatorPosition) / (parameters.equatorWidth * 2);
}

/** Local transitions mix only neighboring climate families. The broad latitude
 * bands keep entire stands coherent instead of mixing every atlas tree. */
export function climateTreeClass(latitude: number, tile: Pick<Tile, 'moisture' | 'elevation' | 'variation' | 'terrain' | 'temperature' | 'biome'>): TreeClass {
  if (tile.terrain === 'tundra') return 'snowy';
  if (tile.temperature !== undefined) {
    if (tile.temperature < .20 || tile.biome === 'alpine') return 'conifer';
    if (tile.temperature < .37) return 'conifer';
    if (tile.temperature > .68 && tile.moisture > .49) return 'tropical';
    if (tile.moisture < .43 || tile.biome === 'savanna' || tile.terrain === 'desert') return 'dry';
    return 'temperate';
  }
  const cold = latitude + Math.max(0, tile.elevation - .5) * .22;
  const edge = (tile.variation - .5) * .035;
  if (cold > .56 + edge) return 'conifer';
  if (latitude < .28 + edge && tile.moisture > .48) return 'tropical';
  if (tile.moisture < .49 || tile.terrain === 'desert') return 'dry';
  return 'temperate';
}

/** Assign only after river, island, beach and ridge placement is complete.
 * Low-frequency curvature avoids perfectly straight climatic boundaries. */
export function assignTreeClimate(world: World, parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): void {
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const tile = world.tiles[y * world.width + x];
    const latitude = treeClimateLatitude(y, world.height, parameters);
    const warped = Math.max(0, latitude + Math.sin((x * .055 + y * .019) / parameters.climatePatchScale)
      * .025 * parameters.climateVariation / .28);
    if (tile.palm && (latitude > .43 || tile.temperature !== undefined && tile.temperature < .60)) delete tile.palm;
    if (tile.overlay !== 'forest' && tile.overlay !== 'jungle' && !tile.palm) { delete tile.treeClass; continue; }
    tile.treeClass = tile.palm ? 'tropical' : climateTreeClass(warped, tile);
  }
}
