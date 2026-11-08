import { describe, expect, it } from 'vitest';
import { soilFertility } from '../src/game/fertility';
import { FIELD_HARVEST_FOOD, fieldHarvestFood } from '../src/game/farms';
import { applySoilFertility } from '../src/world/soil';
import { type Terrain, type World } from '../src/game/types';

function fixture(terrain: Terrain): World {
  return { width: 12, height: 3, seed: 'fertility', source: 'fixture', spawns: [],
    tiles: Array.from({ length: 36 }, () => ({ terrain, overlay: 'none', elevation: .3,
      moisture: .5, food: 0, production: 0, gold: 0, variation: .5 })) };
}
describe('soil fertility and harvests', () => {
  it.each([['grassland', 1], ['plains', .75], ['desert', .5], ['tundra', .25]] as const)('uses %s base yield with or without generated soil data', (terrain, base) => {
    const world = fixture(terrain);
    expect(soilFertility(world, 5, 1)).toBe(base);
    expect(fieldHarvestFood(world, 5, 1)).toBeCloseTo(FIELD_HARVEST_FOOD * base);
    applySoilFertility(world);
    expect(soilFertility(world, 5, 1)).toBe(base);
    expect(fieldHarvestFood(world, 5, 1)).toBeCloseTo(FIELD_HARVEST_FOOD * base);
  });
  it.each(['river', 'lake'] as const)('tapers the %s bonus from 25 points to zero and keeps the distant base yield', source => {
    const world = fixture('plains');
    world.tiles[12].terrain = source;
    const expected = [1, .95, .9, .85, .8, .75, .75, .75];
    for (const generated of [false, true]) {
      if (generated) applySoilFertility(world);
      expected.forEach((fertility, i) => expect(soilFertility(world, i + 1, 1)).toBeCloseTo(fertility));
      expect(soilFertility(world, 0, 1)).toBe(0);
    }
  });
  it('does not count saltwater as freshwater or penalize forest clearing', () => {
    const world = fixture('desert');
    world.tiles[12].terrain = 'coast'; world.tiles[14].terrain = 'ocean'; world.tiles[13].overlay = 'forest';
    applySoilFertility(world);
    expect(soilFertility(world, 1, 1)).toBe(.5);
    world.tiles[13].overlay = 'none'; applySoilFertility(world);
    expect(soilFertility(world, 1, 1)).toBe(.5);
  });
});
