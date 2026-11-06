import { entityStore } from './entity-store';
import { cityResidents, invalidateCitySummarySnapshot } from './cities';
import { cityOwnership } from './city-ownership';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { buildingReady, type Building, type GameState, type Unit } from './types';

/** Workers represent existing residents; hidden job slots are not extra people. */
export function civilianCityPopulations(state: GameState): Map<number, number> {
  return new Map(cityResidents(state).map(city => [city.palace.id, Math.max(0, Math.floor(city.population))]));
}
/** Levied residents keep their homes, but cannot also staff civilian jobs. */
export function civilianWorkforcePopulations(state: GameState): Map<number, number> {
  const populations = civilianCityPopulations(state);
  for (const unit of state.units) if (unit.hp > 0 && unit.kind === 'levyInfantry' && unit.levy) {
    const city = unit.levy.city !== undefined && populations.has(unit.levy.city) ? unit.levy.city : workerHomeCity(state, unit)?.id;
    if (city !== undefined) populations.set(city, Math.max(0, (populations.get(city) ?? 0) - 1));
  }
  return populations;
}
export function constructionWorkerAllowance(population: number): number {
  return population > 0 ? Math.max(1, Math.floor(population / 5)) : 0;
}
export function workerHomeCity(state: GameState, unit: Unit): Building | undefined {
  const candidate = entityStore(state).buildings.get(unit.home ?? -1);
  const home = candidate?.faction === unit.faction && buildingReady(candidate) ? candidate : undefined;
  return home?.kind === 'palace' ? home : cityOwnership(state).nearest(home ?? unit, unit.faction);
}

/** A civilian casualty belongs to its source city, even while working far away.
 * Repeat reconciliation is harmless; administrative retirement never calls this. */
export function recordCivilianCasualty(state: GameState, unit: Unit): boolean {
  if (unit.kind !== 'worker' || unit.engineer || unit.hp > 0 || unit.civilianCasualtyRecorded) return false;
  unit.civilianCasualtyRecorded = true;
  const faction = state.factions.find(candidate => candidate.id === unit.faction);
  if (!faction || faction.population <= 0) return false;
  const city = workerHomeCity(state, unit), before = city && civilianCityPopulations(state).get(city.id);
  if (city && before === 0) return false;
  const ownership = cityOwnership(state);
  const house = state.buildings.find(building => building.kind === 'house' && building.faction === unit.faction && buildingReady(building)
    && (building.residents ?? 0) > 0 && (!city || ownership.building(building)?.id === city.id));
  if (house) house.residents!--;
  else if (city && (city.unhousedResidents ?? 0) > 0) city.unhousedResidents!--;
  faction.population = Math.max(0, faction.population - 1);
  if (city && (before ?? 0) <= 1) { city.depopulated = true; city.populationGrowth = 0; }
  invalidateCitySummarySnapshot(state); invalidateSettlementDecisions(state);
  return true;
}
export function recordCivilianCasualties(state: GameState): void {
  for (const unit of state.units) if (unit.kind === 'worker' && unit.hp <= 0) recordCivilianCasualty(state, unit);
}
