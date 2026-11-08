import { describe, expect, it } from 'vitest';
import { buildDrainage, riverRadius } from '../src/world/hydrology';
import { generateWorld } from '../src/world/generator';
import type { Tile } from '../src/game/types';

const basin = (width: number, height: number): Tile[] => Array.from({ length: width * height }, (_, cell) => {
  const x = cell % width, y = Math.floor(cell / width), sea = !x || !y || x === width - 1 || y === height - 1;
  return { terrain: sea ? 'ocean' : 'grassland', overlay: 'none', elevation: sea ? 0 : .3 + Math.sin(x * .7) * Math.cos(y * .4) * .2,
    rainfall: .7, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 };
});

function audit(tiles: Tile[]): void {
  const indegree = new Int32Array(tiles.length);
  for (const tile of tiles) if (tile.drainage! >= 0) indegree[tile.drainage!]++;
  const queue = tiles.flatMap((_, cell) => indegree[cell] ? [] : [cell]);
  for (let n = 0; n < queue.length; n++) {
    const cell = queue[n], tile = tiles[cell], downstream = tile.drainage!;
    if (downstream < 0) continue;
    expect(tile.elevation + 1e-10).toBeGreaterThanOrEqual(tiles[downstream].elevation);
    expect(tiles[downstream].flow! + 1e-8).toBeGreaterThanOrEqual(tile.flow!);
    if (--indegree[downstream] === 0) queue.push(downstream);
  }
  expect(queue.length, 'every catchment is acyclic and reaches an outlet').toBe(tiles.length);
}

describe('terrain-driven watersheds', () => {
  it('resolves inland depressions downhill and conserves rainfall runoff at the coast', () => {
    const width = 29, height = 23, tiles = basin(width, height);
    for (let y = 8; y < 14; y++) for (let x = 11; x < 17; x++) tiles[y * width + x].elevation = .01;
    const input = tiles.filter(tile => tile.terrain !== 'ocean').reduce((sum, tile) => sum + .15 + tile.rainfall! * .85, 0);
    buildDrainage(tiles, width, height); audit(tiles);
    const output = tiles.filter(tile => tile.drainage === -1).reduce((sum, tile) => sum + tile.flow!, 0);
    expect(output).toBeCloseTo(input, 7);
    const wetter = structuredClone(tiles);
    for (const tile of wetter) tile.rainfall = 1;
    buildDrainage(wetter, width, height);
    expect(wetter.reduce((sum, tile) => sum + (tile.drainage === -1 ? tile.flow! : 0), 0)).toBeGreaterThan(output);
  });

  it('keeps a lake level with one spillway and no uphill shoreline inflows', () => {
    const width = 30, height = 25, tiles = basin(width, height), cells: number[] = [];
    for (let y = 8; y < 16; y++) for (let x = 10; x < 18; x++) {
      const cell = y * width + x; cells.push(cell); tiles[cell].terrain = 'lake'; tiles[cell].elevation = .09;
    }
    buildDrainage(tiles, width, height); audit(tiles);
    expect(new Set(cells.map(cell => tiles[cell].elevation)).size).toBe(1);
    const outlets = cells.filter(cell => tiles[tiles[cell].drainage!].terrain !== 'lake');
    expect(outlets).toHaveLength(1);
    expect(tiles[outlets[0]].flow!).toBeGreaterThan(cells.length * .7);
  });

  it('widens wet accumulated catchments while retaining bridgeable channels', () => {
    expect(riverRadius(500)).toBeGreaterThan(riverRadius(25));
    expect(riverRadius(25)).toBeGreaterThan(riverRadius(2));
    expect(riverRadius(1e8)).toBeLessThanOrEqual(2.7);
    expect(riverRadius(100, 1.2)).toBeCloseTo(riverRadius(100) * 1.2);
  });

  it('publishes downhill flow through a complete generated world without flooding ledges', () => {
    const world = generateWorld('watershed-invariants', 160, 128); audit(world.tiles);
    for (const tile of world.tiles) if (tile.ridge || tile.stair) {
      if (tile.terrain === 'river' && tile.ridge && !tile.stair) expect(tile.riverArt).toBe('banked');
      else expect(['river', 'lake', 'coast', 'ocean']).not.toContain(tile.terrain);
    }
    for (const tile of world.tiles) if (tile.terrain === 'river' && tile.drainage! >= 0)
      expect(['river', 'lake', 'coast', 'ocean']).toContain(world.tiles[tile.drainage!].terrain);
    const inland = world.tiles.filter(tile => tile.drainage! >= 0);
    const input = inland.reduce((sum, tile) => sum + .15 + tile.rainfall! * .85, 0);
    const output = world.tiles.filter(tile => tile.drainage === -1).reduce((sum, tile) => sum + tile.flow!, 0);
    expect(output).toBeCloseTo(input, 6);
  }, 15000);

  it('keeps smoothed river banks cardinally connected around protected ridge aprons', () => {
    const world = generateWorld('connected-world-16'), reached = new Uint8Array(world.tiles.length), queue: number[] = [];
    const water = new Set(['river', 'lake', 'coast', 'ocean']);
    world.tiles.forEach((tile, cell) => {
      if (tile.terrain === 'coast' || tile.terrain === 'ocean') { reached[cell] = 1; queue.push(cell); }
    });
    for (let n = 0; n < queue.length; n++) {
      const cell = queue[n], x = cell % world.width, y = Math.floor(cell / world.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || reached[next] || !water.has(world.tiles[next].terrain)) continue;
        reached[next] = 1; queue.push(next);
      }
    }
    for (let cell = 0; cell < world.tiles.length; cell++) if (world.tiles[cell].terrain === 'river') expect(reached[cell]).toBe(1);
  }, 120000);
});
