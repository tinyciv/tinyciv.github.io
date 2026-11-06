import { WATER, type Point, type Tile, type World } from '../game/types';
import { ridgeEdgeAllowed, ridgeGroundWalkable, ridgeIsLedge, ridgeLevel, STAIR_UP, type StairDirection } from '../game/ridges';
import { harmonizeRidgeTerrain } from './ridges';
import { createTerrainEnvironment, type TerrainEnvironment } from './terrain-ecology';
import { terrainYields } from './generator';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';
import { createNoise2D } from 'simplex-noise';
import type { LandformPlan } from './landforms';

type Random = () => number;
export type ReliefShowcase = 'grass-hills' | 'desert-hills' | 'mountain-range' | 'mountain-clump' | 'mountain-string';
interface Layout { world: World; random: Random; available: Uint8Array; reserved: Uint8Array; nextId: number; raised: number; environment: TerrainEnvironment; parameters: LandscapeParameters }
const DIRECTIONS = Object.keys(STAIR_UP) as StairDirection[];

function randomStream(seed: string): Random {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle<T>(values: T[], random: Random): T[] {
  for (let i = values.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [values[i], values[j]] = [values[j], values[i]]; }
  return values;
}
function layout(world: World, seed: string, spawns: Point[], parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): Layout {
  const { width, height, tiles } = world;
  const available = new Uint8Array(tiles.length), reserved = new Uint8Array(tiles.length);
  for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
    const cell = y * width + x;
    if (spawns.some(spawn => Math.hypot(spawn.x - x, spawn.y - y) < 7)) continue;
    let dry = true;
    // Existing ledge art needs its coastal palette apron, while inland water
    // may approach behind the two-tile apron to form narrow valleys and gorges.
    // Stair placement still validates both of its actual landing cells.
    for (let dy = -3; dy <= 3 && dry; dy++) for (let dx = -3; dx <= 3; dx++) {
      const tile = tiles[(y + dy) * width + x + dx];
      if (tile.terrain === 'ocean' || tile.terrain === 'coast' || tile.beach
        || Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && (WATER.has(tile.terrain) || ['volcano', 'glacier'].includes(tile.overlay))) { dry = false; break; }
    }
    if (dry) available[cell] = 1;
    if (tiles[cell].ridge || tiles[cell].mountainPass) reserved[cell] = 1;
  }
  return { world, random: randomStream(seed), available, reserved, parameters,
    environment: createTerrainEnvironment(tiles, width, height, world.seed, parameters),
    nextId: tiles.reduce((max, tile) => Math.max(max, tile.ridge ?? 0), 0) + 1,
    raised: tiles.reduce((sum, tile) => sum + Number(!!tile.ridge), 0) };
}
function reserve(context: Layout, cells: number[], gap: number): void {
  const { width, height } = context.world;
  for (const cell of cells) {
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) context.reserved[ny * width + nx] = 1;
    }
  }
}
function clear(world: World, cell: number): void {
  const tile = world.tiles[cell];
  const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
  // Remove the vegetation's contribution, preserving fertility from freshwater
  // or any other ground bonus. Repeated clearing must not apply the delta twice.
  for (const resource of ['food', 'production', 'gold'] as const)
    tile[resource] = Math.max(0, tile[resource] + after[resource] - before[resource]);
  tile.overlay = 'none'; delete tile.palm; delete tile.treeClass;
}
function fits(context: Layout, cells: number[]): boolean {
  return cells.length > 0 && cells.every(cell => context.available[cell] && !context.reserved[cell]);
}

/** All stair candidates are checked using the same geometry as movement. A
 * mountain has two flights; small hills deliberately include closed summits. */
function addStairs(context: Layout, cells: number[], upper: number[], kind: 'hills' | 'mountains'): void {
  const { world, random } = context, { width, tiles } = world;
  const selected: number[] = [];
  for (const tier of [1, 2]) {
    if (tier === 2 && !upper.length) continue;
    const entrances: { cell: number; direction: StairDirection }[] = [];
    for (const cell of tier === 2 ? upper : cells) {
      if (ridgeLevel(tiles[cell]) !== tier) continue;
      for (const direction of DIRECTIONS) {
        tiles[cell].stair = direction;
        if (ridgeGroundWalkable(world, cell % width, Math.floor(cell / width))) entrances.push({ cell, direction });
        delete tiles[cell].stair;
      }
    }
    const wanted = tier === 2 ? 1 + Math.floor(random() * 2) : kind === 'mountains' ? 2 + Math.floor(random() * 2) : Math.floor(random() * 4);
    const usedDirections = new Set<StairDirection>();
    let placed = 0;
    for (const entrance of shuffle(entrances, random)) {
      if (placed >= wanted) break;
      if (usedDirections.has(entrance.direction) || selected.some(cell => Math.abs(cell % width - entrance.cell % width)
        + Math.abs(Math.floor(cell / width) - Math.floor(entrance.cell / width)) < 4)) continue;
      tiles[entrance.cell].stair = entrance.direction; selected.push(entrance.cell); usedDirections.add(entrance.direction); placed++;
    }
    // A narrow bend can erase every usable upper landing. Keep that shoulder
    // at the first level instead of creating an accidentally inaccessible tier.
    if (tier === 2 && !placed) for (const cell of upper) tiles[cell].ridgeTier = 1;
  }
  for (const cell of cells) if (ridgeIsLedge(world, cell % width, Math.floor(cell / width))) clear(world, cell);
  for (const cell of selected) {
    const up = STAIR_UP[tiles[cell].stair!], offset = up.y * width + up.x;
    for (const step of [-1, 0, 1]) clear(world, cell + offset * step);
  }
}

/** A slim crest can divide its lower shoulder into two end caps. Give each
 * walkable component a real entrance instead of choosing all ramps on one end.
 * Closed, two-cell-wide crests intentionally contain no walkable upper floor. */
function addMountainStairs(context: Layout, cells: number[], preferExterior = false): void {
  const { world, random } = context, { width, tiles } = world;
  const selected: number[] = [];
  const groundComponent = new Int32Array(tiles.length), groundSizes = [0];
  if (preferExterior) for (let start = 0; start < tiles.length; start++) {
    if (groundComponent[start] || tiles[start].ridge || tiles[start].stair || WATER.has(tiles[start].terrain)) continue;
    const component = groundSizes.length, queue = [start]; groundComponent[start] = component;
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
      for (const up of Object.values(STAIR_UP)) {
        const nx = x + up.x, ny = y + up.y, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= world.height || groundComponent[next]
          || tiles[next].ridge || tiles[next].stair || WATER.has(tiles[next].terrain)) continue;
        groundComponent[next] = component; queue.push(next);
      }
    }
    groundSizes.push(queue.length);
  }
  for (const tier of [1, 2]) {
    const floors = new Set(cells.filter(cell => ridgeLevel(tiles[cell]) === tier
      && !ridgeIsLedge(world, cell % width, Math.floor(cell / width))));
    const owners = new Map<number, number>(), components: number[][] = [];
    for (const start of floors) {
      if (owners.has(start)) continue;
      const component = [start], id = components.length; owners.set(start, id);
      for (let head = 0; head < component.length; head++) for (const offset of [-1, 1, -width, width]) {
        const next = component[head] + offset;
        if (floors.has(next) && !owners.has(next)) { owners.set(next, id); component.push(next); }
      }
      components.push(component);
    }
    const entrances = components.map(() => [] as { cell: number; direction: StairDirection }[]);
    for (const cell of cells) {
      if (ridgeLevel(tiles[cell]) !== tier) continue;
      for (const direction of DIRECTIONS) {
        const up = STAIR_UP[direction], owner = owners.get(cell + up.y * width + up.x);
        if (owner === undefined) continue;
        tiles[cell].stair = direction;
        if (ridgeGroundWalkable(world, cell % width, Math.floor(cell / width))) entrances[owner].push({ cell, direction });
        delete tiles[cell].stair;
      }
    }
    for (const candidates of entrances) {
      const ranked = shuffle(candidates, random);
      // A concave contour can contain a tiny enclosed low-ground pocket.
      // Enter from the surrounding landscape instead of marooning one floor
      // cap above a stair that only descends into that pocket.
      if (preferExterior && tier === 1) {
        const approachSize = (candidate: { cell: number; direction: StairDirection }) => {
          const up = STAIR_UP[candidate.direction];
          return groundSizes[groundComponent[candidate.cell - up.y * width - up.x]];
        };
        ranked.sort((a, b) => approachSize(b) - approachSize(a));
      }
      const chosen = ranked[0];
      if (!chosen) continue;
      tiles[chosen.cell].stair = chosen.direction; selected.push(chosen.cell);
    }
  }
  for (const cell of cells) if (ridgeIsLedge(world, cell % width, Math.floor(cell / width))) clear(world, cell);
  for (const cell of selected) {
    const up = STAIR_UP[tiles[cell].stair!], offset = up.y * width + up.x;
    for (const step of [-1, 0, 1]) clear(world, cell + offset * step);
  }
}

function placeShelf(context: Layout, cells: number[], kind: 'hills' | 'mountains', gap: number): void {
  const { world } = context, { width, tiles } = world, id = context.nextId++, set = new Set(cells);
  for (const cell of cells) {
    tiles[cell].ridge = id; tiles[cell].ridgeTier = 1; tiles[cell].relief = kind; delete tiles[cell].palm;
  }
  let upper: number[] = [];
  if (kind === 'mountains') {
    const xs = cells.map(cell => cell % width), ys = cells.map(cell => Math.floor(cell / width));
    const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    const axis = horizontal ? xs : ys, start = Math.min(...axis), end = Math.max(...axis);
    for (const cell of cells) {
      // Four-cell-long tails provide both the low approach and upper landing for
      // lengthwise stair flights, without widening the narrow mountain body.
      const along = horizontal ? cell % width : Math.floor(cell / width);
      if (along < start + 4 || along > end - 4) continue;
      let nested = true;
      for (let dy = -1; dy <= 1 && nested; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!set.has(cell + dy * width + dx)) { nested = false; break; }
      }
      if (nested) upper.push(cell);
    }
  }
  if (upper.length) {
    // Eroding a curving shelf can leave a one-cell summit pocket diagonally
    // detached from its main floor. Rebuild the upper ledge around the largest
    // cardinally connected floor, rather than decorating inaccessible pockets.
    const upperSet = new Set(upper), floors = new Set<number>();
    for (const cell of upper) {
      let interior = true;
      for (let dy = -1; dy <= 1 && interior; dy++) for (let dx = -1; dx <= 1; dx++)
        if (!upperSet.has(cell + dy * width + dx)) { interior = false; break; }
      if (interior) floors.add(cell);
    }
    let largest: number[] = [];
    const seen = new Set<number>();
    for (const start of floors) {
      if (seen.has(start)) continue;
      const component = [start]; seen.add(start);
      for (let head = 0; head < component.length; head++) for (const offset of [-1, 1, -width, width]) {
        const next = component[head] + offset;
        if (floors.has(next) && !seen.has(next)) { seen.add(next); component.push(next); }
      }
      if (component.length > largest.length) largest = component;
    }
    if (largest.length) {
      const connected = new Set<number>();
      for (const cell of largest) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) connected.add(cell + dy * width + dx);
      upper = [...connected];
    }
  }
  for (const cell of upper) tiles[cell].ridgeTier = 2;
  // Visible ledges and the drainage/climate heightfield describe the same
  // uplands. Low-ground passes retain their valley height between the shelves.
  for (const cell of cells) tiles[cell].elevation = Math.max(tiles[cell].elevation,
    kind === 'mountains' ? .82 + (tiles[cell].ridgeTier === 2 ? .10 : 0) : .76);
  if (kind === 'mountains') addMountainStairs(context, cells);
  else addStairs(context, cells, upper, kind);
  context.raised += cells.length; reserve(context, cells, gap);
}

function hill(context: Layout, cx: number, cy: number, gap: number): boolean {
  const { width, height } = context.world, { random } = context;
  // Tiny outcrops are intact rectangles: a 2×2 is exactly four native corner
  // tiles; 2×N strips add side ledges and deliberately have no upper floor.
  // Larger shelves mix square, elongated, and clipped outlines, keeping every
  // cross-section at least two tiles wide for the authored ledge artwork.
  const family = random();
  let w: number, h: number;
  if (family < .22) { w = 2; h = 2; }
  else if (family < .46) { w = 2; h = 3 + Math.floor(random() * 3); }
  else if (family < .64) { w = 3; h = 3 + Math.floor(random() * 4); }
  else if (family < .82) { w = 4; h = 4 + Math.floor(random() * 4); }
  else { w = 5 + Math.floor(random() * 4); h = 5 + Math.floor(random() * 5); }
  // Retain native tiny corner outcrops at every setting, scale larger shelves.
  if (family >= .46) { w = Math.max(3, Math.round(w * context.parameters.hillSize)); h = Math.max(3, Math.round(h * context.parameters.hillSize)); }
  const cell = Math.max(0, Math.min(context.environment.orientation.length - 1, Math.floor(cy) * width + Math.floor(cx)));
  const vertical = Math.abs(Math.sin(context.environment.orientation[cell])) > Math.abs(Math.cos(context.environment.orientation[cell]));
  if (random() < .2 ? random() < .5 : !vertical) [w, h] = [h, w];
  // Clipping a 4×4 rectangle leaves diagonally separated upper-floor pixels.
  // Five cells across leaves a connected floor after either corner treatment.
  const outline = Math.min(w, h) >= 5 ? random() : 1;
  const left = Math.round(cx - w / 2), top = Math.round(cy - h / 2), cells: number[] = [];
  if (left < 3 || top < 3 || left + w >= width - 3 || top + h >= height - 3) return false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (outline < .4 && (x === 0 || x === w - 1) && (y === 0 || y === h - 1)) continue;
    if (outline >= .4 && outline < .65 && (x === 0 && y === 0 || x === w - 1 && y === h - 1)) continue;
    cells.push((top + y) * width + left + x);
  }
  if (!fits(context, cells)) return false;
  placeShelf(context, cells, 'hills', gap);
  return true;
}

/** One coherent winding range, with low-ground cuts all the way through it.
 * Separate ridge identities on either side prevent accidental cliff hopping. */
function mountainRange(context: Layout, cx: number, cy: number, length: number, breadth: number, vertical: boolean): boolean {
  const { world, random } = context, { width, height, tiles } = world;
  const phase = random() * Math.PI * 2, bend = (1.5 + random() * 2) * context.parameters.mountainBend;
  const gapStart = Math.floor(length * (.46 + random() * .08)), passWidth = 2 + Math.floor(random() * 2);
  const pieces: number[][] = [[], []], pass: number[] = [];
  let previousShift = Math.round(Math.sin(phase) * bend);
  for (let along = 0; along < length; along++) {
    const desired = Math.round(Math.sin(along / length * Math.PI * (1.2 + context.parameters.mountainBend * .3) + phase) * bend);
    const shift = along % 3 ? previousShift : Math.max(previousShift - 1, Math.min(previousShift + 1, desired)); previousShift = shift;
    const endInset = Math.max(0, 1 - Math.min(along, length - 1 - along));
    const first = -Math.floor((breadth - 1) / 2);
    for (let across = first + endInset; across < first + breadth - endInset; across++) {
      const u = Math.round(cx - length / 2) + along, v = Math.round(cy) + shift + across;
      const x = vertical ? v : u, y = vertical ? u : v;
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) return false;
      const cell = y * width + x;
      if (along >= gapStart && along < gapStart + passWidth) pass.push(cell);
      else pieces[Number(along >= gapStart + passWidth)].push(cell);
    }
  }
  if (!fits(context, [...pieces[0], ...pieces[1], ...pass])) return false;
  for (const cells of pieces) placeShelf(context, cells, 'mountains', 1);
  for (const cell of pass) { tiles[cell].relief = 'mountains'; tiles[cell].mountainPass = true; clear(world, cell); }
  reserve(context, pass, 1);
  return true;
}

/** Rounded, overlapping massifs give short mountain districts a lumpy outline
 * rather than looking like a shortened straight range. The substantial overlap
 * keeps the usable base floor connected around the nested crest. */
function mountainClump(context: Layout, cx: number, cy: number, size: number, vertical: boolean): boolean {
  const { world, random } = context, { width, height } = world;
  const lobes = [{ x: 0, y: 0, rx: size * .44, ry: size * (.32 + random() * .13) }];
  const side = random() < .5 ? -1 : 1;
  lobes.push({ x: size * .23 * side, y: size * (.12 + random() * .12), rx: size * .30, ry: size * .31 });
  if (random() < .6) lobes.push({ x: -size * .23 * side, y: -size * .16, rx: size * .31, ry: size * .27 });
  const cells: number[] = [], extent = Math.ceil(size);
  for (let v = -extent; v <= extent; v++) for (let u = -extent; u <= extent; u++) {
    if (!lobes.some(lobe => Math.pow((u - lobe.x) / lobe.rx, 2) + Math.pow((v - lobe.y) / lobe.ry, 2) <= 1)) continue;
    const x = Math.round(cx) + (vertical ? v : u), y = Math.round(cy) + (vertical ? u : v);
    if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) return false;
    cells.push(y * width + x);
  }
  if (!fits(context, cells)) return false;
  placeShelf(context, cells, 'mountains', 1);
  return true;
}

/** An archipelago of separate peaks follows one bending axis. Full-width dry
 * saddles separate irregular segment lengths, creating several crossing routes
 * instead of one uniformly long barrier with a cut in the middle. */
function mountainString(context: Layout, cx: number, cy: number, length: number, breadth: number, vertical: boolean): boolean {
  const { world, random } = context, { width, height, tiles } = world;
  const phase = random() * Math.PI * 2, bend = (2 + random() * 3) * context.parameters.mountainBend;
  const pieces: number[][] = [], gaps: number[] = [];
  let along = 0;
  while (along < length - 3) {
    const remaining = length - along;
    const segmentLength = Math.min(remaining, 6 + Math.floor(random() * 13));
    const segmentWidth = Math.max(4, breadth + Math.floor(random() * 3) - 1);
    const piece: number[] = [];
    let previousShift = Math.round(Math.sin(along / length * Math.PI * 2 + phase) * bend);
    for (let step = 0; step < segmentLength; step++, along++) {
      const desired = Math.round(Math.sin(along / length * Math.PI * 2 + phase) * bend);
      const shift = step % 3 ? previousShift : Math.max(previousShift - 1, Math.min(previousShift + 1, desired)); previousShift = shift;
      const inset = Number(step === 0 || step === segmentLength - 1), first = -Math.floor((segmentWidth - 1) / 2);
      for (let across = first + inset; across < first + segmentWidth - inset; across++) {
        const u = Math.round((vertical ? cy : cx) - length / 2) + along;
        const v = Math.round(vertical ? cx : cy) + shift + across;
        const x = vertical ? v : u, y = vertical ? u : v;
        if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) return false;
        piece.push(y * width + x);
      }
    }
    pieces.push(piece);
    const gap = Math.min(length - along, 2 + Math.floor(random() * 4));
    for (let step = 0; step < gap; step++, along++) {
      const shift = Math.round(Math.sin(along / length * Math.PI * 2 + phase) * bend);
      for (let across = -Math.ceil(breadth / 2); across <= Math.ceil(breadth / 2); across++) {
        const u = Math.round((vertical ? cy : cx) - length / 2) + along, v = Math.round(vertical ? cx : cy) + shift + across;
        const x = vertical ? v : u, y = vertical ? u : v;
        if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) return false;
        gaps.push(y * width + x);
      }
    }
  }
  if (pieces.length < 2 || !fits(context, [...pieces.flat(), ...gaps])) return false;
  for (const piece of pieces) placeShelf(context, piece, 'mountains', 1);
  for (const cell of gaps) { tiles[cell].relief = 'mountains'; tiles[cell].mountainPass = true; clear(world, cell); }
  reserve(context, gaps, 1);
  return true;
}

function hillRegion(context: Layout, center: Point, radius: number, budget: number): number {
  const start = context.raised, { random, world, environment } = context, { width, height, tiles } = world;
  const centerCell = Math.floor(center.y) * width + Math.floor(center.x);
  const axis = environment.orientation[centerCell], cosine = Math.cos(axis), sine = Math.sin(axis);
  const minor = radius * (.46 + random() * .12);
  // The low ground remains part of the region, making the dense patches easy
  // to inspect separately from the individual impassable ledge boundaries.
  for (let y = Math.max(1, Math.floor(center.y - radius)); y <= Math.min(height - 2, Math.ceil(center.y + radius)); y++)
    for (let x = Math.max(1, Math.floor(center.x - radius)); x <= Math.min(width - 2, Math.ceil(center.x + radius)); x++) {
      const cell = y * width + x;
      const u = (x - center.x) * cosine + (y - center.y) * sine, v = -(x - center.x) * sine + (y - center.y) * cosine;
      if (Math.hypot(u / radius, v / minor) <= 1 && context.available[cell]
        && !tiles[cell].relief) tiles[cell].relief = 'hills';
    }
  // Several nested groves of rock follow one regional axis. Their gaps change
  // with roughness, instead of uniformly scattering similarly sized mesas.
  const knots = Array.from({ length: 3 + Math.floor(random() * 4) }, () => ({ u: (random() - .5) * radius * 1.5, v: (random() - .5) * minor }));
  for (let attempt = 0; attempt < 360 && context.raised - start < budget; attempt++) {
    const knot = knots[Math.floor(random() * knots.length)], clustered = random() < context.parameters.hillClustering;
    const u = clustered ? knot.u + (random() - .5) * radius * .7 : (random() * 2 - 1) * radius;
    const v = clustered ? knot.v + (random() - .5) * minor * 1.2 : (random() * 2 - 1) * minor;
    if (Math.hypot(u / radius, v / minor) > 1) continue;
    const x = center.x + u * cosine - v * sine, y = center.y + u * sine + v * cosine;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const cell = Math.floor(y) * width + Math.floor(x), roughness = environment.ruggedness[cell];
    if (random() > .25 + roughness * .85) continue;
    const spacing = Math.max(1, Math.round((roughness > .62 ? 1 : roughness > .39 ? 2 : 3) * context.parameters.hillSpacing));
    hill(context, x, y, spacing);
  }
  return context.raised - start;
}

/** Regional relief keeps the existing physical ledge rules. Every shelf has a
 * dry two-cell apron, and separate shelves leave at least one low-ground cell
 * between them; starting cities therefore retain their overland approaches. */
export function placeRegionalRelief(tiles: Tile[], width: number, height: number, seed: string, spawns: Point[] = [], parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): void {
  const world: World = { tiles, width, height, seed, spawns, source: 'regional-relief' };
  const context = layout(world, `${seed}:regional-relief`, spawns, parameters), { random } = context;
  const land = tiles.reduce((sum, tile) => sum + Number(!WATER.has(tile.terrain)), 0);
  const target = Math.round(land * parameters.reliefCoverage * (.8 + random() * .4));
  const centers = shuffle(Array.from(context.available.keys()).filter(cell => context.available[cell]), random);
  // Preserve seed variation while favoring coherent rugged provinces. The
  // same fields drive water availability and woodland after relief placement.
  const priorities = new Float32Array(tiles.length);
  for (const cell of centers) priorities[cell] = context.environment.ruggedness[cell] + random() * .22;
  centers.sort((a, b) => priorities[b] - priorities[a]);
  const mountainBudget = target * parameters.mountainShare;
  const weights = [parameters.mountainClumpShare, parameters.mountainStringShare,
    Math.max(.08, 1 - parameters.mountainClumpShare - parameters.mountainStringShare)];
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  for (let attempt = 0; attempt < Math.min(2600, centers.length) && context.raised < mountainBudget; attempt++) {
    const cell = centers[attempt], x = cell % width, y = Math.floor(cell / width);
    const axis = context.environment.orientation[cell], vertical = Math.abs(Math.sin(axis)) > Math.abs(Math.cos(axis));
    const family = random() * totalWeight;
    // Sample a broad logarithmic span, including short isolated foothills and
    // long regional barriers. Their construction follows the same ledge rules.
    const length = Math.round(parameters.mountainLengthMin * Math.pow(parameters.mountainLengthMax / parameters.mountainLengthMin, random()));
    const breadth = Math.max(4, Math.round(parameters.mountainWidth + random() - .5));
    if (family < weights[0]) mountainClump(context, x, y, Math.max(9, Math.min(27, length * .52)), vertical);
    else if (family < weights[0] + weights[1]) mountainString(context, x, y, Math.max(24, length), breadth, vertical);
    else mountainRange(context, vertical ? y : x, vertical ? x : y, length, breadth, vertical);
  }
  const regions: Point[] = [];
  for (const cell of centers) {
    if (context.raised >= target) break;
    const center = { x: cell % width, y: Math.floor(cell / width) };
    if (regions.some(other => Math.hypot(other.x - center.x, other.y - center.y) < 17)) continue;
    const radius = 14 + random() * 10;
    const placed = hillRegion(context, center, radius, Math.min(target - context.raised, 220 + random() * 280));
    if (placed) regions.push(center);
    if (regions.length >= 20) break;
  }
  harmonizeRidgeTerrain(world);
}

/** Rasterize a continuous axis without reducing it to horizontal/vertical.
 * The callback receives distance to the closest segment at each visited cell. */
function rasterAxis(world: World, points: Point[], radius: number, visit: (cell: number, distance: number) => void): void {
  const { width, height } = world;
  for (let n = 1; n < points.length; n++) {
    const a = points[n - 1], b = points[n], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius)), right = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + radius));
    const top = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius)), bottom = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + radius));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const t = length2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length2)) : 0;
      const distance = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
      if (distance <= radius) visit(y * width + x, distance);
    }
  }
}

/** Keep only supported native outlines: every retained edge belongs to a full
 * 2×2 patch, so a noisy contour cannot produce single-cell needles or threads. */
function supportedContour(mask: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const cell = y * width + x;
    if (mask[cell] && mask[cell + 1] && mask[cell + width] && mask[cell + width + 1]) {
      result[cell] = result[cell + 1] = result[cell + width] = result[cell + width + 1] = 1;
    }
  }
  return result;
}

function contourComponents(mask: Uint8Array, width: number, height: number): number[][] {
  const seen = new Uint8Array(mask.length), components: number[][] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const cells = [start]; seen[start] = 1;
    for (let head = 0; head < cells.length; head++) {
      const cell = cells[head], x = cell % width, y = Math.floor(cell / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || !mask[next]) continue;
        seen[next] = 1; cells.push(next);
      }
    }
    if (cells.length >= 8) components.push(cells);
  }
  return components.sort((a, b) => b.length - a.length || a[0] - b[0]);
}

/** A diagonal, three-cell shoulder can enclose a single usable floor pixel
 * without a straight edge wide enough for native stair artwork. Cut these
 * unserviceable necks into saddles; do not publish inaccessible upper ground. */
function placeAccessibleContour(context: Layout, cells: number[], kind: 'hills' | 'mountains', gap: number, attempt = 0): void {
  const { world } = context, { width, height, tiles } = world;
  const originalHeight = new Map(cells.map(cell => [cell, tiles[cell].elevation]));
  placeShelf(context, cells, kind, gap);
  for (const cell of cells) delete tiles[cell].stair;
  addMountainStairs(context, cells, true);
  const members = new Set(cells), reached = new Set<number>(), queue: number[] = [];
  for (const cell of cells) if (tiles[cell].stair && ridgeLevel(tiles[cell]) === 1) {
    reached.add(cell); queue.push(cell);
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
    for (const up of Object.values(STAIR_UP)) {
      const nx = x + up.x, ny = y + up.y, next = ny * width + nx;
      if (!members.has(next) || reached.has(next) || !ridgeGroundWalkable(world, nx, ny)
        || !ridgeEdgeAllowed(world, { x, y }, { x: nx, y: ny })) continue;
      reached.add(next); queue.push(next);
    }
  }
  const inaccessible = cells.filter(cell => !tiles[cell].stair && ridgeGroundWalkable(world, cell % width, Math.floor(cell / width))
    && !reached.has(cell));
  if (!inaccessible.length) return;
  const keep = new Uint8Array(tiles.length);
  for (const cell of cells) {
    keep[cell] = 1;
    delete tiles[cell].ridge; delete tiles[cell].ridgeTier; delete tiles[cell].stair; delete tiles[cell].relief;
    tiles[cell].elevation = originalHeight.get(cell)!;
  }
  context.raised -= cells.length;
  // The small guard bounds retries on adversarial contours. A discarded body
  // stays ordinary low ground instead of becoming an invisible isolated floor.
  if (attempt >= 3) return;
  for (const cell of inaccessible) {
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) keep[ny * width + nx] = 0;
    }
  }
  for (const piece of contourComponents(supportedContour(keep, width, height), width, height))
    placeAccessibleContour(context, piece, kind, gap, attempt + 1);
}

/** Native relief follows the plan's regional geography. Large contour plateaus,
 * curved branching belts and rounded uplands share the existing ledge artwork;
 * valleys and lake basins are reserved before any shelf is rasterized. */
export function placeLandformRelief(world: World, plan: LandformPlan,
  parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): void {
  const { width, height, tiles } = world;
  const context = layout(world, `${world.seed}:landform-relief`, [...world.spawns, ...(world.secondarySpawns ?? [])], parameters);
  const noise = createNoise2D(randomStream(`${world.seed}:landform-contours`));
  const mountainGain = Math.sqrt(parameters.mountainShare / DEFAULT_LANDSCAPE_PARAMETERS.mountainShare);
  const score = new Float32Array(tiles.length), mountain = new Float32Array(tiles.length);
  const axes = new Float32Array(tiles.length), corridors = new Uint8Array(tiles.length);
  for (const valley of plan.valleys) rasterAxis(world, valley.points, valley.width / 2 + 1.5, cell => { corridors[cell] = 1; });
  for (const basin of plan.basins) {
    const cosine = Math.cos(basin.angle), sine = Math.sin(basin.angle);
    const margin = basin.lake ? 3 : 0, rx = basin.radiusX + margin, ry = basin.radiusY + margin;
    const reach = Math.max(rx, ry);
    for (let y = Math.max(0, Math.floor(basin.center.y - reach)); y <= Math.min(height - 1, Math.ceil(basin.center.y + reach)); y++)
      for (let x = Math.max(0, Math.floor(basin.center.x - reach)); x <= Math.min(width - 1, Math.ceil(basin.center.x + reach)); x++) {
        const dx = x - basin.center.x, dy = y - basin.center.y;
        if (Math.hypot((dx * cosine + dy * sine) / rx, (-dx * sine + dy * cosine) / ry) < (basin.lake ? 1 : .78))
          corridors[y * width + x] = 1;
      }
  }
  for (const ridge of plan.ridges) {
    const radius = Math.max(2.5, ridge.width / 2) * parameters.mountainWidth / DEFAULT_LANDSCAPE_PARAMETERS.mountainWidth;
    rasterAxis(world, ridge.points, radius * 1.8, (cell, distance) => {
      const x = cell % width, y = Math.floor(cell / width);
      const irregularity = noise(x * .09 + 31, y * .09 - 17) * .10;
      const ridgeScore = Math.max(0, 1 - distance / (radius * 1.8) + irregularity) * (.8 + ridge.prominence * .35)
        * (ridge.kind === 'mountains' ? mountainGain : 1);
      axes[cell] = Math.max(axes[cell], ridgeScore);
      if (ridgeScore > score[cell]) {
        score[cell] = ridgeScore;
        mountain[cell] = ridge.kind === 'mountains' ? 1 : 0;
      }
    });
  }
  for (let provinceIndex = 0; provinceIndex < plan.provinces.length; provinceIndex++) {
    const province = plan.provinces[provinceIndex], cosine = Math.cos(province.angle), sine = Math.sin(province.angle);
    const radius = Math.max(province.radiusX, province.radiusY), offset = provinceIndex * 113;
    for (let y = Math.max(3, Math.floor(province.center.y - radius)); y <= Math.min(height - 4, Math.ceil(province.center.y + radius)); y++)
      for (let x = Math.max(3, Math.floor(province.center.x - radius)); x <= Math.min(width - 4, Math.ceil(province.center.x + radius)); x++) {
        const cell = y * width + x, dx = x - province.center.x, dy = y - province.center.y;
        const u = dx * cosine + dy * sine, v = -dx * sine + dy * cosine;
        const radial = Math.hypot(u / province.radiusX, v / province.radiusY);
        if (radial > 1.1) continue;
        const hillScale = parameters.hillSize;
        const broad = noise(u * .045 / hillScale + offset, v * .045 / hillScale - offset);
        const detail = noise(u * .10 / hillScale - 71, v * .10 / hillScale + offset);
        let provinceScore = 0;
        if (province.kind === 'dissected-plateau') {
          // A broad surface is cut by the planned valleys, rather than tiled
          // with isolated mesas. Resistance gives its contour uneven shoulders.
          provinceScore = .94 - radial * .37 + broad * .11 + (plan.elevation[cell] - .5) * .28
            + (plan.resistance[cell] - .5) * .12;
        } else if (province.kind === 'rolling-uplands') {
          const district = noise(u * .020 + offset + 83, v * .020 - offset - 23);
          provinceScore = .45 + broad * .32 + detail * .045 + district * parameters.hillClustering * .16
            - radial * .17 + (plan.elevation[cell] - .4) * .20;
        } else if (province.kind === 'river-basin') {
          // Keep broad valley floors genuinely flat; low relief belongs to
          // the basin rim and the related upland province instead.
          provinceScore = radial > .65 ? .29 + broad * .19 + (plan.elevation[cell] - .4) * .20 : 0;
        } else if (province.kind === 'glacial-coast') {
          provinceScore = .30 + broad * .18 + (plan.elevation[cell] - .45) * .25 - radial * .08;
        }
        if (provinceScore > score[cell]) { score[cell] = Math.max(0, provinceScore); mountain[cell] = 0; }
      }
  }
  const familyScale = plan.family === 'river-basin' ? .72 : plan.family === 'rolling-uplands' ? .82
    : plan.family === 'folded-range' ? 1.12 : plan.family === 'dissected-plateau' ? 1.08 : 1;
  const land = tiles.reduce((sum, tile) => sum + Number(!WATER.has(tile.terrain)), 0);
  const target = Math.round(land * parameters.reliefCoverage * familyScale);
  const ranked = Array.from(score.keys()).filter(cell => context.available[cell] && !context.reserved[cell]
    && !corridors[cell] && score[cell] > .06).sort((a, b) => score[b] - score[a] || a - b);
  const mask = new Uint8Array(tiles.length);
  // A small allowance covers fringe cells discarded by the native outline
  // safety pass, while the score threshold retains whole geographical forms.
  for (let n = 0; n < Math.min(ranked.length, Math.round(target * 1.10)); n++) mask[ranked[n]] = 1;
  const components = contourComponents(supportedContour(mask, width, height), width, height);
  for (const proposed of components) {
    const available = new Uint8Array(tiles.length);
    for (const cell of proposed) if (!context.reserved[cell]) available[cell] = 1;
    for (const cells of contourComponents(supportedContour(available, width, height), width, height)) {
      const mountainShare = cells.reduce((sum, cell) => sum + mountain[cell], 0) / cells.length;
      const kind = mountainShare > .45 ? 'mountains' : 'hills';
      placeAccessibleContour(context, cells, kind, kind === 'hills' ? Math.max(1, Math.round(parameters.hillSpacing * 1.5)) : 1);
    }
  }
  for (let cell = 0; cell < tiles.length; cell++) if (corridors[cell] && axes[cell] > .62 && context.available[cell]
    && !tiles[cell].ridge) {
    tiles[cell].mountainPass = true; tiles[cell].relief = 'mountains'; clear(world, cell);
  }
  harmonizeRidgeTerrain(world);
}

/** Rebuild the two banks of an incised upland with the same native outline and
 * stair rules as geological relief. Call after clearing the old affected ridge
 * IDs, and supply only the original upland cells outside the river corridor. */
export function rebuildIncisedRelief(world: World,
  fragments: { cells: number[]; kind: 'hills' | 'mountains' }[]): void {
  const context = layout(world, `${world.seed}:canyon-banks`, [...world.spawns, ...(world.secondarySpawns ?? [])],
    world.generationParameters ?? DEFAULT_LANDSCAPE_PARAMETERS);
  for (const fragment of fragments) {
    const mask = new Uint8Array(world.tiles.length);
    for (const cell of fragment.cells) if (context.available[cell] && !context.reserved[cell]) mask[cell] = 1;
    for (const cells of contourComponents(supportedContour(mask, world.width, world.height), world.width, world.height))
      placeAccessibleContour(context, cells, fragment.kind, 0);
  }
  harmonizeRidgeTerrain(world);
}

/** Small deterministic vignettes for the standalone review. They run the same
 * shelf/ramp/pass builders as production, on a quiet, inspectable landscape. */
export function buildReliefShowcase(kind: ReliefShowcase, width = 80, height = 64, seed = 'relief-showcase', parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): World {
  const random = randomStream(`${seed}:ground`), terrain = kind === 'desert-hills' ? 'desert' : 'grassland';
  const world: World = { width, height, seed, spawns: [], source: `Regional relief: ${kind}`,
    tiles: Array.from({ length: width * height }, (): Tile => ({ terrain, overlay: 'none', elevation: .4, moisture: terrain === 'desert' ? .2 : .7,
      food: terrain === 'desert' ? 0 : 3, production: 1, gold: terrain === 'desert' ? 1 : 0, variation: random() })) };
  const context = layout(world, `${seed}:showcase`, [], parameters);
  if (kind === 'mountain-range') {
    mountainRange(context, width / 2, height / 2, Math.min(width - 10, 68), 6, false);
  } else if (kind === 'mountain-clump') {
    mountainClump(context, width / 2, height / 2, 23, false);
  } else if (kind === 'mountain-string') {
    mountainString(context, width / 2, height / 2, Math.min(width - 10, 68), 5, false);
  } else {
    hillRegion(context, { x: width * .33, y: height * .4 }, Math.min(width, height) * .29, width * height * .13);
    hillRegion(context, { x: width * .68, y: height * .62 }, Math.min(width, height) * .27, width * height * .12);
  }
  harmonizeRidgeTerrain(world);
  return world;
}
