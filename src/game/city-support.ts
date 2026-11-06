import { buildingReady, buildingWidth, buildingHeight, type Building, type GameState, type Point, type Unit } from './types';

/** Palace gardens and quarters let a city establish itself before its first
 * farm or house. Further growth still needs ordinary agriculture and housing. */
export const PALACE_HOUSING = 4;
export const PALACE_FOOD_PER_CYCLE = 4;

export function palaceFoodProduction(palace: Building): number {
  return palace.kind === 'palace' && buildingReady(palace) && palace.capacity > 0 ? PALACE_FOOD_PER_CYCLE : 0;
}

function nearest(palaces: readonly Building[], point: Point): Building | undefined {
  return palaces.reduce<Building | undefined>((best, candidate) => {
    const d = (candidate.x + 1 - point.x) ** 2 + (candidate.y + 1 - point.y) ** 2;
    const before = best ? (best.x + 1 - point.x) ** 2 + (best.y + 1 - point.y) ** 2 : Infinity;
    return d < before || d === before && candidate.id < best!.id ? candidate : best;
  }, undefined);
}

/** Remove the casualty from its recruiting city before reducing the faction
 * total. Otherwise the next housing reconciliation removes residents from
 * whichever city happens to be last in the building array. */
export function recordRetinuePopulationLoss(state: GameState, unit: Unit): void {
  const faction = state.factions.find(candidate => candidate.id === unit.faction);
  if (!faction || faction.population <= 0) return;
  const palaces = state.buildings.filter(building => building.kind === 'palace' && building.faction === unit.faction && buildingReady(building));
  const home = state.buildings.find(building => building.id === unit.home && building.faction === unit.faction && buildingReady(building));
  // Retinue recruits leave the founding palace; a home-less escort also belongs
  // there, rather than to the new city it happens to be passing or defending.
  const city = home ? nearest(palaces, { x: home.x + buildingWidth(home) / 2, y: home.y + buildingHeight(home) / 2 })
    : [...palaces].sort((a, b) => a.id - b.id)[0];
  const residents = state.buildings.filter(building => building.kind === 'house' && building.faction === unit.faction
    && buildingReady(building) && (building.residents ?? 0) > 0);
  const localHouse = residents.find(house => nearest(palaces, { x: house.x + .5, y: house.y + .5 })?.id === city?.id);
  if (localHouse) localHouse.residents!--;
  else if (city && (city.unhousedResidents ?? 0) > 0) city.unhousedResidents!--;
  else if (residents.length) residents.sort((a, b) => a.id - b.id)[0].residents!--;
  else {
    const occupied = palaces.find(palace => (palace.unhousedResidents ?? 0) > 0);
    if (occupied) occupied.unhousedResidents!--;
  }
  faction.population--;
}
