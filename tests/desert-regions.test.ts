import { describe, expect, it } from 'vitest';
import { applyDesertTransitions } from '../src/world/desert-regions';
import { type World } from '../src/game/types';

function flat(seed = 'desert-margin', width = 72, height = 60): World {
  return { seed, width, height, source: 'test', spawns: [], tiles: Array.from({ length: width * height }, () => ({
    terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, temperature: .7,
    food: 3, production: 1, gold: 0, variation: .5,
  })) };
}

describe('desert plains ecotone', () => {
  it('wraps a dry interior with an irregular one-to-four-cell plains belt, retaining green hinterlands', () => {
    const world = flat();
    for (let y = 0; y < world.height; y++) for (let x = 0; x < 20; x++) world.tiles[y * world.width + x].terrain = 'desert';
    const before = structuredClone(world);
    applyDesertTransitions(world);
    const widths = Array.from({ length: world.height }, (_, y) => {
      const row = world.tiles.slice(y * world.width, (y + 1) * world.width);
      expect(row[19].terrain).toBe('desert');
      expect(row[20].terrain).toBe('plains');
      expect(row[24].terrain).toBe('grassland');
      return row.filter(tile => tile.terrain === 'plains').length;
    });
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...widths)).toBeLessThanOrEqual(4);
    expect(new Set(widths).size).toBeGreaterThan(1);
    const repeat = structuredClone(before); applyDesertTransitions(repeat);
    expect(repeat).toEqual(world);
    const different = structuredClone(before); different.seed = 'a-different-desert-margin'; applyDesertTransitions(different);
    expect(different.tiles).not.toEqual(world.tiles);
    const retained = JSON.stringify(world); applyDesertTransitions(world);
    expect(JSON.stringify(world)).toBe(retained);
  });

  it('does not spread across water or convert beaches, marsh, grassy shores or authored ridge aprons', () => {
    const world = flat('protected-ground', 30, 18), tile = (x: number, y: number) => world.tiles[y * world.width + x];
    for (let y = 0; y < world.height; y++) {
      tile(3, y).terrain = 'desert';
      tile(4, y).terrain = 'river';
    }
    tile(20, 8).terrain = 'desert'; tile(20, 8).beach = true;
    tile(10, 8).terrain = 'desert';
    tile(11, 8).marsh = true;
    tile(9, 8).ridge = 1;
    tile(10, 11).terrain = 'coast';
    const preserved = [tile(4, 8), tile(20, 8), tile(11, 8), tile(9, 8), tile(10, 10)].map(t => structuredClone(t));
    applyDesertTransitions(world);
    expect([tile(4, 8), tile(20, 8), tile(11, 8), tile(9, 8), tile(10, 10)]).toEqual(preserved);
    expect(tile(5, 8).terrain).toBe('grassland');
    expect(tile(19, 8).terrain).toBe('grassland');
    expect(tile(2, 8).terrain).toBe('plains');
  });
});
