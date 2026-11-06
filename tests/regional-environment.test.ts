import { describe, expect, it } from 'vitest';
import { applyWorldClimate, climateBiome, prevailingWind } from '../src/world/climate';
import { applySoilFertility } from '../src/world/soil';
import { assignRegionalResources } from '../src/world/resources';
import { fieldHarvestFood } from '../src/game/farms';
import { WATER, type World } from '../src/game/types';

function map(seed = 'regional-environment', width = 100, height = 80): World {
  return { width, height, seed, source: 'fixture', spawns: [], tiles: Array.from({ length: width * height }, () => ({
    terrain: 'grassland', overlay: 'none', elevation: .25, moisture: .55,
    food: 3, production: 1, gold: 0, variation: .5,
  })) };
}
const average = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

describe('geography-driven climate and resources', () => {
  it('cools high ground, rains on the windward face, and dries the lee of the same range', () => {
    const flat = map(), mountain = structuredClone(flat), wind = prevailingWind(flat.seed);
    for (let y = 0; y < flat.height; y++) {
      for (let x = 0; x < flat.width; x++) {
        const upstream = wind === 1 ? x : flat.width - 1 - x;
        if (upstream < 10) for (const world of [flat, mountain])
          Object.assign(world.tiles[y * world.width + x], { terrain: 'ocean', elevation: 0 });
        if (upstream >= 40 && upstream <= 44) mountain.tiles[y * flat.width + x].elevation = .9;
      }
    }
    applyWorldClimate(flat); applyWorldClimate(mountain);
    const windward: number[] = [], lee: number[] = [], cooling: number[] = [];
    for (let y = 0; y < flat.height; y++) {
      const index = (upstream: number) => y * flat.width + (wind === 1 ? upstream : flat.width - 1 - upstream);
      windward.push(mountain.tiles[index(40)].rainfall! - flat.tiles[index(40)].rainfall!);
      cooling.push(flat.tiles[index(42)].temperature! - mountain.tiles[index(42)].temperature!);
      for (let x = 45; x < 55; x++) lee.push(flat.tiles[index(x)].rainfall! - mountain.tiles[index(x)].rainfall!);
    }
    expect(average(windward)).toBeGreaterThan(.20);
    expect(average(lee)).toBeGreaterThan(.12);
    expect(average(cooling)).toBeGreaterThan(.18);
  });

  it('moderates coastal temperature and transports ocean moisture inland reproducibly', () => {
    const inland = map(), coastal = structuredClone(inland), wind = prevailingWind(inland.seed);
    for (let y = 0; y < inland.height; y++) for (let x = 0; x < 15; x++) {
      const cell = y * inland.width + (wind === 1 ? x : inland.width - 1 - x);
      Object.assign(coastal.tiles[cell], { terrain: 'ocean', elevation: 0 });
    }
    applyWorldClimate(inland); applyWorldClimate(coastal);
    const at = (world: World, x: number, y: number) => world.tiles[y * world.width + (wind === 1 ? x : world.width - 1 - x)];
    expect(at(coastal, 16, 0).temperature).toBeGreaterThan(at(inland, 16, 0).temperature!);
    expect(at(coastal, 25, 35).rainfall).toBeGreaterThan(at(inland, 25, 35).rainfall! + .07);
    const before = structuredClone(coastal);
    applyWorldClimate(coastal);
    expect(coastal).toEqual(before);
    for (const tile of coastal.tiles) for (const value of [tile.temperature!, tile.rainfall!, tile.moisture]) {
      expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('distinguishes cold, wet, dry, and high climates without introducing unsupported ground art', () => {
    expect(climateBiome(.1, .7, .3)).toBe('tundra');
    expect(climateBiome(.25, .55, .85)).toBe('alpine');
    expect(climateBiome(.3, .55, .3)).toBe('taiga');
    expect(climateBiome(.8, .8, .3)).toBe('rainforest');
    expect(climateBiome(.8, .36, .3)).toBe('savanna');
    expect(climateBiome(.5, .36, .3)).toBe('steppe');
    expect(climateBiome(.8, .15, .3)).toBe('desert');
    const world = map(); applyWorldClimate(world);
    expect(world.tiles.every(tile => ['grassland', 'plains', 'desert'].includes(tile.terrain))).toBe(true);
  });

  it('gives alluvial soil larger harvests and cold slopes smaller harvests while retaining fixture yields', () => {
    const world = map(), bank = 40 * world.width + 25, upland = 40 * world.width + 70;
    expect(fieldHarvestFood(world, 25, 40)).toBe(fieldHarvestFood(world, 70, 40));
    for (let y = 0; y < world.height; y++) world.tiles[y * world.width + 24].terrain = 'river';
    Object.assign(world.tiles[upland], { temperature: .12, elevation: .9, biome: 'alpine' });
    applySoilFertility(world);
    expect(world.tiles[bank].fertility).toBeGreaterThan(world.tiles[upland].fertility! + .3);
    expect(fieldHarvestFood(world, 25, 40)).toBeGreaterThan(fieldHarvestFood(world, 70, 40) * 1.3);
    const soil = world.tiles[bank].fertility;
    world.tiles[bank].overlay = 'forest'; applySoilFertility(world);
    expect(world.tiles[bank].fertility).toBe(soil);
    expect(world.tiles[40 * world.width + 24].fertility).toBe(0);
  });

  it('uses freshwater saturation for wetlands and geology/habitat for clustered deposits', () => {
    const world = map('resource-habitats', 160, 120);
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const tile = world.tiles[y * world.width + x];
      Object.assign(tile, { moisture: x < 60 ? .48 : .8, temperature: .6, elevation: x > 100 ? .8 : .25 });
      if (x < 8) tile.terrain = 'coast';
      if (x === 80) tile.terrain = 'river';
    }
    applySoilFertility(world); assignRegionalResources(world);
    expect(world.tiles.some(tile => tile.biome === 'wetland')).toBe(true);
    const resources = world.tiles.flatMap((tile, i) => tile.resource ? [{ tile, i }] : []);
    expect(resources.length).toBeGreaterThan(40);
    for (const { tile, i } of resources) {
      const x = i % world.width;
      if (tile.resource === 'fish') expect(WATER.has(tile.terrain)).toBe(true);
      else expect(WATER.has(tile.terrain)).toBe(false);
      if (tile.resource === 'clay') expect(Math.abs(x - 80)).toBeLessThanOrEqual(3);
      if (tile.resource === 'salt') expect(x).toBeLessThanOrEqual(9);
      if (tile.resource === 'stone' || tile.resource === 'iron') expect(x).toBeGreaterThan(100);
    }
    const adjacent = resources.filter(({ i, tile }) => world.tiles[i + 1]?.resource === tile.resource || world.tiles[i + world.width]?.resource === tile.resource);
    expect(adjacent.length / resources.length).toBeGreaterThan(.5);
    const before = structuredClone(world); assignRegionalResources(world); expect(world).toEqual(before);
  });
});
