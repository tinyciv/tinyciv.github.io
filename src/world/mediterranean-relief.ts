import { WATER, type Tile, type World } from '../game/types';
import { ridgeEdgeAllowed, ridgeGroundWalkable, ridgeIsLedge, ridgeLevel, STAIR_UP, type StairDirection } from '../game/ridges';
import { harmonizeRidgeTerrain } from './ridges';
import { markRiverWaterfalls } from './waterfalls';

const THRESHOLDS = [300, 750, 1250, 1800, 2350];
const DIRECTIONS = Object.entries(STAIR_UP) as [StairDirection, { x: number; y: number }][];
const dry = (tile: Tile): boolean => !WATER.has(tile.terrain);
const ground = (tile: Tile): boolean => dry(tile) || tile.terrain === 'river' && tile.overlay === 'ford';

/** Remove one-cell threads while retaining the DEM's connected silhouette. */
function supported(mask: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const cell = y * width + x;
    if (mask[cell] && mask[cell + 1] && mask[cell + width] && mask[cell + width + 1])
      result[cell] = result[cell + 1] = result[cell + width] = result[cell + width + 1] = 1;
  }
  return result;
}

function neighbors(world: World, cell: number, visit: (next: number) => void): void {
  const x = cell % world.width, y = Math.floor(cell / world.width);
  if (x) visit(cell - 1);
  if (x + 1 < world.width) visit(cell + 1);
  if (y) visit(cell - world.width);
  if (y + 1 < world.height) visit(cell + world.width);
}

function square(world: World, cell: number, radius: number, visit: (next: number) => void): void {
  const x = cell % world.width, y = Math.floor(cell / world.width);
  for (let ny = Math.max(0, y - radius); ny <= Math.min(world.height - 1, y + radius); ny++)
    for (let nx = Math.max(0, x - radius); nx <= Math.min(world.width - 1, x + radius); nx++) visit(ny * world.width + nx);
}

/** A light spatial average suppresses raster speckle without inventing ranges. */
function smoothElevation(world: World, elevation: Float32Array): Float32Array {
  const result = new Float32Array(elevation.length), { width, height } = world;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, weight = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const w = (dx ? 1 : 4) * (dy ? 1 : 4);
      sum += elevation[ny * width + nx] * w; weight += w;
    }
    result[y * width + x] = sum / weight;
  }
  return result;
}

/** Each new lip has a full lower approach before the next elevation begins. */
function normalizeContours(world: World, levels: Uint8Array): void {
  const { width, height } = world, result = new Uint8Array(levels.length);
  let previous: Uint8Array = new Uint8Array(levels.length);
  for (let tier = 1; tier <= THRESHOLDS.length; tier++) {
    const mask = new Uint8Array(levels.length);
    for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
      const cell = y * width + x;
      if (levels[cell] < tier) continue;
      let nested = true;
      if (tier > 1) for (let dy = -2; dy <= 2 && nested; dy++) for (let dx = -2; dx <= 2; dx++)
        if (!previous[cell + dy * width + dx]) { nested = false; break; }
      if (nested) mask[cell] = 1;
    }
    previous = supported(mask, width, height);
    for (let cell = 0; cell < levels.length; cell++) if (previous[cell]) result[cell] = tier;
  }
  levels.set(result);
}

function assignContours(world: World, levels: Uint8Array, elevation: Float32Array): void {
  const { tiles } = world, seen = new Uint8Array(tiles.length);
  for (const tile of tiles) {
    delete tile.ridge; delete tile.ridgeTier; delete tile.stair; delete tile.relief;
  }
  let id = 0;
  for (let start = 0; start < tiles.length; start++) {
    if (!levels[start] || seen[start]) continue;
    const cells = [start]; seen[start] = 1;
    for (let head = 0; head < cells.length; head++) neighbors(world, cells[head], next => {
      if (levels[next] && !seen[next]) { seen[next] = 1; cells.push(next); }
    });
    if (cells.length < 8) { for (const cell of cells) levels[cell] = 0; continue; }
    id++;
    for (const cell of cells) {
      const tile = tiles[cell]; tile.ridge = id; tile.ridgeTier = levels[cell] as Tile['ridgeTier'];
      tile.relief = elevation[cell] >= 1000 || levels[cell] > 1 ? 'mountains' : 'hills';
      delete tile.palm;
    }
  }
}

/** Connect every bordering floor component, including towns in mountain bowls.
 * Water is never a stair landing, even though narrow creeks retain the shelf. */
function addStairs(world: World): number[][] {
  const { tiles, width } = world, owner = new Int32Array(tiles.length).fill(-1), floors: number[][] = [];
  for (let start = 0; start < tiles.length; start++) {
    if (owner[start] >= 0 || !ground(tiles[start]) || !ridgeGroundWalkable(world, start % width, Math.floor(start / width))) continue;
    const level = ridgeLevel(tiles[start]), id = floors.length, cells = [start]; owner[start] = id;
    for (let head = 0; head < cells.length; head++) neighbors(world, cells[head], next => {
      if (owner[next] >= 0 || !ground(tiles[next]) || ridgeLevel(tiles[next]) !== level
        || !ridgeGroundWalkable(world, next % width, Math.floor(next / width))) return;
      owner[next] = id; cells.push(next);
    });
    floors.push(cells);
  }
  const connections = floors.map(() => [] as number[]), pairs = new Set<string>();
  // Broad, straight contour edges win over shallow jagged notches.
  const candidates: { cell: number; direction: StairDirection; low: number; high: number; score: number }[] = [];
  for (let cell = 0; cell < tiles.length; cell++) {
    if (!tiles[cell].ridge || !dry(tiles[cell])) continue;
    const x = cell % width, y = Math.floor(cell / width);
    for (const [direction, up] of DIRECTIONS) {
      const offset = up.y * width + up.x, low = cell - offset, high = cell + offset;
      if (owner[low] < 0 || owner[high] < 0 || !dry(tiles[low]) || !dry(tiles[high])) continue;
      const flankA = cell - up.y + up.x * width, flankB = cell + up.y - up.x * width;
      if (!tiles[flankA] || !tiles[flankB] || !dry(tiles[flankA]) || !dry(tiles[flankB])) continue;
      tiles[cell].stair = direction;
      const valid = ridgeGroundWalkable(world, x, y); delete tiles[cell].stair;
      if (!valid) continue;
      const score = Math.min(floors[owner[low]].length, floors[owner[high]].length)
        + ((Math.imul(cell + 1, 2654435761) >>> 0) % 1000) / 1000;
      candidates.push({ cell, direction, low: owner[low], high: owner[high], score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.cell - b.cell || a.direction.localeCompare(b.direction));
  for (const candidate of candidates) {
    const key = `${candidate.low}:${candidate.high}`;
    if (pairs.has(key) || tiles[candidate.cell].stair) continue;
    tiles[candidate.cell].stair = candidate.direction;
    if (!ridgeGroundWalkable(world, candidate.cell % width, Math.floor(candidate.cell / width))) {
      delete tiles[candidate.cell].stair; continue;
    }
    pairs.add(key); connections[candidate.low].push(candidate.high); connections[candidate.high].push(candidate.low);
  }
  const reached = new Uint8Array(floors.length), queue: number[] = [];
  for (let id = 0; id < floors.length; id++) if (!tiles[floors[id][0]].ridge) { reached[id] = 1; queue.push(id); }
  for (let head = 0; head < queue.length; head++) for (const next of connections[queue[head]])
    if (!reached[next]) { reached[next] = 1; queue.push(next); }
  return floors.filter((cells, id) => tiles[cells[0]].ridge && !reached[id]);
}

/** Find a narrow saddle only when the new ledges sever a previously open route. */
function townSaddle(world: World): number[] | undefined {
  const { tiles, width } = world, towns = [...world.spawns, ...(world.secondarySpawns ?? [])];
  if (!towns.length) return;
  const start = Math.floor(towns[0].y) * width + Math.floor(towns[0].x);
  const reached = new Uint8Array(tiles.length), queue = [start]; reached[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], from = { x: cell % width, y: Math.floor(cell / width) };
    neighbors(world, cell, next => {
      if (reached[next] || !ground(tiles[next])) return;
      const to = { x: next % width, y: Math.floor(next / width) };
      if (!ridgeGroundWalkable(world, to.x, to.y) || !ridgeEdgeAllowed(world, from, to)) return;
      reached[next] = 1; queue.push(next);
    });
  }
  const targets = new Set(towns.map(p => Math.floor(p.y) * width + Math.floor(p.x)).filter(cell => !reached[cell]));
  if (!targets.size) return;
  const parent = new Int32Array(tiles.length).fill(-2);
  for (const cell of queue) parent[cell] = -1;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (targets.has(cell)) {
      const path: number[] = [];
      for (let next = cell; parent[next] >= 0; next = parent[next]) path.push(next);
      return path;
    }
    neighbors(world, cell, next => {
      if (parent[next] !== -2 || !ground(tiles[next])) return;
      parent[next] = cell; queue.push(next);
    });
  }
}

/** Terraced Mediterranean massifs follow the measured DEM, not stamped mesas.
 * Creek channels remain on their physical shelf; only major water cuts a valley.
 * Tile.elevation retains its original sampled height throughout this process. */
export function addMediterraneanRelief(world: World, elevation: Float32Array): void {
  if (elevation.length !== world.tiles.length) throw new RangeError('Mediterranean relief must match the world dimensions.');
  const { tiles, width, height } = world, heightfield = smoothElevation(world, elevation);
  const blocked = new Uint8Array(tiles.length), levels = new Uint8Array(tiles.length);
  for (let cell = 0; cell < tiles.length; cell++) if (WATER.has(tiles[cell].terrain) && !tiles[cell].creek)
    square(world, cell, 1, next => { blocked[next] = 1; });
  for (const town of [...world.spawns, ...(world.secondarySpawns ?? [])])
    for (let y = Math.max(0, Math.floor(town.y - 7)); y <= Math.min(height - 1, Math.ceil(town.y + 7)); y++)
      for (let x = Math.max(0, Math.floor(town.x - 7)); x <= Math.min(width - 1, Math.ceil(town.x + 7)); x++)
        if (Math.hypot(x - town.x, y - town.y) < 7) blocked[y * width + x] = 1;
  for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
    const cell = y * width + x;
    if (!blocked[cell]) levels[cell] = THRESHOLDS.filter(threshold => heightfield[cell] >= threshold).length;
  }
  // Every repair only lowers a contour, so the process cannot oscillate.
  for (let attempt = 0; attempt < 24; attempt++) {
    normalizeContours(world, levels); assignContours(world, levels, heightfield);
    const inaccessible = addStairs(world);
    if (inaccessible.length) {
      for (const cells of inaccessible) {
        const tier = levels[cells[0]];
        for (const cell of cells) square(world, cell, 1, next => {
          if (levels[next] >= tier) levels[next] = tier - 1;
        });
      }
      continue;
    }
    const saddle = townSaddle(world);
    if (!saddle) break;
    for (const cell of saddle) if (levels[cell]) square(world, cell, 1, next => {
      if (levels[next] && dry(tiles[next])) tiles[next].mountainPass = true;
      levels[next] = 0;
    });
  }
  // The bounded repair loop normally converges in a few passes. Reassign once
  // more so even its final lowering is reflected in the published geometry.
  normalizeContours(world, levels); assignContours(world, levels, heightfield); addStairs(world);
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell], x = cell % width, y = Math.floor(cell / width);
    if (tile.stair || ridgeIsLedge(world, x, y)) {
      tile.overlay = 'none'; delete tile.fordAxis; delete tile.marsh; delete tile.palm; delete tile.treeClass;
    }
  }
  harmonizeRidgeTerrain(world);
  // The native creek overlays expose the shelf beneath them. Match that ground
  // to the palette selected for the surrounding ledges, including desert ones.
  for (let cell = 0; cell < tiles.length; cell++) if (tiles[cell].creek) {
    const tile = tiles[cell]; let grass = 0, sand = 0;
    square(world, cell, 2, next => {
      const neighbor = tiles[next];
      if (!dry(neighbor) || tile.ridge && neighbor.ridge !== tile.ridge) return;
      if (neighbor.terrain === 'desert' || neighbor.terrain === 'plains') sand++;
      else grass++;
    });
    if (grass || sand) tile.creekGround = sand > grass ? 'desert' : 'grassland';
  }
  markRiverWaterfalls(world);
}
