import { type Building, type GameState, type Point, buildingReady, buildingWidth, buildingHeight, isFarmKind } from './types';
import { CAMP_FIELD_OFFSETS, expectedFarmDelivery, fieldHarvestFoodForState, harvestFoodPerEconomyCycle, FIELD_SPOIL_SECONDS } from './farms';
import { farmWalkingDistance, farmCityQuery, palaceWalkingDistances } from './farm-travel';
import { grainStorageMultiplier } from './research-bonuses';
import { cityResidents, invalidateCitySummarySnapshot, withCitySummarySnapshot, withLiveCitySummaries, type CityResidents } from './cities';
import { ORCHARD_YIELD_MULTIPLIER } from './orchards';
import { palaceFoodProduction } from './city-support';
import { cityOwnership } from './city-ownership';
import { saltFoodConsumptionMultiplier } from './resource-development';

export interface GovernorPermissions { farms: boolean; housing: boolean; }
const DEFAULT_PERMISSIONS: Readonly<GovernorPermissions> = Object.freeze({ farms: true, housing: true });

export function governorPermissions(palace: Building): Readonly<GovernorPermissions> {
  return palace.governorPermissions ?? DEFAULT_PERMISSIONS;
}

export function setGovernorPermission(palace: Building, permission: keyof GovernorPermissions, enabled: boolean): void {
  if (palace.kind !== 'palace') return;
  palace.governorPermissions = { ...governorPermissions(palace), [permission]: enabled };
  if (permission === 'housing' && !enabled) palace.automaticHouseCredit = 0;
}

export interface CityDevelopmentNeeds {
  population: number;
  housing: number;
  foodCapacity: number;
  foodTarget: number;
  priority: 'farm' | 'house' | null;
}

interface PlanningScope {
  summaries?: Map<number, CityResidents>;
  needs: Map<Building, CityDevelopmentNeeds>;
  farmCities: Map<number, ReturnType<typeof farmCityQuery>>;
}
const planningScopes = new WeakMap<GameState, PlanningScope>();
const planningCounters = new WeakMap<GameState, { summaries: number; needs: number; hits: number }>();
const counters = (state: GameState) => {
  let value = planningCounters.get(state);
  if (!value) { value = { summaries: 0, needs: 0, hits: 0 }; planningCounters.set(state, value); }
  return value;
};
export function cityPlanningStats(state: GameState): { summaries: number; needs: number; hits: number } {
  return { ...counters(state) };
}

/** Share read-only planning work synchronously, never across simulation steps.
 * Mutation callbacks must clear the scope before another decision reads it.
 * Direct callers outside a scope always receive current scalar statistics. */
export function withCityPlanning<T>(state: GameState, operation: () => T): T {
  if (planningScopes.has(state)) return operation();
  planningScopes.set(state, { needs: new Map(), farmCities: new Map() });
  try { return withCitySummarySnapshot(state, operation); } finally { planningScopes.delete(state); }
}

export function invalidateCityPlanning(state: GameState): void {
  const scope = planningScopes.get(state);
  if (scope) { scope.summaries = undefined; scope.needs.clear(); scope.farmCities.clear(); }
  invalidateCitySummarySnapshot(state);
}

/** Order callbacks may read, mutate and read again. Keep their reads live,
 * and discard the preceding phase's estimates before planning continues. */
export function withCityPlanningMutation<T>(state: GameState, operation: () => T): T {
  const previous = planningScopes.get(state);
  planningScopes.delete(state);
  try { return withLiveCitySummaries(state, operation); }
  finally {
    if (previous) {
      // The economic transaction reconciles its own scalar inputs. Retain its
      // unaffected city aggregates even when an order makes no change; only
      // discard the planner's pending-capacity and priority estimates here.
      previous.summaries = undefined; previous.needs.clear(); previous.farmCities.clear();
      planningScopes.set(state, previous);
    }
  }
}

/** City ownership uses the same nearest-palace rule as population and yields.
 * Automatic orders must stay in their originating city's area of management. */
export function governingPalace(state: GameState, point: Point, faction: number): Building | undefined {
  return cityOwnership(state).nearest(point, faction);
}

/** Respect a cancelled/demolished farm or home without stalling other cities. */
export function pauseCityConstruction(state: GameState, building: Building): void {
  const kind = isFarmKind(building.kind) ? 'camp' : building.kind === 'house' ? 'house' : undefined;
  if (!kind) return;
  const palace = governingPalace(state, { x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 }, building.faction);
  if (palace) (palace.governorPauseUntil ??= {})[kind] = state.time + 30;
}

/** Commit the next investment to the bottleneck on births. Pending buildings
 * count, avoiding duplicate speculative orders; a modest food margin allows
 * for collection delays and the four-food cost of a birth. */
export function cityDevelopmentNeeds(state: GameState, palace: Building): CityDevelopmentNeeds {
  const scope = planningScopes.get(state), stats = counters(state), cached = scope?.needs.get(palace);
  if (cached) { stats.hits++; return cached; }
  stats.needs++;
  let summaries = scope?.summaries;
  if (!summaries) {
    stats.summaries++; summaries = new Map(cityResidents(state).map(city => [city.palace.id, city]));
    if (scope) scope.summaries = summaries;
  }
  const city = summaries.get(palace.id), ownership = cityOwnership(state);
  let farmCity = scope?.farmCities.get(palace.faction);
  if (!farmCity) { farmCity = farmCityQuery(state, palace.faction); scope?.farmCities.set(palace.faction, farmCity); }
  // Roads, walls and unrelated upgrades cannot affect these two totals. In
  // particular, do not run a nearest-palace scan for each of those buildings.
  const buildings = state.buildings.filter(building => building.hp > 0 && building.faction === palace.faction
    && (building.kind === 'house' ? ownership.building(building)?.id === palace.id
      : isFarmKind(building.kind) && farmCity(building)?.id === palace.id));
  const population = city?.population ?? 0;
  const housing = palace.capacity + buildings.filter(building => building.kind === 'house').reduce((sum, house) => sum + house.capacity, 0);
  const walking = palaceWalkingDistances(state, palace);
  const shelfLife = FIELD_SPOIL_SECONDS * grainStorageMultiplier(state.factions.find(faction => faction.id === palace.faction));
  // Budget surviving deliveries, not grain that will spoil around a long bend.
  const foodCapacity = palaceFoodProduction(palace) + population * (1 - saltFoodConsumptionMultiplier(state, palace.faction))
    + buildings.filter(building => isFarmKind(building.kind) && !building.farmSuppressed)
    .reduce((sum, farm) => sum + harvestFoodPerEconomyCycle(CAMP_FIELD_OFFSETS.reduce((food, [dx, dy]) => food + fieldHarvestFoodForState(state, farm.x + dx, farm.y + dy, farm.faction), 0))
      * (farm.orchard ? ORCHARD_YIELD_MULTIPLIER : 1)
      * expectedFarmDelivery(farmWalkingDistance(walking, state.world.width, farm.x, farm.y), farm.orchard ? FIELD_SPOIL_SECONDS : shelfLife), 0) * .9;
  // A four-person palace should begin farmland before its garden alone fills
  // those beds; otherwise its governor orders redundant housing first.
  const foodTarget = Math.max(population * 1.12, population + 4, Math.min(housing + palace.capacity, population + 8));
  const permissions = governorPermissions(palace);
  const priority = !buildingReady(palace) ? null
    : permissions.farms && foodCapacity + 1e-7 < foodTarget ? 'farm'
    : permissions.housing && foodCapacity > population ? 'house' : null;
  const result: CityDevelopmentNeeds = { population, housing, foodCapacity, foodTarget, priority };
  scope?.needs.set(palace, result);
  return result;
}
