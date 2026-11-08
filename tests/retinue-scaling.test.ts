import { describe, expect, it } from 'vitest';
import { desiredRetinueSize, retinueComposition } from '../src/game/archery';
import type { Faction, GameState } from '../src/game/types';

describe('population-based retinue capacity', () => {
  it.each([
    [0, 4], [19, 4], [20, 5], [99, 8], [100, 9],
    [101, 9], [149, 9], [150, 10], [200, 11], [499, 16], [500, 17],
    [501, 17], [574, 17], [575, 18], [649, 18], [650, 19], [1000, 23],
  ])('supports %i population with %i retinue members', (population, expected) => {
    expect(desiredRetinueSize({ population } as Faction)).toBe(expected);
  });

  it('uses the same tiered capacity when calculating archer and warrior targets', () => {
    const faction = { id: 0, population: 500, archerFraction: .5 } as Faction;
    const state = { factions: [faction], units: [] } as unknown as GameState;
    expect(retinueComposition(state, 0)).toEqual({
      horseArchers: 0, knights: 0, swordsmen: 0, currentHorseArchers: 0, currentKnights: 0, currentSwordsmen: 0, total: 17, archers: 9, spearmen: 0, horsemen: 0, warriors: 8, currentHorsemen: 0, currentArchers: 0, currentSpearmen: 0, training: 0,
    });
  });
});
