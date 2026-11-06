import { spendGold } from './gold-ledger';
import { grantIncome } from './resource-income';
import { removeVillageTrailAt } from './village-trails';
import { prepareFarmForAutomaticRoad } from './automatic-road-farms';
import { forbiddenRevision, isForbidden } from './forbidden-zones';
import { buildingWorkForbidden } from './forbidden-work';
import { buildingOverlapsVillageBorders } from './border-placement';
import { entityStore } from './entity-store';
import { cityResidents } from './cities';
import { markWorldChanged } from './world-revisions';
import { constructionEdges } from './builders';
import { validateNetworkPlacement } from './network-placement';
import { canWalk, findPath, hasStaticPath, invalidateNavigation, withNavigationFrame } from './pathfinding';
import { ridgeFootprintAllowed } from './ridges';
import { regionalTradeMultiplier } from './regional-economy';
import { tradeGoldMultiplier } from './research-bonuses';
import { recordVillageTrade, villageCamp, villageHostility, villageTradeActive, VILLAGE_TRADE_COST, VILLAGE_TRADE_MULTIPLIER } from './villages';
import { buildingReady, buildingWidth, buildingHeight, distance, isFarmKind, tileAt, WATER, type Building, type GameState, type Point, type TradeRoute, type Unit } from './types';
import { advanceRiverTrade, beginRiverTradeLeg, findRiverTradeConnection } from './river-trade';

export const TRADE_INCOME_MULTIPLIER = 3;
export const TRADE_GOLD_PER_TILE = 1;
export const TRADE_BONUS_DISTANCE = 1;
export const DOMESTIC_TRADE_GOLD_PER_TILE = .5 * TRADE_INCOME_MULTIPLIER;
export const DOMESTIC_TRADE_PREMIUM_DISTANCE = 50;
export const DOMESTIC_TRADE_POPULATION_SCALE = 50;
export const DOMESTIC_TRADE_MATURITY_START = 20;
export const DOMESTIC_TRADE_MATURITY_FULL = 30;
export const DOMESTIC_TRADE_YOUNG_CITY_CAP = 2 * TRADE_INCOME_MULTIPLIER;
export const MERCHANT_BOUNTY = 200;
export const MERCHANT_REPLACEMENT_SECONDS = 240;
export const MERCHANT_SPEED = 1.3;
const PLAN_INTERVAL = 5;
const planning = new WeakMap<GameState, { signature: string; nextAt: number }>();
type Move = (state: GameState, unit: Unit, goal: Point, dt: number) => void;

/** Village distance base, before partner bonuses and the trade-income multiplier. */
export function tradePayout(tiles: number): number {
  if (!Number.isFinite(tiles) || tiles < 1) return 0;
  return Math.round(tiles * TRADE_GOLD_PER_TILE * (1 + Math.floor((tiles + 1e-7) / TRADE_BONUS_DISTANCE) * .01));
}

/** A city's trade capacity is its residents, shared among its connections.
 * The harmonic mean limits an outpost's demand even beside a large capital.
 * Maturity uses unshared resident counts: either endpoint at 20 or fewer caps
 * the final reward at six gold, then the route reaches full value by 30.
 * Keep the fractional result: a small city's first deliveries still matter. */
export function domesticTradePayout(tiles: number, originShare: number, partnerShare: number, bonus = 1,
  residents = { origin: originShare, partner: partnerShare }): number {
  if (!Number.isFinite(tiles) || tiles <= 0 || !Number.isFinite(originShare) || originShare <= 0
    || !Number.isFinite(partnerShare) || partnerShare <= 0 || !Number.isFinite(bonus) || bonus <= 0
    || !Number.isFinite(residents.origin) || residents.origin <= 0 || !Number.isFinite(residents.partner) || residents.partner <= 0) return 0;
  const smaller = Math.min(originShare, partnerShare), larger = Math.max(originShare, partnerShare);
  const harmonic = smaller / (.5 + .5 * smaller / larger);
  const populationFactor = harmonic / (harmonic + DOMESTIC_TRADE_POPULATION_SCALE);
  const full = DOMESTIC_TRADE_GOLD_PER_TILE * tiles * (1 + .01 * Math.min(tiles, DOMESTIC_TRADE_PREMIUM_DISTANCE))
    * populationFactor * bonus;
  const population = Math.min(residents.origin, residents.partner), small = Math.min(full, DOMESTIC_TRADE_YOUNG_CITY_CAP);
  if (population <= DOMESTIC_TRADE_MATURITY_START) return small;
  if (population >= DOMESTIC_TRADE_MATURITY_FULL) return full;
  const growth = (population - DOMESTIC_TRADE_MATURITY_START) / (DOMESTIC_TRADE_MATURITY_FULL - DOMESTIC_TRADE_MATURITY_START);
  return small + (full - small) * (1 - (1 - growth) ** 2);
}

interface PopulationSnapshot {
  time: number; routes: GameState['tradeRoutes']; buildings: number; world: number | undefined;
  population: string; merchants: string; residents: Map<number, number>; shares: Map<number, number>;
}
const populations = new WeakMap<GameState, PopulationSnapshot>();

/** Requested only at departure, never while a caravan is travelling. Departures
 * in one simulation pass share a single resident-ledger scan. Revision and
 * population changes also invalidate same-time command/planning snapshots. */
function domesticTradePopulationSnapshot(state: GameState): PopulationSnapshot {
  const store = entityStore(state);
  const liveMerchants = new Set((state.tradeRoutes ?? []).flatMap(route => {
    const unit = route.merchantId === undefined ? undefined : store.units.get(route.merchantId);
    return unit?.kind === 'merchant' && unit.hp > 0 && unit.faction === route.faction && unit.tradeRoute === route.id ? [unit.id] : [];
  }));
  const merchants = [...liveMerchants].join(','), population = state.factions.map(faction => `${faction.id}:${faction.population}:${Number(faction.defeated)}`).join(',');
  const previous = populations.get(state);
  if (previous?.time === state.time && previous.routes === state.tradeRoutes && previous.buildings === store.buildings.revision
    && previous.world === state.world.revision && previous.population === population && previous.merchants === merchants) return previous;
  const cities = cityResidents(state), residents = new Map(cities.map(city => [city.palace.id, city.population]));
  const factions = new Map(cities.map(city => [city.palace.id, city.palace.faction])), degree = new Map<number, number>();
  for (const route of state.tradeRoutes ?? []) {
    if (route.villageId !== undefined || route.merchantId === undefined || !liveMerchants.has(route.merchantId)
      || factions.get(route.origin) !== route.faction || factions.get(route.partner) !== route.faction
      || (residents.get(route.origin) ?? 0) <= 0 || (residents.get(route.partner) ?? 0) <= 0) continue;
    degree.set(route.origin, (degree.get(route.origin) ?? 0) + 1);
    degree.set(route.partner, (degree.get(route.partner) ?? 0) + 1);
  }
  const shares = new Map(cities.map(city => [city.palace.id, city.population / Math.max(1, degree.get(city.palace.id) ?? 0)]));
  const snapshot = { time: state.time, routes: state.tradeRoutes, buildings: store.buildings.revision, world: state.world.revision, population, merchants, residents, shares };
  populations.set(state, snapshot);
  return snapshot;
}

export function domesticTradePopulationShares(state: GameState): ReadonlyMap<number, number> {
  return domesticTradePopulationSnapshot(state).shares;
}

/** Quote the complete traversable route before departing. Later avoidance,
 * backtracking or blocked-path reroutes cannot enlarge this delivery's value. */
function planDomesticLeg(state: GameState, route: TradeRoute, merchant: Unit, goal: Point): boolean {
  return withNavigationFrame(state, () => {
    const path = findPath(state, merchant, goal, merchant.faction, false, undefined, undefined, undefined, true, true);
    if (!path.length || distance(path[path.length - 1], goal) > .18) return false;
    let plannedDistance = 0, previous: Point = merchant;
    for (const point of path) { plannedDistance += distance(previous, point); previous = point; }
    quoteDomesticLeg(state, route, plannedDistance);
    // Ordinary movement may validate/replan this path, but the quote stays fixed.
    merchant.path = path; merchant.pathGoal = copy(goal); merchant.repathAt = 0;
    return true;
  });
}

function quoteDomesticLeg(state: GameState, route: TradeRoute, plannedDistance: number): void {
  const { shares, residents } = domesticTradePopulationSnapshot(state);
  const originShare = shares.get(route.origin) ?? 0, partnerShare = shares.get(route.partner) ?? 0;
  const store = entityStore(state).buildings, origin = store.get(route.origin), partner = store.get(route.partner);
  const faction = state.factions.find(candidate => candidate.id === route.faction);
  const bonus = (origin && partner ? regionalTradeMultiplier(state.world, origin, partner, state) : 1) * tradeGoldMultiplier(faction);
  route.legValue = { distance: plannedDistance, originShare, partnerShare,
    gold: domesticTradePayout(plannedDistance, originShare, partnerShare, bonus,
      { origin: residents.get(route.origin) ?? 0, partner: residents.get(route.partner) ?? 0 }) };
}

function nextId(state: GameState): number {
  let id = 0;
  for (const entity of [...state.units, ...state.buildings]) id = Math.max(id, entity.id);
  return id + 1;
}
const copy = (point: Point): Point => ({ x: point.x, y: point.y });
const cityPair = (a: number, b: number): string => a < b ? `${a}:${b}` : `${b}:${a}`;
const villageCooldown = (villageId: number, faction: number): string => `village:${villageId}:${faction}`;
// Negative route IDs cannot collide with positive city-building route IDs.
const villageRouteId = (camp: number, faction: number): number => -((camp + faction) * (camp + faction + 1) / 2 + faction + 1);
const completedCities = (state: GameState): Building[] => state.buildings.filter(building => building.kind === 'palace'
  && buildingReady(building) && state.factions.some(faction => faction.id === building.faction && !faction.defeated));

/** One static component probe rejects an inaccessible city before pathfinding.
 * Prefer the nearest clear pair of doors, keeping all movement outside walls. */
function connection(state: GameState, origin: Building, partner: Building): { start: Point; goal: Point } | undefined {
  if (buildingWorkForbidden(state, origin) || buildingWorkForbidden(state, partner, origin.faction)) return;
  const pairs = constructionEdges(state, origin, true).flatMap(start => constructionEdges(state, partner, true).map(goal => ({ start, goal })));
  pairs.sort((a, b) => distance(a.start, a.goal) - distance(b.start, b.goal));
  return pairs.find(({ start, goal }) => distance(start, goal) >= 1 && hasStaticPath(state, start, goal, origin.faction, true));
}

function riverPartner(state: GameState, origin: Building, cities: Building[]): Building | undefined {
  return cities.filter(city => city.id !== origin.id && city.faction === origin.faction)
    .sort((a, b) => distance(origin, b) - distance(origin, a) || a.id - b.id)
    .find(city => findRiverTradeConnection(state, origin, city));
}
function choosePartner(state: GameState, origin: Building, cities: Building[]): Building | undefined {
  return riverPartner(state, origin, cities) ?? cities.filter(city => city.id !== origin.id && city.faction === origin.faction)
    .sort((a, b) => distance(origin, b) - distance(origin, a) || a.id - b.id)
    .find(city => connection(state, origin, city));
}

function idleAtOrigin(state: GameState, route: TradeRoute, origin: Building, merchant?: Unit): boolean {
  return !merchant || !route.legValue && !route.riverLeg && route.target === route.partner
    && constructionEdges(state, origin, true).some(door => distance(merchant, door) <= .2);
}

/** Prosperous rival realms can afford one local village agreement. Reserve
 * city-building funds and stagger negotiations; trade still requires a route. */
function establishFactionVillageTrade(state: GameState, cities: Building[]): void {
  const candidates = (state.villages ?? []).filter(village => !village.destroyed && villageCamp(state, village));
  for (const village of candidates) village.nextTradeAt ??= state.time + 90;
  for (const faction of state.factions) {
    if (faction.id <= 0 || faction.villageId !== undefined || faction.defeated || faction.relation === 'confederated'
      || faction.population < 20 || faction.gold < VILLAGE_TRADE_COST + 1000
      || candidates.some(village => village.tradingFactions?.includes(faction.id))) continue;
    const origins = cities.filter(city => city.faction === faction.id);
    const options = candidates.filter(village => state.time >= village.nextTradeAt!
      && !villageHostility(state, village.faction, faction.id))
      .flatMap(village => origins.map(origin => ({ village, origin, camp: villageCamp(state, village)! })));
    options.sort((a, b) => distance(a.origin, a.camp) - distance(b.origin, b.camp) || a.village.id - b.village.id);
    const chosen = options.find(({ origin, camp }) => connection(state, origin, camp));
    if (!chosen) continue;
    spendGold(state, faction, VILLAGE_TRADE_COST, 'diplomacy');
    (chosen.village.tradingFactions ??= []).push(faction.id);
  }
  for (const village of candidates) if (state.time >= village.nextTradeAt!) village.nextTradeAt = state.time + 90;
}

function retire(state: GameState, route: TradeRoute): void {
  const merchant = state.units.find(unit => unit.id === route.merchantId && unit.kind === 'merchant');
  // Closing a route is retirement, never a combat kill or a source of bounty.
  if (merchant) merchant.hp = 0;
}

/** Remember a casualty before route ownership/partner reconciliation can remove
 * its route. A restored or reversed city pair must still wait for a caravan. */
function recordMissingMerchants(state: GameState): void {
  const live = new Set(state.units.filter(unit => unit.kind === 'merchant' && unit.hp > 0).map(unit => unit.id));
  for (const route of state.tradeRoutes ?? []) {
    if (route.merchantId === undefined || live.has(route.merchantId)) continue;
    route.merchantId = undefined;
    route.nextDepartureAt = Math.max(route.nextDepartureAt, state.time + MERCHANT_REPLACEMENT_SECONDS);
    route.distance = 0; route.goal = undefined; route.legValue = undefined; route.riverLeg = undefined; route.nextPlanAt = 0;
    const pair = cityPair(route.origin, route.partner), cooldowns = state.tradeCooldowns ??= {};
    cooldowns[pair] = Math.max(cooldowns[pair] ?? 0, route.nextDepartureAt);
    if (route.villageId !== undefined) {
      const village = villageCooldown(route.villageId, route.faction);
      cooldowns[village] = Math.max(cooldowns[village] ?? 0, route.nextDepartureAt);
    }
  }
  for (const [pair, until] of Object.entries(state.tradeCooldowns ?? {})) {
    if (until <= state.time) delete state.tradeCooldowns![pair];
  }
}

/** Plan only when city membership changes or every five seconds. Each city
 * selects a partner, but both directions share one caravan per city pair.
 * Existing traders retain their route; dead traders refill slowly. */
export function updateTradeRoutes(state: GameState): void {
  const cities = completedCities(state);
  establishFactionVillageTrade(state, cities);
  const villages = (state.villages ?? []).filter(village => !village.destroyed && villageCamp(state, village));
  const partners = villages.flatMap(village => [0, ...new Set(village.tradingFactions ?? [])]
    .filter(faction => villageTradeActive(state, village, faction)).map(faction => ({ village, faction })));
  const signature = `${forbiddenRevision(state)}|${cities.map(city => `${city.id}:${city.faction}`).join(',')}|${state.factions.map(f => `${f.id}:${f.research?.levels.sailing ?? 0}`).join(',')}|${partners.map(({ village, faction }) => `${village.id}:${village.campId}:${faction}`).join(',')}`;
  const previous = planning.get(state);
  if (previous?.signature === signature && state.time < previous.nextAt) return;
  planning.set(state, { signature, nextAt: state.time + PLAN_INTERVAL });
  populations.delete(state);
  recordMissingMerchants(state);
  const cityById = new Map(cities.map(city => [city.id, city])), origins = new Set<number>();
  // Reserve live pairs before considering switches; two returning caravans
  // cannot independently adopt reciprocal copies of the same river service.
  const occupiedPairs = new Map((state.tradeRoutes ?? []).filter(route => route.villageId === undefined
    && cityById.get(route.origin)?.faction === route.faction && cityById.get(route.partner)?.faction === route.faction)
    .map(route => [cityPair(route.origin, route.partner), route.id]));
  const pairs = new Set<string>();
  const retained: TradeRoute[] = [];
  for (const route of state.tradeRoutes ?? []) {
    if (route.villageId !== undefined) {
      const village = villages.find(v => v.id === route.villageId), origin = cityById.get(route.origin);
      if (!village || !villageTradeActive(state, village, route.faction) || !origin || origin.faction !== route.faction
        || route.partner !== village.campId || retained.some(other => other.villageId === village.id && other.faction === route.faction)) { retire(state, route); continue; }
      retained.push(route); pairs.add(cityPair(route.origin, route.partner)); continue;
    }
    const origin = cityById.get(route.origin);
    if (!origin || origin.faction !== route.faction || origins.has(route.origin)) { retire(state, route); continue; }
    let partner = cityById.get(route.partner);
    if (!partner || partner.faction !== route.faction) {
      // Closing an invalid river service retires its vessel normally. A boat
      // cannot be reassigned a land destination in the middle of the river.
      if (state.units.some(unit => unit.id === route.merchantId && unit.aboardRiverTrade)) { retire(state, route); continue; }
      const replacement = choosePartner(state, origin, cities);
      if (!replacement) { retire(state, route); continue; }
      route.partner = replacement.id; route.target = replacement.id; route.distance = 0;
      route.goal = undefined; route.legValue = undefined; route.riverLeg = undefined; route.nextPlanAt = 0;
      partner = replacement;
    }
    const preferredRiver = !findRiverTradeConnection(state, origin, partner) ? riverPartner(state, origin, cities) : undefined;
    route.pendingRiverPartner = preferredRiver?.id;
    if (preferredRiver) {
      const merchant = state.units.find(unit => unit.id === route.merchantId && unit.kind === 'merchant' && unit.hp > 0);
      if (idleAtOrigin(state, route, origin, merchant)) {
        const oldPair = cityPair(route.origin, route.partner), newPair = cityPair(route.origin, preferredRiver.id);
        if (occupiedPairs.get(oldPair) === route.id) occupiedPairs.delete(oldPair);
        if (occupiedPairs.has(newPair) && occupiedPairs.get(newPair) !== route.id) { retire(state, route); continue; }
        route.partner = preferredRiver.id; route.target = preferredRiver.id; route.pendingRiverPartner = undefined;
        route.goal = undefined; route.distance = 0;
        route.nextDepartureAt = Math.max(route.nextDepartureAt, state.tradeCooldowns?.[newPair] ?? 0);
        route.nextPlanAt = Math.max(state.time, route.nextPlanAt ?? 0, route.nextDepartureAt);
        occupiedPairs.set(newPair, route.id);
        if (merchant) { merchant.path = undefined; merchant.pathGoal = undefined; merchant.destination = undefined; merchant.repathAt = 0; }
      }
    }
    const pair = cityPair(route.origin, route.partner);
    if (pairs.has(pair)) { retire(state, route); continue; }
    pairs.add(pair); origins.add(route.origin); retained.push(route);
  }
  for (const origin of cities) {
    if (origins.has(origin.id)) continue;
    const partner = choosePartner(state, origin, cities);
    if (!partner) continue;
    const pair = cityPair(origin.id, partner.id);
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    retained.push({ id: origin.id, faction: origin.faction, origin: origin.id, partner: partner.id, target: partner.id,
      nextDepartureAt: Math.max(state.time, state.tradeCooldowns?.[pair] ?? 0), distance: 0, journeys: 0 });
  }
  for (const { village, faction } of partners) {
    const camp = villageCamp(state, village)!;
    cityById.set(camp.id, camp);
    if (retained.some(route => route.villageId === village.id && route.faction === faction)) continue;
    const origin = cities.filter(city => city.faction === faction)
      .sort((a, b) => distance(a, camp) - distance(b, camp) || a.id - b.id).find(city => connection(state, city, camp));
    if (!origin) continue;
    const pair = cityPair(origin.id, camp.id);
    retained.push({ id: villageRouteId(camp.id, faction), faction, villageId: village.id, origin: origin.id, partner: camp.id, target: camp.id,
      nextDepartureAt: Math.max(state.time, state.tradeCooldowns?.[pair] ?? 0, state.tradeCooldowns?.[villageCooldown(village.id, faction)] ?? 0), distance: 0, journeys: 0 });
  }
  state.tradeRoutes = retained;
  for (const route of retained) {
    const origin = cityById.get(route.origin)!, partner = cityById.get(route.partner)!;
    if (route.villageId === undefined) route.river = findRiverTradeConnection(state, origin, partner);
    const live = state.units.find(unit => unit.id === route.merchantId && unit.kind === 'merchant' && unit.hp > 0);
    if (live) { live.speed = MERCHANT_SPEED; continue; }
    if (state.time < Math.max(route.nextDepartureAt, state.tradeCooldowns?.[cityPair(route.origin, route.partner)] ?? 0,
      route.villageId === undefined ? 0 : state.tradeCooldowns?.[villageCooldown(route.villageId, route.faction)] ?? 0)) continue;
    const connected = route.river ? { start: route.river.origin.door, goal: route.river.origin.shore } : connection(state, origin, partner);
    if (!connected) continue;
    const exits = constructionEdges(state, origin, true).sort((a, b) => distance(a, connected.goal) - distance(b, connected.goal));
    // Merchants pass through other units, including a crowded city entrance.
    const start = exits.find(edge => hasStaticPath(state, edge, connected.goal, route.faction, true));
    if (!start) continue;
    const merchant: Unit = { id: nextId(state), kind: 'merchant', faction: route.faction, ...start,
      name: 'Merchant', hp: 70, maxHp: 70, morale: 100, attack: 0, defense: 1, speed: MERCHANT_SPEED, range: 0,
      order: 'work', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time,
      home: origin.id, tradeRoute: route.id };
    entityStore(state).units.add(merchant); route.merchantId = merchant.id; route.target = partner.id;
    route.distance = 0; route.goal = undefined; route.legValue = undefined; route.riverLeg = undefined; route.nextPlanAt = 0;
  }
}

/** Dispatch through the ordinary movement/collision system. No partial path or
 * proximity to an unreachable city can complete a delivery. */
export function updateMerchant(state: GameState, merchant: Unit, dt: number, move: Move): void {
  const route = state.tradeRoutes?.find(candidate => candidate.id === merchant.tradeRoute && candidate.merchantId === merchant.id);
  if (!route || merchant.hp <= 0) return;
  if (route.faction !== merchant.faction) { merchant.moving = false; return; }
  merchant.speed = MERCHANT_SPEED;
  const village = route.villageId === undefined ? undefined : state.villages?.find(v => v.id === route.villageId);
  if (route.villageId !== undefined && (!village || !villageTradeActive(state, village, route.faction))) { merchant.moving = false; return; }
  const buildings = entityStore(state).buildings, origin = buildings.get(route.origin), partner = buildings.get(route.partner);
  // A capture/destruction can precede the next planning pass. A fixed quote is
  // not permission to deliver after either trading endpoint has been lost.
  if (!origin || origin.kind !== 'palace' || origin.faction !== route.faction || !buildingReady(origin)
    || !partner || !buildingReady(partner) || (village
      ? partner.kind !== 'villageTent' || partner.id !== village.campId
      : partner.kind !== 'palace' || partner.faction !== route.faction)) {
    route.legValue = undefined; route.goal = undefined; route.distance = 0;
    merchant.moving = false; merchant.destination = undefined; merchant.path = undefined; merchant.pathGoal = undefined;
    return;
  }
  const target = route.target === origin.id ? origin : route.target === partner.id ? partner : undefined;
  if (!target || state.factions.find(faction => faction.id === merchant.faction)?.defeated) { merchant.moving = false; return; }
  // Hold the brief home turnaround until the next bounded planning pass can
  // adopt the river partner. Otherwise a 1.5s pause can slip between 5s scans.
  if (route.pendingRiverPartner !== undefined && idleAtOrigin(state, route, origin, merchant)) { merchant.moving = false; return; }
  if (buildingWorkForbidden(state, target, merchant.faction)) {
    merchant.moving = false; merchant.destination = undefined; merchant.path = undefined; route.goal = undefined; return;
  }
  if (!village && (route.riverLeg || route.river && !route.legValue)) {
    if (!route.riverLeg) {
      if (state.time < (route.nextPlanAt ?? 0)) return;
      const distance = beginRiverTradeLeg(state, route, merchant);
      if (distance === undefined) { route.nextPlanAt = state.time + 4; return; }
      quoteDomesticLeg(state, route, distance);
    }
    const before = copy(merchant), arrived = advanceRiverTrade(state, route, merchant, dt, move);
    route.distance += distance(before, merchant);
    if (arrived) finishDelivery(state, route, merchant);
    return;
  }
  if (route.goal && isForbidden(state, route.goal.x, route.goal.y, merchant.faction)) {
    route.goal = undefined; route.nextPlanAt = 0;
    merchant.destination = undefined; merchant.path = undefined; merchant.pathGoal = undefined; merchant.moving = false;
  }
  if (!route.goal || !canWalk(state, route.goal.x, route.goal.y, merchant.faction, undefined, true)
    || (merchant.stuckFor ?? 0) > 2 && state.time >= (route.nextPlanAt ?? 0)) {
    if (state.time < (route.nextPlanAt ?? 0)) return;
    route.nextPlanAt = state.time + 4;
    route.goal = constructionEdges(state, target, true).sort((a, b) => distance(merchant, a) - distance(merchant, b))
      .find(goal => hasStaticPath(state, merchant, goal, merchant.faction, true));
    merchant.path = undefined; merchant.pathGoal = undefined; merchant.repathAt = 0;
    if (!route.goal) { merchant.moving = false; return; }
    merchant.destination = copy(route.goal);
  }
  if (!village && !route.legValue && !planDomesticLeg(state, route, merchant, route.goal)) {
    route.goal = undefined; route.nextPlanAt = state.time + 4;
    merchant.destination = undefined; merchant.path = undefined; merchant.moving = false;
    return;
  }
  const before = copy(merchant);
  move(state, merchant, route.goal, dt);
  route.distance += distance(before, merchant);
  if (distance(merchant, route.goal) > .18) return;
  finishDelivery(state, route, merchant);
}

function finishDelivery(state: GameState, route: TradeRoute, merchant: Unit): void {
  const faction = state.factions.find(candidate => candidate.id === merchant.faction);
  if (!faction) return;
  const village = route.villageId === undefined ? undefined : state.villages?.find(v => v.id === route.villageId);
  const gold = village ? TRADE_INCOME_MULTIPLIER * Math.round(tradePayout(route.distance) * tradeGoldMultiplier(faction) * VILLAGE_TRADE_MULTIPLIER) : route.legValue!.gold;
  if (!village || gold > 0) route.journeys++;
  if (gold > 0) {
    grantIncome(faction, { gold }, state, 'trade');
    if (village) recordVillageTrade(state, village, faction.id, gold);
    if (Math.round(gold) > 0) state.particles.push({ x: merchant.x, y: merchant.y, text: `+${Math.round(gold)} gold`, color: '#efd069', life: 1.4 });
  }
  route.target = route.target === route.origin ? route.partner : route.origin;
  route.distance = 0; route.goal = undefined; route.legValue = undefined; route.riverLeg = undefined; route.nextPlanAt = state.time + 1.5;
  merchant.aboardRiverTrade = false;
  merchant.destination = undefined; merchant.path = undefined; merchant.pathGoal = undefined;
  merchant.moving = false;
}

/** A merchant deliberately creates his travelled road outside borders too.
 * Farms move to a free plot; ditches remain. Water, stairs and solid
 * structures remain untouched, and caravans never open gates in walls. */
export function recordMerchantRoad(state: GameState, merchant: Unit, _from?: Point): boolean {
  if (merchant.kind !== 'merchant' || merchant.hp <= 0 || merchant.inside || merchant.aboardRiverTrade || merchant.tradeRoute === undefined) return false;
  const x = Math.floor(merchant.x), y = Math.floor(merchant.y), key = y * state.world.width + x;
  if (merchant.trafficTile === key) return false;
  merchant.trafficTile = key;
  if (buildingOverlapsVillageBorders(state, 'road', x, y, merchant.faction)) return false;
  const tile = tileAt(state.world, x, y);
  if (!tile || isForbidden(state, x, y, merchant.faction) || WATER.has(tile.terrain) || !ridgeFootprintAllowed(state.world, x, y)
    || ['volcano', 'glacier'].includes(tile.overlay)) return false;
  if (state.buildings.some(building => building.hp > 0 && !isFarmKind(building.kind) && building.kind !== 'irrigation'
    && x >= building.x && x < building.x + buildingWidth(building)
    && y >= building.y && y < building.y + buildingHeight(building))) return false;
  if (!validateNetworkPlacement(state, 'road', x, y, merchant.faction).ok) return false;
  if (!prepareFarmForAutomaticRoad(state, { x, y })) return false;
  entityStore(state).buildings.add({ id: nextId(state), kind: 'road', faction: merchant.faction, x, y, hp: 100, maxHp: 100, capacity: 0 });
  const removedPalm = !!tile.palm, removedTrail = removeVillageTrailAt(state.world, x, y);
  delete tile.palm;
  delete state.traffic?.[String(key)];
  markWorldChanged(state.world, removedPalm || removedTrail ? 'appearance' : 'structure');
  invalidateNavigation(state);
  return true;
}
