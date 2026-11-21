import { describe, expect, it } from 'vitest';
import { applyTerrainEcology, createTerrainEnvironment } from '../src/world/terrain-ecology';
import { generateWorld, seededRandom } from '../src/world/generator';
import { createNoise2D } from 'simplex-noise';
import { sampleTerrainClimate } from '../src/world/climate';
import { resolveLandscapeParameters } from '../src/world/options';
import { WATER, type World } from '../src/game/types';
import { canTraverseEdge, traversable } from '../src/game/pathfinding';

function flat(seed = 'ecology-test', width = 96, height = 80): World {
  return { seed, width, height, source: 'ecology fixture', spawns: [], tiles: Array.from({ length: width * height }, (_, i) => ({
    terrain: i % width === 8 ? 'river' : 'grassland', overlay: 'none', elevation: .3, moisture: .55,
    food: 3, production: 1, gold: 0, variation: .5 })) };
}
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function expectOpenWoodland(world: World): void {
  const { width, height, tiles } = world, solidSquares: number[] = [], withoutOpening: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x;
    if (tiles[cell].overlay !== 'forest') continue;
    if (x + 1 < width && y + 1 < height && [cell + 1, cell + width, cell + width + 1]
      .every(next => tiles[next].overlay === 'forest')) solidSquares.push(cell);
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      const neighbor = tiles[ny * width + nx];
      return !WATER.has(neighbor.terrain) && neighbor.overlay === 'none' && traversable(world, nx, ny)
        && canTraverseEdge(world, { x, y }, { x: nx, y: ny });
    });
    if (!open) withoutOpening.push(cell);
  }
  expect(solidSquares, `${world.seed}: no solid 2×2 canopy`).toEqual([]);
  expect(withoutOpening, `${world.seed}: each tree borders usable open ground`).toEqual([]);
}

describe('correlated terrain ecology', () => {
  it('biases desert toward the warm belt and greener cover north, with patch variation in both regions', () => {
    const width = 274, height = 216, counts = { north: { desert: 0, grass: 0, land: 0 }, warm: { desert: 0, grass: 0, land: 0 } };
    const parameters = resolveLandscapeParameters();
    for (let seed = 0; seed < 6; seed++) {
      const random = seededRandom(`latitude-${seed}`), moisture = createNoise2D(random), warp = createNoise2D(random);
      for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
        const region = y < height * .3 ? counts.north
          : Math.abs(y / (height - 1) - parameters.equatorPosition) < parameters.equatorWidth * .5 ? counts.warm : undefined;
        if (!region) continue;
        const climate = sampleTerrainClimate(x, y, width, height, moisture, warp);
        region.land++; region.desert += Number(climate.terrain === 'desert'); region.grass += Number(climate.terrain === 'grassland');
      }
    }
    const northDry = counts.north.desert / counts.north.land, warmDry = counts.warm.desert / counts.warm.land;
    expect(warmDry).toBeGreaterThan(northDry + .25);
    // Sample #20 deliberately has strong regional variation; retain a clear
    // latitude bias without requiring the previous preset's stronger contrast.
    expect(counts.north.grass / counts.north.land).toBeGreaterThan(counts.warm.grass / counts.warm.land + .15);
    // A biased distribution remains a landscape of patches, not solid bands.
    expect(northDry).toBeGreaterThan(.005); expect(warmDry).toBeLessThan(.9);
    expect(counts.warm.grass / counts.warm.land).toBeGreaterThan(.05);
  });

  it('changes climates and woodland with the exposed controls', () => {
    const world = flat(), random = seededRandom('climate-controls'), moisture = createNoise2D(random), warp = createNoise2D(random);
    const wet = resolveLandscapeParameters({ moisture: .62, forestThreshold: .48 });
    const dry = resolveLandscapeParameters({ moisture: .44, forestThreshold: .61 });
    let wetDesert = 0, dryDesert = 0;
    for (let y = 0; y < world.height; y += 2) for (let x = 0; x < world.width; x += 2) {
      wetDesert += Number(sampleTerrainClimate(x, y, world.width, world.height, moisture, warp, wet).terrain === 'desert');
      dryDesert += Number(sampleTerrainClimate(x, y, world.width, world.height, moisture, warp, dry).terrain === 'desert');
    }
    expect(dryDesert).toBeGreaterThan(wetDesert * 1.5);
    const dense = structuredClone(world), sparse = structuredClone(world);
    applyTerrainEcology(dense, wet); applyTerrainEcology(sparse, dry);
    expect(dense.tiles.filter(tile => tile.overlay === 'forest').length).toBeGreaterThan(sparse.tiles.filter(tile => tile.overlay === 'forest').length * 1.5);
    const small = createTerrainEnvironment(world.tiles, world.width, world.height, world.seed,
      resolveLandscapeParameters({ forestPatchScale: .65, ruggednessScale: .65 }));
    const large = createTerrainEnvironment(world.tiles, world.width, world.height, world.seed,
      resolveLandscapeParameters({ forestPatchScale: 1.6, ruggednessScale: 1.6 }));
    expect(small.woodland).not.toEqual(large.woodland); expect(small.ruggedness).not.toEqual(large.ruggedness);
  });

  it('repeats bounded regional fields with substantially stronger local than distant similarity', () => {
    const world = flat(), first = createTerrainEnvironment(world.tiles, world.width, world.height, world.seed);
    expect(createTerrainEnvironment(world.tiles, world.width, world.height, world.seed)).toEqual(first);
    for (const [name, field] of Object.entries(first)) {
      expect([...field].every(value => Number.isFinite(value) && value >= 0 && value <= (name === 'orientation' ? Math.PI : 1))).toBe(true);
    }
    const near: number[] = [], far: number[] = [];
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width - 20; x++) {
      const i = y * world.width + x;
      near.push(Math.abs(first.ruggedness[i] - first.ruggedness[i + 1]));
      far.push(Math.abs(first.ruggedness[i] - first.ruggedness[i + 20]));
    }
    expect(mean(near)).toBeLessThan(mean(far) * .3);
    const wetBank = [], inland = [];
    for (let y = 0; y < world.height; y++) { wetBank.push(first.moisture[y * world.width + 9]); inland.push(first.moisture[y * world.width + 80]); }
    expect(mean(wetBank)).toBeGreaterThan(mean(inland) + .08);
  });

  it('grows woodland on hills and keeps blocked ground, mountain passes and towns clear', () => {
    const world = flat(), at = (x: number, y: number) => world.tiles[y * world.width + x];
    for (let y = 15; y < 40; y++) for (let x = 18; x < 43; x++) at(x, y).relief = 'hills';
    for (let y = 21; y < 34; y++) for (let x = 24; x < 37; x++) at(x, y).relief = 'mountains';
    world.spawns = [{ x: 67.5, y: 25.5 }];
    at(50, 40).mountainPass = true;
    at(18, 27).rockRelief = 0;
    const water = world.tiles.map(tile => WATER.has(tile.terrain) ? { ...tile } : null);
    applyTerrainEcology(world, resolveLandscapeParameters({ forestThreshold: .48 }));
    expect(world.tiles.some(tile => tile.relief === 'hills' && tile.overlay === 'forest')).toBe(true);
    for (let i = 0; i < world.tiles.length; i++) {
      const tile = world.tiles[i], x = i % world.width, y = Math.floor(i / world.width);
      if (water[i]) expect(tile).toEqual(water[i]);
      if (tile.relief === 'mountains' || tile.rockRelief === 0 || tile.mountainPass || Math.abs(x - 67) <= 2 && Math.abs(y - 25) <= 2)
        expect(tile.overlay).toBe('none');
    }
    expectOpenWoodland(world);
  });

  it('retains openings even in saturated rainforest at the lowest woodland threshold, reproducibly', () => {
    const saturated = flat('saturated-open-woodland', 64, 64);
    for (const tile of saturated.tiles) if (!WATER.has(tile.terrain))
      Object.assign(tile, { moisture: 1, biome: 'rainforest', temperature: .8 });
    const parameters = resolveLandscapeParameters({ forestThreshold: .48, moisture: .62, riparianBoost: .26 });
    const repeated = structuredClone(saturated);
    applyTerrainEcology(saturated, parameters); applyTerrainEcology(repeated, parameters);
    expect(repeated).toEqual(saturated);
    // A genuinely dense candidate region exercises the opening guarantees;
    // an empty fixture must not satisfy them vacuously.
    const land = saturated.tiles.filter(tile => !WATER.has(tile.terrain));
    expect(land.filter(tile => tile.overlay === 'forest').length / land.length).toBeGreaterThan(.30);
    expectOpenWoodland(saturated);
  });

  it('grows solid grassland forests with passable trails in all three production geographies', () => {
    for (const style of ['continents', 'pangaea', 'fractal'] as const) {
      const world = generateWorld('BTV-world-modes-review', 274, 216, { style });
      const land = world.tiles.filter(tile => !WATER.has(tile.terrain));
      const forests = land.filter(tile => tile.overlay === 'forest');
      expect(forests.length / land.length).toBeGreaterThan(.15);
      expect(forests.length / land.length).toBeLessThan(.5);
      let broadCanopy = 0, forestPaths = 0;
      world.tiles.forEach((tile, i) => {
        const x = i % world.width, y = Math.floor(i / world.width);
        if (tile.biome !== 'forest') return;
        expect(tile.terrain).toBe('grassland');
        expect(traversable(world, x, y)).toBe(true);
        if (tile.overlay === 'none') {
          forestPaths++;
        } else {
          expect(tile.overlay).toBe('forest');
          if (x + 1 < world.width && y + 1 < world.height
            && [i + 1, i + world.width, i + world.width + 1].every(next =>
              world.tiles[next].biome === 'forest' && world.tiles[next].overlay === 'forest')) broadCanopy++;
        }
      });
      expect(broadCanopy).toBeGreaterThan(0);
      expect(forestPaths).toBeGreaterThan(0);
      for (const spawn of [...world.spawns, ...world.secondarySpawns!]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        expect(world.tiles[(Math.floor(spawn.y) + dy) * world.width + Math.floor(spawn.x) + dx].overlay).toBe('none');
    }
  }, 120_000);
});
