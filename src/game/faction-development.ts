import { factionAIPolicy, factionAIDecision } from './faction-ai-profile';
import { libraryPlacementAllowed } from './research';
import { IRRIGATION_GOLD } from './irrigation';
import { HOUSE_BUILD_GOLD } from './housing-config';
import { isHumanFaction } from './player-context';
import { buildingWithinBorders } from './border-placement';
import { territory } from './borders';
import { cityDevelopmentNeeds, governorPermissions, withCityPlanning, withCityPlanningMutation } from './governor';
import { planHouseSite } from './housing';
import { houseLevel, WELL_POPULATION_REQUIREMENT, WELL_RADIUS } from './wells';
import { areSwordsmenUnlocked, areArchersUnlocked, areHorsemenUnlocked, areHorseArchersUnlocked, areKnightsUnlocked, arePikemenUnlocked, areMusketmenUnlocked, isBuildingUnlocked, researchStatus } from './research';
import { desiredRetinueSize } from './archery';
import { type Building, type Faction, type GameState, type ResearchBranchId, buildingReady, buildingWidth, buildingHeight, distance, isFarmKind } from './types';
import { SimulationEvents } from './simulation-events';
import { entityStore } from './entity-store';
import { cityOwnership } from './city-ownership';
import { FARM_BUILD_GOLD } from './farm-config';
import { canSustainFactionDefense, factionCommittedBudget } from './faction-budget';
import { factionIrrigationSites } from './faction-irrigation';
import { HEALER_SHACK_COST } from './healer-shack';
import { FORT_GOLD, FORT_UPKEEP } from './forts';
import { SUPPLY_DEPOT_COST } from './supply-train';
import { autoDevelopResources, marbleConstructionMultiplier } from './resource-development';
import { buildingDisplacesFarms } from './farm-relocation';
import { placementOccupancy } from './placement-occupancy';
import { INSTITUTION_KIND, nativeInstitutionPlan, type InstitutionKind } from './institution-native';
import { granaryCity } from './granaries-native';
import { structureIndex, structuresOf, STRUCTURE_ALIVE, STRUCTURE_READY } from './structure-index';
import { farmCityQuery } from './farm-travel';
import { canReachConstruction } from './builders';
import { hasLivestock } from './livestock';
import { settlementPopulationLimit, upgradeSettlementTier } from './settlement-upgrades';

type DevelopmentWork = 'validation' | 'farm-validation' | 'action';
type DevelopmentTask = Generator<DevelopmentWork, void, void>;
export type DevelopmentKind = 'well' | 'monument' | 'library' | 'guardPost' | 'archeryRange' | 'blacksmith' | 'irrigation' | 'healerShack' | 'stable' | 'fort' | 'supplyDepot' | InstitutionKind;
export interface DevelopmentOrders {
  /** False retains this city's current farm action for another planning turn. */
  farms(faction: Faction, palace: Building, slice?: { maxCandidates: number }): boolean | void;
  houses(faction: Faction, elapsedSeconds: number, palace: Building, slice?: { maxOrders: number; keepCredit?: boolean }): void;
  validate(faction: number, kind: DevelopmentKind, x: number, y: number): { ok: boolean };
  build(faction: number, kind: DevelopmentKind, x: number, y: number): { ok: boolean };
}
const PLAYER_PLAN_SECONDS = 30;
const LIBRARY_COST = 200;
const productiveKinds = ['camp', 'house', 'well', 'monument', 'library', 'guardPost', 'archeryRange', 'blacksmith', 'healerShack', 'stable', 'fort', 'supplyDepot', 'granary', 'barracks', 'forum', 'apartments', 'factory'];
interface CityPlan {
  palace: Building; faction: Faction; interval: number; factionOrder: number; order: number; seen: number;
}
interface DueCityPlan extends CityPlan { deadline: number; }
interface DevelopmentCohort {
  plans: DueCityPlan[]; cursor: number; resourceAttempts: Set<number>;
}
interface DevelopmentClock {
  world: GameState['world']; time: number; generation: number;
  plans: Map<Building, CityPlan>; events: SimulationEvents<Building, CityPlan>;
  queued: Map<Building, number>; cohort?: DevelopmentCohort;
  active: Map<Building, ActiveCityPlan>;
}
interface ActiveCityPlan { plan: DueCityPlan; task: DevelopmentTask; orders: DevelopmentOrders; scheduledAt: number; housed: boolean }
const developmentClocks = new WeakMap<GameState, DevelopmentClock>();

/** Reconcile the small maintained palace group, then return only due cities.
 * Original faction/building order resolves simultaneous spending deterministically. */
function developmentClock(state: GameState): DevelopmentClock {
  let clock = developmentClocks.get(state);
  if (!clock || clock.world !== state.world || clock.time > state.time) {
    clock = { world: state.world, time: state.time, generation: 0, plans: new Map(), events: new SimulationEvents(), queued: new Map(), active: new Map() };
    developmentClocks.set(state, clock);
  }
  clock.time = state.time;
  const generation = ++clock.generation, palaces = entityStore(state).buildings.query('palace');
  for (let order = 0; order < palaces.length; order++) {
    const palace = palaces[order], factionOrder = state.factions.findIndex(faction => faction.id === palace.faction);
    const faction = state.factions[factionOrder];
    if (!faction || faction.id < 0 || faction.villageId !== undefined || faction.defeated || faction.relation === 'confederated' || palace.hp <= 0) continue;
    if (!buildingReady(palace)) { delete palace.governorNextPlanAt; continue; }
    const interval = isHumanFaction(state, faction.id) ? PLAYER_PLAN_SECONDS : factionAIPolicy(state,faction.id).parameters.developmentInterval;
    palace.governorNextPlanAt ??= state.time + interval;
    let plan = clock.plans.get(palace);
    if (!plan) { plan = { palace, faction, interval, factionOrder, order, seen: generation }; clock.plans.set(palace, plan); }
    plan.faction = faction; plan.interval = interval; plan.factionOrder = factionOrder; plan.order = order; plan.seen = generation;
    // Due work already owned by a cohort must not re-enter the event queue on
    // every frame while earlier cities spend their shared faction treasury.
    if (!clock.active.has(palace) && clock.queued.get(palace) !== palace.governorNextPlanAt)
      clock.events.schedule(palace, palace.governorNextPlanAt, plan);
  }
  for (const [palace, plan] of clock.plans) if (plan.seen !== generation) { clock.plans.delete(palace); clock.events.cancel(palace); }
  return clock;
}

function currentCityPlan(state: GameState, plan: DueCityPlan): boolean {
  const { palace, faction } = plan;
  return entityStore(state).buildings.get(palace.id) === palace && buildingReady(palace)
    && palace.faction === faction.id && state.factions.includes(faction)
    && faction.id >= 0 && faction.villageId === undefined && !faction.defeated && faction.relation !== 'confederated'
    && palace.governorNextPlanAt === plan.deadline && state.time + 1e-7 >= plan.deadline;
}

function dueCityPlans(state: GameState, maxCities: number): DevelopmentCohort[] {
  const clock = developmentClock(state), batches: DevelopmentCohort[] = [];
  let remaining = Math.max(0, Math.floor(maxCities));
  while (remaining > 0) {
    if (!clock.cohort) {
      const plans = clock.events.takeDue(state.time + 1e-7)
        .sort((a, b) => a.factionOrder - b.factionOrder || a.order - b.order)
        .map(plan => ({ ...plan, deadline: plan.palace.governorNextPlanAt! }));
      if (!plans.length) break;
      for (const plan of plans) clock.queued.set(plan.palace, plan.deadline);
      clock.cohort = { plans, cursor: 0, resourceAttempts: new Set() };
    }
    const cohort = clock.cohort, plans: DueCityPlan[] = [];
    while (cohort.cursor < cohort.plans.length && remaining > 0) {
      const plan = cohort.plans[cohort.cursor++];
      clock.queued.delete(plan.palace);
      // A queued city may be captured, removed, postponed or returned to
      // construction before its turn. Its next live reconciliation reschedules it.
      if (!currentCityPlan(state, plan)) continue;
      plans.push(plan); remaining--;
    }
    if (plans.length) batches.push({ plans, cursor: 0, resourceAttempts: cohort.resourceAttempts });
    if (cohort.cursor === cohort.plans.length) clock.cohort = undefined;
  }
  return batches;
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
  const needs = cityDevelopmentNeeds(state, palace);
  if (palace.faction <= 0 || isHumanFaction(state,palace.faction) || !governorPermissions(palace).housing) return needs.priority;
  const limit = settlementPopulationLimit(palace);
  if (needs.housing >= limit || needs.population >= limit) return needs.priority;
  // Completed and pending beds both count. Once the city has room to grow,
  // keep its treasury for actual shortages and funded civic investments.
  if (!factionAIDecision(state, palace.faction, 'housingDemand', needs.housing, needs.population))
    return needs.priority === 'house' ? null : needs.priority;
  const faction = state.factions.find(candidate => candidate.id === palace.faction);
  if (factionAIDecision(state,palace.faction,'housingPriority',needs.housing,needs.population,needs.foodCapacity,faction?.food??0)) return 'house';
  if (needs.housing <= needs.population + 2
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

/** A crop relocation preflight can search a whole city's available plots.
 * Keep the existing candidate order, but finish this turn after one such
 * check. Match relocation's live farm anchors; orphan fields are not movable. */
function validationWork(state: GameState, faction: number, kind: DevelopmentKind, x: number, y: number): DevelopmentWork {
  if (!buildingDisplacesFarms(kind)) return 'validation';
  const occupancy = placementOccupancy(state), right = x + buildingWidth({ kind }), bottom = y + buildingHeight({ kind });
  for (let row = y; row < bottom; row++) for (let column = x; column < right; column++)
    if (occupancy.at(column, row).some(building => building.hp > 0 && building.faction === faction && isFarmKind(building.kind)
      && building.x === column && building.y === row)) return 'farm-validation';
  return 'validation';
}

/** A 50-gold well adds two beds to every covered level-one house, often much
 * cheaper than buying further homes. Pending wells must not trigger duplicates. */
function* improveHousing(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): Generator<DevelopmentWork, boolean, void> {
  if (faction.population < WELL_POPULATION_REQUIREMENT || faction.gold < 50 * marbleConstructionMultiplier(state, faction.id)
    || (faction.constructionPauseUntil?.well ?? 0) > state.time) return false;
  const owned = state.buildings.filter(building => (building.kind === 'house' || building.kind === 'well')
    && ownedByCity(state, building, palace));
  const houses = owned.filter(building => building.kind === 'house' && buildingReady(building) && houseLevel(building) < 2);
  const coverage=factionAIDecision(state,faction.id,'wellCoverage');
  if (houses.length < coverage) return false;
  const wells = owned.filter(building => building.kind === 'well');
  if (wells.some(well => well.construction && houses.filter(house => distance(house, well) <= WELL_RADIUS).length >= coverage)) return true;
  const uncovered = houses.filter(house => !wells.some(well => distance(well, house) <= WELL_RADIUS));
  let best: { x: number; y: number; score: number } | undefined;
  for (let y = Math.max(0, palace.y - 9); y <= Math.min(state.world.height - 1, palace.y + 10); y++) {
    for (let x = Math.max(0, palace.x - 9); x <= Math.min(state.world.width - 1, palace.x + 10); x++) {
      const point = { x, y }, count = uncovered.filter(house => distance(house, point) <= WELL_RADIUS).length;
      if (count < coverage) continue;
      const work = validationWork(state, faction.id, 'well', x, y);
      const valid = orders.validate(faction.id, 'well', x, y).ok; yield work;
      if (!valid) continue;
      const score = count * 10 - distance(point, palace);
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  if (!best || !governorPermissions(palace).housing || faction.population < WELL_POPULATION_REQUIREMENT
    || !upgradeAllowedNow(state, faction, 'well')) return false;
  const live = state.buildings.filter(building => (building.kind === 'house' || building.kind === 'well') && ownedByCity(state, building, palace));
  if (live.filter(house => house.kind === 'house' && buildingReady(house) && houseLevel(house) < 2
    && distance(house, best!) <= WELL_RADIUS && !live.some(well => well.kind === 'well' && distance(well, house) <= WELL_RADIUS)).length < coverage) return false;
  const built = orders.build(faction.id, 'well', best.x, best.y).ok; yield 'action'; return built;
}

function* expandClaim(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): Generator<DevelopmentWork, void, void> {
  if (!isBuildingUnlocked(faction, 'monument') || faction.gold < 325 || faction.population < 16 || (faction.constructionPauseUntil?.monument ?? 0) > state.time
    || state.buildings.some(building => building.kind === 'monument' && ownedByCity(state, building, palace))) return;
  // Territory should be the actual obstacle: a site exists without a border
  // restriction, but no otherwise suitable site is currently claimed.
  const canReplace = () => false;
  // One synchronous search uses one claim snapshot. Revalidating every source
  // building for every candidate makes a large city's site search quadratic.
  const borders = territory(state);
  const claimed = planHouseSite(state, palace, canReplace, point => buildingWithinBorders(state, 'house', point.x, point.y, faction.id, borders));
  yield 'action'; if (claimed) return;
  const unclaimed = planHouseSite(state, palace, canReplace); yield 'action'; if (!unclaimed) return;
  let best: { x: number; y: number; score: number } | undefined;
  for (let y = Math.max(0, palace.y - 10); y <= Math.min(state.world.height - 1, palace.y + 10); y++) {
    for (let x = Math.max(0, palace.x - 10); x <= Math.min(state.world.width - 1, palace.x + 10); x++) {
      const work = validationWork(state, faction.id, 'monument', x, y);
      const valid = orders.validate(faction.id, 'monument', x, y).ok; yield work;
      if (!valid) continue;
      const score = distance({ x, y }, palace);
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  if (best && governorPermissions(palace).housing && upgradeAllowedNow(state, faction, 'monument')
    && !state.buildings.some(building => building.kind === 'monument' && ownedByCity(state, building, palace))) {
    orders.build(faction.id, 'monument', best.x, best.y); yield 'action';
  }
}

function upgradeAllowedNow(state: GameState, faction: Faction, kind: DevelopmentKind): boolean {
  return isBuildingUnlocked(faction, kind) && (faction.constructionPauseUntil?.[kind] ?? 0) <= state.time;
}

/** Only observed city/farm facts cross the bridge. Native planning owns the
 * investment gate and farm-cluster site ranking; normal commands own payment,
 * footprint validation, crop relocation and the one-granary-per-city limit. */
function* developInstitution(state: GameState, faction: Faction, palace: Building, kind: InstitutionKind,
  orders: DevelopmentOrders): Generator<DevelopmentWork, boolean, void> {
  if (!upgradeAllowedNow(state, faction, kind)) return false;
  if (kind === 'apartments' && cityDevelopmentNeeds(state, palace).housing >= settlementPopulationLimit(palace)) return false;
  const existing = () => structuresOf(state, faction.id, STRUCTURE_ALIVE, kind).some(building =>
    kind === 'granary' ? granaryCity(state, building)?.id === palace.id
      : kind !== 'forum' ? ownedByCity(state, building, palace) : true);
  if (existing()) return false;
  const farmOwner = kind === 'granary' ? farmCityQuery(state, faction.id) : undefined;
  const farms = farmOwner ? entityStore(state).buildings.query('farm').filter(building =>
    building.faction === faction.id && buildingReady(building) && farmOwner(building)?.id === palace.id).slice(0, 256) : [];
  const leader = entityStore(state).units.query('leader').find(unit => unit.faction === faction.id && unit.hp > 0);
  const eligible = () => !!nativeInstitutionPlan(state, faction.id, 0, [INSTITUTION_KIND[kind], faction.gold,
    factionDevelopmentReserve(state, faction), factionCommittedBudget(state, faction).surplus, cityDevelopmentNeeds(state, palace).population,
    farms.filter(farm => farm.faction === faction.id && buildingReady(farm)).length,
    faction.culture ?? 0, faction.achievements ?? 0, leader && leader.hp > 0 ? distance(leader, palace) : Number.MAX_SAFE_INTEGER,
    structuresOf(state, faction.id, STRUCTURE_ALIVE, 'factory').length, cityDevelopmentNeeds(state, palace).housing,
    marbleConstructionMultiplier(state, faction.id)])[0];
  if (!eligible()) return false;
  if (kind !== 'granary') return yield* buildCityUpgrade(state, faction, palace, kind, orders, eligible);
  const sites = nativeInstitutionPlan(state, faction.id, state.world.scenario?5:2, [palace.x, palace.y, state.world.width, state.world.height,
    ...farms.flatMap(farm => [farm.x + .5, farm.y + .5])]);
  yield 'action';
  for (let i = 0; i < sites.length; i += 2) {
    if (!upgradeAllowedNow(state, faction, kind) || existing()) return false;
    const x = sites[i], y = sites[i + 1];
    if (cityOwnership(state).nearest({ x: x + 1, y: y + 1 }, faction.id)?.id !== palace.id) continue;
    const work = validationWork(state, faction.id, kind, x, y);
    const valid = orders.validate(faction.id, kind, x, y).ok; yield work;
    if (!valid) continue;
    // Another city's continuation, a capture or a pause may have changed the
    // world while this validation was suspended.
    if (!upgradeAllowedNow(state, faction, kind) || existing() || !eligible()) return false;
    const built = orders.build(faction.id, kind, x, y).ok; yield 'action';
    if (built) return true;
  }
  return false;
}

function* buildCityUpgrade(state: GameState, faction: Faction, palace: Building, kind: DevelopmentKind, orders: DevelopmentOrders,
  eligible: () => boolean = () => true): Generator<DevelopmentWork, boolean, void> {
  if (!isBuildingUnlocked(faction, kind) || (faction.constructionPauseUntil?.[kind] ?? 0) > state.time) return false;
  const options: { x: number; y: number }[] = [];
  if(state.world.scenario) {
    const sites=nativeInstitutionPlan(state,faction.id,4,[palace.x,palace.y,state.world.width,state.world.height]);
    for(let i=0;i<sites.length;i+=2)options.push({x:sites[i],y:sites[i+1]});
  } else {
    for (let y = Math.max(0, palace.y - 7); y <= Math.min(state.world.height - 1, palace.y + 8); y++)
      for (let x = Math.max(0, palace.x - 7); x <= Math.min(state.world.width - 1, palace.x + 8); x++) options.push({ x, y });
    options.sort((a, b) => distance(a, palace) - distance(b, palace) || a.y - b.y || a.x - b.x);
  }
  for (const point of options) {
    const work = validationWork(state, faction.id, kind, point.x, point.y);
    const valid = orders.validate(faction.id, kind, point.x, point.y).ok
      && canReachConstruction(state,palace,{id:-1,kind,faction:faction.id,...point,hp:1,maxHp:1,capacity:0}); yield work;
    if (!valid) continue;
    if (!upgradeAllowedNow(state, faction, kind) || !eligible()) return false;
    // Another city's queued turn may have supplied this faction-wide upgrade
    // while this city's candidate scan was suspended.
    if (kind === 'library' ? !libraryPlacementAllowed(state, faction.id, { x: point.x + 1, y: point.y + 1 })
      : state.buildings.some(building => building.hp > 0 && building.faction === faction.id && building.kind === kind
        && (!['guardPost', 'healerShack', 'fort', 'barracks', 'apartments', 'factory'].includes(kind) || ownedByCity(state, building, palace)))) return true;
    const built = orders.build(faction.id, kind, point.x, point.y).ok; yield 'action';
    if (built) return true;
  }
  return false;
}

/** Each city can add one library after securing its opening food and housing. */
function* establishResearch(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): Generator<DevelopmentWork, boolean, void> {
  if (!libraryPlacementAllowed(state, faction.id, { x: palace.x + 1, y: palace.y + 1 }) || !canSaveForLibrary(state, faction, palace)
    || (faction.constructionPauseUntil?.library ?? 0) > state.time) return false;
  const first = needsLibrary(state, faction);
  if (!first && factionCityDevelopmentPriority(state, palace)) return false;
  const needs = cityDevelopmentNeeds(state, palace);
  if (governorPermissions(palace).housing && needs.housing - needs.population <= needs.housing * .25
    && (yield* improveHousing(state, faction, palace, orders))) return true;
  const budget = factionCommittedBudget(state, faction);
  if (faction.gold < LIBRARY_COST * marbleConstructionMultiplier(state, faction.id) + budget.upkeep)
    return first && needs.housing > needs.population && budget.surplus > 0;
  return (yield* buildCityUpgrade(state, faction, palace, 'library', orders));
}

/** Observations and mirrors only; native planning owns the complete role mix.
 * Runs with resource planning once per due faction cohort, even when a city
 * still has housing or construction work and cannot buy another building. */
function updateFactionComposition(state: GameState, faction: Faction): void {
  const owned = state.buildings.filter(building => building.faction === faction.id && building.hp > 0);
  const ready = new Set(owned.filter(buildingReady).map(building => building.kind));
  const stableSupplied = ready.has('stable') && hasLivestock(state, faction.id, 'horse');
  const flags = Number(areArchersUnlocked(faction) && ready.has('archeryRange'))
    | Number(areHorsemenUnlocked(faction) && stableSupplied) << 1
    | Number(areHorseArchersUnlocked(faction) && stableSupplied) << 2
    | Number(areKnightsUnlocked(faction) && stableSupplied) << 3
    | Number(areSwordsmenUnlocked(faction) && ready.has('blacksmith')) << 4
    | Number(arePikemenUnlocked(faction) && ready.has('barracks')) << 5
    | Number(areMusketmenUnlocked(faction) && ready.has('barracks')) << 6;
  const units = entityStore(state).units;
  const leader = units.queryFaction('leader', faction.id).find(unit => unit.hp > 0);
  const soldiers = units.queryFaction('retinue', faction.id).filter(unit => unit.hp > 0 && !unit.ranger);
  const slots = Math.max(soldiers.length, desiredRetinueSize(faction, leader) - (faction.rangerCompanions ?? 0));
  const budget = factionCommittedBudget(state, faction);
  const research = ready.has('library') ? researchStatus(state, faction.id) : undefined;
  const science = research && !research.completed ? budget.taxes * research.allocation : 0;
  const mix = nativeInstitutionPlan(state, faction.id, 1, [flags, budget.surplus + budget.retinueWages - science,
    slots, faction.fieldCannonFraction ?? 0]);
  [faction.knightFraction, faction.horseArcherFraction, faction.horsemanFraction, faction.swordsmanFraction,
    faction.archerFraction, faction.spearmanFraction, faction.pikemanFraction, faction.musketmanFraction, faction.fieldCannonFraction] = mix;
}

/** Research spends the faction's surplus after city work, keeping the next
 * productive purchase for every city and one economy tick of food in reserve.
 * The shared paid flag makes several palace planners safe to call this. */
function* developUnlockedBuildings(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): Generator<DevelopmentWork, void, void> {
  const owned = state.buildings.filter(building => building.faction === faction.id && building.hp > 0);
  if (owned.filter(building => building.construction && productiveKinds.includes(building.kind)
    && ownedByCity(state, building, palace)).length >= 2) return;
  const reserve = factionDevelopmentReserve(state, faction);
  if (yield* developInstitution(state, faction, palace, 'barracks', orders)) return;
  if (yield* developInstitution(state, faction, palace, 'forum', orders)) return;
  if (yield* developInstitution(state, faction, palace, 'apartments', orders)) return;
  if (yield* developInstitution(state, faction, palace, 'factory', orders)) return;
  const upgrades = ([['guardPost', 200], ['archeryRange', 400], ['blacksmith', 200], ['healerShack', HEALER_SHACK_COST], ['stable', 350],
    ['supplyDepot', SUPPLY_DEPOT_COST], ['fort', FORT_GOLD]] as const)
    .map(([kind,cost],index)=>({kind,cost,rank:factionAIDecision(state,faction.id,'developmentRank',index)}))
    .sort((a,b)=>a.rank-b.rank);
  const marble = marbleConstructionMultiplier(state, faction.id);
  for (const {kind,cost} of upgrades) {
    if (!isBuildingUnlocked(faction, kind) || faction.gold < cost * marble + reserve
      || kind === 'guardPost' && !canSustainFactionDefense(state, faction, kind)
      || kind === 'fort' && factionCommittedBudget(state, faction).surplus < FORT_UPKEEP + Math.max(5, faction.population * .1)
      || owned.some(building => building.kind === kind && (kind !== 'guardPost' && kind !== 'healerShack' && kind !== 'fort' || ownedByCity(state, building, palace)))) continue;
    if ((yield* buildCityUpgrade(state, faction, palace, kind, orders))) return;
  }
}

/** Spend less than the equivalent new farmland, then let the normal governor
 * fill the freshly irrigated neighborhood before expanding farther away. */
function* improveFarms(state: GameState, faction: Faction, palace: Building, orders: DevelopmentOrders): Generator<DevelopmentWork, boolean, void> {
  if (!isBuildingUnlocked(faction, 'irrigation')
    || faction.gold < IRRIGATION_GOLD * marbleConstructionMultiplier(state, faction.id) + factionCommittedBudget(state, faction).upkeep
    || (faction.constructionPauseUntil?.irrigation ?? 0) > state.time) return false;
  for (const point of factionIrrigationSites(state, palace)) {
    const valid = orders.validate(faction.id, 'irrigation', point.x, point.y).ok; yield 'validation';
    if (!valid) continue;
    if (!upgradeAllowedNow(state, faction, 'irrigation') || !governorPermissions(palace).farms) return false;
    const built = orders.build(faction.id, 'irrigation', point.x, point.y).ok; yield 'action';
    if (built) return true;
  }
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
 * use their policy planning interval, while the player's governors plan every thirty.
 * New cities start a fresh clock when complete. None borrows another city's
 * order budget; all still draw real gold and builders from their faction.
 * Runtime callers drain a bounded number each step; direct tools can process
 * every due city immediately by leaving the budget unspecified. */
export function updateFactionDevelopment(state: GameState, orders: DevelopmentOrders, maxCities = Infinity): void {
  const existing = developmentClocks.get(state);
  if (existing?.world === state.world && existing.time <= state.time)
    for (const job of [...existing.active.values()]) advanceCityTask(state, existing, job, orders, Infinity);
  const batches = dueCityPlans(state, maxCities);
  if (!batches.length) return;
  const liveOrders = mutationOrders(state, orders);
  withCityPlanning(state, () => {
    for (const batch of batches) planFactionDevelopment(state, liveOrders, batch.plans, batch.resourceAttempts, Number.isFinite(maxCities));
  });
}

function mutationOrders(state: GameState, orders: DevelopmentOrders): DevelopmentOrders {
  return {
    validate: (...args) => orders.validate(...args),
    build: (...args) => withCityPlanningMutation(state, () => orders.build(...args)),
    farms: (...args) => withCityPlanningMutation(state, () => orders.farms(...args)),
    houses: (...args) => withCityPlanningMutation(state, () => orders.houses(...args)),
  };
}

/** Round-robin city continuations retain ordered placement cursors. One turn
 * performs a purchase/search action or at most four candidate validations,
 * ending after any crop-relocation preflight;
 * busy cities cannot monopolize every other city's planning deadline. */
export function advanceFactionDevelopment(state: GameState, orders: DevelopmentOrders): void {
  if (state.paused || state.gameOver) return;
  const batches = dueCityPlans(state, 1), clock = developmentClocks.get(state)!;
  for (const batch of batches) for (const plan of batch.plans) {
    let job: ActiveCityPlan;
    const forwarding: DevelopmentOrders = {
      farms: (...args) => job.orders.farms(...args),
      houses: (faction, elapsed, palace, slice) => {
        if (!slice || slice.keepCredit) {
          elapsed = Math.max(0, state.time - (palace.governorHousingCreditedAt ?? plan.deadline - plan.interval));
          palace.governorHousingCreditedAt = state.time; job.housed = true;
        }
        job.orders.houses(faction, elapsed, palace, slice);
      },
      validate: (...args) => job.orders.validate(...args), build: (...args) => job.orders.build(...args),
    };
    job = { plan, orders: mutationOrders(state, orders), scheduledAt: plan.deadline, housed: false,
      task: planCityDevelopment(state, forwarding, plan, batch.resourceAttempts, true, true) };
    clock.active.set(plan.palace, job);
  }
  const job = clock.active.values().next().value;
  if (job) advanceCityTask(state, clock, job, orders, 4);
}

function advanceCityTask(state: GameState, clock: DevelopmentClock, job: ActiveCityPlan, orders: DevelopmentOrders, validations: number): void {
  const { palace, faction } = job.plan;
  clock.active.delete(palace);
  if (entityStore(state).buildings.get(palace.id) !== palace || !buildingReady(palace) || palace.faction !== faction.id
    || !state.factions.includes(faction) || faction.defeated || faction.relation === 'confederated'
    || palace.governorNextPlanAt !== job.scheduledAt) return;
  job.orders = mutationOrders(state, orders);
  let complete = false;
  withCityPlanning(state, () => {
    for (let checks = 0; checks < validations;) {
      const step = job.task.next(); job.scheduledAt = palace.governorNextPlanAt!;
      if (step.done) { complete = true; break; }
      if (Number.isFinite(validations) && step.value !== 'validation') break;
      if (step.value === 'validation') checks++;
    }
  });
  if (complete) {
    if (!job.housed) palace.governorHousingCreditedAt = state.time;
  } else clock.active.set(palace, job);
}

function planFactionDevelopment(state: GameState, orders: DevelopmentOrders, plans: readonly DueCityPlan[], resourceAttempts: Set<number>, deferred: boolean): void {
  for (const plan of plans) {
    const task = planCityDevelopment(state, orders, plan, resourceAttempts, deferred);
    while (!task.next().done) { /* Direct/public calls retain immediate completion. */ }
    plan.palace.governorHousingCreditedAt = state.time;
  }
}

function* planCityDevelopment(state: GameState, orders: DevelopmentOrders, plan: DueCityPlan, resourceAttempts: Set<number>, deferred: boolean, boundedActions = false): DevelopmentTask {
    if (!currentCityPlan(state, plan)) return;
    const { faction, interval, palace, deadline } = plan;
    // A frame budget delays decisions, never the city's earned housing credit.
    // Direct/tool calls retain their existing one-interval planning contract.
    const elapsed = interval + (deferred ? Math.max(0, state.time - deadline) : 0);
    // Persist the accrual origin before yielding. Reloading a partially planned
    // city may discard its cursor, but must retain its unpaid housing time.
    palace.governorHousingCreditedAt ??= deadline - interval;
    palace.governorNextPlanAt = state.time + interval;
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && faction.population < 1) return;
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && palace.depopulated && cityDevelopmentNeeds(state, palace).population <= 0) return;
    if (!isHumanFaction(state, faction.id) && !resourceAttempts.has(faction.id)) {
      resourceAttempts.add(faction.id);
      updateFactionComposition(state, faction);
      withCityPlanningMutation(state, () => autoDevelopResources(state, faction.id,
        Math.max(0, faction.gold - factionDevelopmentReserve(state, faction))));
      yield 'action';
    }
    // Establish one library when the city can afford the construction work.
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && state.buildings.filter(building => building.construction && productiveKinds.includes(building.kind)
      && ownedByCity(state, building, palace)).length < 3 && (yield* establishResearch(state, faction, palace, orders))) return;
    const currentNeeds = faction.id > 0 && !isHumanFaction(state, faction.id) ? cityDevelopmentNeeds(state, palace) : undefined;
    const limit = settlementPopulationLimit(palace);
    if (currentNeeds && Number.isFinite(limit) && nativeInstitutionPlan(state, faction.id, 6, [palace.settlementTier ?? 0,
      currentNeeds.population, faction.population, faction.food, faction.gold, faction.yields.gold,
      structureIndex(state).civicCount(palace)])[0]
      && withCityPlanningMutation(state, () => upgradeSettlementTier(state, palace, faction.id)).ok) return;
    // Wells are cheap growth infrastructure, not a reward for finishing every
    // safety-margin farm first. Reserve food production, then avoid hitting a
    // housing ceiling while the farm governor continuously queues more work.
    if (currentNeeds && currentNeeds.housing < limit && governorPermissions(palace).housing && currentNeeds.foodCapacity > currentNeeds.population
      && (currentNeeds.housing - currentNeeds.population <= currentNeeds.housing * .3
        || factionAIDecision(state,faction.id,'housingInfrastructure',currentNeeds.housing,currentNeeds.population,currentNeeds.foodCapacity))
      && (yield* improveHousing(state, faction, palace, orders))) return;
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && savingForWell(state, faction, palace)) return;
    if (faction.id > 0 && !isHumanFaction(state, faction.id)
      && (yield* developInstitution(state, faction, palace, 'granary', orders))) return;
    if (faction.id > 0 && !isHumanFaction(state, faction.id) && factionCityDevelopmentPriority(state, palace) === 'farm' && (yield* improveFarms(state, faction, palace, orders))) return;
    // One former 2×2 field is four independent tiles. Re-evaluate the actual
    // shortfall after each order instead of quartering the governor's output.
    for (let farm = 0; farm < 4; farm++) {
      let complete: boolean;
      do {
        complete = orders.farms(faction, palace, boundedActions ? { maxCandidates: 512 } : undefined) !== false;
        if (!complete || governorPermissions(palace).farms) yield 'action';
      } while (!complete);
    }
    if (isHumanFaction(state, faction.id)) { yield* developHouses(orders, faction, elapsed, palace, boundedActions); return; }
    const pending = state.buildings.filter(building => building.construction
      && productiveKinds.includes(building.kind) && ownedByCity(state, building, palace)).length;
    // A city's existing productive jobs take precedence over its upgrades.
    if (pending >= factionAIDecision(state,faction.id,'developmentLimit')) return;
    const needs = cityDevelopmentNeeds(state, palace);
    if (governorPermissions(palace).housing && factionCityDevelopmentPriority(state, palace) === 'house'
      && needs.housing - needs.population <= needs.housing * .25 && (yield* improveHousing(state, faction, palace, orders))) return;
    yield* developHouses(orders, faction, elapsed, palace, boundedActions);
    if (governorPermissions(palace).housing && factionCityDevelopmentPriority(state, palace) === 'house'
      && needs.housing - needs.population <= needs.housing * .25) yield* expandClaim(state, faction, palace, orders);
    yield* developUnlockedBuildings(state, faction, palace, orders);
}

function* developHouses(orders: DevelopmentOrders, faction: Faction, elapsed: number, palace: Building, bounded: boolean): DevelopmentTask {
  if (bounded && governorPermissions(palace).housing) {
    orders.houses(faction, elapsed, palace, { maxOrders: 1, keepCredit: true }); yield 'action';
    orders.houses(faction, 0, palace, { maxOrders: 1 }); yield 'action';
  } else orders.houses(faction, elapsed, palace);
}
