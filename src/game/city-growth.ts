import type { CitySummary } from './cities';
import { houseBirthProgress } from './enclosures';
import { CITY_GROWTH_SPEED } from './economy-constants';
import { type Building, type Faction, type GameState, buildingReady } from './types';

/** Scale the release allowance too, so banked or enclosed growth is not clipped. */
export const MAX_CITY_BIRTHS_PER_TICK = 10;

/** Advance every city's birth clock once per economy tick. Food stores remain shared,
 * but a city's production, credit, vacant homes and birth allowance do not.
 * The caller snapshots city yields before births, then reconciles workers
 * and housing once after all births rather than after each individual birth. */
export function advanceCityPopulation(state: GameState, faction: Faction, summaries: readonly CitySummary[],
  huntingMultiplier: number, unfed = 0): number {
  const cities = summaries.filter(city => city.palace.faction === faction.id && buildingReady(city.palace));
  const homes = new Map<number, Building[]>();
  for (const city of cities) homes.set(city.palace.id, []);
  // Only the small city list is examined for each house. Do not call
  // citySummaries/governingPalace here and repeatedly rescan every building.
  for (const house of state.buildings) {
    if (house.faction !== faction.id || house.kind !== 'house' || !buildingReady(house)
      || (house.residents ?? 0) >= house.capacity) continue;
    let nearest: CitySummary | undefined, best = Infinity;
    for (const city of cities) {
      const d = (house.x + .5 - city.palace.x - 1) ** 2 + (house.y + .5 - city.palace.y - 1) ** 2;
      if (d < best || d === best && city.palace.id < nearest!.palace.id) { nearest = city; best = d; }
    }
    if (nearest) homes.get(nearest.palace.id)!.push(house);
  }

  // Capture food eligibility before anyone spends it. An earlier city's births
  // must not change the amount of progress a later city earns this tick.
  const stocked = faction.food >= 6;
  const eligible: CitySummary[] = [];
  for (const city of cities) {
    const palace = city.palace;
    palace.populationGrowth ??= 0;
    if (city.population > 0) delete palace.depopulated;
    if (palace.depopulated && city.population <= 0) { palace.populationGrowth = 0; continue; }
    if (city.food > 0 && stocked) {
      palace.populationGrowth += CITY_GROWTH_SPEED * Math.min(2.4, .14 + city.food / 13) * huntingMultiplier;
      eligible.push(city);
    } else if (unfed > 1e-7) palace.populationGrowth = Math.max(0, palace.populationGrowth - .3);
  }

  let totalBirths = 0;
  for (const city of eligible) {
    const palace = city.palace, vacant = homes.get(palace.id)!;
    let births = 0, cursor = 0;
    while (births < MAX_CITY_BIRTHS_PER_TICK && faction.food + 1e-7 >= 4) {
      while (cursor < vacant.length && (vacant[cursor].residents ?? 0) >= vacant[cursor].capacity) cursor++;
      // Palace quarters provide the first four beds, so an empty settlement
      // can earn and retain its first residents without an existing house.
      const palaceVacancy = Math.max(0, palace.capacity - (palace.unhousedResidents ?? 0));
      const home = vacant[cursor] ?? (palaceVacancy ? palace : undefined);
      if (!home) break;
      const required = home.kind === 'house' ? houseBirthProgress(state, home) : 1;
      if (palace.populationGrowth! + 1e-9 < required) break;
      if (home.kind === 'palace') home.unhousedResidents = (home.unhousedResidents ?? 0) + 1;
      else home.residents = (home.residents ?? 0) + 1;
      faction.population++;
      faction.food = Math.max(0, faction.food - 4);
      palace.populationGrowth = Math.max(0, palace.populationGrowth! - required);
      births++; totalBirths++;
    }
  }
  return totalBirths;
}
