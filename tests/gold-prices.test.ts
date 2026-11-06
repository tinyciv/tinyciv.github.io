import { describe, expect, it } from 'vitest';
import { BUILD_COSTS } from '../src/game/simulation';
import { ORCHARD_UPGRADE_COST } from '../src/game/orchards';
import { BLACKSMITH_UPGRADE_COSTS } from '../src/game/blacksmith';
import { GUARD_POST_UPGRADE_COSTS } from '../src/game/guard-posts';
import { villageAllianceCost } from '../src/game/villages';

describe('round gold purchase prices', () => {
  it('uses multiples of five for every building and repeatable upgrade', () => {
    for (const value of [...Object.values(BUILD_COSTS).map(cost => cost.gold), ORCHARD_UPGRADE_COST,
      ...BLACKSMITH_UPGRADE_COSTS, ...GUARD_POST_UPGRADE_COSTS]) {
      expect(value % 5).toBe(0);
    }
    expect(BUILD_COSTS.house.gold).toBe(65);
    expect(BUILD_COSTS.camp.gold).toBe(15);
    expect(BUILD_COSTS.wall.gold - BUILD_COSTS.palisade.gold).toBe(25);
    for (const kind of ['road', 'bridge'] as const) expect((BUILD_COSTS[kind].gold / 2) % 5).toBe(0);
  });

  it('keeps trade-discounted alliance prices round without going below the minimum', () => {
    for (const total of [0, 12.2, 123, 1763, 24999, 100000]) {
      const price = villageAllianceCost({ tradeGoldByFaction: { 0: total } });
      expect(price % 5).toBe(0); expect(price).toBeGreaterThanOrEqual(500);
      expect(price).toBeLessThanOrEqual(3000);
    }
  });
});
