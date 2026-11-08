import { createNoise2D } from 'simplex-noise';
import { WATER, type HillBiome, type Point, type World } from '../game/types';
import { ridgeGroundWalkable } from '../game/ridges';
import { environmentRandom, settlementCoreMask } from './environment-fields';
import { hillFloorConnected, hillShape, type HillShape } from './hill-shapes';
import { rebuildIncisedRelief } from './regional-relief';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';
import { terrainYields } from './generator';

const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
interface District { center: Point; radius: number; biome: HillBiome; }
interface Fragment { cells: number[]; kind: 'hills' | 'mountains'; district: number; growth: number; }

/** Local hill country within the existing climate, never a replacement climate
 * map. It is built before rivers, which can subsequently incise its shelves. */
export function placeHillBiomes(world: World, parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): void {
  const { width, height, tiles } = world;
  // Compact development maps need their limited land for the full set of cities.
  if (Math.min(width, height) < 128) return;
  const random = environmentRandom(`${world.seed}:hill-biomes`), noise = createNoise2D(random);
  const cores = settlementCoreMask(world), available = new Uint8Array(tiles.length), climate = new Uint8Array(tiles.length);
  const existing = new Set(tiles.flatMap(tile => tile.ridge ? [tile.ridge] : []));
  let land = 0;
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell]; if (WATER.has(tile.terrain)) continue; land++;
    const temperature = tile.temperature ?? .55;
    if (tile.terrain === 'desert' || tile.terrain === 'plains' && temperature > .45 && tile.moisture < .5) climate[cell] = 1;
    else if (tile.terrain === 'grassland' && temperature > .25 && tile.moisture > .4) climate[cell] = 2;
  }
  for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
    const cell = y * width + x, tile = tiles[cell];
    if (!climate[cell] || cores[cell] || tile.marsh || tile.canyon || tile.mountainPass || tile.ridge) continue;
    let clear = true;
    for (let dy = -3; dy <= 3 && clear; dy++) for (let dx = -3; dx <= 3; dx++) {
      const next = (y + dy) * width + x + dx, near = tiles[next];
      if (cores[next] || near.beach || near.terrain === 'coast' || near.terrain === 'ocean'
        || Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && (WATER.has(near.terrain) || near.ridge || near.mountainPass
          || near.marsh || near.canyon || near.overlay === 'volcano' || near.overlay === 'glacier')) { clear = false; break; }
    }
    available[cell] = Number(clear);
  }
  const radius = Math.max(18, Math.min(38, 32 * Math.sqrt(parameters.reliefCoverage / DEFAULT_LANDSCAPE_PARAMETERS.reliefCoverage)));
  const districts: District[] = [], mask = new Uint8Array(tiles.length);
  const perClimate = Math.max(1, Math.min(2, Math.round(land / 24000)));
  for (const kind of [1, 2]) for (let count = 0; count < perClimate; count++) {
    let best = -1, bestScore = 0;
    for (let y = 10; y < height - 10; y += 6) for (let x = 10; x < width - 10; x += 6) {
      const cell = y * width + x;
      if (!available[cell] || climate[cell] !== kind || districts.some(d => Math.hypot(d.center.x - x, d.center.y - y) < radius * 2.1)) continue;
      let matching = 0, samples = 0;
      for (let dy = -radius; dy <= radius; dy += 4) for (let dx = -radius; dx <= radius; dx += 4) {
        if (dx * dx + dy * dy > radius * radius) continue;
        samples++;
        const nx = Math.round(x + dx), ny = Math.round(y + dy);
        if (nx >= 3 && ny >= 3 && nx < width - 3 && ny < height - 3) {
          const next = ny * width + nx;
          matching += Number(!!available[next] && climate[next] === kind);
        }
      }
      const score = matching / samples + noise(x * .037, y * .037) * .035;
      if (matching >= 22 && score > bestScore) { bestScore = score; best = cell; }
    }
    if (best < 0) continue;
    const center = { x: best % width, y: Math.floor(best / width) }, id = districts.length + 1;
    districts.push({ center, radius, biome: kind === 1 ? 'desert-hills' : 'forest-hills' });
    for (let y = Math.max(3, Math.floor(center.y - radius)); y < Math.min(height - 3, center.y + radius); y++)
      for (let x = Math.max(3, Math.floor(center.x - radius * 1.2)); x < Math.min(width - 3, center.x + radius * 1.2); x++) {
        const cell = y * width + x;
        const radial = Math.hypot((x - center.x) / (radius * 1.2), (y - center.y) / (radius * .9));
        if (available[cell] && climate[cell] === kind && radial < .93 + noise(x * .075, y * .075) * .12) mask[cell] = id;
      }
  }
  const candidates = Array.from(mask.keys()).filter(cell => mask[cell]);
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  const reserved = new Uint8Array(tiles.length), fragments: Fragment[] = [], authored = new Set<number>();
  const gap = Math.max(1, Math.round(parameters.hillSpacing));
  const place = (cell: number, shape: HillShape, kind: Fragment['kind']): boolean => {
    const x = cell % width, y = Math.floor(cell / width), district = mask[cell];
    if (!hillFloorConnected(shape.points) || shape.points.some(p => x + p.x < 3 || y + p.y < 3 || x + p.x >= width - 3 || y + p.y >= height - 3)) return false;
    const cells = shape.points.map(p => (y + p.y) * width + x + p.x);
    if (cells.some(next => mask[next] !== district || reserved[next])) return false;
    fragments.push({ cells, kind, district, growth: random() < .22 ? 0 : 2 });
    for (const next of cells) {
      authored.add(next); const nx = next % width, ny = Math.floor(next / width);
      for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) reserved[(ny + dy) * width + nx + dx] = 1;
    }
    return true;
  };
  const landmarks: Point[] = [], counts = new Uint8Array(districts.length + 1);
  for (const cell of candidates) {
    const x = cell % width, y = Math.floor(cell / width), district = mask[cell];
    if (counts[district] >= 2 || landmarks.some(p => Math.hypot(p.x - x, p.y - y) < 20)) continue;
    if (place(cell, hillShape(random, true, parameters.hillSize), 'mountains')) { counts[district]++; landmarks.push({ x, y }); }
  }
  for (const cell of candidates) {
    if (reserved[cell]) continue;
    for (let attempt = 0; attempt < 8; attempt++) if (place(cell, hillShape(random, false, parameters.hillSize), 'hills')) break;
  }
  const owner = new Int32Array(tiles.length);
  fragments.forEach((fragment, index) => { for (const cell of fragment.cells) owner[cell] = index + 1; });
  for (let round = 0; round < 2; round++) {
    const additions: { cell: number; id: number }[] = [];
    for (const cell of candidates) {
      if (owner[cell]) continue;
      const near = new Set(CARDINAL.map(([dx, dy]) => owner[cell + dy * width + dx]).filter(Boolean));
      if (near.size !== 1) continue;
      const id = [...near][0], fragment = fragments[id - 1];
      if (round < fragment.growth && mask[cell] === fragment.district) additions.push({ cell, id });
    }
    for (const { cell, id } of additions) {
      let clear = true;
      for (let dy = -gap; dy <= gap && clear; dy++) for (let dx = -gap; dx <= gap; dx++) {
        const other = owner[cell + dy * width + dx]; if (other && other !== id) { clear = false; break; }
      }
      if (clear && fragments[id - 1].cells.length < 320 * parameters.hillSize ** 2) {
        owner[cell] = id; fragments[id - 1].cells.push(cell); authored.add(cell);
      }
    }
  }
  rebuildIncisedRelief(world, fragments);
  const groups = new Map<number, number[]>();
  for (const cell of authored) {
    const id = tiles[cell].ridge; if (!id) continue;
    const cells = groups.get(id) ?? []; cells.push(cell); groups.set(id, cells);
  }
  const flatten: { cells: number[]; kind: 'hills' }[] = [];
  for (const cells of groups.values()) {
    const upper = cells.filter(cell => tiles[cell].ridgeTier === 2);
    if (!upper.length || upper.some(cell => tiles[cell].stair) && upper.some(cell => !tiles[cell].stair && ridgeGroundWalkable(world, cell % width, Math.floor(cell / width)))) continue;
    for (const cell of cells) { delete tiles[cell].ridge; delete tiles[cell].ridgeTier; delete tiles[cell].stair; delete tiles[cell].relief; }
    flatten.push({ cells, kind: 'hills' });
  }
  if (flatten.length) rebuildIncisedRelief(world, flatten);
  for (const cell of authored) {
    const tile = tiles[cell]; if (!tile.ridge) continue;
    tile.relief = 'hills'; tile.elevation = tile.ridgeTier === 2 ? .86 : .76;
    const biome = districts[mask[cell] - 1].biome, x = cell % width, y = Math.floor(cell / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const next = (y + dy) * width + x + dx, near = tiles[next];
      if (!WATER.has(near.terrain) && !near.beach && !near.marsh && !near.canyon && !cores[next]
        && (!near.ridge || !existing.has(near.ridge))) near.hillBiome = biome;
    }
  }
}

/** Restore each district's native ground palette after rainfall, incision and
 * apron harmonization, keeping water, wetlands, beaches and town cores intact. */
export function finishHillBiomes(world: World): void {
  const cores = settlementCoreMask(world);
  world.tiles.forEach((tile, cell) => {
    if (!tile.hillBiome) return;
    if (WATER.has(tile.terrain) || tile.marsh || tile.beach || tile.canyon === 'floor' || cores[cell]) { delete tile.hillBiome; return; }
    const terrain = tile.hillBiome === 'desert-hills' ? 'desert' : 'grassland';
    const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(terrain, tile.overlay);
    tile.terrain = terrain;
    tile.biome = tile.hillBiome === 'desert-hills' ? 'desert' : (tile.temperature ?? .5) < .35 ? 'taiga' : 'temperate';
    for (const key of ['food', 'production', 'gold'] as const) tile[key] = Math.max(0, tile[key] + after[key] - before[key]);
  });
}
