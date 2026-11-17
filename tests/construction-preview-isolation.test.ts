import { describe, expect, it } from 'vitest';
import { buildStroke, constructionLine, planConstruction } from '../src/game/construction';
import { denseConstructionFixture } from './helpers/construction-preview';

describe('speculative construction registration', () => {
  it.each([
    { kind: 'road' as const, y: 69, stoneX: 88 },
    { kind: 'irrigation' as const, y: 68, stoneX: 83 },
  ])('preserves live scenery while previewing $kind, then clears it on purchase', ({ kind, y, stoneX }) => {
    const state = denseConstructionFixture(), cell = y * state.world.width + stoneX;
    state.world.tiles[cell].desertStone = 2;
    const before = JSON.stringify(state);
    // Roads relocate the intervening farms in a private terrain array. The
    // gap at x=88 remains a shared tile; irrigation shares the whole world.
    // Both must avoid registration effects on these live tile objects.
    for (const endX of [99, 97]) {
      const points = constructionLine({ x: 83, y }, { x: endX, y });
      const plan = planConstruction(state, kind, points);
      expect(plan).toMatchObject({ ok: true, skipped: 0 });
      expect(plan.tiles).toContainEqual({ x: stoneX, y });
      expect(state.world.tiles[cell].desertStone).toBe(2);
      expect(JSON.stringify(state)).toBe(before);
    }
    const result = buildStroke(state, kind, constructionLine({ x: 83, y }, { x: 97, y }));
    expect(result).toMatchObject({ ok: true, skipped: 0 });
    expect(state.world.tiles[cell].desertStone).toBeUndefined();
  });
});
