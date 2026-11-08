import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/generator';
import { finishHillBiomes, placeHillBiomes } from '../src/world/hill-biomes';
import { applyTerrainEcology } from '../src/world/terrain-ecology';
import { assignRegionalResources } from '../src/world/resources';
import { canTraverseEdge, traversable } from '../src/game/pathfinding';
import { narrowHillPassage, ridgeGroundWalkable, ridgeIsLedge, ridgeStairAccess, STAIR_UP } from '../src/game/ridges';
import { WATER, type HillBiome, type World } from '../src/game/types';

const BIOMES: HillBiome[] = ['desert-hills', 'forest-hills'];
function fixture(): World {
  const width = 192, height = 160;
  return { width, height, seed: 'HILL-COUNTRY-ACCESS', source: 'test', spawns: [{ x: 15, y: 15 }],
    tiles: Array.from({ length: width * height }, (_, cell) => {
      const x = cell % width, dry = x < width / 2;
      return { terrain: x < 5 ? 'ocean' : dry ? 'desert' : 'grassland', overlay: 'none',
        biome: dry ? 'desert' : 'temperate', elevation: .25, moisture: dry ? .25 : .7,
        temperature: .65, food: 3, production: 1, gold: 0, variation: (cell * .61803398875) % 1 };
    }) };
}
function bodies(world: World, biome: HillBiome): Map<number, number[]> {
  const result = new Map<number, number[]>();
  world.tiles.forEach((tile, cell) => {
    if (tile.hillBiome !== biome || !tile.ridge) return;
    const cells = result.get(tile.ridge) ?? []; cells.push(cell); result.set(tile.ridge, cells);
  });
  return result;
}
function assertAccess(world: World): void {
  const { width, height, tiles } = world, queue: number[] = [], seen = new Uint8Array(tiles.length);
  for (let cell = 0; cell < tiles.length; cell++) if (!tiles[cell].ridge && traversable(world, cell % width, Math.floor(cell / width))) {
    seen[cell] = 1; queue.push(cell);
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
    for (const { x: dx, y: dy } of Object.values(STAIR_UP)) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || !traversable(world, nx, ny)
        || !canTraverseEdge(world, { x, y }, { x: nx, y: ny })) continue;
      seen[next] = 1; queue.push(next);
    }
  }
  const stranded: number[] = [], invalid: number[] = [];
  tiles.forEach((tile, cell) => {
    if (!tile.hillBiome) return;
    const x = cell % width, y = Math.floor(cell / width);
    if (tile.ridge && traversable(world, x, y) && !seen[cell]) stranded.push(cell);
    if (tile.stair) {
      const up = STAIR_UP[tile.stair], low = { x: x - up.x, y: y - up.y }, high = { x: x + up.x, y: y + up.y };
      if (!ridgeGroundWalkable(world, x, y) || !canTraverseEdge(world, low, { x, y }) || !canTraverseEdge(world, { x, y }, high)
        || !canTraverseEdge(world, high, { x, y }) || !canTraverseEdge(world, { x, y }, low)) invalid.push(cell);
    }
  });
  expect(invalid, 'ramps connect both ways with actual movement rules').toEqual([]);
  expect(stranded, 'all usable hill floors connect to local low ground').toEqual([]);
}

describe('desert and forest hill country', () => {
  it('builds deterministic, varied hill districts with occasional accessible second levels', () => {
    const world = fixture(), before = structuredClone(world);
    placeHillBiomes(world); finishHillBiomes(world);
    const replay = structuredClone(before); placeHillBiomes(replay); finishHillBiomes(replay);
    expect(world).toEqual(replay);
    for (const biome of BIOMES) {
      const hills = [...bodies(world, biome).values()], areas = hills.map(cells => cells.length);
      const tiered = hills.filter(cells => cells.some(cell => world.tiles[cell].ridgeTier === 2));
      expect(hills.length).toBeGreaterThanOrEqual(10);
      expect(Math.min(...areas)).toBeLessThan(35);
      expect(Math.max(...areas)).toBeGreaterThan(120);
      expect(tiered.length).toBeGreaterThan(0);
      expect(tiered.length / hills.length).toBeLessThan(.3);
      for (const cells of tiered) expect(cells.some(cell => world.tiles[cell].ridgeTier === 2 && world.tiles[cell].stair)).toBe(true);
      expect(hills.filter(cells => cells.some(cell => world.tiles[cell].stair)).length / hills.length).toBeGreaterThan(.85);
    }
    before.tiles.forEach((tile, cell) => { if (WATER.has(tile.terrain)) expect(world.tiles[cell]).toEqual(tile); });
    for (let y = 13; y <= 17; y++) for (let x = 13; x <= 17; x++) expect(world.tiles[y * world.width + x]).toEqual(before.tiles[y * world.width + x]);
    assertAccess(world);
  }, 15000);

  it('keeps forest openings, narrow passages and both ramp landings clear through ecology and resource placement', () => {
    const world = fixture(); placeHillBiomes(world); finishHillBiomes(world); applyTerrainEcology(world); assignRegionalResources(world);
    let passages = 0, trees = 0;
    world.tiles.forEach((tile, cell) => {
      if (!tile.hillBiome) return;
      const x = cell % world.width, y = Math.floor(cell / world.width);
      if (narrowHillPassage(world, x, y)) {
        passages++; expect(tile.overlay).toBe('none'); expect(['stone', 'iron', 'copper', 'olives']).not.toContain(tile.resource);
      }
      if (ridgeStairAccess(world, x, y)) { expect(tile.overlay).toBe('none'); expect(tile.resource).toBeUndefined(); }
      if (tile.overlay === 'forest') {
        trees++; expect(ridgeIsLedge(world, x, y)).toBe(false);
        expect([cell, cell + 1, cell + world.width, cell + world.width + 1].every(i => world.tiles[i]?.overlay === 'forest')).toBe(false);
      }
    });
    expect(passages).toBeGreaterThan(20); expect(trees).toBeGreaterThan(30); assertAccess(world);
  }, 15000);

  it.each(['DUNE-GROVE-61', 'SAND-BIRCH-19'])('survives the full generator, rivers and city placement for %s', seed => {
    const world = generateWorld(seed, 256, 192);
    // Final polar/apron climate can convert one district type into the other.
    expect(BIOMES.reduce((sum, biome) => sum + bodies(world, biome).size, 0)).toBeGreaterThanOrEqual(10);
    expect(world.tiles.some(tile => tile.hillBiome && tile.ridgeTier === 2)).toBe(true);
    expect(world.tiles.some(tile => tile.hillBiome === 'forest-hills' && tile.overlay === 'forest')).toBe(true);
    for (const tile of world.tiles) if (tile.hillBiome) {
      expect(WATER.has(tile.terrain) || tile.beach || tile.marsh).toBeFalsy();
      expect(tile.terrain).toBe(tile.hillBiome === 'desert-hills' ? 'desert' : 'grassland');
    }
    for (const site of [...world.spawns, ...(world.secondarySpawns ?? [])]) {
      const x = Math.floor(site.x), y = Math.floor(site.y);
      expect(world.tiles[y * world.width + x].hillBiome).toBeUndefined();
    }
    assertAccess(world);
  }, 20000);
});
