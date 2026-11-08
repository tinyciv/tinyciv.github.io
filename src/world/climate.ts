import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';
import { createNoise2D } from 'simplex-noise';
import { WATER, type Biome, type World } from '../game/types';
import { terrainYields } from './generator';
import { clampUnit, environmentRandom, settlementCoreMask, terrainDistance } from './environment-fields';

type Noise = (x: number, y: number) => number;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** A broad warm belt with wandering, noisy climatic boundaries. North lies at
 * the top of the map; the equator is deliberately below its midpoint so there
 * is room for a cool northern hinterland as well as a variable warm frontier. */
export function sampleTerrainClimate(x: number, y: number, width: number, height: number,
  moistureNoise: Noise, warpNoise: Noise, parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): {
    moisture: number; terrain: 'grassland' | 'plains' | 'desert'; wx: number; wy: number;
  } {
  const scale = parameters.climatePatchScale;
  const wx = x + warpNoise(x * .047 / scale + 8, y * .047 / scale + 2) * 5.5 * scale;
  const wy = y + warpNoise(x * .047 / scale - 28, y * .047 / scale + 92) * 5.5 * scale;
  const equator = parameters.equatorPosition + warpNoise(x / width * 2.4 + 83, 17) * .045;
  const distance = (wy / (height - 1) - equator) / parameters.equatorWidth;
  const warmth = Math.exp(-.5 * distance * distance);
  const regional = moistureNoise(wx * .036 / scale, wy * .036 / scale);
  const local = moistureNoise(wx * .10 / scale + 27, wy * .10 / scale - 19);
  const moisture = clamp(parameters.moisture + parameters.climateVariation * (regional + local * .25)
    + parameters.latitudeInfluence * (.45 - warmth) * .65);
  // Latitude shifts the desert threshold instead of imposing a hard biome
  // boundary. Unusually dry northern patches and wet equatorial groves survive.
  const desertLimit = parameters.desertThreshold - (1 - warmth) * parameters.latitudeInfluence;
  // Keep a dry-grass transition even when the selected desert threshold rises
  // above the former fixed plains threshold. Climate controls must not turn
  // the desert directly into lush grass at the next moisture value.
  const terrain = moisture < desertLimit ? 'desert' : moisture < desertLimit + .14 ? 'plains' : 'grassland';
  return { moisture, terrain, wx, wy };
}

/** A reproducible prevailing wind, independent of terrain iteration order. */
export function prevailingWind(seed: string): -1 | 1 {
  return environmentRandom(`${seed}:prevailing-wind`)() < .5 ? -1 : 1;
}

export function climateBiome(temperature: number, rainfall: number, elevation: number, desertThreshold = .27): Biome {
  if (elevation > .72 && temperature < .36) return 'alpine';
  if (temperature < .17) return 'tundra';
  if (rainfall < desertThreshold) return 'desert';
  if (temperature < .36) return 'taiga';
  if (rainfall < .43) return temperature > .64 ? 'savanna' : 'steppe';
  if (temperature > .67 && rainfall > .64) return 'rainforest';
  return 'temperate';
}

/** Ocean moisture travels downwind, rains on rising ground and leaves a dry
 * lee. Values are game-scale suitability, not physical degrees or millimeters.
 * Rebuilding from the seed makes a pre-drainage and final pass safe. */
export function applyWorldClimate(world: World, parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): void {
  const { width, height, tiles } = world, random = environmentRandom(`${world.seed}:regional-climate`);
  const noise = createNoise2D(random), warp = createNoise2D(random), wind = prevailingWind(world.seed);
  const coast = terrainDistance(world, tile => tile.terrain === 'coast' || tile.terrain === 'ocean');
  const fresh = terrainDistance(world, tile => tile.terrain === 'river' || tile.terrain === 'lake', 12);
  const cores = settlementCoreMask(world);
  for (let y = 0; y < height; y++) {
    let vapor = .55, previousHeight = 0, barrier = 0;
    for (let n = 0; n < width; n++) {
      const x = wind === 1 ? n : width - 1 - n, cell = y * width + x, tile = tiles[cell];
      const sample = sampleTerrainClimate(x, y, width, height, noise, warp, parameters);
      const sea = tile.terrain === 'coast' || tile.terrain === 'ocean', water = WATER.has(tile.terrain);
      const elevation = sea ? 0 : tile.elevation;
      const equator = parameters.equatorPosition + warp(x / width * 2.4 + 83, 17) * .045;
      const latitude = (sample.wy / Math.max(1, height - 1) - equator) / parameters.equatorWidth;
      const warmth = Math.exp(-.5 * latitude * latitude);
      const continental = .12 + warmth * .82 - Math.max(0, elevation - .18) * .37;
      const maritime = Math.exp(-coast[cell] / 13) * .22;
      const temperature = clampUnit(continental * (1 - maritime) + .56 * maritime);
      if (water) vapor = sea ? .92 : Math.max(vapor, .74);
      const rise = Math.max(0, elevation - previousHeight), lee = Math.max(0, barrier - elevation);
      const rainfall = clampUnit(sample.moisture * .70 + vapor * .30 + rise * .72 - lee * .34);
      tile.temperature = temperature;
      tile.rainfall = rainfall;
      tile.moisture = clampUnit(rainfall - Math.max(0, temperature - .56) * .16 + Math.exp(-fresh[cell] / 4) * .10);
      if (!water) {
        // Hot interiors and rain shadows produce recognisable desert regions,
        // rather than just a handful of isolated sand cells. Cool, rainy north
        // and maritime regions still follow the existing climate classification.
        tile.biome = climateBiome(temperature, rainfall, elevation,
          .33 + parameters.desertThreshold - DEFAULT_LANDSCAPE_PARAMETERS.desertThreshold);
        const old = terrainYields(tile.terrain, tile.overlay);
        if (!tile.beach && !cores[cell]) {
          tile.terrain = tile.biome === 'desert' ? 'desert'
            : ['savanna', 'steppe'].includes(tile.biome) ? 'plains' : 'grassland';
          // Moist riverbanks retain their alluvial ground through the final pass.
          if (fresh[cell] <= 1 && tile.terrain === 'desert') tile.terrain = 'plains';
        }
        const next = terrainYields(tile.terrain, tile.overlay);
        for (const resource of ['food', 'production', 'gold'] as const)
          tile[resource] = Math.max(0, tile[resource] + next[resource] - old[resource]);
      } else delete tile.biome;
      vapor = clampUnit(vapor - (water ? 0 : .004 + rise * .12));
      barrier = sea ? 0 : Math.max(elevation, barrier - .025);
      previousHeight = elevation;
    }
  }
}
