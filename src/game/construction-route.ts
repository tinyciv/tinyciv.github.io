import type { Building, BuildSelection, GameState, Point } from './types';
import { isFarmKind, isFord, isWallKind, tileAt } from './types';
import { constructionLine, planConstruction } from './construction';
import { buildCostAt, validateBuildAt } from './simulation';
import { playerFaction } from './player-context';
import { isFreshwaterSource } from './irrigation';
import { bridgeSpanAt } from './bridge-spans';
import { createNetworkPlacementQuery } from './network-placement';
import { constructionPreviewContext, rememberConstructionPreview, constructionFunds, sameConstructionFunds, constructionQuoteAffordable, constructionDisplayReadsActive } from './construction-preview-cache';
import { forkTerritory } from './borders';
import { withSimulationReads } from './simulation-reads';

export const isLinearPlacement = (kind: BuildSelection): kind is 'road' | 'wall' | 'palisade' | 'bridge' | 'irrigation' => ['road', 'wall', 'palisade', 'bridge', 'irrigation'].includes(kind);
const key = (p: Point) => `${p.x},${p.y}`;
const manhattan = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const adjacent = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const routeCommitContexts = new WeakMap<Point[], object>();
const routeMessages = new WeakMap<Point[], string>();
/** A shortened preview retains its first concrete rejection without planning again. */
export function constructionRouteMessage(points: Point[]): string | undefined { return routeMessages.get(points); }

/** Preview and purchase use the same, fully validated cardinal route. Search is
 * local and bounded by the Leader's ten-tile construction range. No fog checks. */
export function constructionRoute(state: GameState, kind: BuildSelection, from: Point, to: Point, authoritative = false): Point[] {
  const start = { x: Math.floor(from.x), y: Math.floor(from.y) }, end = { x: Math.floor(to.x), y: Math.floor(to.y) };
  if (!isLinearPlacement(kind)) return [end];
  const context = constructionPreviewContext(state, kind), id = `${kind}:${key(start)}:${key(end)}`;
  let previous = context.routes.get(id);
  if (authoritative && (!previous || routeCommitContexts.get(previous.value) !== constructionPreviewContext(state))) {
    // A local preview can keep a shortened prefix through remote routine work.
    // Release must reconsider the original requested endpoint, including a
    // formerly blocked relocation that became possible elsewhere in the city.
    context.routes.clear(); context.plans.clear(); context.routeChecks.clear(); delete context.cropFreeState;
    previous = undefined;
  }
  const funds = constructionFunds(state);
  if (previous) {
    // A shortened route may have stopped only because money ran out. Retry it
    // when funds change, while a complete affordable route needs no new search.
    const last = previous.value.at(-1);
    if (sameConstructionFunds(previous.funds, funds)
      || last?.x === end.x && last.y === end.y && constructionQuoteAffordable(planConstruction(state, kind, previous.value), funds)) return previous.value;
  }
  const rejected = { message: '' }, value = findConstructionRoute(state, kind, start, end, rejected);
  if (value.at(-1)?.x !== end.x || value.at(-1)?.y !== end.y)
    routeMessages.set(value, rejected.message || 'No connected construction route reaches this tile.');
  if (!constructionDisplayReadsActive(state)) routeCommitContexts.set(value, constructionPreviewContext(state));
  return rememberConstructionPreview(context.routes, id, { value, funds }).value;
}

function findConstructionRoute(state: GameState, kind: 'road' | 'wall' | 'palisade' | 'bridge' | 'irrigation', start: Point, end: Point, rejected: { message: string }): Point[] {
  const direct = constructionLine(start, end), faction = playerFaction(state);
  // Crop relocation is a transaction, not a search-cell predicate. Omitting
  // friendly crops here gives an optimistic geometry check without hundreds
  // of speculative relocation searches; accepted routes still use the full
  // live-state planner below, including every displaced crop and its cost.
  const crops = new Set(kind === 'road' || isWallKind(kind)
    ? state.buildings.filter(b => b.hp > 0 && b.faction === faction && isFarmKind(b.kind)).map(b => b.id) : []);
  const context = constructionPreviewContext(state, kind);
  const searchState: GameState = crops.size && (kind === 'road' || isWallKind(kind)) ? context.cropFreeState ??= {
    ...state, buildings: state.buildings.filter(b => !crops.has(b.id)), fields: state.fields?.filter(f => !crops.has(f.camp)),
  } : state;
  if (searchState !== state) { searchState.factions = state.factions; forkTerritory(state, searchState); }
  const search = (): Point[] => {
  const accept = (plan: ReturnType<typeof planConstruction>): boolean => {
    const valid = plan.ok && !plan.skipped;
    if (!valid) rejected.message ||= plan.message;
    return valid;
  };
  const complete = (points: Point[]) => {
    if (searchState !== state && !accept(planConstruction(searchState, kind, points))) return false;
    return accept(planConstruction(state, kind, points));
  };
  if (complete(direct)) return direct;
  if (kind === 'bridge') {
    // Bridges stay straight and bank-to-bank. Snap an imprecise end click to a
    // nearby complete crossing; never offer a bent or unfinished bridge.
    const candidates = new Map<string, { points: Point[]; score: number }>();
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const point = { x: start.x + dx, y: start.y + dy };
      for (const axis of ['horizontal', 'vertical'] as const) {
        const span = bridgeSpanAt(state, point, playerFaction(state), axis);
        if (!span) continue;
        const banks = [...span.banks].sort((a, b) => manhattan(a, start) - manhattan(b, start));
        if (manhattan(banks[0], start) > 3 && !span.tiles.some(tile => key(tile) === key(start))) continue;
        const points = constructionLine(banks[0], banks[1]);
        candidates.set(points.map(key).join(';'), { points, score: manhattan(banks[0], start) * 2 + manhattan(banks[1], end) });
      }
    }
    for (const candidate of [...candidates.values()].sort((a, b) => a.score - b.score)) if (complete(candidate.points)) return candidate.points;
    return direct;
  }

  const traversable = new Map<string, boolean>(), blocked = new Set<string>(), funds = constructionFunds(state);
  const existing = new Set(state.buildings.filter(b => b.hp > 0 && b.faction === faction && b.kind === kind).map(key));
  const canVisit = (p: Point): boolean => {
    const id = key(p);
    if (blocked.has(id)) return false;
    if (traversable.has(id)) return traversable.get(id)!;
    const cached = context.routeChecks.get(id), cost = cached?.allowed && buildCostAt(state, kind, p.x, p.y);
    if (cached && (sameConstructionFunds(cached.funds, funds) || cost
      && funds.gold >= cost.gold && funds.food >= cost.food && funds.production >= cost.production)) {
      traversable.set(id, cached.allowed); return cached.allowed;
    }
    let allowed = !!tileAt(state.world, p.x, p.y) && (existing.has(id)
      || kind === 'road' && isFord(tileAt(state.world, p.x, p.y))
      || kind === 'irrigation' && isFreshwaterSource(state, p.x, p.y));
    if (!allowed) {
      const result = validateBuildAt(searchState, kind, p.x, p.y);
      // Connectivity is supplied by the growing route, and checked once more
      // against reservations before anything is bought.
      allowed = result.ok || result.message === 'Extend an existing road or bridge, or start from a ford.'
        || result.message === 'Start irrigation beside freshwater or extend an existing ditch.';
      if (!allowed) rejected.message ||= result.message;
    }
    if (context.routeChecks.size >= 4096) context.routeChecks.clear();
    context.routeChecks.set(id, { allowed, funds });
    traversable.set(id, allowed); return allowed;
  };
  if (!canVisit(start)) return [start];
  const upgrades = new Set(kind === 'wall' ? state.buildings.filter(b => b.hp > 0 && b.kind === 'palisade' && (b.faction === faction || b.faction === -1)).map(key) : []);
  const networkQuery = kind === 'irrigation' ? undefined : createNetworkPlacementQuery(state);
  type Node = { p: Point; cost: number; parent?: Node; score: number; additions: Building[] };
  const reservation = (p: Point): Building => ({ id: -1, kind: kind as Building['kind'], faction, ...p, hp: 1, maxHp: 1, capacity: 0 });
  const networkFits = (p: Point, additions: Building[]) => kind === 'irrigation' || existing.has(key(p)) || upgrades.has(key(p))
    || networkQuery!(kind as Building['kind'], p.x, p.y, faction, additions).ok;
  const initialAdditions = kind === 'irrigation' || existing.has(key(start)) || upgrades.has(key(start)) ? [] : [reservation(start)];
  let closest: Point[] = [start], closestDistance = manhattan(start, end);
  for (let attempt = 0; attempt < 6; attempt++) {
    const initial: Node = { p: start, cost: 0, score: manhattan(start, end), additions: initialAdditions };
    const open: Node[] = [initial], costs = new Map<string, number>([[key(start), 0]]);
    let best = initial;
    for (let visited = 0; open.length && visited < 650; visited++) {
      open.sort((a, b) => a.score - b.score || manhattan(a.p, end) - manhattan(b.p, end));
      const node = open.shift()!;
      if (node.cost !== costs.get(key(node.p))) continue;
      if (manhattan(node.p, end) < manhattan(best.p, end)) best = node;
      if (key(node.p) === key(end)) { best = node; break; }
      for (const step of adjacent) {
        const p = { x: node.p.x + step.x, y: node.p.y + step.y };
        if (manhattan(p, start) > 28 || !canVisit(p) || !networkFits(p, node.additions)) continue;
        const bend = node.parent && (node.p.x - node.parent.p.x !== step.x || node.p.y - node.parent.p.y !== step.y) ? .08 : 0;
        const cost = node.cost + 1 + bend;
        if (cost >= (costs.get(key(p)) ?? Infinity)) continue;
        costs.set(key(p), cost); open.push({ p, cost, parent: node, score: cost + manhattan(p, end),
          additions: kind === 'irrigation' || existing.has(key(p)) || upgrades.has(key(p)) ? node.additions : [...node.additions, reservation(p)] });
      }
    }
    const path: Point[] = [];
    for (let node: Node | undefined = best; node; node = node.parent) path.push(node.p);
    path.reverse();
    const geometry = searchState !== state ? planConstruction(searchState, kind, path) : undefined;
    const plan = geometry && (!geometry.ok || geometry.skipped) ? geometry : planConstruction(state, kind, path);
    if (accept(plan)) return path;
    // Never present disconnected islands after a rejected cell. Keep a fully
    // valid prefix as the nearest fallback, then try routing around the obstacle.
    const firstRejected = path.findIndex(p => plan.cells.some(cell => key(cell) === key(p) && !cell.ok));
    if (firstRejected > 0) {
      const prefix = path.slice(0, firstRejected), distance = manhattan(prefix.at(-1)!, end);
      if (distance < closestDistance && complete(prefix)) { closest = prefix; closestDistance = distance; }
    }
    if (firstRejected < 0 || firstRejected === 0) break;
    blocked.add(key(path[firstRejected]));
  }
  // A blocked anchor remains a single rejected cell. Passing the original
  // multi-cell line here would let the older stroke planner skip obstacles
  // and buy disconnected wall fragments on its far side.
  return complete(closest) ? closest : [start];
  };
  // This private crop-free view is immutable for the entire route search.
  // Share structural/territory validation across its hundreds of cell probes.
  return searchState !== state ? withSimulationReads(searchState, search) : search();
}
