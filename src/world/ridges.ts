import { type Tile, type Point, type World, WATER } from '../game/types';
import { ridgeGroundWalkable, ridgeIsLedge, ridgeLevel, STAIR_UP, type StairDirection } from '../game/ridges';
import { terrainYields } from './generator';

function randomStream(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

/** Wide connected shelves with quiet, stepped outlines. Overlapping rectangles
 * give every elbow/lobe a usable floor, instead of one-tile necks or spikes. */
function shelfShape(random: () => number, small = false): Point[] {
  const cells = new Map<number, Point>();
  const band = random(), size = small ? 5 : band < .25 ? 5 + Math.floor(random() * 4)
    : band < .7 ? 9 + Math.floor(random() * 7) : 16 + Math.floor(random() * 9);
  const kind = Math.floor(random() * 4);
  const rect = (left: number, top: number, width: number, height: number, bevel: number) => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (Math.min(x, width - x - 1) + Math.min(y, height - y - 1) < bevel) continue;
      cells.set((top + y) * 128 + left + x, { x: left + x, y: top + y });
    }
  };
  if (kind === 0 || small) rect(0, 0, size, Math.max(5, size - 3 + Math.floor(random() * 7)), 1 + Math.floor(random() * Math.min(3, size / 4)));
  else if (kind === 1) rect(0, 0, Math.ceil(size * 1.65), Math.max(5, Math.round(size * .65)), 1 + Math.floor(random() * 3));
  else if (kind === 2) {
    const arm = Math.max(5, Math.ceil(size * .6));
    rect(0, 0, size, arm, 1); rect(0, 0, arm, size + 2, 1);
  } else {
    const overlap = Math.max(5, Math.ceil(size * .65)), shift = Math.floor(size * .35);
    rect(0, 0, size, overlap, 1); rect(shift, Math.max(0, overlap - 5), overlap, size, 1);
  }
  let result = [...cells.values()];
  if (random() < .5) result = result.map(({ x, y }) => ({ x: y, y: x }));
  const right = Math.max(...result.map(p => p.x));
  if (random() < .5) result = result.map(({ x, y }) => ({ x: right - x, y }));
  return result;
}

/** A seed chooses both hill density and shelf shapes. Every outer shelf has a
 * dry two-cell apron, preserving routes around inaccessible zero-stair hills.
 * Broad shelves may carry a second tier, with a walkable first-tier ring. */
export function placeRidges(tiles: Tile[], width: number, height: number, seed: string, spawns: Point[] = []): void {
  const random = randomStream(`${seed}:puny-ridges`);
  const world: World = { tiles, width, height, seed, spawns, source: 'ridge-placement' };
  const land = tiles.reduce((sum, tile) => sum + Number(!WATER.has(tile.terrain)), 0);
  const target = Math.round(land * (.025 + random() * .085));
  let raised = tiles.filter(tile => tile.ridge).length;
  let nextId = tiles.reduce((highest, tile) => Math.max(highest, tile.ridge ?? 0), 0) + 1;
  const available = new Uint8Array(tiles.length), centers: Point[] = [];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, tile = tiles[i];
    const oceanShore = [i - 1, i + 1, i - width, i + width]
      .some(next => tiles[next].terrain === 'ocean' || tiles[next].terrain === 'coast');
    if (!WATER.has(tile.terrain) && !tile.beach && !['volcano', 'glacier'].includes(tile.overlay)
      && !oceanShore
      && spawns.every(spawn => Math.hypot(spawn.x - x, spawn.y - y) >= 7)) {
      available[i] = 1;
      if (x >= 3 && y >= 3 && x < width - 3 && y < height - 3) centers.push({ x, y });
    }
  }
  for (let i = centers.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [centers[i], centers[j]] = [centers[j], centers[i]]; }
  for (const center of centers) {
    if (raised >= target - 10) break;
    const shape = shelfShape(random, target - raised < 45);
    if (shape.length > target - raised + 20) continue;
    const rw = Math.max(...shape.map(p => p.x)) + 1, rh = Math.max(...shape.map(p => p.y)) + 1;
    const left = center.x - Math.floor(rw / 2), top = center.y - Math.floor(rh / 2);
    if (left < 3 || top < 3 || left + rw + 2 >= width || top + rh + 2 >= height) continue;
    let fits = true;
    for (let y = top - 2; y <= top + rh + 1 && fits; y++) for (let x = left - 2; x <= left + rw + 1; x++) {
      if (!available[y * width + x] || tiles[y * width + x].ridge) { fits = false; break; }
    }
    if (!fits) continue;
    const id = nextId++, cells = shape.map(p => (top + p.y) * width + left + p.x), set = new Set(cells);
    for (const i of cells) { tiles[i].ridge = id; tiles[i].ridgeTier = 1; delete tiles[i].palm; }

    // A three-cell inset leaves two clear lower-floor cells beyond the upper
    // cliff, including a low stair approach and a route around the second tier.
    const upper: number[] = [];
    if (cells.length >= 130 && random() < .7) {
      for (let attempt = 0; attempt < 50 && !upper.length; attempt++) {
        const origin = cells[Math.floor(random() * cells.length)];
        const sw = attempt < 25 ? 5 + Math.floor(random() * 6) : 5;
        const sh = attempt < 25 ? 5 + Math.floor(random() * 6) : 5;
        const sx = origin % width - Math.floor(sw / 2), sy = Math.floor(origin / width) - Math.floor(sh / 2), candidate: number[] = [];
        let nested = true;
        for (let y = sy - 3; y < sy + sh + 3 && nested; y++) for (let x = sx - 3; x < sx + sw + 3; x++) {
          if (!set.has(y * width + x)) { nested = false; break; }
        }
        if (!nested) continue;
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
          if ((x === 0 || x === sw - 1) && (y === 0 || y === sh - 1)) continue;
          candidate.push((sy + y) * width + sx + x);
        }
        upper.push(...candidate);
      }
      for (const i of upper) tiles[i].ridgeTier = 2;
    }

    const chosen: { index: number; direction: StairDirection }[] = [];
    for (const tier of [1, 2]) {
      if (tier === 2 && !upper.length) continue;
      const entrances: typeof chosen = [];
      for (const i of tier === 2 ? upper : cells) {
        if (ridgeLevel(tiles[i]) !== tier) continue;
        const x = i % width, y = Math.floor(i / width);
        for (const direction of Object.keys(STAIR_UP) as StairDirection[]) {
          tiles[i].stair = direction;
          if (ridgeGroundWalkable(world, x, y)) entrances.push({ index: i, direction });
          delete tiles[i].stair;
        }
      }
      for (let i = entrances.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [entrances[i], entrances[j]] = [entrances[j], entrances[i]]; }
      const count = tier === 2 ? 1 + Math.floor(random() * 2) : upper.length ? 2 + Math.floor(random() * 2) : Math.floor(random() * 4);
      let placed = 0;
      for (const entrance of entrances) {
        if (placed >= count) break;
        const x = entrance.index % width, y = Math.floor(entrance.index / width);
        if (chosen.some(other => ridgeLevel(tiles[other.index]) === tier && (other.direction === entrance.direction
          || Math.abs(other.index % width - x) + Math.abs(Math.floor(other.index / width) - y) < 4))) continue;
        chosen.push(entrance); tiles[entrance.index].stair = entrance.direction; placed++;
      }
    }
    for (const i of cells) if (ridgeIsLedge(world, i % width, Math.floor(i / width))) tiles[i].overlay = 'none';
    for (const { index, direction } of chosen) {
      const up = STAIR_UP[direction];
      for (const step of [-1, 0, 1]) {
        const tile = tiles[index + (up.y * width + up.x) * step]; tile.overlay = 'none'; delete tile.palm;
      }
    }
    raised += cells.length;
  }
  harmonizeRidgeTerrain(world);
}

/** A native ledge and its two-cell apron share one ground palette. Overlapping
 * aprons form a group, so a later hill cannot repaint an earlier hill's edge. */
export function harmonizeRidgeTerrain(world: World): void {
  const { tiles, width, height } = world;
  const parents = new Map<number, number>(), cells = new Map<number, Set<number>>();
  const owner = new Int32Array(tiles.length);
  const root = (id: number): number => {
    let found = id;
    while (parents.get(found) !== found) found = parents.get(found)!;
    while (id !== found) { const next = parents.get(id)!; parents.set(id, found); id = next; }
    return found;
  };
  for (const tile of tiles) if (tile.ridge) parents.set(tile.ridge, tile.ridge);
  for (let i = 0; i < tiles.length; i++) {
    const id = tiles[i].ridge;
    if (!id) continue;
    let apron = cells.get(id);
    if (!apron) { apron = new Set(); cells.set(id, apron); }
    const x = i % width, y = Math.floor(i / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      // Water and beaches keep their actual shoreline; new hills already
      // require the whole apron to be dry, non-beach ground.
      if (WATER.has(tiles[next].terrain) || tiles[next].beach) continue;
      apron.add(next);
      if (owner[next]) parents.set(root(id), root(owner[next]));
      owner[next] = id;
    }
  }
  const groups = new Map<number, Set<number>>();
  for (const [id, apron] of cells) {
    const group = root(id), merged = groups.get(group) ?? new Set<number>();
    for (const i of apron) merged.add(i);
    groups.set(group, merged);
  }
  for (const group of groups.values()) {
    const counts = { grassland: 0, desert: 0, plains: 0, tundra: 0 };
    for (const i of group) {
      const terrain = tiles[i].terrain;
      if (terrain in counts) counts[terrain as keyof typeof counts]++;
    }
    const terrain = (Object.keys(counts) as (keyof typeof counts)[])
      .sort((a, b) => counts[b] - counts[a])[0];
    for (const i of group) {
      const tile = tiles[i];
      if (tile.terrain === terrain) continue;
      const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(terrain, tile.overlay);
      tile.terrain = terrain;
      for (const resource of ['food', 'production', 'gold'] as const)
        tile[resource] = Math.max(0, tile[resource] + after[resource] - before[resource]);
    }
  }
}

export function ridgeStatistics(world: World) {
  const land = world.tiles.filter(tile => !WATER.has(tile.terrain)).length;
  const ridges = new Map<number, { cells: number; stairs: number; upperCells: number; tiers: number }>();
  for (const tile of world.tiles) if (tile.ridge) {
    const ridge = ridges.get(tile.ridge) ?? { cells: 0, stairs: 0, upperCells: 0, tiers: 1 };
    ridge.cells++; ridge.stairs += Number(!!tile.stair); ridge.upperCells += Number(ridgeLevel(tile) > 1);
    ridge.tiers = Math.max(ridge.tiers, ridgeLevel(tile)); ridges.set(tile.ridge, ridge);
  }
  return { land, raised: [...ridges.values()].reduce((sum, ridge) => sum + ridge.cells, 0),
    upper: [...ridges.values()].reduce((sum, ridge) => sum + ridge.upperCells, 0),
    stacked: [...ridges.values()].filter(ridge => ridge.tiers > 1).length, ridges };
}
