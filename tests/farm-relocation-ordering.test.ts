import { describe, expect, it, vi } from 'vitest';
import * as ordering from '../src/game/ordered-distance-cells';
import { planFarmRelocation } from '../src/game/farm-relocation';
import { denseConstructionFixture } from './helpers/construction-preview';
import type { GameState } from '../src/game/types';

describe('lazy farm relocation candidates', () => {
  it('chooses the same replacement plots as the complete sorted travel field', () => {
    const initial = denseConstructionFixture();
    const choices = (state: GameState) => {
      const palace = state.buildings.find(building => building.kind === 'palace')!;
      const farms = state.buildings.filter(building => building.kind === 'camp');
      return [0, 30, 99, 150].flatMap(index => {
        const farm = farms[index], reservedTiles = new Set<number>();
        for (let x = farm.x - 1; x <= farm.x + 2; x++) reservedTiles.add(farm.y * state.world.width + x);
        return [true, false].map(road => planFarmRelocation(state, palace, farm, farm, undefined,
          { road, wall: true, reservedTiles }));
      });
    };
    const baseline = vi.spyOn(ordering, 'orderedDistanceCells').mockImplementation(function* (distances) {
      yield* Array.from({ length: distances.length }, (_, cell) => cell)
        .sort((a, b) => distances[a] - distances[b] || a - b);
    });
    let expected: ReturnType<typeof choices>;
    try { expected = choices(structuredClone(initial)); } finally { baseline.mockRestore(); }
    expect(expected.some(plan => plan !== undefined)).toBe(true);
    expect(choices(structuredClone(initial))).toEqual(expected);
  });
});
