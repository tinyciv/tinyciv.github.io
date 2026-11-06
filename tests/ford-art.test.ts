import { describe, expect, it } from 'vitest';
import { FORD_LAYOUT_COUNT, FORD_STONES, fordCrossingAxis, fordStoneLayout } from '../src/game/ford-art';
import type { Terrain, World } from '../src/game/types';

function channel(horizontal: boolean): World {
  return {
    width: 5, height: 5, seed: 'ford-art', source: 'test', spawns: [],
    tiles: Array.from({ length: 25 }, (_, i) => ({
      terrain: (horizontal ? Math.floor(i / 5) === 2 : i % 5 === 2) ? 'river' : 'grassland',
      overlay: i === 12 ? 'ford' : 'none', elevation: .4, moisture: .5,
      food: 1, production: 1, gold: 0, variation: .2,
    })),
  };
}

describe('ford stone direction', () => {
  it('varies native rock clusters on all crossing axes without clipping or scaling them', () => {
    for (const axis of ['horizontal', 'vertical', 'diagonal'] as const) {
      const variants = Array.from({ length: FORD_LAYOUT_COUNT }, (_, index) => fordStoneLayout(axis, (index + .5) / FORD_LAYOUT_COUNT));
      expect(new Set(variants.map(variant => JSON.stringify(variant.map(({ rect, x, y }) => ({ rect, x, y }))))).size).toBe(6);
      for (const stones of variants) for (const stone of stones) {
        expect(Object.values(FORD_STONES)).toContain(stone.rect);
        expect(stone.x).toBeGreaterThanOrEqual(0); expect(stone.y).toBeGreaterThanOrEqual(0);
        expect(stone.x + stone.rect[2]).toBeLessThanOrEqual(16);
        expect(stone.y + stone.rect[3]).toBeLessThanOrEqual(16);
      }
    }
  });

  it('crosses a horizontal river from its north bank to its south bank', () => {
    expect(fordCrossingAxis(channel(true), 2, 2)).toBe('vertical');
  });

  it('crosses a vertical river from its west bank to its east bank', () => {
    expect(fordCrossingAxis(channel(false), 2, 2)).toBe('horizontal');
  });

  it('accepts different dry bank types and never treats another water kind as a bank', () => {
    const world = channel(false);
    world.tiles[11].terrain = 'desert'; world.tiles[13].terrain = 'plains';
    for (const water of ['ocean', 'coast', 'river', 'lake'] as Terrain[]) {
      world.tiles[7].terrain = water; world.tiles[17].terrain = water;
      expect(fordCrossingAxis(world, 2, 2)).toBe('horizontal');
    }
  });

  it('handles channels at map edges without wrapping into an adjacent row', () => {
    const horizontal = channel(true), vertical = channel(false);
    for (const x of [0, 4]) expect(fordCrossingAxis(horizontal, x, 2)).toBe('vertical');
    for (const y of [0, 4]) expect(fordCrossingAxis(vertical, 2, y)).toBe('horizontal');
  });
});
