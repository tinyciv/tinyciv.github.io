import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { resourceBlocksGround } from '../src/game/resource-terrain';
import { generateWorld } from '../src/world/generator';
import { placeRidges, ridgeStatistics } from '../src/world/ridges';
import { ridgeEdgeAllowed, ridgeFootprintAllowed, ridgeGroundWalkable, ridgeIsLedge, ridgeLevel, STAIR_UP } from '../src/game/ridges';
import { canMove, canWalk, findPath, hasStaticPath, canTraverseEdge, traversable, travelTimeMap } from '../src/game/pathfinding';
import { ridgeQuads, STAIR_SOURCES } from '../src/game/ridge-art';
import { rasterTerrain } from '../src/game/terrain';
import { punyAtlas } from './puny-atlas';
import { type World, type GameState, type Tile, type Point, WATER } from '../src/game/types';

function flat(width = 24, height = 20): World {
  return { width, height, seed: 'ridge-test', source: 'fixture', spawns: [], revision: 0,
    tiles: Array.from({ length: width * height }, (): Tile => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) };
}
function raised(world: World, left = 8, top = 6, width = 7, height = 7) {
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) world.tiles[y * world.width + x].ridge = 1;
}
const stateOf = (world: World) => ({ world, buildings: [], units: [], factions: [] } as unknown as GameState);
const center = (point: Point): Point => ({ x: point.x + .5, y: point.y + .5 });

function reachable(world: World, start: Point) {
  const seen = new Set<number>(), queue = [{ x: Math.floor(start.x), y: Math.floor(start.y) }];
  seen.add(queue[0].y * world.width + queue[0].x);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const up of Object.values(STAIR_UP)) {
      const n = { x: p.x + up.x, y: p.y + up.y }, key = n.y * world.width + n.x;
      if (!seen.has(key) && traversable(world, n.x, n.y) && canTraverseEdge(world, p, n)) { seen.add(key); queue.push(n); }
    }
  }
  return seen;
}

describe('native ledges and correctly oriented stairs', () => {
  it.each(['north','east','south','west'] as const)('climbs %s from low approach through the stair to a high landing', direction => {
    const world = flat(); raised(world);
    const high = direction === 'north' ? { x: 11, y: 12 } : direction === 'south' ? { x: 11, y: 6 }
      : direction === 'east' ? { x: 8, y: 9 } : { x: 14, y: 9 };
    const up = STAIR_UP[direction], low = { x: high.x - up.x, y: high.y - up.y }, inside = { x: high.x + up.x, y: high.y + up.y };
    world.tiles[high.y * world.width + high.x].stair = direction;
    const state = stateOf(world);
    expect(world.tiles[low.y * world.width + low.x].ridge).toBeUndefined();
    expect(world.tiles[inside.y * world.width + inside.x].ridge).toBe(1);
    expect(canMove(state, center(low), center(inside), 0)).toBe(true);
    expect(canMove(state, center(inside), center(low), 0)).toBe(true);
    expect(hasStaticPath(state, center(low), center(inside), 0)).toBe(true);
    const path = findPath(state, center(low), center(inside), 0);
    expect(path.length).toBeGreaterThan(0);
    expect(path.some(p => Math.floor(p.x) === high.x && Math.floor(p.y) === high.y)).toBe(true);
    const diagonalInterior = { x: inside.x - up.y, y: inside.y + up.x };
    expect(canMove(state, center(diagonalInterior), center(high), 0)).toBe(false);
    expect(traversable(world, high.x, high.y)).toBe(true);
    const wrong = direction === 'north' ? 'south' : direction === 'south' ? 'north' : direction === 'east' ? 'west' : 'east';
    world.tiles[high.y * world.width + high.x].stair = wrong; world.revision!++;
    expect(canMove(state, center(low), center(inside), 0)).toBe(false);
    expect(hasStaticPath(state, center(low), center(inside), 0)).toBe(false);
    expect(canWalk(state, high.x, high.y, 0)).toBe(false);
  });

  it('blocks every full ledge tile from above as well as below, including inner-corner art', () => {
    const world = flat(); raised(world);
    delete world.tiles[6 * world.width + 8].ridge;
    const state = stateOf(world), interior = { x: 11.5, y: 9.5 };
    expect(ridgeIsLedge(world, 9, 7)).toBe(true);
    const costs = travelTimeMap(state, interior, 0, 1, Infinity);
    for (let index = 0; index < world.tiles.length; index++) {
      const x = index % world.width, y = Math.floor(index / world.width);
      if (!ridgeIsLedge(world, x, y)) continue;
      expect(traversable(world, x, y), `ledge ${x},${y}`).toBe(false);
      expect(canWalk(state, x + .5, y + .5, 0)).toBe(false);
      expect(hasStaticPath(state, interior, { x: x + .5, y: y + .5 }, 0)).toBe(false);
      expect(costs[index]).toBe(Infinity);
      expect(ridgeFootprintAllowed(world, x, y)).toBe(false);
    }
    expect(canMove(state, { x: 11.5, y: 7.5 }, { x: 11.5, y: 6.5 }, 0)).toBe(false);
    expect(canMove(state, interior, { x: 12.5, y: 10.5 }, 0)).toBe(true);
    expect(ridgeFootprintAllowed(world, 10, 8)).toBe(true);
  });

  it('does not make ledges walkable with a road or misplaced river bridge', () => {
    const world = flat(); raised(world);
    const state = stateOf(world), x = 11, y = 6;
    entityStore(state).buildings.add({ id: 1, kind: 'road', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
    expect(canWalk(state, x, y, 0)).toBe(false);
    state.buildings[0].kind = 'bridge'; world.tiles[y * world.width + x].terrain = 'river'; world.revision!++;
    expect(canWalk(state, x, y, 0)).toBe(false);
    expect(hasStaticPath(state, { x: 11.5, y: 9.5 }, { x: 11.5, y: 6.5 }, 0)).toBe(false);
  });

  it('does not jump ledges, cut diagonal corners, or use roads to bypass a cliff', () => {
    const world = flat(); raised(world); const state = stateOf(world);
    expect(canMove(state, { x: 11.5, y: 4.5 }, { x: 11.5, y: 8.5 }, 0)).toBe(false);
    expect(ridgeEdgeAllowed(world, { x: 7, y: 5 }, { x: 8, y: 6 })).toBe(false);
    expect(ridgeEdgeAllowed(world, { x: 7, y: 6 }, { x: 8, y: 5 })).toBe(false);
    world.tiles[6 * world.width + 11].stair = 'south';
    expect(canMove(state, { x: 10.5, y: 5.5 }, { x: 11.5, y: 6.5 }, 0)).toBe(false);
    entityStore(state).buildings.add({ id: 1, kind: 'road', faction: 0, x: 8, y: 9, hp: 100, maxHp: 100, capacity: 0 });
    expect(canMove(state, { x: 7.5, y: 9.5 }, { x: 8.5, y: 9.5 }, 0)).toBe(false);
  });

  it('keeps zero-stair summits inaccessible while the low route goes around the hill', () => {
    const world = flat(); raised(world); const state = stateOf(world);
    expect(findPath(state, { x: 5.5, y: 9.5 }, { x: 18.5, y: 9.5 }, 0).length).toBeGreaterThan(0);
    expect(hasStaticPath(state, { x: 5.5, y: 9.5 }, { x: 11.5, y: 9.5 }, 0)).toBe(false);
  });

  it('allows building on stairs and both landings but rejects a footprint straddling elevations', () => {
    const world = flat(); raised(world); world.tiles[6 * world.width + 11].stair = 'south';
    expect(ridgeFootprintAllowed(world, 10, 5, 3)).toBe(false);
    for (const y of [5, 6, 7]) expect(ridgeFootprintAllowed(world, 11, y)).toBe(true);
    expect(ridgeFootprintAllowed(world, 10, 8, 3)).toBe(true);
  });

  it('uses authored cardinal stair sprites without rotations or invented pixels', () => {
    const world = flat(), atlas = punyAtlas(); raised(world);
    const stairs = [{ x: 11, y: 6, direction: 'south' }, { x: 14, y: 9, direction: 'west' },
      { x: 11, y: 12, direction: 'north' }, { x: 8, y: 9, direction: 'east' }] as const;
    for (const { x, y, direction } of stairs) world.tiles[y * world.width + x].stair = direction;
    expect(STAIR_SOURCES).toEqual({ north: [96,96], east: [80,80], south: [96,64], west: [112,80] });
    const raster = rasterTerrain(world, undefined, atlas);
    for (const { x, y, direction } of stairs) {
      const [sx, sy] = STAIR_SOURCES[direction];
      for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
        const target = ((y * 16 + py) * raster.width + x * 16 + px) * 4;
        const source = ((sy + py) * atlas.width + sx + px) * 4;
        expect(raster.pixels.slice(target, target + 4)).toEqual(atlas.data.slice(source, source + 4));
      }
    }
    expect(ridgeQuads(world, 11, 9)!.every(q => q.sx >= 16 && q.sx < 32 && q.sy >= 80 && q.sy < 96)).toBe(true);
  });

  it('retains the inner halves of full native boundary tiles so north and side ledges remain visible', () => {
    const world = flat(); raised(world);
    for (const [x, y, sourceX, sourceY] of [[11,6,16,64],[8,9,0,80],[14,9,32,80],[11,12,16,96]]) {
      const quads = ridgeQuads(world, x, y)!;
      for (const q of quads) { expect(q.sx).toBe(sourceX + q.dx); expect(q.sy).toBe(sourceY + q.dy); }
    }
  });
});

describe('world ridge placement', () => {
  it('repeats the same shelves from a seed and varies shelf sizes, counts and outlines between seeds', () => {
    const counts: number[] = [], sizes: number[] = [];
    let stacked = 0, concave = 0;
    for (let seed = 0; seed < 8; seed++) {
      const world = flat(112, 96), repeat = flat(112, 96);
      placeRidges(world.tiles, world.width, world.height, `shelf-shapes-${seed}`);
      placeRidges(repeat.tiles, repeat.width, repeat.height, `shelf-shapes-${seed}`);
      expect(repeat.tiles).toEqual(world.tiles);
      const stats = ridgeStatistics(world);
      counts.push(stats.ridges.size); sizes.push(...[...stats.ridges.values()].map(r => r.cells)); stacked += stats.stacked;
      for (let i = 0; i < world.tiles.length; i++) {
        const tile = world.tiles[i];
        if (!tile.ridge) continue;
        const x = i % world.width, y = Math.floor(i / world.width), same = (dx: number, dy: number) => world.tiles[(y + dy) * world.width + x + dx]?.ridge === tile.ridge;
        if (same(-1, 0) && same(1, 0) && same(0, -1) && same(0, 1) && !same(1, 1)) concave++;
      }
    }
    expect(Math.max(...counts) - Math.min(...counts)).toBeGreaterThan(3);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(10);
    expect(stacked).toBeGreaterThan(0);
    expect(concave).toBeGreaterThan(0);
  });

  it('varies hill coverage while keeping both tiers and all settlements reachable through legal stairs', () => {
    const counts = new Set<number>(), directions = new Set<string>(), ratios: number[] = [];
    for (let seed = 0; seed < 20; seed++) {
      // Fixed dimensions preserve the recorded terrain audit baseline.
      const world = generateWorld(`ridge-coverage-${seed}`, 194, 153);
      if (!world.tiles.some(tile => tile.ridge)) placeRidges(world.tiles, world.width, world.height, world.seed, world.spawns);
      const stats = ridgeStatistics(world), ratio = stats.raised / stats.land;
      ratios.push(ratio);
      expect(ratio, `seed ${seed}: ${stats.raised}/${stats.land}`).toBeGreaterThanOrEqual(.02);
      expect(ratio, `seed ${seed}`).toBeLessThanOrEqual(.12);
      const mountains = new Set(world.tiles.filter(tile => tile.relief === 'mountains' && tile.ridge).map(tile => tile.ridge!));
      const incised = new Set(world.tiles.filter(tile => tile.canyon === 'wall' && tile.ridge).map(tile => tile.ridge!));
      for (const [id, ridge] of stats.ridges) if (!mountains.has(id)) {
        if (!incised.has(id)) expect(ridge.stairs).toBeLessThanOrEqual(3);
        else {
          // A river cut can leave several separate upper-floor caps joined
          // only by impassable ledge artwork. Every cap needs its own legal
          // entrance, even when their shared hill outline needs >3 stairs.
          const floors = new Set(world.tiles.flatMap((tile, cell) => tile.ridge === id && !tile.stair
            && !ridgeIsLedge(world, cell % world.width, Math.floor(cell / world.width)) ? [cell] : []));
          const seen = new Set<number>(); let caps = 0;
          for (const start of floors) {
            if (seen.has(start)) continue;
            const queue = [start]; seen.add(start); caps++;
            for (let head = 0; head < queue.length; head++) for (const offset of [-1, 1, -world.width, world.width]) {
              const next = queue[head] + offset;
              if (floors.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
            }
          }
          expect(ridge.stairs, `one entrance per incised hill floor ${id} seed ${seed}`).toBe(caps);
        }
        if (ridge.tiers === 1) counts.add(ridge.stairs);
      }
      for (let i = 0; i < world.tiles.length; i++) {
        const tile = world.tiles[i];
        if (ridgeIsLedge(world, i % world.width, Math.floor(i / world.width))) {
          expect(tile.overlay).toBe('none'); expect(tile.palm).toBeUndefined();
          expect(traversable(world, i % world.width, Math.floor(i / world.width))).toBe(false);
        }
        if (!tile.stair) continue;
        const p = { x: i % world.width, y: Math.floor(i / world.width) }, up = STAIR_UP[tile.stair];
        directions.add(tile.stair);
        const low = world.tiles[(p.y - up.y) * world.width + p.x - up.x], high = world.tiles[(p.y + up.y) * world.width + p.x + up.x];
        expect(ridgeLevel(low)).toBe(ridgeLevel(tile) - 1); expect(ridgeLevel(high)).toBe(ridgeLevel(tile)); expect(high.ridge).toBe(tile.ridge);
        expect(WATER.has(low.terrain)).toBe(false); expect(WATER.has(high.terrain)).toBe(false);
        expect(low.overlay).toBe('none'); expect(high.overlay).toBe('none');
        expect(ridgeGroundWalkable(world, p.x, p.y)).toBe(true);
        expect(ridgeIsLedge(world, p.x + up.x, p.y + up.y)).toBe(false);
        expect(ridgeEdgeAllowed(world, { x: p.x - up.x, y: p.y - up.y }, p)).toBe(true);
        expect(ridgeEdgeAllowed(world, p, { x: p.x + up.x, y: p.y + up.y })).toBe(true);
      }
      const connected = reachable(world, world.spawns[0]);
      expect(world.spawns.every(p => connected.has(Math.floor(p.y) * world.width + Math.floor(p.x))), `spawn connectivity seed ${seed}`).toBe(true);
      // Shelves on offshore islands need local access, not a route across the
      // ocean to the player's capital. Label each traversable component once.
      const components = new Int32Array(world.tiles.length);
      let component = 0;
      for (let i = 0; i < world.tiles.length; i++) if (!components[i] && traversable(world, i % world.width, Math.floor(i / world.width))) {
        const region = reachable(world, { x: i % world.width, y: Math.floor(i / world.width) });
        component++;
        for (const cell of region) components[cell] = component;
      }
      const approaches = new Map<number, number>();
      for (let i = 0; i < world.tiles.length; i++) {
        const tile = world.tiles[i];
        if (!tile.ridge || !tile.stair || ridgeLevel(tile) !== 1) continue;
        const up = STAIR_UP[tile.stair];
        approaches.set(tile.ridge, components[i - up.y * world.width - up.x]);
      }
      for (let index = 0; index < world.tiles.length; index++) {
        const tile = world.tiles[index];
        // Only rocky resources intentionally occupy an otherwise usable floor.
        if (tile.ridge && !tile.stair && !resourceBlocksGround(tile) && !ridgeIsLedge(world, index % world.width, Math.floor(index / world.width))) {
          // Mountain silhouettes may have more than five separate floor caps.
          // Require actual entrances and local connectivity for every floor,
          // rather than limiting how many valid stairs can serve those caps.
          if (mountains.has(tile.ridge)) expect(approaches.has(tile.ridge), `mountain entrance ${tile.ridge} seed ${seed}`).toBe(true);
          if (mountains.has(tile.ridge) || stats.ridges.get(tile.ridge)!.stairs > 0)
            expect(components[index], `summit ${tile.ridge} seed ${seed}`).toBe(approaches.get(tile.ridge));
        }
      }
    }
    // Incision changes which original hills survive; a fixed set of seeds
    // need not retain every old stair-count bucket. Keep both closed summits
    // and accessible hilltops, while the checks above validate every entrance.
    expect(counts.has(0)).toBe(true);
    expect([...counts].some(count => count > 0)).toBe(true);
    expect(counts.size).toBeGreaterThanOrEqual(2);
    expect([...directions].sort()).toEqual(['east','north','south','west']);
    // Province contours share a coverage budget. Coastlines, valleys and safe
    // stair trimming still vary their realized area; larger density changes
    // are exercised through reliefCoverage in landform-relief.test.ts.
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(.005);
  }, 30000);
});

describe('stacked ledge shelves', () => {
  function stacked() {
    const world = flat(32, 30);
    raised(world, 4, 4, 23, 21);
    for (let y = 11; y < 18; y++) for (let x = 11; x < 20; x++) world.tiles[y * world.width + x].ridgeTier = 2;
    world.tiles[4 * world.width + 15].stair = 'south';
    world.tiles[11 * world.width + 15].stair = 'south';
    return world;
  }

  it('routes up both stair flights and keeps the lower shelf flat around the higher cliff', () => {
    const world = stacked(), state = stateOf(world), low = { x: 15.5, y: 3.5 }, summit = { x: 15.5, y: 14.5 };
    expect([3, 9, 14].map(y => ridgeLevel(world.tiles[y * world.width + 15]))).toEqual([0, 1, 2]);
    expect(canMove(state, low, summit, 0)).toBe(true);
    expect(canMove(state, summit, low, 0)).toBe(true);
    const path = findPath(state, low, summit, 0);
    for (const y of [4, 11]) expect(path.some(p => Math.floor(p.x) === 15 && Math.floor(p.y) === y)).toBe(true);
    expect(ridgeIsLedge(world, 15, 10)).toBe(false);
    expect(ridgeQuads(world, 15, 10)!.map(q => [q.sx - q.dx, q.sy - q.dy])).toEqual(Array(4).fill([16, 80]));
    delete world.tiles[11 * world.width + 15].stair;
    expect(ridgeIsLedge(world, 15, 11)).toBe(true);
    expect(ridgeQuads(world, 15, 11)!.map(q => [q.sx - q.dx, q.sy - q.dy])).toEqual(Array(4).fill([16, 64]));
  });

  it('forbids skipped tiers and diagonal cliff crossings while permitting structures on stair landings', () => {
    const world = stacked();
    expect(ridgeEdgeAllowed(world, { x: 14, y: 10 }, { x: 15, y: 11 })).toBe(false);
    for (const y of [3, 4, 5, 10, 11, 12]) expect(ridgeFootprintAllowed(world, 15, y)).toBe(true);
    expect(ridgeFootprintAllowed(world, 7, 7, 3)).toBe(true);
    expect(ridgeFootprintAllowed(world, 13, 13, 3)).toBe(true);
    expect(ridgeFootprintAllowed(world, 13, 9, 3)).toBe(false);
    delete world.tiles[10 * world.width + 15].ridge;
    expect(ridgeGroundWalkable(world, 15, 11)).toBe(false);
    expect(ridgeEdgeAllowed(world, { x: 15, y: 10 }, { x: 15, y: 11 })).toBe(false);
  });
});
