import { territory, UNCLAIMED } from './borders';
import { cityOwnership } from './city-ownership';
import { cityResidents } from './cities';
import { workerHomeCity } from './civilian-population';
import { buildingReady, type Building, type GameState, type Unit } from './types';

export * from './loyalty-model';
import { initialCityLoyalty, citySupport, advanceLoyalty, LOYALTY_INTERVAL, LOYALTY_TRAUMA_HALF_LIFE } from './loyalty-model';
const ADVANCED = new Set<Building['kind']>(['library', 'blacksmith', 'archeryRange', 'stable', 'scoutLodge', 'healerShack', 'dock', 'supplyDepot', 'fort']);

/** Call only after a real civilian casualty has been charged to its city. */
export function recordLoyaltyCasualty(state: GameState, victim: Unit, attackerFaction: number): void {
  if (attackerFaction !== -2 || victim.villageId !== undefined || victim.engineer) return;
  const homeId = victim.guardCity ?? victim.levy?.city;
  const city = state.buildings.find(b => b.id === homeId && b.faction === victim.faction && buildingReady(b)) ?? workerHomeCity(state, victim);
  if (!city || state.factions.find(f => f.id === city.faction)?.villageId !== undefined) return;
  const population = (cityResidents(state).find(row => row.palace.id === city.id)?.population ?? 0) + 1;
  const loyalty = city.loyalty ??= initialCityLoyalty(state.time);
  loyalty.trauma = Math.min(75, loyalty.trauma * 2 ** (-Math.max(0, state.time - loyalty.traumaAt) / LOYALTY_TRAUMA_HALF_LIFE)
    + 240 / Math.max(20, population));
  loyalty.traumaAt = state.time;
}

/** Pressure is the fraction of a city's perimeter touching foreign claims.
 * Neutral villages exert only a quarter of ordinary civilization pressure. */
export function loyaltyBorderPressure(state: GameState, cities: readonly Building[]): Map<number, number> {
  const borders = territory(state), ownership = cityOwnership(state), eligible = new Set(cities.map(city => city.id));
  const counts = new Map<number, { total: number; foreign: number }>();
  const factions = new Map(state.factions.map(f => [f.id, f]));
  for (const edge of borders.edges) {
    for (const [owner, other] of [[edge.faction, edge.neighborFaction ?? UNCLAIMED], [edge.neighborFaction ?? UNCLAIMED, edge.faction]]) {
      if (owner < 0) continue;
      const city = ownership.nearest({ x: edge.x + .5, y: edge.y + .5 }, owner);
      if (!city || !eligible.has(city.id)) continue;
      const count = counts.get(city.id) ?? { total: 0, foreign: 0 }; count.total++;
      if (other >= 0 && other !== owner) {
        const friend = owner === 0 && factions.get(other)?.relation === 'confederated' || other === 0 && factions.get(owner)?.relation === 'confederated';
        if (!friend) count.foreign += factions.get(other)?.villageId === undefined ? 1 : .25;
      }
      counts.set(city.id, count);
    }
  }
  return new Map(cities.map(city => { const count = counts.get(city.id); return [city.id, count?.total ? count.foreign / count.total : 0]; }));
}

/** One perimeter pass and one building pass every five simulation seconds. */
export function updateCityLoyalty(state: GameState, secede: (city: Building) => void): void {
  if (state.time < (state.nextLoyaltyAt ?? 0)) return;
  const elapsed = Math.min(LOYALTY_INTERVAL, Math.max(0, state.time - (state.loyaltyUpdatedAt ?? state.time)));
  state.loyaltyUpdatedAt = state.time; state.nextLoyaltyAt = state.time + LOYALTY_INTERVAL;
  const ownership = cityOwnership(state);
  const cities = ownership.palaces.filter(city => buildingReady(city)
    && state.factions.some(f => f.id === city.faction && !f.defeated && f.villageId === undefined));
  const pressure = loyaltyBorderPressure(state, cities), byId = new Map(cities.map(city => [city.id, city]));
  for (const city of cities) {
    const loyalty = city.loyalty ??= initialCityLoyalty(state.time);
    loyalty.advanced = 0; loyalty.monument = 0; loyalty.guards = 0; loyalty.pressure = pressure.get(city.id) ?? 0;
    let nearest: number | undefined;
    for (const other of cities) if (other !== city && other.faction === city.faction) {
      const distance = Math.hypot(other.x - city.x, other.y - city.y);
      nearest = Math.min(nearest ?? Infinity, distance);
    }
    loyalty.support = citySupport(nearest);
  }
  for (const building of state.buildings) {
    if (!buildingReady(building)) continue;
    const city = ownership.building(building), loyalty = city && byId.get(city.id)?.loyalty;
    if (!loyalty) continue;
    if (ADVANCED.has(building.kind)) loyalty.advanced++;
    if (building.kind === 'monument') loyalty.monument = 1;
    if (building.kind === 'guardPost') loyalty.guards++;
  }
  for (const city of cities) {
    advanceLoyalty(city.loyalty!, elapsed, state.time);
    if (city.loyalty!.value <= 0) secede(city);
  }
}
