import { describe, expect, it } from 'vitest';
import { generateWorld, terrainYields } from '../src/world/generator';
import { applyStonePlains, stonePlainsGroundMask, stonePlainsSites } from '../src/world/stone-plains';
import { type World } from '../src/game/types';

function flat(seed = 'stone-plains', width = 34, height = 28): World {
  return { width, height, seed, source: 'test', spawns: [], tiles: Array.from({ length: width * height }, () => ({
    terrain: 'grassland', overlay: 'none', elevation: .6, moisture: .5, temperature: .6,
    food: 3, production: 1, gold: 0, variation: .5, fertility: 1,
  })) };
}
function deposit(world: World, points: readonly (readonly [number, number])[]): number[] {
  const cells = points.map(([x, y]) => y * world.width + x);
  for (const cell of cells) Object.assign(world.tiles[cell], { resource: 'stone', resourceGroup: 1 });
  return cells;
}
const cluster = [[14, 10], [15, 10], [13, 11], [14, 11], [15, 11], [14, 12]] as const;
const plains = (world: World) => world.tiles.flatMap((tile, cell) => tile.terrain === 'plains' ? [cell] : []);

describe('stone deposit plains', () => {
  it('forms one connected, irregular blob with a complete first ring and a bounded second ring', () => {
    const world = flat(), stones = deposit(world, cluster);
    applyStonePlains(world);
    const painted = new Set(plains(world));
    for (const cell of stones) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      expect(painted.has(cell + dy * world.width + dx), 'complete first ring').toBe(true);
    let hasSecondRing = false;
    for (const cell of painted) {
      const distance = Math.min(...stones.map(stone => Math.max(Math.abs(cell % world.width - stone % world.width),
        Math.abs(Math.floor(cell / world.width) - Math.floor(stone / world.width)))));
      expect(distance).toBeLessThanOrEqual(2);
      hasSecondRing ||= distance === 2;
    }
    expect(hasSecondRing).toBe(true);
    const xs = [...painted].map(cell => cell % world.width), ys = [...painted].map(cell => Math.floor(cell / world.width));
    expect(painted.size).toBeLessThan((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1));
    const queue = [stones[0]], seen = new Set(queue);
    for (let head = 0; head < queue.length; head++) for (const step of [-1, 1, -world.width, world.width]) {
      const next = queue[head] + step;
      if (painted.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
    expect(seen.size).toBe(painted.size);
  });

  it('is deterministic, seed-varied and idempotent without changing resources or relief', () => {
    const world = flat(), stones = deposit(world, cluster), repeat = structuredClone(world);
    const untouched = world.tiles.map(tile => [tile.elevation, tile.overlay, tile.resource, tile.resourceGroup]);
    applyStonePlains(world); applyStonePlains(repeat); expect(repeat).toEqual(world);
    applyStonePlains(repeat); expect(repeat).toEqual(world);
    expect(world.tiles.map(tile => [tile.elevation, tile.overlay, tile.resource, tile.resourceGroup])).toEqual(untouched);
    expect(stones.every(cell => world.tiles[cell].resource === 'stone')).toBe(true);
    const shapes = new Set(Array.from({ length: 6 }, (_, index) => {
      const variant = flat(`stone-shape-${index}`); deposit(variant, cluster); applyStonePlains(variant);
      return plains(variant).join(',');
    }));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('preserves protected ground and reserves enough room around every eligible stone site', () => {
    const world = flat(), at = (x: number, y: number) => world.tiles[y * world.width + x];
    world.spawns = [{ x: 26, y: 21 }];
    Object.assign(at(15, 7), { terrain: 'river', overlay: 'ford', fordAxis: 'vertical' });
    Object.assign(at(8, 10), { ridge: 1, ridgeTier: 2 });
    Object.assign(at(20, 10), { creek: true, creekGround: 'grassland' });
    at(19, 16).beach = true; at(12, 16).marsh = true; at(7, 19).stair = 'north';
    at(5, 19).mountainPass = true; at(5, 22).farm = 1; at(8, 22).overlay = 'volcano';
    const before = structuredClone(world), ground = stonePlainsGroundMask(world), sites = stonePlainsSites(world, ground);
    for (const [x, y] of [[15, 7], [15, 8], [8, 10], [10, 12], [20, 10], [19, 10], [19, 16], [12, 16], [7, 19], [5, 19], [5, 22], [8, 22], [24, 19]])
      expect(ground[y * world.width + x], `protected ${x},${y}`).toBe(0);
    for (let cell = 0; cell < sites.length; cell++) if (sites[cell]) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        expect(ground[cell + dy * world.width + dx]).toBe(1);
    }
    deposit(world, [[14, 10], [15, 10], [14, 11], [15, 11]]); applyStonePlains(world);
    for (let cell = 0; cell < ground.length; cell++) if (!ground[cell]) expect(world.tiles[cell]).toEqual(before.tiles[cell]);
  });

  it('updates base yields and cached fertility while retaining existing bonuses and trees', () => {
    const world = flat(), [stone] = deposit(world, [[14, 10]]), forest = stone + 1;
    Object.assign(world.tiles[stone], { terrain: 'desert', biome: 'desert', palm: true, fertility: .65, food: 1, production: 2, gold: 3 });
    Object.assign(world.tiles[forest], { overlay: 'forest', treeClass: 'temperate', fertility: 1.15,
      ...terrainYields('grassland', 'forest') });
    applyStonePlains(world);
    expect(world.tiles[stone]).toMatchObject({ terrain: 'plains', biome: 'steppe', food: 3, production: 3, gold: 2 });
    expect(world.tiles[stone].palm).toBeUndefined(); expect(world.tiles[stone].fertility).toBeCloseTo(.9);
    expect(world.tiles[forest]).toMatchObject({ terrain: 'plains', overlay: 'forest', treeClass: 'temperate',
      ...terrainYields('plains', 'forest') });
    expect(world.tiles[forest].fertility).toBeCloseTo(.9);
  });

  it.each(['regional', 'mediterranean'] as const)('ships stone on plains through the %s world pipeline', style => {
    const world = style === 'mediterranean'
      ? generateWorld('MED-200BC', undefined, undefined, { style: 'mediterranean' })
      : generateWorld('CROWN');
    const stones = world.tiles.flatMap((tile, cell) => tile.resource === 'stone' ? [cell] : []);
    expect(stones.length, 'stone remains available on generated maps').toBeGreaterThanOrEqual(4);
    for (const cell of stones) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      expect(world.tiles[cell + dy * world.width + dx].terrain, `plains around stone ${cell}`).toBe('plains');
  }, 30000);
});
