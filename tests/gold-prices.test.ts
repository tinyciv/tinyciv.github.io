import { describe, expect, it } from 'vitest';
import { BUILD_COSTS } from '../src/game/simulation';
import { ORCHARD_UPGRADE_COST } from '../src/game/orchards';
import { BLACKSMITH_UPGRADE_COSTS } from '../src/game/blacksmith';
import { GUARD_POST_UPGRADE_COSTS } from '../src/game/guard-posts';

describe('gold purchase prices', () => {
  it('uses multiples of five except the palisade and growth-balanced farm and house prices', () => {
    for (const value of [...Object.entries(BUILD_COSTS).filter(([kind]) => !['palisade', 'camp', 'house'].includes(kind)).map(([,cost]) => cost.gold), ORCHARD_UPGRADE_COST,
      ...BLACKSMITH_UPGRADE_COSTS, ...GUARD_POST_UPGRADE_COSTS]) {
      expect(value % 5).toBe(0);
    }
    expect(BUILD_COSTS.palisade.gold).toBe(3.75);
    expect(BUILD_COSTS.house.gold).toBe(32.5 * 1.3);
    expect(BUILD_COSTS.camp.gold).toBe(7.5 * 1.3);
    expect(BUILD_COSTS.wall.gold - BUILD_COSTS.palisade.gold).toBe(11.25);
    for (const kind of ['road', 'bridge'] as const) expect((BUILD_COSTS[kind].gold / 2) % 5).toBe(0);
  });

  // Trade-discounted alliance prices are Rust rules: affiliation.rs
  // `village_costs_match_the_ledger` asserts they stay round within [500, 3000].
});
