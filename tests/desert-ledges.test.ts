import { describe, expect, it } from 'vitest';
import { rasterTerrain, terrainMinimapColor, terrainQuads, type TerrainRaster } from '../src/game/terrain';
import type { PunyPixels } from '../src/game/puny-world';
import type { Terrain, World } from '../src/game/types';
import { punyAtlas } from './puny-atlas';

const atlas = punyAtlas();
const sandstone = punyAtlas(new URL('../public/assets/puny-world/desert-ledges.png', import.meta.url));
const originalLedges: PunyPixels = { width: 128, height: 48, data: new Uint8ClampedArray(128 * 48 * 4) };
for (let y = 0; y < 48; y++) originalLedges.data.set(atlas.data.subarray((y + 64) * atlas.width * 4,
  ((y + 64) * atlas.width + 128) * 4), y * 128 * 4);

function plateau(terrain: Terrain = 'grassland'): World {
  const width = 18, height = 15;
  const world: World = { width, height, seed: 'desert-ledges', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: width * height }, () => ({ terrain, overlay: 'none', elevation: .3,
      moisture: .3, food: 1, production: 1, gold: 0, variation: .4 })) };
  for (let y = 3; y <= 11; y++) for (let x = 4; x <= 12; x++) world.tiles[y * width + x].ridge = 1;
  return world;
}

function block(pixels: Uint8ClampedArray, width: number, x: number, y: number): Uint8ClampedArray {
  const result = new Uint8ClampedArray(16 * 16 * 4);
  for (let row = 0; row < 16; row++) result.set(pixels.subarray(((y + row) * width + x) * 4,
    ((y + row) * width + x + 16) * 4), row * 16 * 4);
  return result;
}

function expectTile(raster: TerrainRaster, x: number, y: number, source: PunyPixels, sx: number, sy: number) {
  expect(block(raster.pixels, raster.width, x * 16, y * 16)).toEqual(block(source.data, source.width, sx, sy));
}

describe('approved sandstone ledges', () => {
  it('uses matching native cliffs on both tiers without drawing a reverse cliff on the lower floor', () => {
    for (const terrain of ['desert', 'grassland'] as const) {
      const world = plateau(terrain), source = terrain === 'grassland' ? atlas : sandstone;
      const offset = terrain === 'grassland' ? 0 : 64;
      for (let y = 5; y <= 9; y++) for (let x = 6; x <= 10; x++) world.tiles[y * world.width + x].ridgeTier = 2;
      const raster = rasterTerrain(world, undefined, atlas, sandstone);
      expectTile(raster, 8, 3, source, 16, 64 - offset);
      expectTile(raster, 8, 5, source, 16, 64 - offset);
      expectTile(raster, 8, 9, source, 16, 96 - offset);
      expectTile(raster, 8, 10, source, 16, 80 - offset);
    }
  });

  it('samples the approved sheet for sandy corners and all four stairs, preserving original grassy art', () => {
    expect([sandstone.width, sandstone.height]).toEqual([128, 48]);
    for (const terrain of ['desert', 'plains', 'grassland'] as const) {
      const world = plateau(terrain), source = terrain === 'grassland' ? atlas : sandstone;
      const offset = terrain === 'grassland' ? 0 : 64;
      const edges = [[4,3,0,64], [8,3,16,64], [12,3,32,64], [4,7,0,80],
        [8,7,16,80], [12,7,32,80], [4,11,0,96], [8,11,16,96], [12,11,32,96]];
      let raster = rasterTerrain(world, undefined, atlas, sandstone);
      for (const [x, y, sx, sy] of edges) expectTile(raster, x, y, source, sx, sy - offset);

      for (const [x, y] of [[4,3], [12,3], [4,11], [12,11]]) delete world.tiles[y * world.width + x].ridge;
      world.tiles[3 * world.width + 8].stair = 'south';
      world.tiles[7 * world.width + 12].stair = 'west';
      world.tiles[11 * world.width + 8].stair = 'north';
      world.tiles[7 * world.width + 4].stair = 'east';
      world.revision!++;
      raster = rasterTerrain(world, undefined, atlas, sandstone);
      const cornersAndStairs = [[5,4,48,64], [11,4,64,64], [5,10,48,80], [11,10,64,80],
        [8,3,96,64], [12,7,112,80], [8,11,96,96], [4,7,80,80]];
      for (const [x, y, sx, sy] of cornersAndStairs) expectTile(raster, x, y, source, sx, sy - offset);
    }
  });

  it('keeps mixed-biome ridge joins and world data intact while matching minimap colors to each palette', () => {
    const world = plateau(), raised = world.tiles.flatMap((tile, i) => tile.ridge ? [i] : []);
    const joins = raised.map(i => terrainQuads(world, i % world.width, Math.floor(i / world.width)));
    for (const i of raised) world.tiles[i].terrain = i % world.width < 8 ? 'desert' : i % world.width === 8 ? 'plains' : 'grassland';
    const before = JSON.stringify(world), raster = rasterTerrain(world, undefined, atlas, sandstone);
    expect(raised.map(i => terrainQuads(world, i % world.width, Math.floor(i / world.width)))).toEqual(joins);
    expectTile(raster, 6, 7, sandstone, 16, 16);
    expectTile(raster, 8, 7, sandstone, 16, 16);
    expectTile(raster, 10, 7, atlas, 16, 80);
    expect([6, 8, 10].map(x => terrainMinimapColor(world, x, 7))).toEqual(['#a7956b', '#a7956b', '#758b40']);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('changes only sandy ridge pixels and leaves all non-ridge surfaces and water masks untouched', () => {
    const world = plateau('desert');
    for (let y = 0; y < world.height; y++) {
      world.tiles[y * world.width].terrain = 'ocean';
      world.tiles[y * world.width + 1].terrain = 'river';
      world.tiles[y * world.width + 15].terrain = 'plains';
      world.tiles[y * world.width + 16].terrain = 'grassland';
    }
    const before = rasterTerrain(world, undefined, atlas, originalLedges);
    const after = rasterTerrain(world, undefined, atlas, sandstone);
    expect(after.water).toEqual(before.water);
    expect(after.water.some(value => value === 1)).toBe(true);
    for (let i = 0; i < world.tiles.length; i++) if (!world.tiles[i].ridge) {
      const x = i % world.width * 16, y = Math.floor(i / world.width) * 16;
      expect(block(after.pixels, after.width, x, y)).toEqual(block(before.pixels, before.width, x, y));
    }
    expect(block(after.pixels, after.width, 8 * 16, 7 * 16)).not.toEqual(block(before.pixels, before.width, 8 * 16, 7 * 16));
    expect(Array.from(block(after.pixels, after.width, 8 * 16, 7 * 16).subarray(0, 4))).toEqual([201, 178, 102, 255]);
  });

  it('renders a partial dirty rectangle identically to the corresponding full-world pixels', () => {
    const world = plateau('plains');
    world.tiles[11 * world.width + 8].stair = 'north';
    delete world.tiles[3 * world.width + 4].ridge;
    const region = { x: 3, y: 2, width: 11, height: 11 };
    const full = rasterTerrain(world, undefined, atlas, sandstone);
    const partial = rasterTerrain(world, region, atlas, sandstone);
    for (let row = 0; row < partial.height; row++) {
      const start = (region.y * 16 + row) * full.width + region.x * 16;
      expect(partial.pixels.subarray(row * partial.width * 4, (row + 1) * partial.width * 4))
        .toEqual(full.pixels.subarray(start * 4, (start + partial.width) * 4));
      expect(partial.water.subarray(row * partial.width, (row + 1) * partial.width))
        .toEqual(full.water.subarray(start, start + partial.width));
    }
  });
});
