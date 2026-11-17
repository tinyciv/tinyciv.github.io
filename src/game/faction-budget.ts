import { fleetUpkeep } from './warships-native';
import { stoneDefenseMultiplier } from './stone-defense';
import { factionAIDecision } from './faction-ai-profile';
import { cityTaxIncome } from './cities';
import { FORT_UPKEEP } from './forts';
import { retinueUpkeep } from './archery';
import { guardPostUpkeep, GUARD_POST_UPKEEP } from './guard-posts';
import { BUILDING_UPKEEP, settlementMaintenance, watchtowerMaintenance } from './maintenance';
import { retinueSlotUpkeep } from './retinue-purchases';
import { isRetinueMember, type Faction, type GameState } from './types';
import { enemyFactionStrength } from './enemy-strength';
import { institutionUpkeep } from './institution-native';

/** Count committed upkeep, including unfinished institutions and training. Trade and combat loot
 * are useful windfalls, but cannot guarantee the next garrison's wages. */
export function factionCommittedBudget(state: GameState, faction: Faction): { upkeep: number; surplus: number } {
  let cities = 0, upkeep = retinueSlotUpkeep(faction) + fleetUpkeep(state, faction.id), soldiers = 0;
  for (const building of state.buildings) {
    if (building.faction !== faction.id || building.hp <= 0 || building.villageId !== undefined) continue;
    if (building.kind === 'palace') cities++;
    else if (building.kind === 'woodenTower' || building.kind === 'tower') upkeep += watchtowerMaintenance(state, faction.id, building.kind);
    else if (building.kind === 'fort') upkeep += FORT_UPKEEP;
    else if (building.kind === 'siegeCannon') upkeep += BUILDING_UPKEEP.siegeCannon!;
    else if (building.kind === 'guardPost') upkeep += guardPostUpkeep(building);
    else upkeep += institutionUpkeep(building.kind);
  }
  upkeep += state.units.filter(unit => unit.faction === faction.id && (unit.kind === 'levyInfantry' || unit.kind === 'slinger') && unit.hp > 0).length * 5;
  upkeep += Math.max(0, cities - 1) * settlementMaintenance(cities);
  for (const unit of state.units) if (unit.faction === faction.id && unit.hp > 0 && isRetinueMember(unit))
    soldiers += retinueUpkeep(unit.training ? { kind: unit.training.role } : unit);
  return { upkeep, surplus: cityTaxIncome(state, faction)
    * enemyFactionStrength(state, faction.id) - soldiers - upkeep };
}

/** Leave a small positive recurring balance for repairs and further growth. */
export function canSustainFactionDefense(state: GameState, faction: Faction, kind: 'woodenTower' | 'guardPost'): boolean {
  const extra = kind === 'guardPost' ? GUARD_POST_UPKEEP : watchtowerMaintenance(state, faction.id, kind);
  const budget=factionCommittedBudget(state,faction);
  const cost=kind==='guardPost'?200:40*stoneDefenseMultiplier(state,faction.id,kind);
  return !!factionAIDecision(state,faction.id,'defenseAffordable',faction.gold,budget.upkeep,budget.surplus,cost,extra,faction.population);
}
