import { createNoise2D } from 'simplex-noise';
import { narrowHillPassage, ridgeEdgeAllowed, ridgeGroundWalkable, ridgeLevel, STAIR_UP } from '../game/ridges';
import { WATER, type Tile, type World } from '../game/types';
import { terrainYields } from './generator';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';

export interface TerrainEnvironment {
  /** Dimensionless, spatially correlated regional suitability, each in 0..1. */
  ruggedness: Float32Array;
  moisture: Float32Array;
  woodland: Float32Array;
  /** Local ridge/valley axis, in radians in [0, PI). */
  orientation: Float32Array;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
function randomStream(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => { state += 0x6d2b79f5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

function freshwaterDistance(tiles: Tile[], width: number, height: number): Int16Array {
  const distances = new Int16Array(tiles.length).fill(32767), queue: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i].terrain === 'river' || tiles[i].terrain === 'lake') {
    distances[i] = 0; queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
    if (distances[cell] >= 24) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || distances[next] <= distances[cell] + 1
        || tiles[next].terrain === 'ocean' || tiles[next].terrain === 'coast') continue;
      distances[next] = distances[cell] + 1; queue.push(next);
    }
  }
  return distances;
}

/** Shared regional fields couple relief placement and woodland rather than
 * scattering each independently. This is a landscape-inspired construction,
 * not a calibrated erosion model: frequencies and cover are gameplay scales. */
export function createTerrainEnvironment(tiles: Tile[], width: number, height: number, seed: string,
  parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): TerrainEnvironment {
  const random = randomStream(`${seed}:terrain-environment`), noise = createNoise2D(random), detail = createNoise2D(random);
  const axis = random() * Math.PI, cosine = Math.cos(axis), sine = Math.sin(axis);
  const ruggedness = new Float32Array(tiles.length), moisture = new Float32Array(tiles.length);
  const woodland = new Float32Array(tiles.length), orientation = new Float32Array(tiles.length);
  const water = freshwaterDistance(tiles, width, height);
  const sampleHeight = (x: number, y: number) => tiles[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))].elevation;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x, tile = tiles[cell];
    const wx = x + noise(x * .018 + 71, y * .018 - 19) * 8;
    const wy = y + noise(x * .018 - 47, y * .018 + 83) * 8;
    const u = wx * cosine + wy * sine, v = -wx * sine + wy * cosine;
    const reliefScale = parameters.ruggednessScale;
    const province = noise(wx * .018 / reliefScale - 113, wy * .018 / reliefScale + 41);
    const ridgeBands = Math.cos(v * .21 / reliefScale + noise(u * .019 / reliefScale, v * .019 / reliefScale) * 2.3);
    ruggedness[cell] = clamp(.48 + province * .27 + ridgeBands * .17 + detail(wx * .07 / reliefScale, wy * .07 / reliefScale) * .08);
    orientation[cell] = ((axis + noise(wx * .013 / reliefScale + 29, wy * .013 / reliefScale - 53) * .4) % Math.PI + Math.PI) % Math.PI;
    // Local concavity and freshwater proximity increase water availability.
    // Exposed convex ground loses a little moisture, without banning its trees.
    const surrounding = (sampleHeight(x - 5, y) + sampleHeight(x + 5, y) + sampleHeight(x, y - 5) + sampleHeight(x, y + 5)) / 4;
    const concavity = Math.max(-1, Math.min(1, (surrounding - tile.elevation) * 3));
    const riparian = Math.exp(-water[cell] / 5.5);
    moisture[cell] = clamp(tile.moisture * .82 + .09 + riparian * parameters.riparianBoost + concavity * .075
      + noise(wx * .026 + 31, wy * .026 - 97) * .055 - ridgeLevel(tile) * .008);
    // Three patch scales give extensive stands, nested groves, and a rough
    // margin. This defines woodland regions; individual trees leave openings
    // throughout those regions in applyTerrainEcology.
    const forestScale = parameters.forestPatchScale;
    const broad = noise(wx * .039 / forestScale + 137, wy * .039 / forestScale + 91);
    const grove = detail(wx * .095 / forestScale - 29, wy * .095 / forestScale + 53);
    const edge = detail(wx * .22 / forestScale + 17, wy * .22 / forestScale - 31);
    const north = (parameters.equatorPosition - y / (height - 1)) / parameters.equatorPosition;
    const biomeCover = tile.biome === 'rainforest' ? .10 : tile.biome === 'taiga' ? .025
      : tile.biome === 'tundra' ? -.18 : tile.biome === 'alpine' ? -.25 : tile.biome === 'savanna' ? -.055 : 0;
    woodland[cell] = clamp(.50 + broad * .23 + grove * .20 + edge * .055
      + (moisture[cell] - .5) * .65 + ruggedness[cell] * .045 + north * parameters.forestNorthBias + biomeCover);
  }
  return { ruggedness, moisture, woodland, orientation };
}

/** Forest regions contain a mesh of trees and open ground, including usable
 * upper floors. Every tree touches a traversable opening, and no 2×2 square is
 * solid canopy. Cliff faces and their actual access lanes remain clear. */
export function applyTerrainEcology(world: World, parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): void {
  const { width, height, tiles } = world, fields = createTerrainEnvironment(tiles, width, height, world.seed, parameters);
  const clear = new Uint8Array(tiles.length), spawns = [...world.spawns, ...(world.secondarySpawns ?? [])];
  const ground = new Uint8Array(tiles.length), trees = new Uint8Array(tiles.length);
  const random = randomStream(`${world.seed}:open-woodland`);
  // One rank per cell, including ineligible ground, keeps the pattern stable
  // when a nearby clearing or access constraint changes.
  const rank = Float32Array.from(tiles, () => random());
  for (const spawn of spawns) {
    const cx = Math.floor(spawn.x), cy = Math.floor(spawn.y);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < width && y < height) clear[y * width + x] = 1;
    }
  }
  for (let cell = 0; cell < tiles.length; cell++) if (tiles[cell].stair) {
    const up = STAIR_UP[tiles[cell].stair!], offset = up.y * width + up.x;
    for (const step of [-1, 0, 1]) clear[cell + offset * step] = 1;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x, tile = tiles[cell];
    if (tile.marsh) { tile.biome = 'wetland'; tile.moisture = Math.max(.9, tile.moisture); continue; }
    if (WATER.has(tile.terrain) || !['none', 'forest', 'jungle'].includes(tile.overlay)) continue;
    ground[cell] = Number(ridgeGroundWalkable(world, x, y));
    const eligible = ground[cell] && !clear[cell] && !tile.beach && !tile.palm && !tile.mountainPass && !narrowHillPassage(world, x, y);
    const dry = tile.terrain === 'desert';
    // Sandy regions retain open desert, with a few groves along wetter pockets.
    const threshold = parameters.forestThreshold + (dry ? .14 : 0);
    const hillWoodland = tile.hillBiome === 'forest-hills';
    const suitability = hillWoodland ? Math.max(.04, fields.woodland[cell] - threshold) : fields.woodland[cell] - threshold;
    // Wet, sheltered woodland has more trees, but even its core is perforated.
    const occupancy = hillWoodland ? .24 + fields.woodland[cell] * .16 : .58 + Math.min(.10, Math.max(0, suitability) * .4);
    trees[cell] = Number(eligible && suitability > 0 && (!dry || fields.moisture[cell] > .43) && rank[cell] < occupancy);
  }
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const cell = y * width + x, square = [cell, cell + 1, cell + width, cell + width + 1];
    if (square.every(next => trees[next])) {
      // Remove the least favored tree, rather than repeatedly clearing the
      // same corner and producing a visible grid of gaps.
      const opening = square.reduce((a, b) => rank[a] > rank[b] ? a : b);
      trees[opening] = 0;
    }
  }
  const candidates = Array.from(trees.keys()).filter(cell => trees[cell]).sort((a, b) => rank[b] - rank[a]);
  for (const cell of candidates) {
    const x = cell % width, y = Math.floor(cell / width);
    const hasOpening = CARDINAL.some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      return nx >= 0 && ny >= 0 && nx < width && ny < height && ground[next] && !trees[next]
        && ridgeEdgeAllowed(world, { x, y }, { x: nx, y: ny });
    });
    if (!hasOpening) trees[cell] = 0;
  }
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    if (tile.marsh) { tile.biome = 'wetland'; tile.moisture = Math.max(.9, tile.moisture); continue; }
    if (WATER.has(tile.terrain) || !['none', 'forest', 'jungle'].includes(tile.overlay)) continue;
    const old = terrainYields(tile.terrain, tile.overlay);
    tile.overlay = trees[cell] ? 'forest' : 'none';
    const next = terrainYields(tile.terrain, tile.overlay);
    for (const resource of ['food', 'production', 'gold'] as const)
      tile[resource] = Math.max(0, tile[resource] + next[resource] - old[resource]);
    tile.moisture = fields.moisture[cell];
    if (tile.overlay !== 'forest') delete tile.treeClass;
  }
}
