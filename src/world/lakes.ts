import { WATER, type Point, type Tile, type World } from '../game/types';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';
import type { LandformPlan } from './landforms';

export type LakeShape = 'compact';
export interface FreshwaterLake { shape: LakeShape; cells: number[]; center: Point }
export interface FreshwaterLakeOptions { count?: number; parameters?: LandscapeParameters }
const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
function randomStream(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => { state += 0x6d2b79f5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

/** Distance from existing water and the rim, also useful for isolated studies. */
function dryDistance(tiles: Tile[], width: number, height: number): Int16Array {
  const distance = new Int16Array(tiles.length).fill(32767), queue: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || WATER.has(tiles[i].terrain)) {
      distance[i] = 0; queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % width, y = Math.floor(i / width);
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || distance[next] <= distance[i] + 1) continue;
      distance[next] = distance[i] + 1; queue.push(next);
    }
  }
  return distance;
}

/** Principal-axis aspect measures the basin rather than its arbitrary map
 * orientation. Bounding extents additionally catch narrow pixel-grid tails. */
export function lakeAspectRatio(cells: number[], width: number): number {
  const meanX = cells.reduce((sum, cell) => sum + cell % width, 0) / cells.length;
  const meanY = cells.reduce((sum, cell) => sum + Math.floor(cell / width), 0) / cells.length;
  let xx = 0, yy = 0, xy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const cell of cells) {
    const x = cell % width, y = Math.floor(cell / width), dx = x - meanX, dy = y - meanY;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const trace = xx + yy, d = Math.hypot(xx - yy, 2 * xy);
  const bounds = (maxX - minX + 1) / (maxY - minY + 1);
  return Math.max(Math.sqrt((trace + d) / Math.max(1e-9, trace - d)), bounds, 1 / bounds);
}

/** Faults and glacial valleys may be long, but their standing water occupies
 * compact pockets. Place these before relief so ledges respect their shores. */
export function placeLandformLakes(world: World, plan: LandformPlan, inland: Int16Array,
  parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): FreshwaterLake[] {
  const { tiles, width, height } = world, lakes: FreshwaterLake[] = [];
  const occupied = new Uint8Array(tiles.length);
  for (const basin of plan.basins) {
    if (!basin.lake) continue;
    const cosine = Math.cos(basin.angle), sine = Math.sin(basin.angle);
    let accepted: number[] = [];
    for (const scale of [1, .82, .66, .52]) {
      const minor = Math.min(basin.radiusX, basin.radiusY);
      const maximum = minor * Math.min(1.75, 1 + (parameters.compactLakeAspectMax - 1) * .7);
      const rx = Math.min(basin.radiusX, maximum) * scale * Math.sqrt(parameters.lakeSize);
      const ry = Math.min(basin.radiusY, maximum) * scale * Math.sqrt(parameters.lakeSize);
      const reach = Math.ceil(Math.max(rx, ry) * 1.3), cells = new Set<number>();
      for (let y = Math.max(2, Math.floor(basin.center.y - reach)); y <= Math.min(height - 3, Math.ceil(basin.center.y + reach)); y++)
        for (let x = Math.max(2, Math.floor(basin.center.x - reach)); x <= Math.min(width - 3, Math.ceil(basin.center.x + reach)); x++) {
          const cell = y * width + x, dx = x - basin.center.x, dy = y - basin.center.y;
          const u = dx * cosine + dy * sine, v = -dx * sine + dy * cosine;
          const bend = Math.sin(u / Math.max(1, rx) * Math.PI) * ry * Math.min(.12, (parameters.compactLakeAspectMax - 1) * .16);
          if (Math.hypot(u / rx, (v - bend) / ry) > 1) continue;
          if (inland[cell] < 4 || occupied[cell] || WATER.has(tiles[cell].terrain)) continue;
          cells.add(cell);
        }
      const seen = new Set<number>();
      for (const start of cells) {
        if (seen.has(start)) continue;
        const component = [start]; seen.add(start);
        for (let n = 0; n < component.length; n++) for (const [dx, dy] of CARDINAL) {
          const next = component[n] + dx + dy * width;
          if (cells.has(next) && !seen.has(next)) { seen.add(next); component.push(next); }
        }
        if (component.length > accepted.length && lakeAspectRatio(component, width) <= parameters.compactLakeAspectMax) accepted = component;
      }
      if (accepted.length >= 25) break;
    }
    if (accepted.length < 25) continue;
    const shape: LakeShape = 'compact';
    const basinCells = new Set(accepted);
    let spillway = Infinity;
    for (const cell of accepted) for (const [dx, dy] of CARDINAL) {
      const next = cell + dx + dy * width;
      if (!basinCells.has(next)) spillway = Math.min(spillway, tiles[next].elevation);
    }
    const elevation = Math.max(.015, spillway - .012);
    for (const cell of accepted) {
      Object.assign(tiles[cell], { terrain: 'lake', overlay: 'none', lakeShape: shape, elevation, food: 2, production: 0, gold: 0 });
      const x = cell % width, y = Math.floor(cell / width);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) occupied[ny * width + nx] = 1;
      }
    }
    lakes.push({ cells: accepted, shape, center: { ...basin.center } });
  }
  return lakes;
}

/** Compact, uneven oval basins stay behind at least four dry shoreline cells.
 * Long narrow watercourses belong to the river network, not lake geometry. */
export function placeFreshwaterLakes(tiles: Tile[], width: number, height: number, seed: string,
  suppliedInland?: Int16Array, options: FreshwaterLakeOptions = {}): FreshwaterLake[] {
  const random = randomStream(`${seed}:freshwater-lakes`), inland = suppliedInland ?? dryDistance(tiles, width, height);
  const parameters = options.parameters ?? DEFAULT_LANDSCAPE_PARAMETERS;
  const land = tiles.reduce((sum, tile) => sum + Number(!WATER.has(tile.terrain)), 0);
  const target = options.count ?? Math.max(1, Math.round(Math.max(3, Math.min(7, land / 5500)) * parameters.lakeDensity));
  const compactFitDepth = 4 + 5.4 * parameters.lakeSize * parameters.compactLakeAspectMax;
  const candidates = tiles.map((tile, i) => {
    const jitter = random() * 12;
    const x = i % width, y = Math.floor(i / width);
    const rim = [[-4, 0], [4, 0], [0, -4], [0, 4]].reduce((sum, [dx, dy]) =>
      sum + tiles[Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx))].elevation, 0) / 4;
    const basin = (rim - tile.elevation) * 28 - tile.elevation * 3;
    return { i, score: inland[i] + tile.moisture * 4 + basin + jitter,
      compactScore: Math.min(inland[i], compactFitDepth) * .35 + tile.moisture * 2 + basin + jitter,
      nearestLakeSquared: Infinity };
  })
    .filter(({ i }) => inland[i] >= 7 && !tiles[i].ridge).sort((a, b) => b.score - a.score);
  const scatterReach = Math.sqrt(candidates.length / Math.max(1, target)) * 1.6;
  const lakes: FreshwaterLake[] = [], occupied = new Uint8Array(tiles.length);
  for (let cell = 0; cell < tiles.length; cell++) if (tiles[cell].ridge || WATER.has(tiles[cell].terrain))
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = cell % width + dx, y = Math.floor(cell / width) + dy;
      if (x >= 0 && y >= 0 && x < width && y < height) occupied[y * width + x] = 1;
    }
  for (let order = 0; order < target; order++) {
    const shape: LakeShape = 'compact';
    let placementOrder = candidates;
    {
      // Once there is room for a basin, greater inland depth no longer makes
      // its center more attractive. Favor unserved parts of suitable land,
      // with enough seeded jitter to avoid regular rows or a rigid lattice.
      // Cached nearest distances and half-point buckets keep this linear per
      // lake.
      const buckets: (typeof candidates)[] = [];
      for (const candidate of candidates) {
        const spread = Math.min(scatterReach, Math.sqrt(candidate.nearestLakeSquared));
        const priority = Math.floor((candidate.compactScore + spread * .32) * 2);
        (buckets[priority] ??= []).push(candidate);
      }
      placementOrder = [];
      for (let priority = buckets.length - 1; priority >= 0; priority--)
        if (buckets[priority]) placementOrder.push(...buckets[priority]);
    }
    let accepted: FreshwaterLake | undefined;
    for (let attempt = 0; attempt < Math.min(1800, placementOrder.length); attempt++) {
      const i = placementOrder[attempt].i, cx = i % width, cy = Math.floor(i / width);
      if (lakes.some(lake => Math.hypot(cx - lake.center.x, cy - lake.center.y) < 16 * Math.sqrt(parameters.lakeSize))) continue;
      const angle = random() * Math.PI, c = Math.cos(angle), s = Math.sin(angle), phase = random() * Math.PI * 2;
      const cells = new Set<number>(); let fits = true;
      const brush = (x: number, y: number, radius: number): void => {
        for (let ny = Math.floor(y - radius); ny <= Math.ceil(y + radius); ny++)
          for (let nx = Math.floor(x - radius); nx <= Math.ceil(x + radius); nx++) {
            if (Math.hypot(nx - x, ny - y) > radius) continue;
            const next = ny * width + nx;
            if (nx < 2 || ny < 2 || nx >= width - 2 || ny >= height - 2 || inland[next] < 4
              || occupied[next] || WATER.has(tiles[next].terrain) || tiles[next].ridge || tiles[next].mountainPass
              || CARDINAL.some(([dx, dy]) => tiles[next + dy * width + dx]?.stair
                || tiles[next + dy * width + dx]?.ridge)) { fits = false; continue; }
            cells.add(next);
          }
      };
      {
        const ry = (3.2 + random() * 2.2) * parameters.lakeSize;
        const rx = ry * (1 + random() * (parameters.compactLakeAspectMax - 1) * .82);
        const extent = Math.ceil(rx * 1.2), irregularity = Math.min(1, (parameters.compactLakeAspectMax - 1) * 2);
        for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
          const u = x * c + y * s, v = -x * s + y * c, theta = Math.atan2(v / ry, u / rx);
          const shore = 1 + (Math.sin(theta * 3 + phase) * .09 + Math.cos(theta * 5 - phase) * .055) * irregularity;
          if (Math.hypot(u / rx, v / ry) <= shore) brush(cx + x, cy + y, .1);
        }
      }
      if (!fits || cells.size < 25) continue;
      if (lakeAspectRatio([...cells], width) > parameters.compactLakeAspectMax) continue;
      const queue = [[...cells][0]], reached = new Set(queue);
      for (let head = 0; head < queue.length; head++) {
        const cell = queue[head];
        for (const [dx, dy] of CARDINAL) { const next = cell + dx + dy * width;
          if (cells.has(next) && !reached.has(next)) { reached.add(next); queue.push(next); } }
      }
      if (reached.size !== cells.size) continue;
      accepted = { shape, cells: [...cells], center: { x: cx, y: cy } }; break;
    }
    if (!accepted) continue;
    lakes.push(accepted);
    for (const candidate of candidates) {
      const dx = candidate.i % width - accepted.center.x, dy = Math.floor(candidate.i / width) - accepted.center.y;
      candidate.nearestLakeSquared = Math.min(candidate.nearestLakeSquared, dx * dx + dy * dy);
    }
    const basinCells = new Set(accepted.cells);
    let spillway = Infinity;
    for (const i of accepted.cells) for (const [dx, dy] of CARDINAL) {
      const adjacent = i + dy * width + dx;
      if (!basinCells.has(adjacent)) spillway = Math.min(spillway, tiles[adjacent].elevation);
    }
    const lakeLevel = Math.max(.015, spillway - .012);
    for (const i of accepted.cells) {
      Object.assign(tiles[i], { terrain: 'lake', overlay: 'none', lakeShape: shape, elevation: lakeLevel, food: 2, production: 0, gold: 0 });
      delete tiles[i].palm; delete tiles[i].beach;
      const x = i % width, y = Math.floor(i / width);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) occupied[ny * width + nx] = 1;
      }
    }
  }
  return lakes;
}
