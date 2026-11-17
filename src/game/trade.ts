import { factionTradeActive } from './faction-trade-agreements';
import { rustEngine } from './rust-engine';
import { unitNavigationState } from './unit-navigation';
import { atWar } from './relations';
import { playerFaction } from './player-context';
import { spendGold } from './gold-ledger';
import { grantIncome } from './resource-income';
import { removeVillageTrailAt } from './village-trails';
import { prepareFarmForAutomaticRoad } from './automatic-road-farms';
import { forbiddenRevision, isForbidden } from './forbidden-zones';
import { buildingWorkForbidden } from './forbidden-work';
import { buildingOverlapsVillageBorders } from './border-placement';
import { entityStore } from './entity-store';
import { solidBuildingAt, structuresOf, STRUCTURE_READY } from './structure-index';
import { cityResidents } from './cities';
import { markWorldChanged } from './world-revisions';
import { constructionEdges } from './builders';
import { validateNetworkPlacement } from './network-placement';
import { workNavigationState, canWalk, findPath, hasStaticPath, invalidateNavigation, withNavigationFrame } from './pathfinding';
import { reliefFootprintAllowed } from './relief';
import { regionalTradeMultiplier } from './regional-economy';
import { factionHasDevelopedResource, oliveVillageTradeMultiplier } from './resource-development';
import { tradeGoldMultiplier } from './research-bonuses';
import { villageCamp, villageTradeActive, villageRequiredResource, VILLAGE_TRADE_MULTIPLIER, VILLAGE_TRADE_BASE_SCALE, VILLAGE_RESOURCE_MULTIPLIER } from './villages';
import { settlementTrade, villageTradingFactions, villageTradeOrigin } from './settlement-bridge';
import { buildingReady, buildingWidth, buildingHeight, distance, isFarmKind, tileAt, WATER, type Building, type GameState, type NeutralVillage, type Point, type TradeRoute, type Unit } from './types';
import { advanceRiverTrade, beginRiverTradeLeg, findRiverTradeConnection, RIVER_TRADE_TIME_MULTIPLIER } from './river-trade';

export const TRADE_INCOME_MULTIPLIER = 3 * 1.15;
export const TRADE_GOLD_PER_TILE = 1;
export const DOMESTIC_TRADE_GOLD_PER_TILE = .5 * TRADE_INCOME_MULTIPLIER;
export const DOMESTIC_TRADE_POPULATION_SCALE = 50;
export const DOMESTIC_TRADE_MATURITY_START = 20;
export const DOMESTIC_TRADE_MATURITY_FULL = 30;
export const DOMESTIC_TRADE_YOUNG_CITY_CAP = 2 * TRADE_INCOME_MULTIPLIER;
export const MERCHANT_BOUNTY = 200;
export const MERCHANT_REPLACEMENT_SECONDS = 240;
export const MERCHANT_SPEED = 1.3;
const PLAN_INTERVAL = 10;
const planning = new WeakMap<GameState, { signature: string; nextAt: number }>();
type Move = (state: GameState, unit: Unit, goal: Point, dt: number) => void;

/** Village active-transit rate, calibrated to an ordinary merchant on land. */
export function tradePayout(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds * MERCHANT_SPEED * TRADE_GOLD_PER_TILE : 0;
}

/** A complete village delivery, shared by settlement payments and popup
 * estimates. Demand uses the trading faction's current resource access, not
 * the village's own deposits. Fractional receipts accumulate without rounding. */
export function villageTradePayout(state: GameState, village: NeutralVillage, factionId: number, seconds: number,
  hasResourceOverride?: boolean): number {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  if (!faction) return 0;
  const supplied = hasResourceOverride ?? factionHasDevelopedResource(state, factionId, villageRequiredResource(state, village));
  const base = TRADE_INCOME_MULTIPLIER * tradePayout(seconds) * tradeGoldMultiplier(faction) * VILLAGE_TRADE_MULTIPLIER
    * oliveVillageTradeMultiplier(state, factionId) * VILLAGE_TRADE_BASE_SCALE;
  return base * (supplied ? VILLAGE_RESOURCE_MULTIPLIER : 1);
}

/** A city's trade capacity is its residents, shared among its connections.
 * The harmonic mean limits an outpost's demand even beside a large capital.
 * Maturity uses unshared resident counts: either endpoint at 20 or fewer caps
 * the rate at six gold per 30 active seconds, reaching full value by 30 residents.
 * Keep the fractional result: a small city's first deliveries still matter. */
export function domesticTradePayout(seconds: number, originShare: number, partnerShare: number, bonus = 1,
  residents = { origin: originShare, partner: partnerShare }, achievements = 0, domestic = true): number {
  return rustEngine.achievement_domestic_trade(seconds, originShare, partnerShare, bonus,
    residents.origin, residents.partner, achievements, Number(domestic));
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
      || factions.get(route.origin) !== route.faction || factions.get(route.partner) !== (route.partnerFaction ?? route.faction)
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

/** Lock the population-supported rate before departing. Actual active travel
 * time determines the receipt; stopped caravans accrue nothing. */
function planDomesticLeg(state: GameState, route: TradeRoute, merchant: Unit, goal: Point): boolean {
  return withNavigationFrame(state, () => {
    const path = findPath(unitNavigationState(state, merchant), merchant, goal, merchant.faction, false, undefined, undefined, undefined, true, true);
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
    goldPerSecond: domesticTradePayout(1, originShare, partnerShare, bonus,
      { origin: residents.get(route.origin) ?? 0, partner: residents.get(route.partner) ?? 0 }, faction?.achievements ?? 0,
      origin?.faction === partner?.faction) };
}

function nextId(state: GameState): number { return entityStore(state).allocateId(); }
const copy = (point: Point): Point => ({ x: point.x, y: point.y });
const cityPair = (a: number, b: number): string => a < b ? `${a}:${b}` : `${b}:${a}`;
const villageCooldown = (villageId: number, faction: number): string => `village:${villageId}:${faction}`;
// Negative route IDs cannot collide with positive city-building route IDs.
const villageRouteId = (camp: number, faction: number): number => -((camp + faction) * (camp + faction + 1) / 2 + faction + 1);
const completedCities = (state: GameState): Building[] => structuresOf(state, undefined, STRUCTURE_READY, 'palace')
  .filter(building => state.factions.some(faction => faction.id === building.faction && !faction.defeated));

/** One static component probe rejects an inaccessible city before pathfinding.
 * Prefer the nearest clear pair of doors, keeping all movement outside walls. */
export function tradeConnection(state: GameState, origin: Building, partner: Building): { start: Point; goal: Point } | undefined {
  if (buildingWorkForbidden(state, origin) || buildingWorkForbidden(state, partner, origin.faction)) return;
  const navigation = origin.faction === partner.faction ? state : workNavigationState(state, false, origin.faction, partner.faction);
  const pairs = constructionEdges(navigation, origin, true).flatMap(start => constructionEdges(navigation, partner, true).map(goal => ({ start, goal })));
  pairs.sort((a, b) => distance(a.start, a.goal) - distance(b.start, b.goal));
  return pairs.find(({ start, goal }) => distance(start, goal) >= 1 && hasStaticPath(navigation, start, goal, origin.faction, true));
}

function riverPartner(state: GameState, origin: Building, cities: Building[]): Building | undefined {
  return cities.filter(city => city.id !== origin.id && city.faction === origin.faction)
    .sort((a, b) => distance(origin, b) - distance(origin, a) || a.id - b.id)
    .find(city => findRiverTradeConnection(state, origin, city));
}
function choosePartner(state: GameState, origin: Building, cities: Building[]): Building | undefined {
  return riverPartner(state, origin, cities) ?? cities.filter(city => city.id !== origin.id && city.faction === origin.faction)
    .sort((a, b) => distance(origin, b) - distance(origin, a) || a.id - b.id)
    .find(city => tradeConnection(state, origin, city));
}

function idleAtOrigin(state: GameState, route: TradeRoute, origin: Building, merchant?: Unit): boolean {
  return !merchant || !route.legValue && !route.riverLeg && route.target === route.partner
    && constructionEdges(state, origin, true).some(door => distance(merchant, door) <= .2);
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
    route.distance = 0; route.transitSeconds = 0; route.goal = undefined; route.legValue = undefined; route.riverLeg = undefined; route.nextPlanAt = 0;
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
  const villages = (state.villages ?? []).filter(village => !village.destroyed && villageCamp(state, village));
  const partners = villages.flatMap(village => villageTradingFactions(state, village)
    .filter(faction => villageTradeActive(state, village, faction)).map(faction => ({ village, faction })));
  const signature = `${JSON.stringify(state.factionTrades ?? [])}:${state.factions.map(f => f.relation).join()}|${forbiddenRevision(state)}|${cities.map(city => `${city.id}:${city.faction}`).join(',')}|${state.factions.map(f => `${f.id}:${f.research?.levels.sailing ?? 0}`).join(',')}|${partners.map(({ village, faction }) => `${village.id}:${village.campId}:${faction}`).join(',')}`;
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
    if (route.partnerFaction !== undefined) {
      const origin = cityById.get(route.origin), partner = cityById.get(route.partner);
      if (!origin || !partner || origin.faction !== route.faction || partner.faction !== route.partnerFaction
        || !factionTradeActive(state, route.faction, route.partnerFaction)) { retire(state, route); continue; }
      retained.push(route); pairs.add(cityPair(route.origin, route.partner)); continue;
    }
    if (route.villageId !== undefined) {
      const village = villages.find(v => v.id === route.villageId);
      const origin = village ? cityById.get(villageTradeOrigin(state, village, route.faction, route.origin)) : undefined;
      if (!village || !villageTradeActive(state, village, route.faction) || !origin || origin.id !== route.origin
        || route.partner !== village.campId || retained.some(other => other.villageId === village.id && other.faction === route.faction)) { retire(state, route); continue; }
      // Village services never reserve a domestic origin or city-pair slot.
      retained.push(route); continue;
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
      route.partner = replacement.id; route.target = replacement.id; route.distance = 0; route.transitSeconds = 0;
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
        route.goal = undefined; route.distance = 0; route.transitSeconds = 0;
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
    const preferred = villageTradeOrigin(state, village, faction);
    const origin = cities.filter(city => city.faction === faction)
      .sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred) || distance(a, camp) - distance(b, camp) || a.id - b.id).find(city => tradeConnection(state, city, camp));
    if (!origin) continue;
    const pair = cityPair(origin.id, camp.id);
    retained.push({ id: villageRouteId(camp.id, faction), faction, villageId: village.id, origin: origin.id, partner: camp.id, target: camp.id,
      nextDepartureAt: Math.max(state.time, state.tradeCooldowns?.[pair] ?? 0, state.tradeCooldowns?.[villageCooldown(village.id, faction)] ?? 0), distance: 0, journeys: 0 });
  }
  state.factionTrades = (state.factionTrades ?? []).filter(agreement => factionTradeActive(state, agreement.faction, agreement.partnerFaction)
    && cityById.get(agreement.origin)?.faction === agreement.faction && cityById.get(agreement.partner)?.faction === agreement.partnerFaction);
  for (const agreement of state.factionTrades) {
    const pair = cityPair(agreement.origin, agreement.partner);
    if (pairs.has(pair)) continue;
    const a = Math.min(agreement.origin, agreement.partner), b = Math.max(agreement.origin, agreement.partner);
    retained.push({ ...agreement, id: -1000000000 - ((a + b) * (a + b + 1) / 2 + b), target: agreement.partner,
      nextDepartureAt: Math.max(state.time, state.tradeCooldowns?.[pair] ?? 0), distance: 0, journeys: 0 });
    pairs.add(pair);
  }
  state.tradeRoutes = retained;
  for (const route of retained) {
    const origin = cityById.get(route.origin)!, partner = cityById.get(route.partner)!;
    if (route.villageId === undefined) route.river = findRiverTradeConnection(state, origin, partner);
    const live = state.units.find(unit => unit.id === route.merchantId && unit.kind === 'merchant' && unit.hp > 0);
    if (live) { live.speed = MERCHANT_SPEED; continue; }
    if (state.time < Math.max(route.nextDepartureAt, state.tradeCooldowns?.[cityPair(route.origin, route.partner)] ?? 0,
      route.villageId === undefined ? 0 : state.tradeCooldowns?.[villageCooldown(route.villageId, route.faction)] ?? 0)) continue;
    const connected = route.river ? { start: route.river.origin.door, goal: route.river.origin.shore } : tradeConnection(state, origin, partner);
    if (!connected) continue;
    const exits = constructionEdges(state, origin, true).sort((a, b) => distance(a, connected.goal) - distance(b, connected.goal));
    // Merchants pass through other units, including a crowded city entrance.
    const start = exits.find(edge => hasStaticPath(workNavigationState(state, false, route.faction, route.partnerFaction), edge, connected.goal, route.faction, true));
    if (!start) continue;
    const merchant: Unit = { id: nextId(state), kind: 'merchant', faction: route.faction, ...start,
      name: 'Merchant', hp: 70, maxHp: 70, morale: 100, attack: 0, defense: 1, speed: MERCHANT_SPEED, range: 0,
      order: 'work', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time,
      home: origin.id, tradeRoute: route.id };
    entityStore(state).units.add(merchant); route.merchantId = merchant.id; route.target = partner.id;
    route.distance = 0; route.transitSeconds = 0; route.goal = undefined; route.legValue = undefined; route.riverLeg = undefined; route.nextPlanAt = 0;
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
  const navigation = unitNavigationState(state, merchant);
  const buildings = entityStore(state).buildings, origin = buildings.get(route.origin), partner = buildings.get(route.partner);
  // A capture/destruction can precede the next planning pass. A fixed quote is
  // not permission to deliver after either trading endpoint has been lost.
  if (!origin || origin.kind !== 'palace' || origin.faction !== route.faction || !buildingReady(origin)
    || !partner || !buildingReady(partner) || (village
      ? partner.kind !== 'villageTent' || partner.id !== village.campId
      : partner.kind !== 'palace' || partner.faction !== (route.partnerFaction ?? route.faction)
        || route.partnerFaction !== undefined && !factionTradeActive(state, route.faction, route.partnerFaction))) {
    route.legValue = undefined; route.goal = undefined; route.distance = 0; route.transitSeconds = 0;
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
    const before = copy(merchant), facing = merchant.facing, water = merchant.aboardRiverTrade;
    const arrived = advanceRiverTrade(state, route, merchant, dt, move);
    recordTransit(route, merchant, before, facing, dt, !!water);
    if (arrived) finishDelivery(state, route, merchant);
    return;
  }
  if (route.goal && isForbidden(state, route.goal.x, route.goal.y, merchant.faction)) {
    route.goal = undefined; route.nextPlanAt = 0;
    merchant.destination = undefined; merchant.path = undefined; merchant.pathGoal = undefined; merchant.moving = false;
  }
  if (!route.goal || !canWalk(navigation, route.goal.x, route.goal.y, merchant.faction, undefined, true)
    || (merchant.stuckFor ?? 0) > 2 && state.time >= (route.nextPlanAt ?? 0)) {
    if (state.time < (route.nextPlanAt ?? 0)) return;
    route.nextPlanAt = state.time + 4;
    route.goal = constructionEdges(navigation, target, true).sort((a, b) => distance(merchant, a) - distance(merchant, b))
      .find(goal => hasStaticPath(navigation, merchant, goal, merchant.faction, true));
    merchant.path = undefined; merchant.pathGoal = undefined; merchant.repathAt = 0;
    if (!route.goal) { merchant.moving = false; return; }
    merchant.destination = copy(route.goal);
  }
  if (!village && !route.legValue && !planDomesticLeg(state, route, merchant, route.goal)) {
    route.goal = undefined; route.nextPlanAt = state.time + 4;
    merchant.destination = undefined; merchant.path = undefined; merchant.moving = false;
    return;
  }
  const before = copy(merchant), facing = merchant.facing;
  move(state, merchant, route.goal, dt);
  recordTransit(route, merchant, before, facing, dt, false);
  if (distance(merchant, route.goal) > .18) return;
  finishDelivery(state, route, merchant);
}

function finishDelivery(state: GameState, route: TradeRoute, merchant: Unit): void {
  const faction = state.factions.find(candidate => candidate.id === merchant.faction);
  if (!faction) return;
  const village = route.villageId === undefined ? undefined : state.villages?.find(v => v.id === route.villageId);
  const gold = village ? villageTradePayout(state, village, faction.id, (route.transitSeconds ?? 0)) : route.legValue!.goldPerSecond * (route.transitSeconds ?? 0);
  if (!village || gold > 0) route.journeys++;
  if (gold > 0) {
    grantIncome(faction, { gold }, state, 'trade');
    if (route.partnerFaction !== undefined) {
      const partner = state.factions.find(f => f.id === route.partnerFaction);
      if (partner) grantIncome(partner, { gold }, state, 'trade');
    }
    // Delivered gold feeds settlement affiliation (and the village treasury).
    if (village) { if (villageTradeActive(state, village, faction.id)) settlementTrade(state, village.campId, route.origin, faction.id, -1, gold, 1); }
    else if (route.partnerFaction !== undefined) settlementTrade(state, route.origin, route.partner, faction.id, route.partnerFaction, gold, 3);
    else settlementTrade(state, route.origin, route.partner, faction.id, faction.id, gold, 2);
    if (Math.round(gold) > 0) state.particles.push({ x: merchant.x, y: merchant.y, text: `+${Math.round(gold)} gold`, color: '#ffe33d', life: 1.4, duration: 1.4 });
  }
  route.target = route.target === route.origin ? route.partner : route.origin;
  route.distance = 0; route.transitSeconds = 0; route.goal = undefined; route.legValue = undefined; route.riverLeg = undefined; route.nextPlanAt = state.time + 1.5;
  merchant.aboardRiverTrade = false;
  merchant.destination = undefined; merchant.path = undefined; merchant.pathGoal = undefined;
  merchant.moving = false;
}

/** A merchant deliberately creates his travelled road outside borders too.
 * Farms move to a free plot; ditches remain. Water, cliff faces and solid
 * structures remain untouched, and caravans never open gates in walls. */
export function recordMerchantRoad(state: GameState, merchant: Unit, _from?: Point): boolean {
  if (merchant.kind !== 'merchant' || merchant.hp <= 0 || merchant.inside || merchant.aboardRiverTrade || merchant.tradeRoute === undefined) return false;
  const x = Math.floor(merchant.x), y = Math.floor(merchant.y), key = y * state.world.width + x;
  if (merchant.trafficTile === key) return false;
  merchant.trafficTile = key;
  if (buildingOverlapsVillageBorders(state, 'road', x, y, merchant.faction)) return false;
  const tile = tileAt(state.world, x, y);
  if (!tile || isForbidden(state, x, y, merchant.faction) || WATER.has(tile.terrain) || !reliefFootprintAllowed(state.world, x, y)
    || ['volcano', 'glacier'].includes(tile.overlay)) return false;
  if (solidBuildingAt(state, x, y)) return false;
  if (!validateNetworkPlacement(state, 'road', x, y, merchant.faction).ok) return false;
  if (!prepareFarmForAutomaticRoad(state, { x, y })) return false;
  entityStore(state).buildings.add({ id: nextId(state), kind: 'road', faction: merchant.faction, x, y, hp: 100, maxHp: 100, capacity: 0 });
  const removedPalm = !!tile.palm, removedTrail = removeVillageTrailAt(state.world, x, y);
  delete tile.palm;
  delete state.traffic?.[String(key)];
  markWorldChanged(state.world, removedPalm || removedTrail ? 'appearance' : 'structure', removedPalm || removedTrail ? [key] : []);
  invalidateNavigation(state);
  return true;
}

/** Only active travel earns value: paused, parked or blocked traders do not.
 * Boat steering counts as transit; its existing river premium is preserved. */
function recordTransit(route: TradeRoute, merchant: Unit, before: Point, facing: number, dt: number, water: boolean): void {
  const moved = distance(before, merchant);
  route.distance += moved;
  if (Number.isFinite(dt) && dt > 0 && (moved > 1e-7 || water && Math.abs(facing - merchant.facing) > 1e-7))
    route.transitSeconds = (route.transitSeconds ?? 0) + dt * (water ? RIVER_TRADE_TIME_MULTIPLIER : 1);
}

export const FACTION_TRADE_COST = 250;
export function factionTradeStatus(state: GameState, partnerFaction: number, faction = playerFaction(state), buildingId?: number) {
  const active = factionTradeActive(state, faction, partnerFaction);
  const owner = state.factions.find(f => f.id === faction), partner = state.factions.find(f => f.id === partnerFaction);
  const fail = (message: string) => ({ ok: false, message, active, cost: FACTION_TRADE_COST, origin: undefined as Building | undefined, partner: undefined as Building | undefined });
  if (active) return fail('Trade route established.');
  if (state.gameOver || !owner || !partner || owner.defeated || partner.defeated || faction === partnerFaction || partner.villageId !== undefined || partner.relation === 'confederated') return fail('This faction is unavailable for trade.');
  if (atWar(state, faction, partnerFaction)) return fail('Trade requires peace.');
  if (owner.gold < FACTION_TRADE_COST) return fail('Need 250 gold.');
  const endpoints = findFactionTradeEndpoints(state, partnerFaction, faction, buildingId);
  if (endpoints) return { ok: true, message: '', active: false, cost: FACTION_TRADE_COST, ...endpoints };
  return fail('No reachable town trade route.');
}
/** Presentation quote using the same population capacity and payout function
 * as actual deliveries. Turnarounds, blockages and mixed river legs can lower
 * the realized rate; this is gold per active transit time, before Science. */
export function factionTradeIncomeEstimate(state: GameState, origin: Building, partner: Building): number {
  const snapshot = domesticTradePopulationSnapshot(state);
  const active = !!state.tradeRoutes?.some(r => r.partnerFaction !== undefined
    && (r.origin === origin.id && r.partner === partner.id || r.origin === partner.id && r.partner === origin.id));
  const share = (city: Building): number => {
    const population = snapshot.residents.get(city.id) ?? 0, current = snapshot.shares.get(city.id) ?? population;
    const hasRoute = state.tradeRoutes?.some(r => r.villageId === undefined && r.merchantId !== undefined && (r.origin === city.id || r.partner === city.id));
    return !active && hasRoute && current > 0 ? population / (population / current + 1) : current;
  };
  const owner = state.factions.find(f => f.id === origin.faction);
  const bonus = regionalTradeMultiplier(state.world, origin, partner, state) * tradeGoldMultiplier(owner);
  return domesticTradePayout(30, share(origin), share(partner), bonus,
    { origin: snapshot.residents.get(origin.id) ?? 0, partner: snapshot.residents.get(partner.id) ?? 0 });
}
/** Reachability query shared by diplomacy; it never charges a treaty fee. */
export function findFactionTradeEndpoints(state: GameState, partnerFaction: number, faction: number, buildingId?: number): { origin: Building; partner: Building } | undefined {
  const cities = completedCities(state), selected = state.buildings.find(b => b.id === buildingId && b.faction === partnerFaction);
  const targets = cities.filter(b => b.faction === partnerFaction).sort((a,b) => selected ? distance(a,selected)-distance(b,selected) : a.id-b.id);
  for (const target of targets) {
    const origins = cities.filter(b => b.faction === faction).sort((a,b) => distance(a,target)-distance(b,target));
    const origin = origins.find(b => tradeConnection(state,b,target) || findRiverTradeConnection(state,b,target,true));
    if (origin) return { origin, partner: target };
  }
  return undefined;
}
export function establishFactionTrade(state: GameState, partnerFaction: number, faction = playerFaction(state), buildingId?: number): { ok: boolean; message: string } {
  const status = factionTradeStatus(state, partnerFaction, faction, buildingId);
  if (!status.ok || !status.origin || !status.partner) return { ok: false, message: status.message };
  spendGold(state, state.factions.find(f => f.id === faction)!, status.cost, 'diplomacy');
  (state.factionTrades ??= []).push({ faction, partnerFaction, origin: status.origin.id, partner: status.partner.id });
  updateTradeRoutes(state);
  return { ok: true, message: 'Trade route established. Both factions earn gold on completed deliveries.' };
}
