import { rustEngine } from './rust-engine';
import { isHumanFaction } from './player-context';
import { stoneDefenseMultiplier } from './stone-defense';
import { GRANARY_UPKEEP } from './granaries-native';
import { THERMAL_BATH_UPKEEP } from './thermal-baths-native';
import { questEffect } from './quest-effects';
import { INSTITUTION_UPKEEP, institutionUpkeep } from './institution-native';
import { buildingReady, type Building, type BuildingKind, type Faction, type GameState } from './types';

/** Charges per economy interval; guard posts use their own service clock. */
export const TAX_INCOME_MULTIPLIER = .7;
export const SETTLEMENT_MAINTENANCE = 25;
export const WATCHTOWER_MAINTENANCE = rustEngine.watchtower_upkeep(1);
/** Each additional town raises every non-capital town's upkeep by this share,
 * so a wide realm no longer floods its treasury. */
export const CITY_UPKEEP_GROWTH = .25;
/** Gold per economy interval for completed civic and military buildings of a
 * human realm; granaries, barracks and forums also charge rival realms.
 * Homes, farms, roads and walls are the economy itself or come in
 * hundreds of tiles, so they stay free; towers, forts, guard posts and
 * observation posts have their own rules. */
export const BUILDING_UPKEEP: Readonly<Partial<Record<BuildingKind, number>>> = {
  monument: 4, ballista: 4, siegeCannon: 100, library: 3, blacksmith: 3, archeryRange: 3, stable: 3, scoutLodge: 2, healerShack: 2,
  whalingPost: 5, dock: 2, supplyDepot: 2, well: 1, bridge: .5, irrigation: .25,
  colosseum: 80, barracks: INSTITUTION_UPKEEP.barracks, forum: INSTITUTION_UPKEEP.forum, granary: GRANARY_UPKEEP, thermalBath: THERMAL_BATH_UPKEEP,
};
/** One non-capital town's upkeep when the realm holds `cities` completed towns. */
export function settlementMaintenance(cities: number): number {
  return SETTLEMENT_MAINTENANCE * (1 + CITY_UPKEEP_GROWTH * Math.max(0, cities - 2));
}
/** Kinds whose completed buildings appear in the per-town upkeep ledger. */
export const chargesMaintenance = (kind: BuildingKind): boolean =>
  kind === 'palace' || kind === 'woodenTower' || kind === 'tower' || kind === 'guardPost' || BUILDING_UPKEEP[kind] !== undefined;

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

function cityCount(state: GameState, faction: number): number {
  let count = 0;
  for (const building of state.buildings) if (building.faction === faction && building.kind === 'palace' && completedCivilizationBuilding(building)) count++;
  return count;
}

/** Share the native exemption between payments, forecasts and pending towers. */
export function watchtowerMaintenance(state: GameState, faction: number, kind: 'woodenTower' | 'tower'): number {
  const base = rustEngine.watchtower_upkeep(Number(isHumanFaction(state, faction)));
  if (!base) return 0;
  return questEffect(state.factions.find(candidate => candidate.id === faction), 0,
    base * stoneDefenseMultiplier(state, faction, kind));
}

function charge(state: GameState, building: Building, capital: number | undefined, cities: number): number {
  if (!completedCivilizationBuilding(building)) return 0;
  if (building.kind === 'palace') return rustEngine.exploration_town_upkeep(building.explorationUpkeepUntil ?? 0, state.time, building.id === capital ? 0 : settlementMaintenance(cities));
  if (building.kind === 'siegeCannon') return BUILDING_UPKEEP.siegeCannon!;
  if (building.kind === 'woodenTower' || building.kind === 'tower') return watchtowerMaintenance(state, building.faction, building.kind);
  if (!isHumanFaction(state, building.faction)) return institutionUpkeep(building.kind);
  return BUILDING_UPKEEP[building.kind] ?? 0;
}

/** Mandatory settlement/tower maintenance only. Guard-post service is billed
 * separately, and ordinary housing/farms/infrastructure incur no charge. */
export function buildingMaintenance(state: GameState, building: Building, capital?: number, cities?: number): number {
  const faction = state.factions.find(candidate => candidate.id === building.faction);
  if (!taxableFaction(faction)) return 0;
  const town = building.kind === 'palace';
  return charge(state, building, town ? capital ?? capitalId(state, faction.id) : undefined, town ? cities ?? cityCount(state, faction.id) : 0);
}

export function factionMaintenanceBreakdown(state: GameState, faction: Faction): { settlements: number; defenses: number } {
  const result = { settlements: 0, defenses: 0 };
  if (!taxableFaction(faction)) return result;
  const capital = capitalId(state, faction.id), cities = cityCount(state, faction.id);
  for (const building of state.buildings) if (building.faction === faction.id)
    result[building.kind === 'palace' ? 'settlements' : 'defenses'] += charge(state, building, capital, cities);
  return result;
}

export function factionBuildingMaintenance(state: GameState, faction: Faction): number {
  const costs = factionMaintenanceBreakdown(state, faction);
  return costs.settlements + costs.defenses;
}
