import { FORT_UPKEEP } from './forts';
import { ARCHER_EXTRA_UPKEEP } from './archery';
import { guardPostUpkeep, GUARD_POST_UPKEEP } from './guard-posts';
import { SETTLEMENT_MAINTENANCE, WATCHTOWER_MAINTENANCE, TAX_INCOME_MULTIPLIER } from './maintenance';
import { housingGoldBonus } from './wells';
import { retinueSlotUpkeep } from './retinue-purchases';
import { isRetinueMember, type Faction, type GameState } from './types';

/** Count committed upkeep, including unfinished defenses. Trade and combat loot
 * are useful windfalls, but cannot guarantee the next garrison's wages. */
export function factionCommittedBudget(state: GameState, faction: Faction): { upkeep: number; surplus: number } {
  let cities = 0, upkeep = retinueSlotUpkeep(faction), soldiers = 0;
  for (const building of state.buildings) {
    if (building.faction !== faction.id || building.hp <= 0 || building.villageId !== undefined) continue;
    if (building.kind === 'palace') cities++;
    else if (building.kind === 'woodenTower' || building.kind === 'tower') upkeep += WATCHTOWER_MAINTENANCE;
    else if (building.kind === 'fort') upkeep += FORT_UPKEEP;
    else if (building.kind === 'guardPost') upkeep += guardPostUpkeep(building);
  }
  upkeep += state.units.filter(unit => unit.faction === faction.id && unit.kind === 'levyInfantry' && unit.hp > 0).length * 5;
  upkeep += Math.max(0, cities - 1) * SETTLEMENT_MAINTENANCE;
  for (const unit of state.units) if (unit.faction === faction.id && unit.hp > 0 && isRetinueMember(unit))
    soldiers += .5 + (unit.kind === 'archer' ? ARCHER_EXTRA_UPKEEP : 0);
  return { upkeep, surplus: (faction.population + housingGoldBonus(state, faction.id)) * TAX_INCOME_MULTIPLIER - soldiers - upkeep };
}

/** Leave a small positive recurring balance for repairs and further growth. */
export function canSustainFactionDefense(state: GameState, faction: Faction, kind: 'woodenTower' | 'guardPost'): boolean {
  const extra = kind === 'guardPost' ? GUARD_POST_UPKEEP : WATCHTOWER_MAINTENANCE;
  return factionCommittedBudget(state, faction).surplus - extra >= Math.max(3, faction.population * .1);
}
