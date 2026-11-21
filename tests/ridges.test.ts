import { describe, expect, it } from 'vitest';
import { placeRidges, ridgeStatistics } from '../src/world/ridges';
import { ridgeEdgeAllowed, ridgeFootprintAllowed, ridgeGroundWalkable } from '../src/game/ridges';
import { ridgeQuads } from '../src/game/ridge-art';
import { type World, type Tile } from '../src/game/types';

function flat(width = 24, height = 20): World {
  return { width, height, seed: 'ridge-test', source: 'fixture', spawns: [], revision: 0,
    tiles: Array.from({ length: width * height }, (): Tile => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) };
}
function raised(world: World, left = 8, top = 6, width = 7, height = 7) {
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) world.tiles[y * world.width + x].ridge = 1;
}
describe('offline ridge geometry', () => {
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
