import { seededRandom } from '../../src/world/generator';
import { LANDSCAPE_CONTROLS, resolveLandscapeParameters, type LandscapeParameter, type LandscapeParameters } from '../../src/world/options';
import { WATER, type World, type Point } from '../../src/game/types';

export const GALLERY_SEED = 'FRACTAL-STUDY-2026';
export const SAMPLE_COUNT = 25;
export type Sample = { id: string; title: string; seed: string; parameters: LandscapeParameters };
export type Summary = { land: number; forest: number; desert: number; relief: number; lakeCount: number; compactLakes: number; minimumStartDistance: number; meanStartDistance: number; startVariation: number; mountainBodies: number; latitudeForest: number[]; latitudeDesert: number[] };
export type Record = Sample & { width: number; height: number; summary: Summary; capitals: Point[]; secondary: Point[]; preview: string };

/** Latin-hypercube sampling visits every portion of each control's review range
 * without coupling all the wettest, rockiest, and largest settings together. */
export function sampleSettings(seed = GALLERY_SEED): Sample[] {
  const random = seededRandom(`${seed}:parameter-study`);
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => ({ id: String(index + 1).padStart(2, '0'), title: '', seed, parameters: resolveLandscapeParameters() }));
  const integers = new Set<LandscapeParameter>(['riverCount', 'startRelaxations', 'mountainLengthMin', 'mountainLengthMax']);
  for (const key of Object.keys(LANDSCAPE_CONTROLS) as LandscapeParameter[]) {
    const control = LANDSCAPE_CONTROLS[key];
    const strata = Array.from({ length: SAMPLE_COUNT }, (_, n) => n);
    for (let i = strata.length - 1; i; i--) { const j = Math.floor(random() * (i + 1)); [strata[i], strata[j]] = [strata[j], strata[i]]; }
    // Avoid combining multiple unsupported extreme settings. The full public
    // range is still documented alongside the precise value for every sample.
    let minimum = control.min + (control.max - control.min) * .1;
    let maximum = control.max - (control.max - control.min) * .1;
    if (key === 'landScale') { minimum = .94; maximum = 1.12; }
    if (key === 'coastRoughness') { minimum = .75; maximum = 1.4; }
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const value = minimum + (maximum - minimum) * (strata[i] + random()) / SAMPLE_COUNT;
      samples[i].parameters[key] = integers.has(key) ? Math.round(value) : Number(value.toFixed(4));
    }
  }
  for (const sample of samples) {
    const p = sample.parameters;
    const landscape = p.mountainClumpShare > .46 ? 'Massifs' : p.mountainStringShare > .46 ? 'Broken ranges' : 'Long ridges';
    sample.title = `${p.moisture > .55 ? 'Verdant' : p.moisture < .49 ? 'Dry' : 'Mixed'} ${landscape.toLowerCase()}`;
    resolveLandscapeParameters(p);
  }
  return samples;
}

export function measure(world: World): Summary {
  const { tiles, width, height } = world;
  let land = 0, forest = 0, desert = 0, relief = 0, lakeCount = 0, compactLakes = 0;
  const bandLand = [0, 0, 0], bandForest = [0, 0, 0], bandDesert = [0, 0, 0];
  const mountains = new Set<number>(), seen = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i], band = Math.min(2, Math.floor(Math.floor(i / width) / height * 3));
    if (!WATER.has(tile.terrain)) {
      land++; bandLand[band]++;
      if (tile.overlay === 'forest' || tile.overlay === 'jungle') { forest++; bandForest[band]++; }
      if (tile.terrain === 'desert' && !tile.beach) { desert++; bandDesert[band]++; }
      if (tile.ridge) relief++;
    }
    if (tile.ridge && tile.relief === 'mountains') mountains.add(tile.ridge);
    if (tile.terrain !== 'lake' || seen[i]) continue;
    lakeCount++; let compact = 0, snaky = 0;
    const queue = [i]; seen[i] = 1;
    for (let h = 0; h < queue.length; h++) {
      const cell = queue[h], x = cell % width, y = Math.floor(cell / width);
      compact += Number(tiles[cell].lakeShape === 'compact'); snaky += Number(tiles[cell].lakeShape === 'snaky');
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || tiles[next].terrain !== 'lake') continue;
        seen[next] = 1; queue.push(next);
      }
    }
    if (compact >= snaky) compactLakes++;
  }
  const distances = world.spawns.map((point, index) => Math.min(...world.spawns.filter((_, n) => n !== index).map(other => Math.hypot(point.x - other.x, point.y - other.y))));
  const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
  return { land: land / tiles.length, forest: forest / land, desert: desert / land, relief: relief / land,
    lakeCount, compactLakes, minimumStartDistance: Math.min(...distances), meanStartDistance: mean,
    startVariation: Math.sqrt(distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / distances.length) / mean,
    mountainBodies: mountains.size, latitudeForest: bandForest.map((n, i) => n / Math.max(1, bandLand[i])), latitudeDesert: bandDesert.map((n, i) => n / Math.max(1, bandLand[i])) };
}

export function overviewPixels(world: World): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(world.tiles.length * 4);
  const colors = { ocean: '#097f96', coast: '#05a4b3', river: '#29bbaa', lake: '#73d9ca', forest: '#3e6239',
    desert: '#c9b66d', grassland: '#8d9f4e', plains: '#a5a568', hills: '#697549', mountain: '#a59b7d', summit: '#d4c9a2', pass: '#dacf96' };
  for (let i = 0; i < world.tiles.length; i++) {
    const tile = world.tiles[i];
    const hex = WATER.has(tile.terrain) ? colors[tile.terrain as 'ocean' | 'coast' | 'river' | 'lake'] ?? colors.ocean
      : tile.mountainPass ? colors.pass : tile.ridge && tile.relief === 'mountains' ? tile.ridgeTier === 2 ? colors.summit : colors.mountain
      : tile.ridge ? colors.hills : tile.overlay === 'forest' || tile.overlay === 'jungle' ? colors.forest
      : tile.terrain === 'desert' ? colors.desert : tile.terrain === 'plains' ? colors.plains : colors.grassland;
    const n = Number.parseInt(hex.slice(1), 16), offset = i * 4;
    pixels[offset] = n >> 16; pixels[offset + 1] = n >> 8 & 255; pixels[offset + 2] = n & 255; pixels[offset + 3] = 255;
  }
  return pixels;
}
