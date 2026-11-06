import { describe, expect, it } from 'vitest';
import { ridgeEdgeAllowed, ridgeGroundWalkable, ridgeIsLedge, STAIR_UP } from '../src/game/ridges';
import { WATER, type World } from '../src/game/types';
import { captureRiverRelief, carveRiverCanyons } from '../src/world/river-canyons';

function plateau(): World {
  const width = 72, height = 64;
  const world: World = { width, height, seed: 'incised-plateau', spawns: [], source: 'test',
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'forest', elevation: .4,
      moisture: .6, food: 2, production: 3, gold: 0, variation: .5 })) };
  for (let y = 12; y <= 50; y++) for (let x = 14; x <= 57; x++) Object.assign(world.tiles[y * width + x], {
    ridge: 1, ridgeTier: x >= 21 && x <= 50 && y >= 19 && y <= 43 ? 2 : 1,
    relief: 'mountains', elevation: .9,
  });
  // An untouched distant hill must not be rebuilt just because another body
  // is split by a river.
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 6; x++) Object.assign(world.tiles[y * width + x], {
    ridge: 2, ridgeTier: 1, relief: 'hills', elevation: .76,
  });
  return world;
}

function assertUsableBanks(world: World): void {
  const { width, height, tiles } = world, seen = new Uint8Array(tiles.length), queue: number[] = [];
  // Both banks may be separated by the actual river. Every raised usable
  // floor must reach some real dry low ground without crossing a cliff.
  for (let cell = 0; cell < tiles.length; cell++) if (!tiles[cell].ridge && !WATER.has(tiles[cell].terrain)) {
    seen[cell] = 1; queue.push(cell);
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
    for (const up of Object.values(STAIR_UP)) {
      const nx = x + up.x, ny = y + up.y, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || WATER.has(tiles[next].terrain)
        || !ridgeGroundWalkable(world, nx, ny) || !ridgeEdgeAllowed(world, { x, y }, { x: nx, y: ny })) continue;
      seen[next] = 1; queue.push(next);
    }
  }
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell], x = cell % width, y = Math.floor(cell / width);
    if (tile.ridge && tile.ridge !== 2 && ridgeGroundWalkable(world, x, y)) expect(seen[cell], `floor ${x},${y}`).toBe(1);
    if (tile.stair) {
      const up = STAIR_UP[tile.stair];
      expect(ridgeGroundWalkable(world, x, y), `stair ${x},${y}`).toBe(true);
      expect(WATER.has(tiles[cell - up.y * width - up.x].terrain)).toBe(false);
      expect(WATER.has(tiles[cell + up.y * width + up.x].terrain)).toBe(false);
    }
  }
}

describe('rivers incising completed landforms', () => {
  it('cuts a winding river through a preexisting mountain shelf and rebuilds real accessible ledges', () => {
    const world = plateau(), snapshot = captureRiverRelief(world), heights = new Map<number, number>();
    const untouched = structuredClone(world.tiles[4 * world.width + 4]);
    for (let y = 5; y < world.height - 5; y++) {
      const center = 35 + Math.round(Math.sin(y * .16) * 6);
      for (let x = center - 1; x <= center + 1; x++) {
        const cell = y * world.width + x;
        Object.assign(world.tiles[cell], { terrain: 'river', overlay: 'none', channel: 'main', channelWidth: 3,
          elevation: .3 - y * .001, flow: y * 10, drainage: cell + world.width });
        heights.set(cell, world.tiles[cell].elevation);
      }
    }
    const result = carveRiverCanyons(world, snapshot);
    expect(result.affectedRidges).toBe(1);
    expect(result.canyonCells.length).toBeGreaterThan(200);
    expect(result.wallCells.length).toBeGreaterThan(50);
    expect(new Set(world.tiles.filter(tile => tile.ridge && tile.ridge !== 2).map(tile => tile.ridge)).size).toBeGreaterThanOrEqual(2);
    expect(world.tiles.some(tile => tile.ridgeTier === 2)).toBe(true);
    expect(world.tiles[4 * world.width + 4]).toEqual(untouched);
    for (const [cell, height] of heights) {
      expect(world.tiles[cell].elevation).toBe(height);
      expect(world.tiles[cell].ridge).toBeUndefined();
      expect(world.tiles[cell].stair).toBeUndefined();
      expect(world.tiles[cell].flow).toBe(Math.floor(cell / world.width) * 10);
    }
    for (const cell of result.wallCells) {
      expect(world.tiles[cell].canyon).toBe('wall');
      expect(ridgeIsLedge(world, cell % world.width, Math.floor(cell / world.width))).toBe(true);
      expect(world.tiles[cell].overlay).toBe('none');
    }
    for (let cell = 0; cell < world.tiles.length; cell++) if (world.tiles[cell].ridge) {
      const x = cell % world.width, y = Math.floor(cell / world.width);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        expect(WATER.has(world.tiles[(y + dy) * world.width + x + dx].terrain)).toBe(false);
    }
    assertUsableBanks(world);
  });

  it('leaves dry hillslope drainage intact instead of carving creek canyons', () => {
    const world = plateau(), snapshot = captureRiverRelief(world);
    for (let y = 5; y < world.height - 5; y++) {
      const x = 34 + Math.round(Math.sin(y * .13) * 5), cell = y * world.width + x;
      Object.assign(world.tiles[cell], { drainage: cell + world.width, flow: y * .5 });
    }
    const unchanged = structuredClone(world), result = carveRiverCanyons(world, snapshot);
    expect(result).toMatchObject({ affectedRidges: 0, canyonCells: [], wallCells: [], removedRidgeCells: [] });
    expect(world).toEqual(unchanged);
  });

  it('does not invent canyon walls for rivers entirely on flat ground, and is deterministic', () => {
    const world = plateau(), snapshot = captureRiverRelief(world);
    for (let y = 8; y < world.height - 8; y++) Object.assign(world.tiles[y * world.width + 8], { terrain: 'river', channel: 'tributary' });
    const unchanged = structuredClone(world);
    expect(carveRiverCanyons(world, snapshot)).toMatchObject({ affectedRidges: 0, wallCells: [], canyonCells: [] });
    expect(world).toEqual(unchanged);
    for (let y = 5; y < world.height - 5; y++) Object.assign(world.tiles[y * world.width + 35], { terrain: 'river', channel: 'tributary' });
    const repeat = structuredClone(world);
    expect(carveRiverCanyons(world, snapshot)).toEqual(carveRiverCanyons(repeat, snapshot));
    expect(world).toEqual(repeat);
  });
});
