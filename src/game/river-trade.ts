import { territory } from './borders';
import { constructionEdges } from './builders';
import { dockShoreCrossingClear, DOCK_DIRECTIONS } from './dock';
import { entityStore } from './entity-store';
import { forbiddenRevision, isForbidden } from './forbidden-zones';
import { canTraverseEdge, canWalk, findPath, hasStaticPath } from './pathfinding';
import { sailingNavigation, sailingPath } from './sailing';
import { buildingReady, distance, isFord, tileAt, WATER, type Building, type GameState, type Point,
  type RiverTradeConnection, type RiverTradeEnd, type TradeRoute, type Unit } from './types';

export const RIVER_TRADE_TILE_VALUE = 2.5;
const MAX_SHORES = 8;
const copy = (p: Point): Point => ({ x: p.x, y: p.y });
export function pathDistance(start: Point, path: readonly Point[]): number {
  let total = 0, previous = start;
  for (const point of path) { total += distance(previous, point); previous = point; }
  return total;
}
const probe = (faction: number, p: Point): Unit => ({ id: -1, kind: 'merchant', faction, ...p, hp: 1,
  morale: 100, attack: 0, defense: 0, speed: 1.3, range: 0, order: 'work', cooldown: 0,
  lastCombat: -100, moving: false, facing: 0, attackTime: 0 });
export const riverTradeUnlocked = (state: GameState, faction: number): boolean =>
  (state.factions.find(owner => owner.id === faction)?.research?.levels.sailing ?? 0) >= 1;
interface Planner { signature: string; shores: Map<number, RiverTradeEnd[]>; pairs: Map<string, RiverTradeConnection | undefined> }
const planners = new WeakMap<GameState, Planner>();

function planner(state: GameState): Planner {
  const borders = territory(state), signature = `${state.world.revision}:${entityStore(state).buildings.revision}:${borders.revision}:${forbiddenRevision(state)}`;
  const old = planners.get(state);
  if (old?.signature === signature) return old;
  const next: Planner = { signature, shores: new Map(), pairs: new Map() }; planners.set(state, next); return next;
}

/** Both bank and adjacent river cell must belong to this city's local area.
 * A distant city's border touching the river cannot lend this city a port. */
function shores(state: GameState, city: Building, cache: Planner): RiverTradeEnd[] {
  const cached = cache.shores.get(city.id); if (cached) return cached;
  const borders = territory(state), cities = state.buildings.filter(b => b.kind === 'palace' && b.faction === city.faction && buildingReady(b));
  const nav = sailingNavigation(state, probe(city.faction, city), true, true), choices: { shore: Point; water: Point }[] = [];
  const nearest = (p: Point): boolean => cities.every(other => other.id === city.id
    || distance({ x: city.x + 1, y: city.y + 1 }, p) < distance({ x: other.x + 1, y: other.y + 1 }, p)
    || distance({ x: city.x + 1, y: city.y + 1 }, p) === distance({ x: other.x + 1, y: other.y + 1 }, p) && city.id < other.id);
  for (let cell = 0; cell < state.world.tiles.length; cell++) {
    if (state.world.tiles[cell].terrain !== 'river' || borders.owners[cell] !== city.faction) continue;
    const water = { x: cell % state.world.width + .5, y: Math.floor(cell / state.world.width) + .5 };
    if (!nearest(water) || !nav.position(water)) continue;
    for (const d of DOCK_DIRECTIONS) {
      const shore = { x: water.x + d.x, y: water.y + d.y }, tile = tileAt(state.world, shore.x, shore.y);
      if (!tile || WATER.has(tile.terrain) || isForbidden(state, shore.x, shore.y, city.faction)
        || borders.owners[Math.floor(shore.y) * state.world.width + Math.floor(shore.x)] !== city.faction
        || !nearest(shore) || !canWalk(state, shore.x, shore.y, city.faction, undefined, true)
        || !dockShoreCrossingClear(state, water, shore)) continue;
      choices.push({ shore, water });
    }
  }
  choices.sort((a, b) => distance(city, a.shore) - distance(city, b.shore) || a.shore.y - b.shore.y || a.shore.x - b.shore.x);
  const ends: RiverTradeEnd[] = [], seen = new Set<string>(), doors = constructionEdges(state, city, true);
  // Probe at most 32 nearby banks, and retain eight reachable alternatives.
  // Land routes use actual walking distance, including walls and waterways.
  for (const candidate of choices.slice(0, 32)) {
    const key = `${candidate.shore.x}:${candidate.shore.y}`; if (seen.has(key)) continue; seen.add(key);
    const door = [...doors].sort((a, b) => distance(a, candidate.shore) - distance(b, candidate.shore))
      .find(p => hasStaticPath(state, p, candidate.shore, city.faction, true));
    if (!door) continue;
    const path = distance(door, candidate.shore) < .01 ? [copy(door)]
      : findPath(state, door, candidate.shore, city.faction, false, undefined, undefined, undefined, true, true);
    if (!path.length || distance(path.at(-1)!, candidate.shore) > .18) continue;
    ends.push({ city: city.id, door, ...candidate, post: { x: Math.floor(candidate.shore.x), y: Math.floor(candidate.shore.y) }, landDistance: pathDistance(door, path) });
    if (ends.length >= MAX_SHORES) break;
  }
  ends.sort((a, b) => a.landDistance - b.landDistance); cache.shores.set(city.id, ends); return ends;
}

/** Same connected river only: oceans/lakes, fords, bridges, cliffs and solid
 * structures cannot substitute for a navigable river stretch. */
export function findRiverTradeConnection(state: GameState, origin: Building, partner: Building): RiverTradeConnection | undefined {
  if (origin.faction !== partner.faction || !riverTradeUnlocked(state, origin.faction)) return;
  const cache = planner(state), key = `${origin.id}:${partner.id}`;
  if (cache.pairs.has(key)) return cache.pairs.get(key);
  const candidates = shores(state, origin, cache).flatMap(a => shores(state, partner, cache).map(b => ({ a, b })))
    .sort((a, b) => a.a.landDistance + a.b.landDistance + distance(a.a.water, a.b.water)
      - b.a.landDistance - b.b.landDistance - distance(b.a.water, b.b.water));
  let result: RiverTradeConnection | undefined, best = Infinity;
  // A bounded set of nearby entrances avoids repeated whole-map searches.
  for (const { a, b } of candidates.slice(0, 16)) {
    const path = sailingPath(state, probe(origin.faction, a.water), b.water, true, true);
    if (!path.length) continue;
    const waterDistance = pathDistance(a.water, path);
    if (waterDistance <= a.landDistance || waterDistance <= b.landDistance) continue;
    const total = a.landDistance + b.landDistance + waterDistance;
    if (total < best) { best = total; result = { origin: a, partner: b, waterPath: [copy(a.water), ...path], waterDistance }; }
  }
  cache.pairs.set(key, result);
  cache.pairs.set(`${partner.id}:${origin.id}`, result && { origin: result.partner, partner: result.origin,
    waterDistance: result.waterDistance, waterPath: [...result.waterPath].reverse() });
  return result;
}

/** Begin from the merchant's real departure point. A journey already quoted
 * on land finishes first; switching to river never teleports a live caravan. */
export function beginRiverTradeLeg(state: GameState, route: TradeRoute, merchant: Unit): number | undefined {
  const connection = route.river; if (!connection) return;
  const fromOrigin = route.target === route.partner, source = fromOrigin ? connection.origin : connection.partner;
  const destination = fromOrigin ? connection.partner : connection.origin;
  const path = distance(merchant, source.shore) < .01 ? [copy(source.shore)]
    : findPath(state, merchant, source.shore, merchant.faction, false, undefined, undefined, undefined, true, true);
  if (!path.length || distance(path.at(-1)!, source.shore) > .18) return;
  const endPath = findPath(state, destination.shore, destination.door, merchant.faction, false, undefined, undefined, undefined, true, true);
  if (!endPath.length || distance(endPath.at(-1)!, destination.door) > .18) return;
  route.riverLeg = { connection, fromOrigin, phase: 'embark', waterPath: (fromOrigin ? connection.waterPath : [...connection.waterPath].reverse()).map(copy) };
  route.goal = copy(destination.door); merchant.path = path; merchant.pathGoal = copy(source.shore); merchant.repathAt = 0;
  return pathDistance(merchant, path) + pathDistance(destination.shore, endPath) + 2 + connection.waterDistance * RIVER_TRADE_TILE_VALUE;
}

type Move = (state: GameState, unit: Unit, goal: Point, dt: number) => void;
function stepToward(unit: Unit, goal: Point, dt: number): void {
  const gap = distance(unit, goal), step = Math.min(gap, unit.speed * dt);
  unit.moving = step > .0001;
  if (!unit.moving) return;
  unit.facing = Math.atan2(goal.y - unit.y, goal.x - unit.x);
  unit.x += (goal.x - unit.x) * step / gap; unit.y += (goal.y - unit.y) * step / gap;
}
const clearOrders = (unit: Unit): void => { unit.path = undefined; unit.pathGoal = undefined; unit.destination = undefined; unit.repathAt = 0; };

/** Decorative, route-owned posts have no independent cost, HP, or building slot. */
export function riverTradingPosts(state: GameState): Point[] {
  const posts = new Map<string, Point>(), buildings = entityStore(state).buildings;
  for (const route of state.tradeRoutes ?? []) {
    const connection = route.riverLeg?.connection ?? route.river;
    if (!connection) continue;
    for (const end of [connection.origin, connection.partner]) {
      const city = buildings.get(end.city);
      if (!city || !buildingReady(city) || city.faction !== route.faction) continue;
      posts.set(`${end.post.x}:${end.post.y}`, end.post);
    }
  }
  return [...posts.values()];
}

/** Shore crossings interpolate at merchant speed; no warps or free shortcuts.
 * The vessel remains the same damageable merchant throughout the itinerary. */
export function advanceRiverTrade(state: GameState, route: TradeRoute, merchant: Unit, dt: number, move: Move): boolean {
  const leg = route.riverLeg!;
  const source = leg.fromOrigin ? leg.connection.origin : leg.connection.partner;
  const destination = leg.fromOrigin ? leg.connection.partner : leg.connection.origin;
  merchant.moving = false;
  if (leg.phase === 'embark') {
    if (!canWalk(state, source.shore.x, source.shore.y, merchant.faction, undefined, true)
      || !dockShoreCrossingClear(state, source.water, source.shore)) {
      if (state.time < (leg.nextRepathAt ?? 0)) return false;
      leg.nextRepathAt = state.time + 4;
      const buildings = entityStore(state).buildings, a = buildings.get(route.origin), b = buildings.get(route.partner);
      const replacement = a && b && findRiverTradeConnection(state, a, b);
      if (replacement) { route.river = replacement; beginRiverTradeLeg(state, route, merchant); }
      return false;
    }
    move(state, merchant, source.shore, dt);
    // Ordinary land movement settles within .12 of its goal. Continue from
    // that real position into the boat; do not snap the final approach.
    if (distance(merchant, source.shore) < .13) { leg.phase = 'board'; clearOrders(merchant); }
  } else if (leg.phase === 'board' || leg.phase === 'disembark') {
    const end = leg.phase === 'board' ? source : destination;
    if (!canWalk(state, end.shore.x, end.shore.y, merchant.faction, undefined, true)
      || !dockShoreCrossingClear(state, end.water, end.shore)) {
      if (leg.phase === 'disembark') {
        // Retrace the transfer if construction appears during disembarkation,
        // then choose another clear bank using the ordinary river replanner.
        stepToward(merchant, end.water, dt);
        if (distance(merchant, end.water) < .001) leg.phase = 'river';
      } else if (!merchant.aboardRiverTrade) {
        // Still on land: use another bank rather than waiting on this order.
        leg.phase = 'embark'; leg.nextRepathAt = 0; clearOrders(merchant);
      } else if (canTraverseEdge(state.world, end.shore, end.water)
        && sailingNavigation(state, merchant, true).position(end.water)) {
        // The transfer has already started. Leave newly obstructed ground
        // toward its clear water, without returning into the new structure.
        stepToward(merchant, end.water, dt);
        if (distance(merchant, end.water) < .001) leg.phase = 'river';
      }
      return false;
    }
    if (!sailingNavigation(state, merchant, true).position(end.water)) return false;
    merchant.aboardRiverTrade = true;
    stepToward(merchant, leg.phase === 'board' ? end.water : end.shore, dt);
    if (distance(merchant, leg.phase === 'board' ? end.water : end.shore) < .001) {
      if (leg.phase === 'board') leg.phase = 'river';
      else { leg.phase = 'city'; merchant.aboardRiverTrade = false; clearOrders(merchant); }
    }
  } else if (leg.phase === 'river') {
    if (!canWalk(state, destination.shore.x, destination.shore.y, merchant.faction, undefined, true)
      || !dockShoreCrossingClear(state, destination.water, destination.shore)) {
      if (state.time < (leg.nextRepathAt ?? 0)) return false;
      leg.nextRepathAt = state.time + 4;
      const buildings = entityStore(state).buildings, a = buildings.get(route.origin), b = buildings.get(route.partner);
      const replacement = a && b && findRiverTradeConnection(state, a, b);
      if (replacement) {
        const end = leg.fromOrigin ? replacement.partner : replacement.origin;
        const path = sailingPath(state, merchant, end.water, true);
        if (path.length) { leg.connection = replacement; leg.waterPath = path; route.river = replacement; route.goal = copy(end.door); }
      }
      return false;
    }
    while (leg.waterPath.length && distance(merchant, leg.waterPath[0]) < .025) leg.waterPath.shift();
    if (!leg.waterPath.length && distance(merchant, destination.water) < .03) { leg.phase = 'disembark'; return false; }
    const next = leg.waterPath[0];
    if (!next || !sailingNavigation(state, merchant, true).segment(merchant, next)) {
      if (state.time >= (leg.nextRepathAt ?? 0)) {
        leg.waterPath = sailingPath(state, merchant, destination.water, true); leg.nextRepathAt = state.time + 1;
      }
      return false;
    }
    stepToward(merchant, next, dt);
  } else {
    if (!canWalk(state, destination.door.x, destination.door.y, merchant.faction, undefined, true)) {
      if (state.time < (leg.nextRepathAt ?? 0)) return false;
      leg.nextRepathAt = state.time + 4;
      const city = entityStore(state).buildings.get(destination.city);
      const door = city && constructionEdges(state, city, true).find(p => hasStaticPath(state, merchant, p, merchant.faction, true));
      if (!door) return false;
      destination.door = door; route.goal = copy(door); clearOrders(merchant);
    }
    move(state, merchant, destination.door, dt);
    return distance(merchant, destination.door) < .18;
  }
  return false;
}
