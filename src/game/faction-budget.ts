import { fleetUpkeep } from './warships-native';
import { stoneDefenseMultiplier } from './stone-defense';
import { citiesWithDevelopedPeat, marbleConstructionMultiplier } from './resource-development';
import { factionAIDecision } from './faction-ai-profile';
import { cityTaxIncome } from './cities';
import { fortMaintenance } from './forts';
import { fieldCannonUpkeep } from './field-cannons-native';
import { retinueUpkeep } from './archery';
import { guardPostUpkeep, GUARD_POST_UPKEEP } from './guard-posts';
import { BUILDING_UPKEEP, factoryMaintenanceQuote, SETTLEMENT_MAINTENANCE, watchtowerMaintenance } from './maintenance';
import { retinueSlotUpkeep } from './retinue-purchases';
import { isRetinueMember, type Building, type Faction, type GameState } from './types';
import { enemyFactionStrength } from './enemy-strength';
import { institutionUpkeep } from './institution-native';
import { entityStore } from './entity-store';
import { structuresOf, STRUCTURE_ALIVE } from './structure-index';

/** Count committed upkeep, including unfinished institutions and training. Trade and combat loot
 * are useful windfalls, but cannot guarantee the next garrison's wages. */
export function factionCommittedBudget(state: GameState, faction: Faction) {
  let cities = 0, upkeep = retinueSlotUpkeep(faction) + fleetUpkeep(state, faction.id), soldiers = 0;
  let factoryQuote: ReturnType<typeof factoryMaintenanceQuote> | undefined;
  for (const building of structuresOf(state, faction.id, STRUCTURE_ALIVE)) {
    if (building.villageId !== undefined) continue;
    if (building.kind === 'palace') {
      cities++;
    } else if (building.kind === 'woodenTower' || building.kind === 'tower') upkeep += watchtowerMaintenance(state, faction.id, building.kind);
    else if (building.kind === 'fort') upkeep += fortMaintenance(building);
    else if (building.kind === 'siegeCannon') upkeep += BUILDING_UPKEEP.siegeCannon!;
    else if (building.kind === 'guardPost') upkeep += guardPostUpkeep(building);
    else if (building.kind === 'factory') upkeep += (factoryQuote ??= factoryMaintenanceQuote(state))(building);
    else upkeep += institutionUpkeep(building.kind);
  }
  let peatCities: ReadonlySet<number> | undefined;
  for (const unit of entityStore(state).units.queryFaction('soldier', faction.id)) {
    if (unit.hp <= 0) continue;
    if (unit.kind === 'levyInfantry' || unit.kind === 'slinger') upkeep += 5;
    if (!isRetinueMember(unit)) continue;
    const role = unit.training?.role ?? unit.kind;
    if (role === 'fieldCannon') {
      upkeep += unit.kind === 'fieldCannon'
        ? fieldCannonUpkeep(state, unit, peatCities ??= citiesWithDevelopedPeat(state)) : retinueUpkeep({ kind: role });
    } else soldiers += retinueUpkeep({ kind: role, ranger: unit.ranger });
  }
  upkeep += Math.max(0, cities - 1) * SETTLEMENT_MAINTENANCE;
  upkeep += soldiers;
  const taxes = cityTaxIncome(state, faction) * enemyFactionStrength(state, faction.id);
  return { upkeep, surplus: taxes - upkeep, taxes, retinueWages: soldiers };
}

/** Leave a small positive recurring balance for repairs and further growth. */
export function canSustainFactionDefense(state: GameState, faction: Faction, kind: 'woodenTower' | 'guardPost'): boolean {
  const extra = kind === 'guardPost' ? GUARD_POST_UPKEEP : watchtowerMaintenance(state, faction.id, kind);
  const budget=factionCommittedBudget(state,faction);
  const cost = (kind === 'guardPost' ? 200 : 40 * stoneDefenseMultiplier(state, faction.id, kind))
    * marbleConstructionMultiplier(state, faction.id);
  return !!factionAIDecision(state,faction.id,'defenseAffordable',faction.gold,budget.upkeep,budget.surplus,cost,extra,faction.population);
}
