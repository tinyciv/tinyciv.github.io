import { describe, expect, it } from 'vitest';
import { ridgeEdgeAllowed, ridgeGroundWalkable, ridgeIsLedge, ridgeLevel, STAIR_UP } from '../src/game/ridges';
import { type World, WATER } from '../src/game/types';
import { buildReliefShowcase, placeRegionalRelief } from '../src/world/regional-relief';
import { applyTerrainEcology } from '../src/world/terrain-ecology';
import { DEFAULT_LANDSCAPE_PARAMETERS } from '../src/world/options';

function flat(width = 144, height = 120): World {
  return { width, height, seed: 'regional-test', spawns: [], source: 'test',
    tiles: Array.from({ length: width * height }, (_, cell) => ({ terrain: cell % width < width / 2 ? 'desert' : 'grassland',
      overlay: 'none', elevation: .4, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
}
function flood(world: World, x: number, y: number): Set<number> {
  const queue = [y * world.width + x], seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % world.width, y = Math.floor(cell / world.width);
    for (const up of Object.values(STAIR_UP)) {
      const nx = x + up.x, ny = y + up.y, next = ny * world.width + nx, tile = world.tiles[next];
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || seen.has(next) || WATER.has(tile.terrain)
        || !ridgeGroundWalkable(world, nx, ny) || !ridgeEdgeAllowed(world, { x, y }, { x: nx, y: ny })) continue;
      seen.add(next); queue.push(next);
    }
  }
  return seen;
}
function validateStairs(world: World): number {
  let count = 0;
  for (let cell = 0; cell < world.tiles.length; cell++) {
    const tile = world.tiles[cell], x = cell % world.width, y = Math.floor(cell / world.width);
    if (ridgeIsLedge(world, x, y)) { expect(tile.overlay).toBe('none'); expect(tile.palm).toBeUndefined(); }
    if (!tile.stair) continue;
    count++;
    const up = STAIR_UP[tile.stair], low = world.tiles[cell - up.y * world.width - up.x], high = world.tiles[cell + up.y * world.width + up.x];
    expect(ridgeGroundWalkable(world, x, y), `stair ${x},${y}`).toBe(true);
    expect(ridgeLevel(low)).toBe(ridgeLevel(tile) - 1); expect(ridgeLevel(high)).toBe(ridgeLevel(tile));
    expect(WATER.has(low.terrain) || WATER.has(high.terrain)).toBe(false);
    expect(ridgeEdgeAllowed(world, { x: x - up.x, y: y - up.y }, { x, y })).toBe(true);
    expect(ridgeEdgeAllowed(world, { x, y }, { x: x + up.x, y: y + up.y })).toBe(true);
  }
  return count;
}

describe('regional ledge terrain', () => {
  it('removes woodland yields from real pass and stair clearings while retaining freshwater fertility', () => {
    const world = flat();
    // A wooded grass tile yields 2 food / 3 production, plus 1 retained food
    // from freshwater fertility. Clearing it should produce 4 food / 1 production.
    for (const tile of world.tiles) Object.assign(tile, { terrain: 'grassland', overlay: 'forest', food: 3, production: 3, gold: 0 });
    placeRegionalRelief(world.tiles, world.width, world.height, 'terrain-regions');
    const clearings = new Set<number>();
    let passes = 0, stairs = 0;
    for (let cell = 0; cell < world.tiles.length; cell++) {
      const tile = world.tiles[cell];
      if (tile.mountainPass) { passes++; clearings.add(cell); }
      if (tile.stair) {
        stairs++;
        const up = STAIR_UP[tile.stair], offset = up.y * world.width + up.x;
        for (const step of [-1, 0, 1]) clearings.add(cell + offset * step);
      }
    }
    expect(passes).toBeGreaterThan(0); expect(stairs).toBeGreaterThan(0);
    for (const cell of clearings) expect(world.tiles[cell]).toMatchObject({ overlay: 'none', food: 4, production: 1, gold: 0 });
    applyTerrainEcology(world);
    for (const cell of clearings) expect(world.tiles[cell]).toMatchObject({ overlay: 'none', food: 4, production: 1, gold: 0 });
  });

  it('mixes solid 2×2, 2×3 and 2×4 ledge outcrops with larger varied hill outlines', () => {
    const dimensions = new Set<string>();
    let clipped = 0;
    for (let seed = 0; seed < 4; seed++) {
      const world = buildReliefShowcase('grass-hills', 80, 64, `micro-outcrops-${seed}`);
      const hills = new Map<number, number[]>();
      world.tiles.forEach((tile, cell) => { if (tile.ridge) { const cells = hills.get(tile.ridge) ?? []; cells.push(cell); hills.set(tile.ridge, cells); } });
      for (const cells of hills.values()) {
        const xs = cells.map(cell => cell % world.width), ys = cells.map(cell => Math.floor(cell / world.width));
        const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
        dimensions.add([w, h].sort((a, b) => a - b).join('×'));
        if (cells.length < w * h) clipped++;
        if (Math.min(w, h) === 2) {
          expect(cells).toHaveLength(w * h);
          for (const cell of cells) {
            expect(ridgeIsLedge(world, cell % world.width, Math.floor(cell / world.width))).toBe(true);
            expect(world.tiles[cell].stair).toBeUndefined();
            expect(ridgeGroundWalkable(world, cell % world.width, Math.floor(cell / world.width))).toBe(false);
          }
        }
      }
    }
    for (const size of ['2×2', '2×3', '2×4']) expect(dimensions.has(size), size).toBe(true);
    expect(dimensions.size).toBeGreaterThan(10); expect(clipped).toBeGreaterThan(3);
  });

  it('repeats its layouts exactly and makes both clustered hills and layered ranges', () => {
    const world = flat(), repeat = flat();
    placeRegionalRelief(world.tiles, world.width, world.height, 'terrain-regions');
    placeRegionalRelief(repeat.tiles, repeat.width, repeat.height, 'terrain-regions');
    expect(repeat.tiles).toEqual(world.tiles);
    expect(world.tiles.some(tile => tile.ridge && tile.relief === 'hills')).toBe(true);
    expect(world.tiles.some(tile => tile.ridgeTier === 2 && tile.relief === 'mountains')).toBe(true);
    expect(world.tiles.some(tile => tile.mountainPass)).toBe(true);
    expect(validateStairs(world)).toBeGreaterThan(10);
  });

  it.each(['grass-hills', 'desert-hills'] as const)('supports dense %s with open and closed hilltops', kind => {
    const stairCounts = new Set<number>(), sizes: number[] = [];
    for (let seed = 0; seed < 5; seed++) {
      const world = buildReliefShowcase(kind, 80, 64, `hills-${seed}`), hills = new Map<number, { cells: number; stairs: number }>();
      for (const tile of world.tiles) if (tile.ridge) {
        const hill = hills.get(tile.ridge) ?? { cells: 0, stairs: 0 };
        hill.cells++; hill.stairs += Number(!!tile.stair); hills.set(tile.ridge, hill);
        expect(tile.terrain).toBe(kind === 'desert-hills' ? 'desert' : 'grassland');
      }
      expect(hills.size).toBeGreaterThanOrEqual(14);
      for (const hill of hills.values()) { stairCounts.add(hill.stairs); sizes.push(hill.cells); expect(hill.stairs).toBeLessThanOrEqual(3); }
      validateStairs(world);
    }
    expect([...stairCounts].sort()).toEqual([0, 1, 2, 3]);
    expect(Math.min(...sizes)).toBeLessThan(30); expect(Math.max(...sizes)).toBeGreaterThan(50);
  });

  it('puts a genuine low-ground pass across a long two-tier range', () => {
    const world = buildReliefShowcase('mountain-range', 80, 64, 'mountain-pass');
    const pass = world.tiles.flatMap((tile, index) => tile.mountainPass ? [index] : []);
    expect(pass.length).toBeGreaterThanOrEqual(12);
    for (const cell of pass) {
      expect(world.tiles[cell].ridge).toBeUndefined();
      expect(ridgeGroundWalkable(world, cell % world.width, Math.floor(cell / world.width))).toBe(true);
    }
    const passX = pass[Math.floor(pass.length / 2)] % world.width;
    for (let y = 6; y < world.height - 6; y++) expect(ridgeGroundWalkable(world, passX, y)).toBe(true);
    const tiers = new Set(world.tiles.filter(tile => tile.ridge).map(tile => tile.ridgeTier));
    expect([...tiers].sort()).toEqual([1, 2]);
    const reachable = flood(world, passX, 6);
    expect(reachable.has((world.height - 7) * world.width + passX)).toBe(true);
    for (let cell = 0; cell < world.tiles.length; cell++) if (world.tiles[cell].ridge && ridgeGroundWalkable(world, cell % world.width, Math.floor(cell / world.width)))
      expect(reachable.has(cell), `reachable mountain floor ${cell}`).toBe(true);
    expect(validateStairs(world)).toBeGreaterThanOrEqual(4);
  });

  it('retains narrow chain widths while mixing compact massifs and broken strings', () => {
    const showcase = buildReliefShowcase('mountain-range', 80, 64, 'thin-range');
    const columns = new Map<number, number>();
    for (let cell = 0; cell < showcase.tiles.length; cell++) if (showcase.tiles[cell].relief === 'mountains')
      columns.set(cell % showcase.width, (columns.get(cell % showcase.width) ?? 0) + 1);
    expect(Math.max(...columns.values())).toBe(6);
    expect(columns.size).toBe(68);
    const shapes = ['mountain-clump', 'mountain-string', 'mountain-range'] as const;
    for (const shape of shapes) {
      const world = buildReliefShowcase(shape, 100, 80, `varied-${shape}`), ids = new Set<number>();
      const cells = world.tiles.flatMap((tile, cell) => tile.ridge ? [cell] : []);
      for (const cell of cells) ids.add(world.tiles[cell].ridge!);
      const xs = cells.map(cell => cell % world.width), ys = cells.map(cell => Math.floor(cell / world.width));
      const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
      if (shape === 'mountain-clump') { expect(Math.max(w, h) / Math.min(w, h)).toBeLessThan(2); expect(ids.size).toBe(1); }
      if (shape === 'mountain-string') { expect(ids.size).toBeGreaterThanOrEqual(3); expect(w / h).toBeGreaterThan(3); }
      const reachable = flood(world, 1, 1);
      for (const cell of cells) if (ridgeGroundWalkable(world, cell % world.width, Math.floor(cell / world.width)))
        expect(reachable.has(cell), `${shape}: floor ${cell}`).toBe(true);
      validateStairs(world);
    }
  });

  it('varies mountain lengths and silhouettes without creating isolated usable mountain floors', () => {
    const lengths: number[] = [], aspect: number[] = [];
    for (let seed = 0; seed < 12; seed++) {
      const world = flat(); placeRegionalRelief(world.tiles, world.width, world.height, `varied-mountains-${seed}`);
      const ranges = new Map<number, number[]>();
      for (let cell = 0; cell < world.tiles.length; cell++) if (world.tiles[cell].relief === 'mountains' && world.tiles[cell].ridge) {
        const id = world.tiles[cell].ridge!; const cells = ranges.get(id) ?? []; cells.push(cell); ranges.set(id, cells);
      }
      expect(ranges.size).toBeGreaterThan(0);
      for (const cells of ranges.values()) {
        const xs = cells.map(cell => cell % world.width), ys = cells.map(cell => Math.floor(cell / world.width));
        const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
        lengths.push(Math.max(w, h)); aspect.push(Math.max(w, h) / Math.min(w, h));
      }
      const accessible = flood(world, 1, 1);
      for (let cell = 0; cell < world.tiles.length; cell++) if (world.tiles[cell].relief === 'mountains' && ridgeGroundWalkable(world, cell % world.width, Math.floor(cell / world.width)))
        expect(accessible.has(cell), `seed ${seed}: mountain floor ${cell}`).toBe(true);
      validateStairs(world);
    }
    expect(Math.min(...lengths)).toBeLessThan(10); expect(Math.max(...lengths)).toBeGreaterThan(25);
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeGreaterThan(4);
    expect(aspect.some(value => value < 1.5)).toBe(true); expect(aspect.some(value => value > 4)).toBe(true);
  });

  it('applies relief amount and mountain balance controls deterministically', () => {
    const sparse = flat(180, 150), rugged = flat(180, 150);
    placeRegionalRelief(sparse.tiles, sparse.width, sparse.height, 'relief-controls', [],
      { ...DEFAULT_LANDSCAPE_PARAMETERS, reliefCoverage: .04, mountainShare: .25 });
    placeRegionalRelief(rugged.tiles, rugged.width, rugged.height, 'relief-controls', [],
      { ...DEFAULT_LANDSCAPE_PARAMETERS, reliefCoverage: .14, mountainShare: .7 });
    const raised = (world: World) => world.tiles.filter(tile => tile.ridge).length;
    const mountain = (world: World) => world.tiles.filter(tile => tile.ridge && tile.relief === 'mountains').length;
    expect(raised(rugged)).toBeGreaterThan(raised(sparse) * 2);
    expect(mountain(rugged)).toBeGreaterThan(mountain(sparse) * 3);
  });

  it('keeps dry routes and settlements connected across many regional layouts', () => {
    for (let seed = 0; seed < 8; seed++) {
      const world = flat(); world.spawns = [{ x: 15, y: 15 }, { x: 120, y: 20 }, { x: 65, y: 95 }];
      // A stream divides the map, with a deliberate broad ford in the middle.
      for (let y = 0; y < world.height; y++) if (y < 55 || y > 60) world.tiles[y * world.width + 72].terrain = 'river';
      placeRegionalRelief(world.tiles, world.width, world.height, `regional-routes-${seed}`, world.spawns);
      const reachable = flood(world, 15, 15);
      expect(world.spawns.every(point => reachable.has(point.y * world.width + point.x))).toBe(true);
      for (const point of world.spawns) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++)
        expect(world.tiles[(point.y + dy) * world.width + point.x + dx].ridge).toBeUndefined();
      validateStairs(world);
    }
  });
});
