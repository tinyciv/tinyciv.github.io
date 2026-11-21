import { citySummaries } from '../../src/game/cities';
import { settlementTierForPopulation } from '../../src/game/settlement-upgrades';
import type { GameState } from '../../src/game/types';

/** Authored cities start with enough civic capacity for their completed layouts. */
export function recordPreparedSettlements(state: GameState) {
  const assigned = new Map<number, GameState['buildings'][number]>();
  const cities = citySummaries(state).map(({ palace, population, housing, food }) => {
    const requiredTier = settlementTierForPopulation(population);
    const existingTier = palace.settlementTier ?? 0;
    const settlementTier = existingTier < requiredTier ? requiredTier : existingTier;
    if (palace.settlementTier !== settlementTier) {
      palace.settlementTier = settlementTier;
      assigned.set(palace.id, palace);
    }
    return { id: palace.id, faction: palace.faction, x: palace.x, y: palace.y, population, housing, food, settlementTier };
  });
  for (const memory of state.fog?.buildings ?? []) {
    if (memory.kind !== 'palace') continue;
    const palace = assigned.get(memory.id);
    if (palace && palace.faction === memory.faction && palace.x === memory.x && palace.y === memory.y)
      memory.settlementTier = palace.settlementTier;
  }
  return cities;
}
