import { IRRIGATION_GOLD } from './irrigation';
import { HOUSE_BUILD_GOLD } from './housing-config';
import { isHumanFaction } from './player-context';
import { buildingWithinBorders } from './border-placement';
import { territory } from './borders';
import { cityDevelopmentNeeds, governorPermissions, withCityPlanning, withCityPlanningMutation } from './governor';
import { planHouseSite } from './housing';
import { houseLevel, WELL_POPULATION_REQUIREMENT, WELL_RADIUS } from './wells';
import { areArchersUnlocked, areHorsemenUnlocked, isBuildingUnlocked, researchStatus } from './research';
import { type Building, type Faction, type GameState, type ResearchBranchId, buildingReady, distance } from './types';
import { SimulationEvents } from './simulation-events';
import { entityStore } from './entity-store';
import { cityOwnership } from './city-ownership';
import { FARM_BUILD_GOLD } from './farm-config';
import { canSustainFactionDefense, factionCommittedBudget } from './faction-budget';
import { factionIrrigationSites } from './faction-irrigation';
import { HEALER_SHACK_COST } from './healer-shack';
import { FORT_GOLD, FORT_UPKEEP } from './forts';
import { SUPPLY_DEPOT_COST } from './supply-train';

export type DevelopmentKind = 'well' | 'monument' | 'library' | 'guardPost' | 'archeryRange' | 'blacksmith' | 'irrigation' | 'healerShack' | 'stable' | 'fort' | 'supplyDepot';
export interface DevelopmentOrders {
  farms(faction: Faction, palace: Building): void;
  houses(faction: Faction, elapsedSeconds: number, palace: Building): void;
  validate(faction: number, kind: DevelopmentKind, x: number, y: number): { ok: boolean };
  build(faction: number, kind: DevelopmentKind, x: number, y: number): { ok: boolean };
}
const PLAN_SECONDS = 6;
const PLAYER_PLAN_SECONDS = 30;
const LIBRARY_COST = 200;
const productiveKinds = ['camp', 'house', 'well', 'monument', 'library', 'guardPost', 'archeryRange', 'blacksmith', 'healerShack', 'stable', 'fort', 'supplyDepot'];
interface CityPlan {
  palace: Building; faction: Faction; interval: number; factionOrder: number; order: number; seen: number;
}
interface DevelopmentClock {
  world: GameState['world']; time: number; generation: number;
  plans: Map<Building, CityPlan>; events: SimulationEvents<Building, CityPlan>;
}
const developmentClocks = new WeakMap<GameState, DevelopmentClock>();

/** Reconcile the small maintained palace group, then return only due cities.
 * Original faction/building order resolves simultaneous spending deterministically. */
function dueCityPlans(state: GameState): CityPlan[] {
  let clock = developmentClocks.get(state);
  if (!clock || clock.world !== state.world || clock.time > state.time) {
    clock = { world: state.world, time: state.time, generation: 0, plans: new Map(), events: new SimulationEvents() };
    developmentClocks.set(state, clock);
  }
  clock.time = state.time;
  const generation = ++clock.generation, palaces = entityStore(state).buildings.query('palace');
  for (let order = 0; order < palaces.length; order++) {
    const palace = palaces[order], factionOrder = state.factions.findIndex(faction => faction.id === palace.faction);
    const faction = state.factions[factionOrder];
    if (!faction || faction.id < 0 || faction.villageId !== undefined || faction.defeated || faction.relation === 'confederated' || palace.hp <= 0) continue;
    if (!buildingReady(palace)) { delete palace.governorNextPlanAt; continue; }
    const interval = isHumanFaction(state, faction.id) ? PLAYER_PLAN_SECONDS : PLAN_SECONDS;
    palace.governorNextPlanAt ??= state.time + interval;
    let plan = clock.plans.get(palace);
    if (!plan) { plan = { palace, faction, interval, factionOrder, order, seen: generation }; clock.plans.set(palace, plan); }
    plan.faction = faction; plan.interval = interval; plan.factionOrder = factionOrder; plan.order = order; plan.seen = generation;
    clock.events.schedule(palace, palace.governorNextPlanAt, plan);
  }
  for (const [palace, plan] of clock.plans) if (plan.seen !== generation) { clock.plans.delete(palace); clock.events.cancel(palace); }
  return clock.events.takeDue(state.time + 1e-7).sort((a, b) => a.factionOrder - b.factionOrder || a.order - b.order);
}

function needsLibrary(state: GameState, faction: Faction): boolean {
  return !entityStore(state).buildings.query('library').some(building => building.faction === faction.id && building.hp > 0);
}

/** Establish the opening food supply before banking research gold. A full city
 * can pause new housing safely; a real food shortfall must still be corrected. */
function canSaveForLibrary(state: GameState, faction: Faction, palace: Building): boolean {
  const needs = cityDevelopmentNeeds(state, palace);
  return needs.foodCapacity >= Math.max(12, needs.population * 1.05)
    && needs.housing >= needs.population && faction.food >= Math.max(12, faction.population * 1.25);
}

/** When beds are full, real food reserves can bridge a small production margin.
 * Do not buy another safety-margin farm while food is accumulating and births
 * have nowhere to live. A genuine food deficit still takes precedence. */
export function factionCityDevelopmentPriority(state: GameState, palace: Building): 'farm' | 'house' | null {
  const needs = cityDevelopmentNeeds(state, palace), faction = state.factions.find(candidate => candidate.id === palace.faction);
  if (palace.faction > 0 && !isHumanFaction(state, palace.faction) && governorPermissions(palace).housing && needs.housing <= needs.population + 2
    && needs.foodCapacity > needs.population && (faction?.food ?? 0) >= Math.max(12, needs.population * 2)) return 'house';
  return needs.priority;
}

/** Pending buildings already count in the supply/capacity estimates. Keep this
 * separate from research savings so paying a project never reserves it twice. */
function productiveDevelopmentReserve(state: GameState, faction: Faction): number {
  let reserve = 0;
  const palaces = entityStore(state).buildings.query('palace');
  for (const palace of palaces) {
    if (palace.faction !== faction.id || !buildingReady(palace)) continue;
    const priority = factionCityDevelopmentPriority(state, palace);
    if (priority === 'farm') reserve += FARM_BUILD_GOLD * 4;
    else if (priority === 'house') reserve += HOUSE_BUILD_GOLD;
  }
  if (faction.id > 0 && !isHumanFaction(state, faction.id) && needsLibrary(state, faction) && palaces.some(palace => palace.faction === faction.id
    && buildingReady(palace) && canSaveForLibrary(state, faction, palace))) reserve += LIBRARY_COST;
  return reserve;
}

/** AI and human factions use the same cheapest-eligible automatic queue. */
export function factionResearchTarget(state: GameState, faction: Faction): ResearchBranchId | undefined {
  const status = researchStatus(state, faction.id); return status.completed ? undefined : status.focus;
}
/** Research is withheld from receipts, so no second treasury reservation is needed. */
export function factionDevelopmentReserve(state: GameState, faction: Faction): number {
  return withCityPlanning(state, () => productiveDevelopmentReserve(state, faction) + factionCommittedBudget(state, faction).upkeep);
}

function ownedByCity(state: GameState, building: Building, palace: Building): boolean {
  return building.faction === palace.faction && building.hp > 0
    && cityOwnership(state).building(building)?.id === palace.id;
}

/** A 50-gold well adds two beds to every covered level-one house, often much
 * cheaper than buying further homes. Pending wells must not trigger duplicates. */
function improveHousing(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): boolean {
  if (faction.population < WELL_POPULATION_REQUIREMENT || faction.gold < 50
    || (faction.constructionPauseUntil?.well ?? 0) > state.time) return false;
  const owned = state.buildings.filter(building => (building.kind === 'house' || building.kind === 'well')
    && ownedByCity(state, building, palace));
  const houses = owned.filter(building => building.kind === 'house' && buildingReady(building) && houseLevel(building) < 2);
  if (houses.length < 3) return false;
  const wells = owned.filter(building => building.kind === 'well');
  if (wells.some(well => well.construction && houses.filter(house => distance(house, well) <= WELL_RADIUS).length >= 3)) return true;
  const uncovered = houses.filter(house => !wells.some(well => distance(well, house) <= WELL_RADIUS));
  let best: { x: number; y: number; score: number } | undefined;
  for (let y = Math.max(0, palace.y - 9); y <= Math.min(state.world.height - 1, palace.y + 10); y++) {
    for (let x = Math.max(0, palace.x - 9); x <= Math.min(state.world.width - 1, palace.x + 10); x++) {
      const point = { x, y }, count = uncovered.filter(house => distance(house, point) <= WELL_RADIUS).length;
      if (count < 3 || !orders.validate(faction.id, 'well', x, y).ok) continue;
      const score = count * 10 - distance(point, palace);
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return !!best && orders.build(faction.id, 'well', best.x, best.y).ok;
}

function expandClaim(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): void {
  if (!isBuildingUnlocked(faction, 'monument') || faction.gold < 325 || faction.population < 16 || (faction.constructionPauseUntil?.monument ?? 0) > state.time
    || state.buildings.some(building => building.kind === 'monument' && ownedByCity(state, building, palace))) return;
  // Territory should be the actual obstacle: a site exists without a border
  // restriction, but no otherwise suitable site is currently claimed.
  const canReplace = () => false;
  // One synchronous search uses one claim snapshot. Revalidating every source
  // building for every candidate makes a large city's site search quadratic.
  const borders = territory(state);
  if (planHouseSite(state, palace, canReplace, point => buildingWithinBorders(state, 'house', point.x, point.y, faction.id, borders))
    || !planHouseSite(state, palace, canReplace)) return;
  let best: { x: number; y: number; score: number } | undefined;
  for (let y = Math.max(0, palace.y - 10); y <= Math.min(state.world.height - 1, palace.y + 10); y++) {
    for (let x = Math.max(0, palace.x - 10); x <= Math.min(state.world.width - 1, palace.x + 10); x++) {
      if (!orders.validate(faction.id, 'monument', x, y).ok) continue;
      const score = distance({ x, y }, palace);
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  if (best) orders.build(faction.id, 'monument', best.x, best.y);
}

function buildCityUpgrade(state: GameState, faction: Faction, palace: Building, kind: DevelopmentKind, orders: DevelopmentOrders): boolean {
  if (!isBuildingUnlocked(faction, kind) || (faction.constructionPauseUntil?.[kind] ?? 0) > state.time) return false;
  const options: { x: number; y: number }[] = [];
  for (let y = Math.max(0, palace.y - 7); y <= Math.min(state.world.height - 1, palace.y + 8); y++)
    for (let x = Math.max(0, palace.x - 7); x <= Math.min(state.world.width - 1, palace.x + 8); x++) options.push({ x, y });
  options.sort((a, b) => distance(a, palace) - distance(b, palace) || a.y - b.y || a.x - b.x);
  for (const point of options) if (orders.validate(faction.id, kind, point.x, point.y).ok
    && orders.build(faction.id, kind, point.x, point.y).ok) return true;
  return false;
}

/** A single faction library is enough to advance the shared tree. Once the
 * opening farms are ready, save for it instead of endlessly buying spare beds. */
function establishResearch(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): boolean {
  if (!needsLibrary(state, faction) || !canSaveForLibrary(state, faction, palace)
    || (faction.constructionPauseUntil?.library ?? 0) > state.time) return false;
  const needs = cityDevelopmentNeeds(state, palace);
  if (governorPermissions(palace).housing && needs.housing - needs.population <= needs.housing * .25
    && improveHousing(state, faction, palace, orders)) return true;
  if (faction.gold < LIBRARY_COST + factionCommittedBudget(state, faction).upkeep) return true;
  return buildCityUpgrade(state, faction, palace, 'library', orders);
}

/** Research spends the faction's surplus after city work, keeping the next
 * productive purchase for every city and one economy tick of food in reserve.
 * The shared paid flag makes several palace planners safe to call this. */
function developUnlockedBuildings(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): void {
  const owned = state.buildings.filter(building => building.faction === faction.id && building.hp > 0);
  if (areArchersUnlocked(faction) && owned.some(building => building.kind === 'archeryRange' && buildingReady(building)))
    faction.archerFraction = .25;
  if (areHorsemenUnlocked(faction) && owned.some(building => building.kind === 'stable' && buildingReady(building))) faction.horsemanFraction = .25;
  if (owned.filter(building => building.construction && productiveKinds.includes(building.kind)
    && ownedByCity(state, building, palace)).length >= 2) return;
  const reserve = factionDevelopmentReserve(state, faction);
  for (const [kind, cost] of [['guardPost', 200], ['archeryRange', 400], ['blacksmith', 200], ['healerShack', HEALER_SHACK_COST], ['stable', 350],
    ['supplyDepot', SUPPLY_DEPOT_COST], ['fort', FORT_GOLD]] as const) {
    if (!isBuildingUnlocked(faction, kind) || faction.gold < cost + reserve
      || kind === 'guardPost' && !canSustainFactionDefense(state, faction, kind)
      || kind === 'fort' && factionCommittedBudget(state, faction).surplus < FORT_UPKEEP + Math.max(5, faction.population * .1)
      || owned.some(building => building.kind === kind && (kind !== 'guardPost' && kind !== 'healerShack' && kind !== 'fort' || ownedByCity(state, building, palace)))) continue;
    if (buildCityUpgrade(state, faction, palace, kind, orders)) return;
  }
}

/** Spend less than the equivalent new farmland, then let the normal governor
 * fill the freshly irrigated neighborhood before expanding farther away. */
function improveFarms(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): boolean {
  if (!isBuildingUnlocked(faction, 'irrigation') || faction.gold < IRRIGATION_GOLD + factionCommittedBudget(state, faction).upkeep
    || (faction.constructionPauseUntil?.irrigation ?? 0) > state.time) return false;
  for (const point of factionIrrigationSites(state, palace)) if (orders.validate(faction.id, 'irrigation', point.x, point.y).ok
    && orders.build(faction.id, 'irrigation', point.x, point.y).ok) return true;
  return false;
}

/** A nearly eligible well can avoid an expensive housing dead end. Do not
 * consume its last 50 gold on a food safety margin while existing deliveries
 * already support the next residents. Real food shortages still get farms. */
function savingForWell(state: GameState, faction: Faction, palace: Building): boolean {
  if (faction.population < WELL_POPULATION_REQUIREMENT - 4 || !governorPermissions(palace).housing
    || faction.food < faction.population * 2 || factionCommittedBudget(state, faction).surplus >= 0) return false;
  const needs = cityDevelopmentNeeds(state, palace);
  if (needs.foodCapacity < needs.population + 2) return false;
  const candidates = entityStore(state).buildings.query('palace').filter(city => city.faction === faction.id && buildingReady(city));
  const nearCapacity = candidates.some(city => {
    const local = cityDevelopmentNeeds(state, city);
    return governorPermissions(city).housing && local.population >= local.housing * .65
      && state.buildings.filter(building => building.kind === 'house' && buildingReady(building) && houseLevel(building) < 2
        && ownedByCity(state, building, city)).length >= 3
      && !state.buildings.some(building => building.kind === 'well' && ownedByCity(state, building, city));
  });
  return nearCapacity && faction.gold < factionCommittedBudget(state, faction).upkeep + (faction.population < WELL_POPULATION_REQUIREMENT ? 100 : 50);
}

/** Each palace owns its planning clock and pending-work allowance. Rivals
 * react every six seconds, while the player's governors plan every thirty.
 * New cities start a fresh clock when complete. None borrows another city's
 * order budget; all still draw real gold and builders from their faction. */
export function updateFactionDevelopment(state: GameState, orders: DevelopmentOrders): void {
  const plans = dueCityPlans(state);
  if (!plans.length) return;
  const liveOrders: DevelopmentOrders = {
    validate: (...args) => orders.validate(...args),
    build: (...args) => withCityPlanningMutation(state, () => orders.build(...args)),
    farms: (...args) => withCityPlanningMutation(state, () => orders.farms(...args)),
    houses: (...args) => withCityPlanningMutation(state, () => orders.houses(...args)),
  };
  withCityPlanning(state, () => planFactionDevelopment(state, liveOrders, plans));
}

function planFactionDevelopment(state: GameState, orders: DevelopmentOrders, plans: readonly CityPlan[]): void {
  for (const { faction, interval, palace } of plans) {
    if (state.time + 1e-7 < (palace.governorNextPlanAt ?? Infinity)) continue;
    palace.governorNextPlanAt = state.time + interval;
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && faction.population < 1) continue;
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && palace.depopulated && cityDevelopmentNeeds(state, palace).population <= 0) continue;
    // Establish one library when the city can afford the construction work.
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && state.buildings.filter(building => building.construction && productiveKinds.includes(building.kind)
      && ownedByCity(state, building, palace)).length < 3 && establishResearch(state, faction, palace, orders)) continue;
    const currentNeeds = faction.id > 0 && !isHumanFaction(state, faction.id) ? cityDevelopmentNeeds(state, palace) : undefined;
    // Wells are cheap growth infrastructure, not a reward for finishing every
    // safety-margin farm first. Reserve food production, then avoid hitting a
    // housing ceiling while the farm governor continuously queues more work.
    if (currentNeeds && governorPermissions(palace).housing && currentNeeds.foodCapacity > currentNeeds.population
      && currentNeeds.housing - currentNeeds.population <= currentNeeds.housing * .3
      && improveHousing(state, faction, palace, orders)) continue;
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && savingForWell(state, faction, palace)) continue;
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && factionCityDevelopmentPriority(state, palace) === 'farm' && improveFarms(state, faction, palace, orders)) continue;
    // One former 2×2 field is four independent tiles. Re-evaluate the actual
    // shortfall after each order instead of quartering the governor's output.
    for (let farm = 0; farm < 4; farm++) orders.farms(faction, palace);
    if (isHumanFaction(state, faction.id)) { orders.houses(faction, interval, palace); continue; }
    const pending = state.buildings.filter(building => building.construction
      && productiveKinds.includes(building.kind) && ownedByCity(state, building, palace)).length;
    // A city's existing productive jobs take precedence over its upgrades.
    if (pending >= 2) continue;
    const needs = cityDevelopmentNeeds(state, palace);
    if (governorPermissions(palace).housing && factionCityDevelopmentPriority(state, palace) === 'house'
      && needs.housing - needs.population <= needs.housing * .25 && improveHousing(state, faction, palace, orders)) continue;
    orders.houses(faction, interval, palace);
    if (governorPermissions(palace).housing && factionCityDevelopmentPriority(state, palace) === 'house'
      && needs.housing - needs.population <= needs.housing * .25) expandClaim(state, faction, palace, orders);
    developUnlockedBuildings(state, faction, palace, orders);
  }
}
