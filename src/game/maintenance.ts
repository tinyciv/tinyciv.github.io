import { rustEngine } from './rust-engine';
import { factionById, isHumanFaction } from './player-context';
import { stoneDefenseMultiplier } from './stone-defense';
import { GRANARY_UPKEEP } from './granaries-native';
import { THERMAL_BATH_UPKEEP } from './thermal-baths-native';
import { questEffect } from './quest-effects';
import { INSTITUTION_UPKEEP, institutionUpkeep } from './institution-native';
import { cityOwnership } from './city-ownership';
import { citiesWithDevelopedPeat, peatUpkeepMultiplier } from './resource-development';
import { structuresOf, STRUCTURE_READY } from './structure-index';
import { buildingReady, type Building, type BuildingKind, type Faction, type GameState } from './types';

/** Charges per economy interval; guard posts use their own service clock. */
export const TAX_INCOME_MULTIPLIER = .7;
export const SETTLEMENT_MAINTENANCE = rustEngine.town_upkeep(2, 0);
export const WATCHTOWER_MAINTENANCE = rustEngine.watchtower_upkeep(1);
/** Gold per economy interval for completed civic and military buildings of a
 * human realm; granaries, barracks and forums also charge rival realms.
 * Homes, farms, roads and walls are the economy itself or come in
 * hundreds of tiles, so they stay free; towers, forts, guard posts and
 * observation posts have their own rules. */
export const BUILDING_UPKEEP: Readonly<Partial<Record<BuildingKind, number>>> = {
  hospital: rustEngine.civic_building_constant(38, 2), factory: rustEngine.civic_building_constant(40, 2),
  monument: 4, ballista: 4, siegeCannon: 100, library: 3, blacksmith: 3, archeryRange: 3, stable: 3, scoutLodge: 2, healerShack: 2,
  whalingPost: 5, dock: 2, supplyDepot: 2, well: 1, bridge: .5, irrigation: .25,
  colosseum: 80, barracks: INSTITUTION_UPKEEP.barracks, forum: INSTITUTION_UPKEEP.forum, granary: GRANARY_UPKEEP, thermalBath: THERMAL_BATH_UPKEEP,
};
/** One non-capital town's upkeep when the realm holds `cities` completed towns. */
export function settlementMaintenance(cities: number, discounted = false): number {
  return rustEngine.town_upkeep(cities, Number(discounted));
}
/** Kinds whose completed buildings appear in the per-town upkeep ledger. */
export const chargesMaintenance = (kind: BuildingKind): boolean =>
  kind === 'palace' || kind === 'woodenTower' || kind === 'tower' || kind === 'guardPost' || BUILDING_UPKEEP[kind] !== undefined;

export function factoryMaintenance(supplied: boolean): number {
  return BUILDING_UPKEEP.factory! * peatUpkeepMultiplier(supplied);
}

export function factoryMaintenanceQuote(state: GameState): (factory: Building) => number {
  const peatCities = citiesWithDevelopedPeat(state);
  if (!peatCities.size) return () => BUILDING_UPKEEP.factory!;
  const ownership = cityOwnership(state);
  return factory => factoryMaintenance(peatCities.has(ownership.building(factory)?.id ?? -1));
}
const taxableFaction = (faction: Faction | undefined): faction is Faction => !!faction
  && faction.id >= 0 && faction.villageId === undefined;
const completedCivilizationBuilding = (building: Building): boolean => buildingReady(building)
  && building.villageId === undefined;

/** The oldest completed city is the capital, independent of building-array
 * order. Losing or capturing cities changes which single city is exempt. */
function cityMaintenanceBasis(state: GameState, faction: number): { capital?: number; cities: number } {
  let capital: number | undefined, cities = 0;
  for (const palace of structuresOf(state, faction, STRUCTURE_READY, 'palace')) if (palace.villageId === undefined) {
    cities++;
    if (capital === undefined || palace.id < capital) capital = palace.id;
  }
  return { capital, cities };
}

/** Quote the individual town at the current completed city count. */
export function townBuildTerms(state: GameState, faction: Faction): { upkeep: number; residents: number } {
  const { cities } = cityMaintenanceBasis(state, faction.id);
  const discounted = faction.firstTownFoundingAvailable === true;
  return {
    upkeep: cities === 0 ? 0 : settlementMaintenance(cities + 1, discounted),
    residents: rustEngine.town_founding_residents(Number(discounted)),
  };
}

/** Share the native exemption between payments, forecasts and pending towers. */
export function watchtowerMaintenance(state: GameState, faction: number, kind: 'woodenTower' | 'tower'): number {
  const base = rustEngine.watchtower_upkeep(Number(isHumanFaction(state, faction)));
  if (!base) return 0;
  return questEffect(factionById(state, faction), 0,
    base * stoneDefenseMultiplier(state, faction, kind));
}

function charge(state: GameState, building: Building, capital: number | undefined, cities: number, factoryCost?: number): number {
  if (!completedCivilizationBuilding(building)) return 0;
  if (building.kind === 'palace') {
    if (building.id === capital) return 0;
    const upkeep = settlementMaintenance(cities, building.foundingSubsidyFaction === building.faction);
    return rustEngine.exploration_town_upkeep(building.explorationUpkeepUntil ?? 0, state.time, upkeep);
  }
  if (building.kind === 'hospital') return BUILDING_UPKEEP.hospital!;
  if (building.kind === 'factory') return factoryCost ?? factoryMaintenanceQuote(state)(building);
  if (building.kind === 'siegeCannon') return BUILDING_UPKEEP.siegeCannon!;
  if (building.kind === 'woodenTower' || building.kind === 'tower') return watchtowerMaintenance(state, building.faction, building.kind);
  if (!isHumanFaction(state, building.faction)) return institutionUpkeep(building.kind);
  return BUILDING_UPKEEP[building.kind] ?? 0;
}

/** Mandatory settlement/tower maintenance only. Guard-post service is billed
 * separately, and ordinary housing/farms/infrastructure incur no charge. */
export function buildingMaintenance(state: GameState, building: Building, capital?: number, cities?: number, factoryCost?: number): number {
  const faction = factionById(state, building.faction);
  if (!taxableFaction(faction)) return 0;
  if (building.kind !== 'palace') return charge(state, building, undefined, 0, factoryCost);
  if (capital !== undefined && cities !== undefined) return charge(state, building, capital, cities);
  const basis = cityMaintenanceBasis(state, faction.id);
  return charge(state, building, capital ?? basis.capital, cities ?? basis.cities);
}

export function factionMaintenanceBreakdown(state: GameState, faction: Faction): { settlements: number; defenses: number } {
  const result = { settlements: 0, defenses: 0 };
  if (!taxableFaction(faction)) return result;
  const { capital, cities } = cityMaintenanceBasis(state, faction.id);
  let factoryQuote: ReturnType<typeof factoryMaintenanceQuote> | undefined;
  for (const building of structuresOf(state, faction.id, STRUCTURE_READY)) {
    const factoryCost = building.kind === 'factory' ? (factoryQuote ??= factoryMaintenanceQuote(state))(building) : undefined;
    result[building.kind === 'palace' ? 'settlements' : 'defenses'] += charge(state, building, capital, cities, factoryCost);
  }
  return result;
}

export function factionBuildingMaintenance(state: GameState, faction: Faction): number {
  const costs = factionMaintenanceBreakdown(state, faction);
  return costs.settlements + costs.defenses;
}
