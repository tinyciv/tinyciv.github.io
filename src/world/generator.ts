import { createNoise2D } from 'simplex-noise';
import { WATER, type Overlay, type Point, type Terrain, type Tile, type World } from '../game/types';
import { EARTH_SAMPLES } from './data/earth-samples';
import { harmonizeRidgeTerrain, placeRidges } from './ridges';
import { addOffshoreIslands, createLandformProfile, landformDensity, type LandformProfile } from './islands';
import { assignTreeClimate } from './tree-climate';
import { OPPOSING_FACTION_COUNT } from '../game/civilizations';
import { DEFAULT_WORLD_STYLE, LANDFORM_KINDS, resolveLandscapeParameters, WORLD_GENERATION_STYLES,
  type LandformFamily, type LandscapeParameters, type WorldGenerationOptions, type WorldGenerationStyle } from './options';
import { placeFreshwaterLakes, placeLandformLakes } from './lakes';
import { placeLandformRelief } from './regional-relief';
import { applyLandformHeights, createLandformPlan, shapeLandformCoasts } from './landforms';
import { applyTerrainEcology, createTerrainEnvironment } from './terrain-ecology';
import { sampleTerrainClimate, applyWorldClimate } from './climate';
import { generateRiverNetwork, placeNetworkFords, repairRiverDrainage } from './river-network';
import { captureRiverRelief, carveRiverCanyons } from './river-canyons';
import { addWaterfallTributaries, markRiverWaterfalls } from './waterfalls';
import { generateRiverDeltas } from './river-deltas';
import { applySoilFertility } from './soil';
import { assignRegionalResources } from './resources';
import { STAIR_UP } from '../game/ridges';
import { packSettlementSites, spreadFactionStarts } from './starting-sites';
import { generateMediterraneanWorld, MEDITERRANEAN_WIDTH, MEDITERRANEAN_HEIGHT } from './mediterranean';

const PATCH = 24;
const OVERLAP = 7;
const STRIDE = PATCH - OVERLAP;
const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIAGONAL = [...CARDINAL, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export const DEFAULT_WORLD_WIDTH = 194;
export const DEFAULT_WORLD_HEIGHT = 153;

/** A stable, local random stream: generation never mutates Math.random. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

interface Patch { pixels: Uint8Array; land: number; }
let patchBank: Patch[] | undefined;

function trainingPatches(): Patch[] {
  if (patchBank) return patchBank;
  patchBank = [];
  for (const sample of EARTH_SAMPLES) {
    for (let sy = 0; sy <= 40; sy += 10) for (let sx = 0; sx <= 40; sx += 10) {
      for (let rotation = 0; rotation < 4; rotation++) {
        const pixels = new Uint8Array(PATCH * PATCH);
        let land = 0;
        for (let y = 0; y < PATCH; y++) for (let x = 0; x < PATCH; x++) {
          let u = x, v = y;
          for (let r = 0; r < rotation; r++) [u, v] = [PATCH - 1 - v, u];
          const value = sample.rows[sy + v].charCodeAt(sx + u) - 48;
          pixels[y * PATCH + x] = value;
          land += value;
        }
        patchBank.push({ pixels, land: land / (PATCH * PATCH) });
      }
    }
  }
  return patchBank;
}

/** Dynamic-programming minimum-error cut through an overlapping patch edge. */
function seamCut(old: Int8Array, patch: Uint8Array, width: number, height: number, ox: number, oy: number, vertical: boolean): Int16Array {
  const length = Math.min(PATCH, vertical ? height - oy : width - ox);
  const thickness = Math.min(OVERLAP, vertical ? width - ox : height - oy);
  const costs = new Float32Array(length * thickness);
  const parents = new Int8Array(length * thickness);
  for (let along = 0; along < length; along++) for (let across = 0; across < thickness; across++) {
    const x = vertical ? across : along, y = vertical ? along : across;
    const previous = old[(oy + y) * width + ox + x];
    const difference = previous < 0 ? 0 : Math.abs(previous - patch[y * PATCH + x]);
    let best = Infinity, bestOffset = 0;
    if (along > 0) {
      for (let offset = -1; offset <= 1; offset++) {
        const neighbor = across + offset;
        if (neighbor >= 0 && neighbor < thickness && costs[(along - 1) * thickness + neighbor] < best) {
          best = costs[(along - 1) * thickness + neighbor];
          bestOffset = offset;
        }
      }
    } else best = 0;
    costs[along * thickness + across] = difference + best + Math.abs(across - thickness / 2) * 0.0001;
    parents[along * thickness + across] = bestOffset;
  }
  let column = 0;
  for (let x = 1; x < thickness; x++) if (costs[(length - 1) * thickness + x] < costs[(length - 1) * thickness + column]) column = x;
  const seam = new Int16Array(length);
  for (let row = length - 1; row >= 0; row--) {
    seam[row] = column;
    column += parents[row * thickness + column];
  }
  return seam;
}

/** Real training-image quilting, with a weak, smooth continental prior. */
function quiltLand(width: number, height: number, random: () => number, noise: (x: number, y: number) => number, profile: LandformProfile): Uint8Array {
  const output = new Int8Array(width * height).fill(-1);
  const target = new Float32Array(width * height);
  const bank = trainingPatches();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    target[y * width + x] = clamp(landformDensity(profile, x, y, width, height, noise));
  }
  for (let oy = 0; oy < height; oy += STRIDE) for (let ox = 0; ox < width; ox += STRIDE) {
    const pw = Math.min(PATCH, width - ox), ph = Math.min(PATCH, height - oy);
    let density = 0;
    for (let y = 0; y < ph; y += 2) for (let x = 0; x < pw; x += 2) density += target[(oy + y) * width + ox + x];
    density /= Math.ceil(pw / 2) * Math.ceil(ph / 2);
    let best = bank[0], bestScore = Infinity;
    // Stratified candidates include every geography/rotation over successive patches.
    for (let candidate = 0; candidate < 120; candidate++) {
      const patch = bank[Math.floor(random() * bank.length)];
      let score = 0;
      for (let y = 0; y < ph; y += 2) for (let x = 0; x < pw; x += 2) {
        const i = (oy + y) * width + ox + x;
        const value = patch.pixels[y * PATCH + x];
        if (output[i] >= 0) score += Math.abs(output[i] - value) * 2.2;
        score += Math.abs(target[i] - value) * 0.85;
      }
      score += Math.abs(patch.land - density) * 5 + random() * 3;
      if (score < bestScore) { best = patch; bestScore = score; }
    }
    const left = ox > 0 ? seamCut(output, best.pixels, width, height, ox, oy, true) : undefined;
    const top = oy > 0 ? seamCut(output, best.pixels, width, height, ox, oy, false) : undefined;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = (oy + y) * width + ox + x;
      if (output[i] >= 0 && ((left && x < OVERLAP && x <= left[y]) || (top && y < OVERLAP && y <= top[x]))) continue;
      output[i] = best.pixels[y * PATCH + x];
    }
  }
  const land = Uint8Array.from(output, value => Math.max(0, value));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // A varying ocean rim prevents sampled peninsulas from ending at an
    // artificial, perfectly straight map boundary.
    const horizontalRim = 3 + Math.round((noise(y * 0.085 + 51, 62) + 1) * 1.5);
    const verticalRim = 3 + Math.round((noise(82, x * 0.085 - 27) + 1) * 1.5);
    if (x < horizontalRim || y < verticalRim || x >= width - horizontalRim || y >= height - verticalRim) land[y * width + x] = 0;
    // Quilting can bridge two target islands across an overlap. Keep the deep
    // water between their broad shapes; the sampled margins remain untouched.
    if (!profile.compact && landformDensity(profile, x, y, width, height, noise) < -.2) land[y * width + x] = 0;
  }
  // A single majority pass removes isolated pixels without replacing the quilt.
  const clean = land.slice();
  for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
    let neighbors = 0;
    for (const [dx, dy] of DIAGONAL) neighbors += land[(y + dy) * width + x + dx];
    if (neighbors >= 7) clean[y * width + x] = 1;
    else if (neighbors <= 1) clean[y * width + x] = 0;
  }
  return clean;
}

/** Manhattan distance from a class of cells; also provides coast-directed flow. */
function distanceField(mask: Uint8Array, width: number, height: number, source: number): Int16Array {
  const distances = new Int16Array(mask.length).fill(32767);
  const queue = new Int32Array(mask.length);
  let head = 0, tail = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === source) { distances[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || distances[next] <= distances[i] + 1) continue;
      distances[next] = distances[i] + 1;
      queue[tail++] = next;
    }
  }
  return distances;
}

/** Base yields are shared by initial generation and settlement clearing. */
export function terrainYields(terrain: Terrain, overlay: Overlay): Pick<Tile, 'food' | 'production' | 'gold'> {
  let food = 0, production = 0, gold = 0;
  switch (terrain) {
    case 'ocean': food = 1; break;
    case 'coast': food = 2; gold = 1; break;
    case 'river': food = 3; gold = 1; break;
    case 'lake': food = 2; break;
    case 'grassland': food = 3; production = 1; break;
    case 'plains': food = 2; production = 2; break;
    case 'desert': production = 1; gold = 1; break;
    case 'tundra': food = 1; production = 1; break;
  }
  switch (overlay) {
    case 'forest': food = Math.max(1, food - 1); production += 2; break;
    case 'jungle': food += 1; production += 1; break;
    case 'swamp': food += 1; production = 0; break;
    case 'volcano': food = 0; production = 4; gold = 2; break;
    case 'glacier': food = 0; production = 0; break;
  }
  return { food, production, gold };
}

function walkable(tile: Tile): boolean {
  return !tile.ridge && ((!WATER.has(tile.terrain) && tile.overlay !== 'volcano' && tile.overlay !== 'glacier') || tile.terrain === 'river' && tile.overlay === 'ford');
}

/** A complete bank-to-bank spine with connected, tapered side shallows. The
 * whole crossing stays one to three cells wide, without a rectangular stamp. */
export function addRiverFords(world: World): boolean {
  if (world.tiles.some(tile => tile.channel)) return placeNetworkFords(world);
  const { tiles, width, height } = world;
  const existing = tiles.flatMap((tile, i) => tile.terrain === 'river' && tile.overlay === 'ford' ? [i] : []);
  type Crossing = { axis: 'horizontal' | 'vertical'; line: number; start: number; end: number; score: number; lanes: number; side: number; shape: number };
  const candidates: Crossing[] = [], rows = new Map<string, Crossing[]>();
  const random = seededRandom(`${world.seed}:river-fords`);
  const index = (axis: Crossing['axis'], along: number, line: number) => axis === 'horizontal' ? line * width + along : along * width + line;
  const dry = (i: number) => !!tiles[i] && !WATER.has(tiles[i].terrain) && walkable(tiles[i]);
  for (const axis of ['horizontal', 'vertical'] as const) {
    const lines = axis === 'horizontal' ? height : width, length = axis === 'horizontal' ? width : height;
    for (let line = 1; line < lines - 1; line++) for (let along = 1; along < length - 1; along++) {
      if (tiles[index(axis, along, line)].terrain !== 'river') continue;
      const start = along;
      while (along < length && tiles[index(axis, along, line)].terrain === 'river') along++;
      const end = along - 1;
      if (end >= length - 1 || end - start + 1 > 10 || !dry(index(axis, start - 1, line)) || !dry(index(axis, end + 1, line))) continue;
      const candidate: Crossing = { axis, line, start, end, score: random() + (end - start) * .025,
        lanes: 1 + Math.floor(random() * 3), side: random() < .5 ? -1 : 1, shape: Math.floor(random() * 12) };
      candidates.push(candidate);
      const key = `${axis}:${line}`; rows.set(key, [...(rows.get(key) ?? []), candidate]);
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.line - b.line || a.start - b.start);
  let changed = false;
  for (const candidate of candidates) {
    const { axis, start, end, line } = candidate, middle = (start + end) / 2;
    const lanes = [candidate];
    for (const offset of [candidate.side, -candidate.side]) {
      if (lanes.length >= candidate.lanes) break;
      const adjacent = rows.get(`${axis}:${line + offset}`)?.find(other => other.start <= middle && other.end >= middle
        && Math.abs(other.start - start) <= 2 && Math.abs(other.end - end) <= 2);
      if (adjacent) lanes.push(adjacent);
    }
    const cells = lanes.flatMap((lane, side) => {
      if (!side) return Array.from({ length: end - start + 1 }, (_, n) => index(axis, start + n, line));
      const span = lane.end - lane.start + 1, shape = (candidate.shape + side * 5) % 6;
      // Leave some full side lanes; others taper at one or both ends. Even the
      // shortest flange intersects the spine, so no decorative island is walkable.
      const trim = Math.max(1, Math.floor(span / 3));
      const left = shape === 1 || shape === 3 || shape === 5 ? trim : 0;
      const right = shape === 2 || shape === 3 || shape === 4 ? trim : 0;
      const pivot = Math.max(Math.max(lane.start, start), Math.min(Math.min(lane.end, end), Math.round(middle)));
      const from = Math.min(pivot, lane.start + left);
      const to = Math.max(pivot, lane.end - right);
      return Array.from({ length: to - from + 1 }, (_, n) => index(axis, from + n, lane.line));
    });
    if (cells.some(i => tiles[i].overlay !== 'none')) continue;
    // Keep crossings distinct even at confluences; nearby candidates cannot
    // turn a river section into one large shallow lake.
    if (cells.some(i => existing.some(other => Math.hypot(other % width - i % width, Math.floor(other / width) - Math.floor(i / width)) < 10))) continue;
    for (const i of cells) { tiles[i].overlay = 'ford'; tiles[i].fordAxis = axis; existing.push(i); }
    changed = true;
  }
  return changed;
}

/** The native ledge palette and legal stair approaches share two dry cells. */
function ridgeApron(tiles: Tile[], width: number, height: number): Uint8Array {
  const protectedCells = new Uint8Array(tiles.length);
  for (let cell = 0; cell < tiles.length; cell++) if (tiles[cell].ridge) {
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) protectedCells[ny * width + nx] = 1;
    }
  }
  return protectedCells;
}

function largestWalkable(tiles: Tile[], width: number, height: number): number[] {
  const visited = new Uint8Array(tiles.length);
  let largest: number[] = [];
  for (let start = 0; start < tiles.length; start++) {
    if (visited[start] || !walkable(tiles[start])) continue;
    const queue = [start];
    visited[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % width, y = Math.floor(i / width);
      for (const [dx, dy] of CARDINAL) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || visited[next] || !walkable(tiles[next])) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (queue.length > largest.length) largest = queue;
  }
  return largest;
}

export function settlements(tiles: Tile[], width: number, height: number, random: () => number,
  parameters: LandscapeParameters): { capitals: Point[]; secondary: Point[] } {
  const empty = { capitals: [], secondary: [] };
  const component = largestWalkable(tiles, width, height);
  if (component.length < Math.min(1200, width * height * 0.16)) return empty;
  const members = new Set(component);
  // Match the palace ring plus all four houses and their walking lanes. The
  // old 5×5 core could fit a palace beside a ridge while pushing its full town
  // ten tiles away. Compact development maps retain the flexible town planner.
  const townFootprint: Point[] = [];
  for (let dy = -3; dy <= 4; dy++) for (let dx = -3; dx <= 4; dx++) {
    if (dx >= -1 && dx <= 2 && dy >= -1 && dy <= 2
      || dx >= -1 && dx <= 1 && dy >= -3 && dy <= -1
      || dx >= 2 && dx <= 4 && dy >= -1 && dy <= 1
      || dx >= 0 && dx <= 2 && dy >= 2 && dy <= 4
      || dx >= -3 && dx <= -1 && dy >= 0 && dy <= 2) townFootprint.push({ x: dx, y: dy });
  }
  const freshwater = distanceField(Uint8Array.from(tiles, tile => Number(tile.terrain === 'river' || tile.terrain === 'lake')), width, height, 1);
  const routes = new Map<number, Int16Array>();
  const travelFrom = (point: Point): Int16Array => {
    const start = Math.floor(point.y) * width + Math.floor(point.x), cached = routes.get(start);
    if (cached) return cached;
    const distances = new Int16Array(tiles.length).fill(32767), queue = [start]; distances[start] = 0;
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
      for (const [dx, dy] of CARDINAL) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || !members.has(next) || distances[next] !== 32767) continue;
        distances[next] = distances[cell] + 1; queue.push(next);
      }
    }
    routes.set(start, distances); return distances;
  };
  const candidates: { x: number; y: number; quality: number; scenic: number; tie: number }[] = [];
  for (const i of component) {
    const x = i % width, y = Math.floor(i / width);
    if (x < 7 || y < 7 || x >= width - 7 || y >= height - 7) continue;
    let space = 0, fertile = 0, water = 0, core = true;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const next = (y + dy) * width + x + dx;
      if (dx * dx + dy * dy > 25) continue;
      if (members.has(next)) { space++; fertile += tiles[next].food; }
      if (WATER.has(tiles[next].terrain)) water++;
      if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && (!members.has(next) || WATER.has(tiles[next].terrain) || tiles[next].marsh)) core = false;
    }
    if (!core || space < 65 || fertile < 110) continue;
    if (Math.min(width, height) >= 128 && townFootprint.some(offset => {
      const next = (y + offset.y) * width + x + offset.x;
      return !members.has(next) || WATER.has(tiles[next].terrain) || !!tiles[next].marsh;
    })) continue;
    const tile = tiles[i];
    // Water access improves a site without requiring every city to occupy the
    // same grassy riverbank. Broad fertility and space still set viability.
    candidates.push({ x, y, quality: fertile / 81 + space / 81 + Math.exp(-freshwater[i] / 7) * .8,
      scenic: water > 1 ? 1 : 0, tie: random() });
    if (tile.terrain === 'grassland') candidates[candidates.length - 1].scenic += 1.5;
  }
  if (!candidates.length) return empty;
  candidates.sort((a, b) => (b.quality + b.scenic + b.tie * 0.6) - (a.quality + a.scenic + a.tie * 0.6));
  // Production maps retain generous separation. The tiniest development maps
  // use seven cells; the settlement planner adapts their outlying houses while
  // keeping palace/road footprints and every reserved town distinct.
  const shortSide = Math.min(width, height);
  const minimumGap = shortSide < 80 ? 7 : Math.min(18, Math.floor(shortSide / 8));
  let chosen: Point[] = spreadFactionStarts(candidates, OPPOSING_FACTION_COUNT + 1, minimumGap, parameters);
  if (chosen.length !== OPPOSING_FACTION_COUNT + 1) return empty;
  const secondary: Point[] = [], occupied = chosen.slice();
  for (let faction = 1; faction <= OPPOSING_FACTION_COUNT; faction++) {
    let best: Point | undefined, score = -Infinity;
    const capital = chosen[faction];
    const travel = travelFrom(capital);
    for (const candidate of candidates) {
      let nearest = Infinity;
      for (const point of occupied) nearest = Math.min(nearest, Math.hypot(point.x - candidate.x, point.y - candidate.y));
      if (nearest < minimumGap) continue;
      // Nearby second cities form readable realms and useful trade routes.
      const homeDistance = travel[candidate.y * width + candidate.x];
      const foreignDistance = Math.min(...chosen.filter((_, i) => i !== faction)
        .map(point => Math.hypot(point.x - candidate.x, point.y - candidate.y)));
      const candidateScore = candidate.quality * 2 + candidate.tie - homeDistance
        - Math.max(0, homeDistance - foreignDistance) * 3;
      if (candidateScore > score) { best = candidate; score = candidateScore; }
    }
    if (!best) {
      // Constrained islands/small maps can fit all towns even when a greedy
      // second-city choice uses the last viable gap. Reserve all towns first,
      // then distribute capitals over that packing and assign the remainder.
      const packed = packSettlementSites(candidates, OPPOSING_FACTION_COUNT * 2 + 1, minimumGap, parameters);
      if (packed.length !== OPPOSING_FACTION_COUNT * 2 + 1) return empty;
      const capitals = spreadFactionStarts(packed, OPPOSING_FACTION_COUNT + 1, minimumGap, parameters);
      if (capitals.length !== OPPOSING_FACTION_COUNT + 1) return empty;
      chosen = capitals;
      const remaining = packed.filter(point => !capitals.includes(point));
      secondary.length = 0;
      for (let owner = 1; owner <= OPPOSING_FACTION_COUNT; owner++) {
        const travel = travelFrom(chosen[owner]);
        remaining.sort((a, b) => travel[a.y * width + a.x] - travel[b.y * width + b.x]);
        secondary.push(remaining.shift()!);
      }
      break;
    }
    secondary.push(best);
    occupied.push(best);
  }
  for (const point of [...chosen, ...secondary]) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const tile = tiles[(point.y + dy) * width + point.x + dx];
      // Peripheral clearing corners may touch a ford even when the actual town
      // footprint is dry. Clear vegetation without destroying river crossings.
      if (WATER.has(tile.terrain)) continue;
      const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
      tile.overlay = 'none';
      delete tile.beach; delete tile.palm;
      for (const resource of ['food', 'production', 'gold'] as const)
        tile[resource] = Math.max(0, tile[resource] + after[resource] - before[resource]);
    }
  }
  const centers = (points: Point[]) => points.map(({ x, y }) => ({ x: x + .5, y: y + .5 }));
  return { capitals: centers(chosen), secondary: centers(secondary) };
}

/** Broad sandy stretches occupy half of the ocean-facing shore. A separate
 * stream keeps beach scenery from changing rivers or settlement placement. */
function addCoastalBeaches(world: World, attempt: number, parameters: LandscapeParameters): void {
  const { width, height, tiles } = world;
  const random = seededRandom(`${world.seed}:beaches:${attempt}`);
  const noise = createNoise2D(random);
  const shore: { index: number; score: number; depth: number }[] = [];
  const distance = new Uint8Array(tiles.length);
  const owner = new Int32Array(tiles.length).fill(-1);
  const sandy = new Uint8Array(tiles.length);
  const beachDepth = new Uint8Array(tiles.length);
  const queue: number[] = [];
  const neighbors = (i: number, visit: (next: number) => void) => {
    const x = i % width, y = Math.floor(i / width);
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) visit(ny * width + nx);
    }
  };
  for (let i = 0; i < tiles.length; i++) {
    if (WATER.has(tiles[i].terrain) || tiles[i].marsh) continue;
    let oceanFacing = false;
    neighbors(i, next => { if (tiles[next].terrain === 'coast' || tiles[next].terrain === 'ocean') oceanFacing = true; });
    if (!oceanFacing) continue;
    const x = i % width, y = Math.floor(i / width);
    shore.push({ index: i, score: noise(x * .045, y * .045) + noise(x * .11 + 67, y * .11 - 23) * .1,
      depth: Math.max(1, Math.min(3, Math.round((2 + noise(x * .075 - 41, y * .075 + 19) * 1.4) * parameters.beachWidth))) });
    distance[i] = 1; owner[i] = i; queue.push(i);
  }
  // Ranking a smooth field, rather than flipping a coin per tile, gives long
  // beach/grass runs while keeping the visible sandy coastline near 50%.
  shore.sort((a, b) => b.score - a.score || a.index - b.index);
  const settlementSites = [...world.spawns, ...world.secondarySpawns ?? []];
  const beachCandidates = shore.filter(({ index }) => !settlementSites.some(spawn =>
    Math.abs(index % width - Math.floor(spawn.x)) <= 2 && Math.abs(Math.floor(index / width) - Math.floor(spawn.y)) <= 2));
  for (const { index, depth } of beachCandidates.slice(0, Math.round(shore.length * parameters.beachFraction))) {
    sandy[index] = 1; beachDepth[index] = depth;
  }
  // The nearest shore owns its inward strip. Grass shores cannot be swallowed
  // by a beach wrapping around a narrow peninsula, and rivers stay untouched.
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (distance[i] >= 3) continue;
    neighbors(i, next => {
      if (distance[next] || WATER.has(tiles[next].terrain) || tiles[next].marsh) return;
      distance[next] = distance[i] + 1; owner[next] = owner[i]; queue.push(next);
    });
  }
  const ledgeApron = ridgeApron(tiles, width, height);
  const palms: number[] = [];
  for (const i of queue) {
    const tile = tiles[i], x = i % width, y = Math.floor(i / width), source = owner[i];
    const settlementClearing = settlementSites.some(spawn => Math.abs(x - Math.floor(spawn.x)) <= 2 && Math.abs(y - Math.floor(spawn.y)) <= 2);
    if (settlementClearing || ledgeApron[i] || tile.marsh) continue;
    if (sandy[source] && distance[i] <= beachDepth[source]) {
      tile.terrain = 'desert'; tile.overlay = 'none'; tile.beach = true;
      Object.assign(tile, terrainYields(tile.terrain, tile.overlay));
      neighbors(i, next => { if (tiles[next].terrain === 'river' || tiles[next].terrain === 'lake') tile.food = 1; });
      // A lone palm is scenery, not dense forest cover. Keep enough spacing
      // that these remain occasional landmarks instead of another tree stand.
      if (random() < .07 * parameters.palmDensity && palms.every(other => Math.hypot(other % width - x, Math.floor(other / width) - y) >= 3)) {
        tile.palm = true; palms.push(i);
      }
    } else if (distance[i] === 1 && (tile.terrain === 'plains' || tile.terrain === 'desert')) {
      // Both dry biomes use the native sand tile. Leaving them on the other
      // half of the shore would silently push actual beach coverage above 50%.
      tile.terrain = 'grassland';
      Object.assign(tile, terrainYields(tile.terrain, tile.overlay));
      neighbors(i, next => { if (tiles[next].terrain === 'river' || tiles[next].terrain === 'lake') tile.food = terrainYields(tile.terrain, tile.overlay).food + 1; });
    }
  }
  // A preserved dry-city clearing can reach the immediate shore. The current
  // plains/desert atlas is sand, so keep every intentionally unsanded bank on
  // its grass palette even when a city excluded it from decorative beaches.
  for (const { index } of shore) {
    const tile = tiles[index];
    if (tile.beach || tile.ridge || tile.terrain !== 'plains' && tile.terrain !== 'desert') continue;
    const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields('grassland', tile.overlay);
    tile.terrain = 'grassland';
    for (const resource of ['food', 'production', 'gold'] as const)
      tile[resource] = Math.max(0, tile[resource] + after[resource] - before[resource]);
  }
}

function generateAttempt(seed: string, width: number, height: number, attempt: number, style: WorldGenerationStyle,
  parameters: LandscapeParameters, landformFamily: LandformFamily, riverDeltas: boolean): World {
  // Development maps still hold every starting city. Scale the waterways
  // with their much smaller area, while keeping ordinary production settings exact.
  const developmentScale = Math.min(width, height) < 128 ? Math.min(1, width * height / (128 * 128)) : 1;
  const random = seededRandom(`${seed}:terrain:${attempt}`);
  const noise = createNoise2D(random);
  const moistureNoise = createNoise2D(random);
  const warpNoise = createNoise2D(random);
  const profileRandom = seededRandom(`${seed}:landforms`);
  const profile = createLandformProfile(profileRandom, width, height, style, parameters);
  const land = quiltLand(width, height, random, noise, profile);
  const islandRandom = seededRandom(`${seed}:offshore-islands:${attempt}`);
  const islandNoise = createNoise2D(islandRandom);
  addOffshoreIslands(land, width, height, islandRandom, islandNoise, profile.compact ? {} : {
    density: (profile.style === 'fractal' ? 1.2 + profileRandom() * .8 : profile.style === 'continents' ? .45 + profileRandom() * .55 : .15 + profileRandom() * .35) * parameters.islandDensity,
    reach: profile.style === 'fractal' ? 40 : 20,
    largeChance: profile.style === 'pangaea' ? .15 : .4,
    size: (.8 + profileRandom() * .7) * parameters.islandSize,
  });
  const plan = !profile.compact ? createLandformPlan(seed, width, height, land, landformFamily, parameters) : undefined;
  if (plan) shapeLandformCoasts(land, width, height, plan);
  const inland = distanceField(land, width, height, 0);
  const offshore = distanceField(land, width, height, 1);
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const climate = sampleTerrainClimate(x, y, width, height, moistureNoise, warpNoise, parameters);
    const { wx, wy, moisture } = climate;
    const ridge = Math.abs(noise(wx * 0.030 + 72, wy * 0.030 - 17)
      + warpNoise(wx * 0.14 - 9, wy * 0.14 + 18) * 0.22);
    const elevation = land[i] ? clamp(0.13 + inland[i] * 0.014 + Math.max(0, 0.22 - ridge) * 2.5) : 0;
    const terrain: Terrain = land[i] ? climate.terrain : offshore[i] <= 2 ? 'coast' : 'ocean';
    const overlay: Overlay = 'none';
    tiles.push({ terrain, overlay, elevation, moisture, ...terrainYields(terrain, overlay), variation: random() });
  }
  const world: World = { width, height, seed, tiles, spawns: [], generationStyle: style,
    generationParameters: { ...parameters }, landformFamily, landformProvinces: plan?.provinces,
    source: `Natural Earth v5.1.2 · geological regions · ${style} · ${landformFamily}` };
  // Continuous geology is shaped before the renderer's ledges are selected.
  if (plan) applyLandformHeights(world, plan);
  else {
    const environment = createTerrainEnvironment(tiles, width, height, seed, parameters);
    for (let i = 0; i < tiles.length; i++) if (land[i]) {
      const x = i % width, y = Math.floor(i / width);
      const valley = noise(x * .055 + 80, y * .055 + 80) * .045 * parameters.riverMeander;
      tiles[i].elevation = clamp(tiles[i].elevation * .50 + environment.ruggedness[i] * .28 + valley, .03, .72);
    }
  }
  const plannedLakes = plan ? placeLandformLakes(world, plan, inland, parameters) : [];
  if (!plan) {
    placeRidges(tiles, width, height, seed);
    for (const tile of tiles) if (tile.ridge) tile.elevation = .76 + (tile.ridgeTier === 2 ? .14 : 0);
  } else placeLandformRelief(world, plan, parameters);
  applyWorldClimate(world, parameters);
  const lakeCount = developmentScale < 1 ? Math.max(1, Math.round(Math.max(3,
    Math.min(7, land.reduce((sum, value) => sum + value, 0) / 5500)) * parameters.lakeDensity * developmentScale)) : undefined;
  const usualLakes = lakeCount ?? Math.max(1, Math.round(Math.max(3,
    Math.min(7, land.reduce((sum, value) => sum + value, 0) / 5500)) * parameters.lakeDensity));
  placeFreshwaterLakes(tiles, width, height, `${seed}:${attempt}`, inland,
    { parameters, count: Math.max(1, usualLakes - plannedLakes.length) });
  // Rivers are a later incision into completed landforms. Native relief is
  // captured before channel painting, then its cut banks are rebuilt as ledges.
  // Keep this rainfall event fixed so discharge and channel widths agree.
  applyWorldClimate(world, parameters);
  const riverRelief = captureRiverRelief(world);
  generateRiverNetwork(world, parameters);
  carveRiverCanyons(world, riverRelief);
  addWaterfallTributaries(world);
  repairRiverDrainage(world);
  // Sediment builds coastal wetlands only after the upstream landforms and
  // channel network are complete. Settlement and beach placement respect them.
  world.riverDeltas = riverDeltas ? generateRiverDeltas(world) : [];
  // Refresh base yields after waterways are carved, adding riverside fertility.
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, tile = tiles[i];
    Object.assign(tile, terrainYields(tile.terrain, tile.overlay));
    if (!WATER.has(tile.terrain) && CARDINAL.some(([dx, dy]) => (['river', 'lake'].includes(tiles[(y + dy) * width + x + dx].terrain)))) {
      tile.food += 1;
      if (tile.terrain === 'desert') { tile.terrain = 'plains'; tile.food = Math.max(tile.food, 2); }
    }
  }
  addRiverFords(world);
  const sites = settlements(tiles, width, height, random, parameters);
  world.spawns = sites.capitals;
  world.secondarySpawns = sites.secondary;
  harmonizeRidgeTerrain(world);
  markRiverWaterfalls(world);
  addCoastalBeaches(world, attempt, parameters);
  applyTerrainEcology(world, parameters);
  assignTreeClimate(world, parameters);
  applySoilFertility(world);
  assignRegionalResources(world);
  return world;
}

/** Build a deterministic playable world from real, rotated geographical patches. */
export function generateWorld(seed: string, width?: number, height?: number,
  options: WorldGenerationOptions = {}): World {
  const style = options.style ?? DEFAULT_WORLD_STYLE;
  width ??= style === 'mediterranean' ? MEDITERRANEAN_WIDTH : DEFAULT_WORLD_WIDTH;
  height ??= style === 'mediterranean' ? MEDITERRANEAN_HEIGHT : DEFAULT_WORLD_HEIGHT;
  const landformFamily = options.landformFamily ?? 'mixed';
  const parameters = resolveLandscapeParameters(options.parameters);
  if (!WORLD_GENERATION_STYLES.includes(style)) throw new RangeError(`Unknown world style: ${style}`);
  if (landformFamily !== 'mixed' && !(LANDFORM_KINDS as readonly string[]).includes(landformFamily))
    throw new RangeError(`Unknown landform family: ${landformFamily}`);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 512 || height > 512) {
    throw new RangeError('World dimensions must be integers between 64 and 512 tiles.');
  }
  if (style === 'mediterranean') return generateMediterraneanWorld(seed, width, height);
  for (let attempt = 0; attempt < 20; attempt++) {
    const world = generateAttempt(seed, width, height, attempt, style, parameters, landformFamily, options.riverDeltas !== false);
    if (world.spawns.length === OPPOSING_FACTION_COUNT + 1 && world.secondarySpawns?.length === OPPOSING_FACTION_COUNT) return world;
  }
  throw new Error(`Could not find ${OPPOSING_FACTION_COUNT + 1} connected capitals and ${OPPOSING_FACTION_COUNT} second cities for seed "${seed}".`);
}

/** Retire unsupported landscape concepts in old saves without hidden blockers. */
export function normalizePunyWorld(world: World): void {
  let changed = false;
  world.tiles.forEach(tile => {
    // Discard obsolete ramp fields; new raised terrain uses ridge/stair metadata.
    const legacyTile = tile as Tile & { ramp?: boolean; rampDirection?: string };
    if ('ramp' in legacyTile || 'rampDirection' in legacyTile) {
      delete legacyTile.ramp;
      delete legacyTile.rampDirection;
      changed = true;
    }
    const terrain = tile.terrain, overlay = tile.overlay;
    // Old JSON saves may retain removed overlay names outside the current type.
    if (['hills', 'mountains'].includes(tile.overlay as string)) tile.overlay = 'none';
    if (tile.terrain === 'tundra') tile.terrain = 'grassland';
    if (tile.overlay === 'jungle') tile.overlay = 'forest';
    else if (tile.overlay === 'swamp') tile.overlay = 'none';
    else if (tile.overlay === 'volcano' || tile.overlay === 'glacier') tile.overlay = 'none';
    if (tile.terrain === terrain && tile.overlay === overlay) return;
    changed = true;
    const oldYields = terrainYields(terrain, overlay), nextYields = terrainYields(tile.terrain, tile.overlay);
    // Clearing/farming and riverside bonuses survive an art-set migration.
    tile.food = Math.max(0, nextYields.food + tile.food - oldYields.food);
    tile.production = Math.max(0, nextYields.production + tile.production - oldYields.production);
    tile.gold = Math.max(0, nextYields.gold + tile.gold - oldYields.gold);
  });
  // Geographic maps already contain authored bank-to-bank crossings; retain them.
  if (world.generationStyle !== 'mediterranean') changed = addRiverFords(world) || changed;
  if (changed) world.revision = (world.revision ?? 0) + 1;
}
