import { buildingReady, type Building, type Faction, type GameState } from './types';

/** Charges per economy interval; guard posts use their own service clock. */
export const TAX_INCOME_MULTIPLIER = .7;
export const SETTLEMENT_MAINTENANCE = 37.5;
export const WATCHTOWER_MAINTENANCE = 5;

const taxableFaction = (faction: Faction | undefined): faction is Faction => !!faction
  && faction.id >= 0 && faction.villageId === undefined;
const completedCivilizationBuilding = (building: Building): boolean => buildingReady(building)
  && building.villageId === undefined;

/** The oldest completed city is the capital, independent of building-array
 * order. Losing or capturing cities changes which single city is exempt. */
function capitalId(state: GameState, faction: number): number | undefined {
  let oldest: number | undefined;
  for (const building of state.buildings) if (building.faction === faction && building.kind === 'palace'
    && completedCivilizationBuilding(building) && (oldest === undefined || building.id < oldest)) oldest = building.id;
  return oldest;
}

function charge(building: Building, capital: number | undefined): number {
  if (!completedCivilizationBuilding(building)) return 0;
  if (building.kind === 'palace') return building.id === capital ? 0 : SETTLEMENT_MAINTENANCE;
  if (building.kind === 'woodenTower' || building.kind === 'tower') return WATCHTOWER_MAINTENANCE;
  return 0;
}

/** Mandatory settlement/tower maintenance only. Guard-post service is billed
 * separately, and ordinary housing/farms/infrastructure incur no charge. */
export function buildingMaintenance(state: GameState, building: Building): number {
  const faction = state.factions.find(candidate => candidate.id === building.faction);
  if (!taxableFaction(faction)) return 0;
  return charge(building, building.kind === 'palace' ? capitalId(state, faction.id) : undefined);
}

export function factionMaintenanceBreakdown(state: GameState, faction: Faction): { settlements: number; defenses: number } {
  const result = { settlements: 0, defenses: 0 };
  if (!taxableFaction(faction)) return result;
  const capital = capitalId(state, faction.id);
  for (const building of state.buildings) if (building.faction === faction.id)
    result[building.kind === 'palace' ? 'settlements' : 'defenses'] += charge(building, capital);
  return result;
}

export function factionBuildingMaintenance(state: GameState, faction: Faction): number {
  const costs = factionMaintenanceBreakdown(state, faction);
  return costs.settlements + costs.defenses;
}
