import { describe, expect, it } from 'vitest';
import { type Tile, type World } from '../src/game/types';
import { lakeAspectRatio, placeFreshwaterLakes, placeLandformLakes, type LakeShape } from '../src/world/lakes';
import type { LandformPlan } from '../src/world/landforms';
import { generateWorld } from '../src/world/generator';
import { resolveLandscapeParameters } from '../src/world/options';

function basin(width = 96, height = 80): Tile[] {
  return Array.from({ length: width * height }, (_, i) => ({ terrain: i % width < 4 || i % width >= width - 4
    || Math.floor(i / width) < 4 || Math.floor(i / width) >= height - 4 ? 'ocean' : 'grassland', overlay: 'none',
    elevation: .3, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 }));
}
describe('freshwater lake basins', () => {
  it.each([0, .4, 1.2])('fills only a compact pocket of a long geological basin at angle %s', angle => {
    const world: World = { width: 96, height: 80, tiles: basin(), seed: 'compact-fault-basin', spawns: [], source: 'test' };
    const plan: LandformPlan = { family: 'rift-lakes', provinces: [], ridges: [], valleys: [],
      basins: [{ center: { x: 48, y: 40 }, radiusX: 24, radiusY: 5, angle, lake: true }],
      elevation: new Float32Array(7680), resistance: new Float32Array(7680), uplift: new Float32Array(7680) };
    const parameters = resolveLandscapeParameters({ compactLakeAspectMax: 1.6 });
    const lakes = placeLandformLakes(world, plan, new Int16Array(7680).fill(30), parameters);
    expect(lakes).toHaveLength(1);
    expect(lakes[0].shape).toBe('compact');
    expect(lakeAspectRatio(lakes[0].cells, world.width)).toBeLessThanOrEqual(1.6);
    expect(lakes[0].cells.length).toBeGreaterThanOrEqual(25);
    expect(lakes[0].cells.every(cell => Math.hypot(cell % 96 - 48, Math.floor(cell / 96) - 40) < 10)).toBe(true);
  });

  it.each(['compact'] as LakeShape[])('creates a connected and reproducible %s basin behind a dry bank', shape => {
    const tiles = basin(), original = structuredClone(tiles);
    const lakes = placeFreshwaterLakes(tiles, 96, 80, 'lake-shapes', undefined, { count: 1 });
    expect(lakes).toHaveLength(1); expect(lakes[0].shape).toBe(shape);
    expect(placeFreshwaterLakes(original, 96, 80, 'lake-shapes', undefined, { count: 1 })).toEqual(lakes);
    expect(original).toEqual(tiles);
    const cells = new Set(lakes[0].cells), queue = [lakes[0].cells[0]], seen = new Set(queue);
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      for (const offset of [-1, 1, -96, 96]) if (cells.has(i + offset) && !seen.has(i + offset)) { seen.add(i + offset); queue.push(i + offset); }
    }
    expect(seen.size).toBe(cells.size);
    expect(cells.size).toBeGreaterThan(25);
    for (const i of cells) {
      expect(tiles[i].terrain).toBe('lake'); expect(tiles[i].lakeShape).toBe(shape);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        expect(tiles[i + dy * 96 + dx].terrain).not.toBe('ocean');
    }
    expect(lakeAspectRatio(lakes[0].cells, 96)).toBeLessThanOrEqual(2);
  });

  it('places compact freshwater basins in every production style, with shores distinct from sea', () => {
    for (const style of ['continents', 'pangaea', 'fractal'] as const) {
      // Test inland basin placement before the separate tidal-delta overlay,
      // which can extend coastal channels up to existing freshwater shores.
      const world = generateWorld('freshwater-regions', 274, 216, { style, riverDeltas: false });
      // Coastal delta ponds also use lake terrain, but are not inland basins.
      const lakes = world.tiles.filter(tile => tile.terrain === 'lake' && tile.lakeShape !== undefined);
      expect(lakes.length).toBeGreaterThan(0);
      expect(lakes.every(tile => tile.lakeShape === 'compact')).toBe(true);
      for (let i = 0; i < world.tiles.length; i++) if (world.tiles[i].terrain === 'lake' && world.tiles[i].lakeShape !== undefined) {
        expect(world.tiles[i].overlay).toBe('none');
        for (const offset of [-1, 1, -world.width, world.width]) expect(['ocean', 'coast']).not.toContain(world.tiles[i + offset].terrain);
      }
    }
  }, 120_000);

  it('creates only compact lakes and enforces their measured aspect across many seeds', () => {
    let compact = 0, snaky = 0;
    for (let seed = 0; seed < 30; seed++) {
      const lakes = placeFreshwaterLakes(basin(160, 128), 160, 128, `lake-distribution-${seed}`);
      for (const lake of lakes) {
        if (lake.shape === 'compact') { compact++; expect(lakeAspectRatio(lake.cells, 160)).toBeLessThanOrEqual(2); }
        else snaky++;
      }
    }
    expect(compact).toBeGreaterThan(70); expect(snaky).toBe(0);
  });

  it('uses density, size and aspect controls in actual basin geometry', () => {
    const small = placeFreshwaterLakes(basin(160, 128), 160, 128, 'controlled-lakes', undefined,
      { parameters: resolveLandscapeParameters({ lakeDensity: .5, lakeSize: .7, compactLakeAspectMax: 1.2 }) });
    const large = placeFreshwaterLakes(basin(160, 128), 160, 128, 'controlled-lakes', undefined,
      { parameters: resolveLandscapeParameters({ lakeDensity: 1.7, lakeSize: 1.3 }) });
    expect(large.length).toBeGreaterThan(small.length);
    expect(large.reduce((sum, lake) => sum + lake.cells.length, 0) / large.length)
      .toBeGreaterThan(small.reduce((sum, lake) => sum + lake.cells.length, 0) / small.length * 2);
    expect([...small, ...large].every(lake => lake.shape === 'compact')).toBe(true);
    for (const lake of small) expect(lakeAspectRatio(lake.cells, 160)).toBeLessThanOrEqual(1.2);
  });

  it('scatters compact lakes across suitable land instead of concentrating them in the deepest interior', () => {
    const width = 160, height = 128, signatures = new Set<string>();
    const parameters = resolveLandscapeParameters({ lakeSize: .8319, compactLakeAspectMax: 1.5773 });
    for (let seed = 0; seed < 8; seed++) {
      const lakes = placeFreshwaterLakes(basin(width, height), width, height, `scatter-${seed}`, undefined,
        { count: 8, parameters });
      expect(lakes).toHaveLength(8);
      const centers = lakes.map(lake => lake.center), xs = centers.map(point => point.x), ys = centers.map(point => point.y);
      const nearest = centers.map((point, n) => Math.min(...centers.filter((_, i) => i !== n)
        .map(other => Math.hypot(point.x - other.x, point.y - other.y))));
      // The former inland-depth ranking occupied only ~6% of this uniform
      // mainland, with a mean nearest gap of 15 tiles despite ample safe space.
      expect((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) / (width * height)).toBeGreaterThan(.4);
      expect(nearest.reduce((sum, gap) => sum + gap, 0) / nearest.length).toBeGreaterThan(35);
      const regions = new Set(centers.map(point => Math.floor(point.x / width * 4) + 4 * Math.floor(point.y / height * 4)));
      expect(regions.size).toBeGreaterThanOrEqual(6);
      for (const lake of lakes) expect(lakeAspectRatio(lake.cells, width)).toBeLessThanOrEqual(parameters.compactLakeAspectMax);
      signatures.add(JSON.stringify(centers));
    }
    expect(signatures.size).toBe(8);
  });
});
