import { applyTundra } from './tundra';
import { scatterDesertStones } from './desert-stones';
import { createNoise2D } from 'simplex-noise';
import { type Point, type World, type Tile, WATER } from '../game/types';
import { STARTING_FACTION_COUNT, OPPOSING_FACTION_COUNT } from '../game/civilizations';
import { ridgeGroundWalkable, ridgeIsLedge, STAIR_UP } from '../game/ridges';
import { MEDITERRANEAN_DATA as DATA } from './data/mediterranean-data';
import { seededRandom, settlements, terrainYields } from './generator';
import { MIN_FACTION_START_DISTANCE } from './starting-sites';
import { DEFAULT_LANDSCAPE_PARAMETERS } from './options';
import { addMediterraneanRelief } from './mediterranean-relief';
import { pruneShortRiverSpurs } from './river-spurs';
import { addWaterfallTributaries } from './waterfalls';
import { applySoilFertility } from './soil';
import { assignRegionalResources } from './resources';
import { applyStonePlains } from './stone-plains';
import { applyDesertTransitions } from './desert-regions';

export const MEDITERRANEAN_WIDTH = 384;
export const MEDITERRANEAN_HEIGHT = 199;
const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const clamp = (value: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const at = (world: World, x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height ? y * world.width + x : -1;

function geographicPoint(world: World, lon: number, lat: number): Point {
  const b = DATA.bounds;
  return { x: clamp((lon - b.west) / (b.east - b.west) * world.width, 0, world.width - 1),
    y: clamp((b.north - lat) / (b.north - b.south) * world.height, 0, world.height - 1) };
}

/** A cardinal raster path leaves no diagonal cracks in channels or straits. */
function lineCells(world: World, points: readonly (readonly [number, number])[]): number[] {
  const cells: number[] = [];
  for (let n = 1; n < points.length; n++) {
    const a = geographicPoint(world, ...points[n - 1]), b = geographicPoint(world, ...points[n]);
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 3));
    let x = Math.floor(a.x), y = Math.floor(a.y); cells.push(y * world.width + x);
    for (let s = 1; s <= steps; s++) {
      const tx = Math.floor(a.x + (b.x - a.x) * s / steps), ty = Math.floor(a.y + (b.y - a.y) * s / steps);
      if (x !== tx) { x = tx; cells.push(y * world.width + x); }
      if (y !== ty) { y = ty; cells.push(y * world.width + x); }
    }
  }
  return [...new Set(cells)];
}

function paintWater(tile: Tile, terrain: 'ocean' | 'river'): void {
  tile.terrain = terrain; tile.overlay = 'none'; tile.moisture = 1;
  delete tile.biome; delete tile.treeClass; delete tile.marsh; delete tile.palm;
  Object.assign(tile, terrainYields(terrain, 'none'));
}

/** Small reaches retain their ground under a four-native-pixel surface stream.
 * A confluence never shrinks an already painted major river. */
function paintRiver(tile: Tile, main: boolean): void {
  main ||= tile.terrain === 'river' && !tile.creek;
  const ground = tile.creekGround ?? (tile.terrain === 'desert' || tile.terrain === 'plains' ? tile.terrain : 'grassland');
  paintWater(tile, 'river');
  tile.channel = main ? 'main' : 'tributary'; tile.channelWidth = main ? 1 : .25;
  if (main) { delete tile.creek; delete tile.creekGround; }
  else { tile.creek = true; tile.creekGround = ground; }
}

function waterDistance(world: World, source: (tile: Tile) => boolean): Uint16Array {
  const result = new Uint16Array(world.tiles.length).fill(65535), queue: number[] = [];
  world.tiles.forEach((tile, cell) => { if (source(tile)) { result[cell] = 0; queue.push(cell); } });
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % world.width, y = Math.floor(cell / world.width);
    for (const [dx, dy] of CARDINAL) {
      const next = at(world, x + dx, y + dy);
      if (next < 0 || result[next] <= result[cell] + 1) continue;
      result[next] = result[cell] + 1; queue.push(next);
    }
  }
  return result;
}

/** Sub-tile channels need a single-cell spine: detailed source bends can raster
 * into 2×2 blocks whose cardinal ports would otherwise draw artificial loops.
 * Remove only redundant creek cells, never an endpoint or a connecting branch. */
function thinCreekBlocks(world: World, originalGround: ReadonlyMap<number, Tile>): void {
  const wet = (x: number, y: number) => {
    const cell = at(world, x, y);
    return cell >= 0 && WATER.has(world.tiles[cell].terrain);
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [cell, ground] of originalGround) {
      if (!world.tiles[cell].creek) continue;
      const x = cell % world.width, y = Math.floor(cell / world.width);
      const block = [-1, 0].some(dx => [-1, 0].some(dy =>
        wet(x + dx, y + dy) && wet(x + dx + 1, y + dy)
        && wet(x + dx, y + dy + 1) && wet(x + dx + 1, y + dy + 1)));
      if (!block) continue;
      const neighbors = CARDINAL.map(([dx, dy]) => at(world, x + dx, y + dy))
        .filter(next => next >= 0 && WATER.has(world.tiles[next].terrain));
      if (neighbors.length < 2) continue;
      // All surviving ports must remain cardinally connected within the same
      // 3×3 neighborhood; this local condition preserves global connectivity.
      const queue = [neighbors[0]], connected = new Set(queue);
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head], cx = current % world.width, cy = Math.floor(current / world.width);
        for (const [dx, dy] of CARDINAL) {
          const nx = cx + dx, ny = cy + dy, next = at(world, nx, ny);
          if (next < 0 || next === cell || connected.has(next) || Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1 || !wet(nx, ny)) continue;
          connected.add(next); queue.push(next);
        }
      }
      if (!neighbors.every(next => connected.has(next))) continue;
      // Restore the exact pre-river climate, terrain and yields. Later riparian
      // ecology still sees the surviving creek immediately beside this bank.
      world.tiles[cell] = ground; changed = true;
    }
  }
}

/** Modern river centerlines are geographic proxies; widths are game abstractions. */
function addRivers(world: World, elevation: Float32Array): void {
  const originalGround = new Map<number, Tile>();
  for (const river of DATA.rivers) {
    const cells = lineCells(world, river.points);
    for (const cell of cells) {
      const tile = world.tiles[cell];
      if (tile.terrain === 'ocean' || tile.terrain === 'lake') continue;
      if (!WATER.has(tile.terrain)) originalGround.set(cell, { ...tile });
      paintRiver(tile, river.rank <= 3);
    }
  }
  thinCreekBlocks(world, originalGround);
  // Close tiny rasterization gaps at mouths without extending arbitrary channels.
  const saltDistance = waterDistance(world, tile => tile.terrain === 'ocean' || tile.terrain === 'lake');
  const mouths = world.tiles.flatMap((tile, cell) => tile.terrain === 'river' && saltDistance[cell] <= 2 ? [cell] : []);
  for (let cell of mouths) while (saltDistance[cell] > 0) {
    const x = cell % world.width, y = Math.floor(cell / world.width);
    const next = CARDINAL.map(([dx, dy]) => at(world, x + dx, y + dy)).find(next => next >= 0 && saltDistance[next] < saltDistance[cell]);
    if (next === undefined) break;
    if (!WATER.has(world.tiles[next].terrain)) {
      originalGround.set(next, { ...world.tiles[next] });
      paintRiver(world.tiles[next], !world.tiles[cell].creek);
    }
    cell = next;
  }
  pruneShortRiverSpurs(world, originalGround);
  // Infer direction on the raster network, using actual outlets and map-edge cuts.
  // Each pointer decreases distance to its outlet, so channelNext can never cycle.
  const depth = new Int32Array(world.tiles.length).fill(-1), seen = new Uint8Array(world.tiles.length);
  for (let start = 0; start < world.tiles.length; start++) {
    if (seen[start] || world.tiles[start].terrain !== 'river') continue;
    const component = [start], outlets: number[] = []; seen[start] = 1;
    for (let head = 0; head < component.length; head++) {
      const cell = component[head], x = cell % world.width, y = Math.floor(cell / world.width);
      let outlet = x === 0 || y === 0 || x === world.width - 1 || y === world.height - 1;
      for (const [dx, dy] of CARDINAL) {
        const next = at(world, x + dx, y + dy); if (next < 0) continue;
        const tile = world.tiles[next];
        if (tile.terrain === 'ocean' || tile.terrain === 'lake') outlet = true;
        if (tile.terrain === 'river' && !seen[next]) { seen[next] = 1; component.push(next); }
      }
      if (outlet) outlets.push(cell);
    }
    // A truncated or internally draining source reach retains its lowest outlet.
    if (!outlets.length) outlets.push(component.reduce((a, b) => elevation[a] < elevation[b] ? a : b));
    const queue = outlets.slice(); for (const cell of queue) depth[cell] = 0;
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head], x = cell % world.width, y = Math.floor(cell / world.width), tile = world.tiles[cell];
      tile.flow = Math.max(1, tile.channel === 'main' ? 80 : 15);
      if (depth[cell] === 0) tile.channelNext = CARDINAL.map(([dx, dy]) => at(world, x + dx, y + dy))
        .find(next => next >= 0 && ['ocean', 'lake'].includes(world.tiles[next].terrain)) ?? -1;
      for (const [dx, dy] of CARDINAL) {
        const next = at(world, x + dx, y + dy);
        if (next < 0 || world.tiles[next].terrain !== 'river' || depth[next] >= 0) continue;
        depth[next] = depth[cell] + 1; world.tiles[next].channelNext = cell; queue.push(next);
      }
    }
  }
}

/** Frequent shallow crossings preserve walking routes between regional starts. */
function addFords(world: World): void {
  const used: number[] = [];
  for (const axis of ['horizontal', 'vertical'] as const) {
    const lines = axis === 'horizontal' ? world.height : world.width, length = axis === 'horizontal' ? world.width : world.height;
    const index = (line: number, p: number) => axis === 'horizontal' ? line * world.width + p : p * world.width + line;
    for (let line = 2; line < lines - 2; line++) for (let p = 2; p < length - 2; p++) {
      const first = index(line, p); if (world.tiles[first].terrain !== 'river') continue;
      const start = p; while (p < length - 1 && world.tiles[index(line, p)].terrain === 'river') p++;
      if (p - start > 4 || WATER.has(world.tiles[index(line, start - 1)].terrain) || WATER.has(world.tiles[index(line, p)].terrain)) continue;
      if (used.some(cell => Math.hypot(cell % world.width - first % world.width, Math.floor(cell / world.width) - Math.floor(first / world.width)) < 6)) continue;
      for (let q = start; q < p; q++) { const tile = world.tiles[index(line, q)]; tile.overlay = 'ford'; tile.fordAxis = axis; }
      used.push(first);
    }
  }
}

export function generateMediterraneanWorld(seed: string, width = MEDITERRANEAN_WIDTH, height = MEDITERRANEAN_HEIGHT): World {
  const random = seededRandom(`${seed}:mediterranean`), noise = createNoise2D(random);
  const world: World = { seed, width, height, generationStyle: 'mediterranean', landformFamily: 'mixed',
    generationParameters: { ...DEFAULT_LANDSCAPE_PARAMETERS }, tiles: [], spawns: [],
    source: 'Mediterranean c.200 BC: REVEALS TW6 pollen-constrained estimates; GMT SRTM15+ relief; Natural Earth v5.1.2 coastlines and rivers. See dev/mediterranean-map/README.md.' };
  const elevation = new Float32Array(width * height), woody = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(DATA.width - 1, Math.floor((x + .5) / width * DATA.width)), sy = Math.min(DATA.height - 1, Math.floor((y + .5) / height * DATA.height));
    const cell = y * width + x, cover = Number(DATA.classRows[sy][sx]);
    elevation[cell] = DATA.elevationRows[sy][sx]; woody[cell] = parseInt(DATA.woodyRows[sy][sx], 16) / 15;
    const moisture = parseInt(DATA.moistureRows[sy][sx], 16) / 15;
    const terrain = cover === 0 ? 'ocean' : cover === 1 ? 'lake' : cover === 6 ? 'desert' : cover === 5 ? 'plains' : 'grassland';
    const tile: Tile = { terrain, overlay: 'none', elevation: clamp(elevation[cell] / 3000), moisture,
      temperature: clamp(.80 - (DATA.bounds.north - (y + .5) / height * 22 - 27) * .015 - Math.max(0, elevation[cell]) / 5500),
      rainfall: moisture, ...terrainYields(terrain, 'none'), variation: random() };
    if (terrain === 'lake') tile.lakeShape = 'compact';
    world.tiles.push(tile);
  }
  for (const strait of [[[-6,35.9],[-5.6,35.95],[-5.4,35.98],[-5.1,35.95]],
    [[26,39.9],[26.2,40],[26.4,40.18],[26.7,40.4],[27,40.5]],
    [[28.9,40.8],[29,41],[29.1,41.15],[29.15,41.3],[29.3,41.4]]] as const)
    for (const cell of lineCells(world, strait)) paintWater(world.tiles[cell], 'ocean');
  addRivers(world, elevation); addFords(world);
  const freshwater = waterDistance(world, tile => tile.terrain === 'river' || tile.terrain === 'lake');
  for (let cell = 0; cell < world.tiles.length; cell++) {
    const tile = world.tiles[cell]; if (WATER.has(tile.terrain)) continue;
    if (freshwater[cell] <= 2 && tile.terrain === 'desert') tile.terrain = 'plains';
    Object.assign(tile, terrainYields(tile.terrain, tile.overlay));
    if (freshwater[cell] <= 2) { tile.food++; tile.moisture = clamp(tile.moisture + .23); }
  }
  // Reserve connected, buildable towns before raising shelves around them.
  const minimumFactionDistance = width >= MEDITERRANEAN_WIDTH && height >= MEDITERRANEAN_HEIGHT ? MIN_FACTION_START_DISTANCE : 0;
  world.minimumFactionStartDistance = minimumFactionDistance || undefined;
  const sites = settlements(world.tiles, width, height, random, DEFAULT_LANDSCAPE_PARAMETERS, minimumFactionDistance);
  if (sites.capitals.length !== STARTING_FACTION_COUNT || sites.secondary.length !== OPPOSING_FACTION_COUNT)
    throw new Error('Mediterranean map needs more room for connected starting towns.');
  world.spawns = sites.capitals; world.secondarySpawns = sites.secondary;
  addMediterraneanRelief(world, elevation);
  // The coarse DEM supports small inferred headwaters on the Alpine slopes.
  // Keep their complete downhill courses and real ledge drops; the original
  // mapped river network, including its outlet routing, remains unchanged.
  const alpine = addWaterfallTributaries(world, { geographic: true, maxPaths: 6, minimumDropSpacing: 6,
    sourceRegion: (cell, map) => {
      const lon = DATA.bounds.west + (cell % map.width + .5) / map.width * 54;
      const lat = DATA.bounds.north - (Math.floor(cell / map.width) + .5) / map.height * 22;
      // Follow the Alpine arc, excluding the Apennines and Dinaric ranges.
      const southernEdge = lon < 8 ? 44 : lon < 10 ? 45.4 : lon < 13 ? 45.7 : 46;
      return lon >= 5 && lon <= 16.5 && lat >= southernEdge && lat <= 48;
    } });
  if (alpine.paths.length) {
    const previous = freshwater.slice();
    freshwater.set(waterDistance(world, tile => tile.terrain === 'river' || tile.terrain === 'lake'));
    for (let cell = 0; cell < world.tiles.length; cell++) {
      const tile = world.tiles[cell];
      if (WATER.has(tile.terrain) || previous[cell] <= 2 || freshwater[cell] > 2) continue;
      tile.moisture = clamp(tile.moisture + .23);
      if (tile.terrain === 'desert') tile.terrain = 'plains';
    }
  }
  applyDesertTransitions(world);
  const alpineChannels = new Set(alpine.paths.flatMap(path => path.slice(0, -1)));
  const starts = [...world.spawns, ...world.secondarySpawns];
  for (let cell = 0; cell < world.tiles.length; cell++) {
    const tile = world.tiles[cell], x = cell % width, y = Math.floor(cell / width);
    if (WATER.has(tile.terrain)) {
      // New surface streams replace former woodland draws. Keep their random
      // slots so this Alpine change does not reshuffle vegetation basin-wide.
      if (alpineChannels.has(cell) && !ridgeIsLedge(world, x, y)) random();
      continue;
    }
    const latitude = DATA.bounds.north - (y + .5) / height * 22;
    tile.biome = elevation[cell] > 2100 ? 'alpine' : tile.terrain === 'desert' ? 'desert' : tile.moisture < .38 ? 'steppe' : 'temperate';
    tile.treeClass = elevation[cell] > 1400 ? 'conifer' : latitude < 39 || tile.moisture < .48 ? 'dry' : 'temperate';
    const clearing = starts.some(point => Math.max(Math.abs(point.x - x - .5), Math.abs(point.y - y - .5)) <= 5);
    const landing = Object.values(STAIR_UP).some(up => world.tiles[at(world, x + up.x, y + up.y)]?.stair);
    if (clearing || landing || tile.stair || !ridgeGroundWalkable(world, x, y) || ridgeIsLedge(world, x, y)) {
      tile.overlay = 'none'; delete tile.marsh;
    } else {
      // Regional abundance + correlated groves + local openings; no uniform forest carpet.
      const groves = noise(x * .11, y * .11) * .24 + noise(x * .34 + 71, y * .34 - 23) * .13;
      const riparian = freshwater[cell] <= 2 ? .20 : freshwater[cell] <= 4 ? .08 : 0;
      const density = clamp(woody[cell] + riparian + groves * Math.min(1, tile.moisture / .4), .005, .88);
      tile.overlay = random() < density && tile.biome !== 'alpine' ? 'forest' : 'none';
      const wet = !tile.ridge && freshwater[cell] <= 2 && elevation[cell] < 500;
      if (wet && noise(x * .17 + 38, y * .17) > .05 && tile.overlay !== 'forest') { tile.marsh = true; tile.biome = 'wetland'; }
      if (tile.terrain === 'desert' && freshwater[cell] <= 2 && random() < .14) tile.palm = true;
    }
    Object.assign(tile, terrainYields(tile.terrain, tile.overlay)); if (freshwater[cell] <= 2) tile.food++;
  }
  applySoilFertility(world); assignRegionalResources(world);
  applyStonePlains(world);
  scatterDesertStones(world);
  applyTundra(world);
  return world;
}
