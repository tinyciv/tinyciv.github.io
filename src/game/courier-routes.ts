import { farmTravelRevision } from './farm-travel';
import { buildingBlockerView, canMove, canTraverseEdge, canWalk, findPath, navigationRouteStamp, navigationRouteUnchanged, ReversePathQuery, withNavigationFrame, type NavigationRouteStamp, type CellBlockers } from './pathfinding';
import type { GameState, Point } from './types';

// Cache routes that have actually been requested, rather than filling a whole
// world-sized distance map for every palace entrance. Immutable tails can be
// shared by other couriers starting anywhere along a previous return journey.
interface RouteNode { readonly cell: number; readonly next?: RouteNode }
interface DestinationRoutes {
  nodes: Map<number, RouteNode>; allocated: number; stamp: NavigationRouteStamp; generation: object; refreshedAt: number;
}
interface SharedReturnField { query: ReversePathQuery; createdAt: number; }
interface RouteCache {
  generation: object; world: GameState['world']; doors: Map<string, DestinationRoutes>; allocated: number;
  fields: Map<string, SharedReturnField>; reverseExpanded: number; reverseSearches: number; reverseHits: number;
  hits: number; searches: number; fallbacks: number;
}
export const COURIER_OUTBOUND_TARGET_LIMIT = 2048;
export const COURIER_OUTBOUND_NODE_LIMIT = 131_072;
export const COURIER_ROUTE_MAX_AGE = 120;
const MAX_DOORS = 64, MAX_NODES = 16_384, MAX_REVERSE_NODES = 65_536;
const caches = new WeakMap<GameState, RouteCache>();
const outboundCaches = new WeakMap<GameState, RouteCache>();

function cacheFor(state: GameState, owner = caches): RouteCache {
  const generation = farmTravelRevision(state);
  let cache = owner.get(state);
  if (!cache) {
    cache = { generation, world: state.world, doors: new Map(), allocated: 0, hits: 0, searches: 0, fallbacks: 0,
      fields: new Map(), reverseExpanded: 0, reverseSearches: 0, reverseHits: 0 };
    owner.set(state, cache);
  } else if (cache.world !== state.world) {
    cache.world = state.world; cache.doors.clear(); cache.fields.clear(); cache.allocated = 0;
  }
  // Generation publishes batched road costs; only affected route regions
  // expire. Unrelated construction no longer empties every courier's cache.
  cache.generation = generation;
  return cache;
}

/** Cumulative per-game counters permit profiling reuse without timing hot code. */
export function courierRouteCacheStats(state: GameState): {
  hits: number; searches: number; fallbacks: number; doors: number; nodes: number;
  outboundHits: number; outboundSearches: number; outboundTargets: number; outboundNodes: number;
  reverseFields: number; reverseNodes: number; reverseExpanded: number; reverseSearches: number; reverseHits: number;
} {
  const cache = caches.get(state), outbound = outboundCaches.get(state);
  return { hits: cache?.hits ?? 0, searches: cache?.searches ?? 0, fallbacks: cache?.fallbacks ?? 0,
    doors: cache?.doors.size ?? 0, nodes: cache?.allocated ?? 0,
    outboundHits: outbound?.hits ?? 0, outboundSearches: outbound?.searches ?? 0,
    outboundTargets: outbound?.doors.size ?? 0, outboundNodes: outbound?.allocated ?? 0,
    reverseFields: cache?.fields.size ?? 0, reverseNodes: cache ? [...cache.fields.values()].reduce((sum, field) => sum + field.query.size, 0) : 0,
    reverseExpanded: cache?.reverseExpanded ?? 0, reverseSearches: cache?.reverseSearches ?? 0, reverseHits: cache?.reverseHits ?? 0 };
}

function remember(state: GameState, faction: number, cache: RouteCache, key: string, cells: number[], maxTargets: number, maxNodes: number): void {
  if (cells.length > maxNodes) return;
  // Reserve the worst-case allocation before linking nodes. The count may
  // overestimate retained nodes after replacement, which keeps the bound safe.
  while (cache.allocated + cells.length > maxNodes || !cache.doors.has(key) && cache.doors.size >= maxTargets) {
    const oldest = cache.doors.keys().next().value;
    if (oldest === undefined) break;
    cache.allocated -= cache.doors.get(oldest)!.allocated; cache.doors.delete(oldest);
  }
  const door = cache.doors.get(key) ?? { nodes: new Map<number, RouteNode>(), allocated: 0,
    stamp: navigationRouteStamp(state, faction, cells), generation: cache.generation, refreshedAt: state.time };
  let next: RouteNode | undefined;
  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i], old = door.nodes.get(cell);
    if (old && old.next === next) next = old;
    else {
      next = { cell, next }; door.nodes.set(cell, next);
      door.allocated++; cache.allocated++;
    }
  }
  door.stamp = navigationRouteStamp(state, faction, door.nodes.keys());
  cache.doors.delete(key); cache.doors.set(key, door);
}

function cachedPath(state: GameState, from: Point, faction: number, first: RouteNode, blockers?: CellBlockers): Point[] | undefined {
  const width = state.world.width, start = first.cell;
  const buildings = buildingBlockerView(state, faction);
  const occupied = { has: (cell: number) => buildings.has(cell) || cell !== start && !!blockers?.has(cell) };
  if (!canWalk(state, from.x, from.y, faction, occupied, true)) return;
  const path: Point[] = [];
  let previous = { x: start % width + .5, y: Math.floor(start / width) + .5 };
  for (let node = first.next; node; node = node.next) {
    const point = { x: node.cell % width + .5, y: Math.floor(node.cell / width) + .5 };
    // Check live access even while routine road-cost updates are coalesced.
    if (!canWalk(state, point.x, point.y, faction, occupied, true) || !canTraverseEdge(state.world, previous, point)) return;
    path.push(point); previous = point;
  }
  // As in A*, an off-center unit may need to center before a diagonal step.
  if (path.length && !canMove(state, from, path[0], faction, occupied, true))
    path.unshift({ x: start % width + .5, y: Math.floor(start / width) + .5 });
  return path;
}

/** Weighted searches always run in their actual travel direction. The same
 * immutable suffix storage serves returns and outbound journeys, independently. */
function sharedStaticPath(state: GameState, from: Point, goalPoint: Point, faction: number,
  cache: RouteCache, maxTargets: number, maxNodes: number, blockers?: CellBlockers, sharedReturn = false): Point[] | undefined {
  const width = state.world.width;
  const cell = (point: Point): number => Math.floor(point.y) * width + Math.floor(point.x);
  const start = cell(from), goal = cell(goalPoint), key = `${faction}:${goalPoint.x},${goalPoint.y}`;
  let destination = cache.doors.get(key);
  if (destination && (state.time < destination.refreshedAt || state.time >= destination.refreshedAt + COURIER_ROUTE_MAX_AGE
    || !navigationRouteUnchanged(state, faction, destination.stamp, destination.generation !== cache.generation))) {
    cache.allocated -= destination.allocated; cache.doors.delete(key); destination = undefined;
  }
  if (destination) destination.generation = cache.generation;
  const first = destination?.nodes.get(start);
  if (first && start !== goal) {
    const path = cachedPath(state, from, faction, first, blockers);
    if (path) {
      cache.hits++; cache.doors.delete(key); cache.doors.set(key, destination!);
      return path;
    }
  }
  // Static searches can use the native kernel; transient occupancy is checked
  // against the result and never teaches a detour to the shared cache.
  let path: Point[] | undefined, reverseReused = false;
  if (sharedReturn) {
    let field = cache.fields.get(key);
    if (!field || state.time < field.createdAt || state.time >= field.createdAt + COURIER_ROUTE_MAX_AGE) {
      field = { query: new ReversePathQuery({ ...goalPoint }, faction), createdAt: state.time };
    }
    cache.fields.delete(key); cache.fields.set(key, field);
    const result = field.query.findReversePath(state, from);
    cache.reverseExpanded += result.expanded;
    if (result.expanded) { cache.reverseSearches++; cache.searches++; }
    else if (result.path) reverseReused = true;
    path = result.path;
    let nodes = [...cache.fields.values()].reduce((total, entry) => total + entry.query.size, 0);
    while (cache.fields.size > MAX_DOORS || nodes > MAX_REVERSE_NODES) {
      const oldest = cache.fields.keys().next().value!;
      nodes -= cache.fields.get(oldest)!.query.size; cache.fields.delete(oldest);
    }
  }
  if (!path) {
    // Far-away one-off requests stay bounded; the native A* fallback avoids
    // flooding an entire continent just to answer one courier's request.
    cache.searches++;
    path = findPath(state, from, goalPoint, faction, false, undefined, undefined, undefined, false, true);
  }
  if (!path.length || cell(path[path.length - 1]) !== goal) return;
  const cells = [start];
  for (const point of path) if (cell(point) !== cells[cells.length - 1]) cells.push(cell(point));
  if (start !== goal) remember(state, faction, cache, key, cells, maxTargets, maxNodes);
  if (path.some(point => cell(point) !== start && blockers?.has(cell(point)))) return;
  if (blockers) {
    const buildings = buildingBlockerView(state, faction);
    const occupied = { has: (index: number) => buildings.has(index) || index !== start && blockers.has(index) };
    if (!canMove(state, from, path[0], faction, occupied, true))
      path.unshift({ x: Math.floor(from.x) + .5, y: Math.floor(from.y) + .5 });
  }
  if (reverseReused) { cache.reverseHits++; cache.hits++; }
  return path;
}

/** Reuse a complete forward route from a chosen settlement door to its farm.
 * A separate target budget accommodates hundreds of farms without evicting
 * frequently shared return doors. Dispatch never accepts a partial route. */
export function courierOutboundPath(state: GameState, from: Point, goal: Point, faction: number): Point[] {
  return withNavigationFrame(state, () => sharedStaticPath(state, from, goal, faction,
    cacheFor(state, outboundCaches), COURIER_OUTBOUND_TARGET_LIMIT, COURIER_OUTBOUND_NODE_LIMIT) ?? []);
}

/** Reuse a route to the exact entrance chosen by the existing traffic policy.
 * Static suffixes never learn transient occupancy detours or partial routes.
 * Movement still performs its usual swept collision checks on every update. */
export function courierReturnPath(state: GameState, from: Point, entrance: Point, faction: number, blockers?: CellBlockers): Point[] {
  return withNavigationFrame(state, () => {
    const cache = cacheFor(state), path = sharedStaticPath(state, from, entrance, faction, cache, MAX_DOORS, MAX_NODES, blockers, true);
    if (path) return path;
    // Preserve the original partial-path and unoccupied fallback policy when
    // a live blocker prevents use of the shared static route.
    cache.fallbacks++; cache.searches++;
    const partial = findPath(state, from, entrance, faction, true, blockers, undefined, undefined, false, true);
    if (partial.length) return partial;
    cache.searches++;
    return findPath(state, from, entrance, faction, false, undefined, undefined, undefined, false, true);
  });
}
