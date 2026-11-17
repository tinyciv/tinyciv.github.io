import { forkTerritory, territory, type Territory } from './borders';
import { planConstruction, type ConstructionPlan } from './construction';
import { constructionDisplayContext, withConstructionDisplayReads } from './construction-preview-cache';
import { constructionRoute, constructionRouteMessage } from './construction-route';
import { resetEntities } from './entity-store';
import { invalidateNavigation } from './pathfinding';
import { playerFaction } from './player-context';
import { withSimulationReads } from './simulation-reads';
import { isFarmKind, type BuildSelection, type GameState, type Point } from './types';

const borrowedTerritories = new WeakMap<GameState, { source: GameState; view: Territory }>();
const geometryQuotes = new WeakMap<Point[], ConstructionPlan>();

/** Keep filtered membership live even while remote edits leave the local road
 * context unchanged. Reuse the array/ECS when the same objects remain in order. */
function filteredMembership<T>(source: T[], previous: T[] | undefined, keep: (value: T) => boolean): T[];
function filteredMembership<T>(source: readonly T[], previous: readonly T[] | undefined, keep: (value: T) => boolean): readonly T[];
function filteredMembership<T>(source: readonly T[], previous: readonly T[] | undefined, keep: (value: T) => boolean): readonly T[] {
  let index = 0, same = !!previous;
  for (const value of source) if (keep(value)) {
    if (previous?.[index] !== value) same = false;
    index++;
  }
  return same && previous!.length === index ? previous! : source.filter(keep);
}

/** Pointer feedback checks road geometry and cost without searching for every
 * displaced crop's replacement. Release refreshes the original endpoint's
 * geometry, then buys each cell against the authoritative state. A crop that
 * cannot move may therefore leave part of the road unbuilt when released. */
function withInfrastructureDisplayState<T>(state: GameState, selection: 'road' | 'irrigation', run: (preview: GameState) => T, refresh = false): T {
  const context = constructionDisplayContext(state, selection);
  if (refresh) { delete context.displayState; context.routes.clear(); context.plans.clear(); context.routeChecks.clear(); }
  let preview = context.displayState;
  const faction = playerFaction(state), crops = new Set<number>();
  const buildings = filteredMembership(state.buildings, preview?.buildings, building => {
    const crop = selection === 'road' && building.hp > 0 && building.faction === faction && isFarmKind(building.kind);
    if (crop) crops.add(building.id);
    return !crop;
  });
  const fields = state.fields && filteredMembership(state.fields, preview?.fields, field => !crops.has(field.camp));
  if (!preview) preview = context.displayState = { ...state, buildings, fields };
  else if (preview.units !== state.units || preview.buildings !== buildings || preview.fields !== fields) {
    resetEntities(preview); invalidateNavigation(preview);
  }
  // Geometry belongs to this cached view; treasury, units and other live state
  // stay current even when their arrays were replaced between pointer events.
  for (const key of Object.keys(preview)) if (!Object.hasOwn(state, key)) delete (preview as unknown as Record<string, unknown>)[key];
  Object.assign(preview, state, { buildings, fields });
  const view = territory(state), borrowed = borrowedTerritories.get(preview);
  if (borrowed?.source !== state || borrowed.view !== view) {
    forkTerritory(state, preview); borrowedTerritories.set(preview, { source: state, view });
  }
  return withConstructionDisplayReads(preview, () => withSimulationReads(preview, () => run(preview)), { selection, context });
}

/** UI infrastructure routes share indexed reads. Road feedback omits crop relocation. */
export function previewConstructionRoute(state: GameState, selection: BuildSelection, from: Point, to: Point, refresh = false): Point[] {
  return selection === 'road' || selection === 'irrigation'
    ? withInfrastructureDisplayState(state, selection, preview => constructionRoute(preview, selection, from, to), refresh)
    : constructionRoute(state, selection, from, to);
}

export interface ConstructionGesturePreview {
  points: Point[];
  plan: ConstructionPlan;
  message?: string;
  requestedCost?: number;
  requestedTiles?: number;
}

/** One pointer operation shares context, topology and route/quote work. Funds
 * affect the affordable quote, never the shape of infrastructure feedback.
 * Only this private view receives speculative balances; purchase stays live. */
export function previewConstructionGesture(state: GameState, selection: BuildSelection, from: Point, to: Point, refresh = false): ConstructionGesturePreview {
  if (selection !== 'road' && selection !== 'irrigation') {
    const points = constructionRoute(state, selection, from, to, refresh);
    return { points, plan: planConstruction(state, selection, points), message: constructionRouteMessage(points) };
  }
  return withInfrastructureDisplayState(state, selection, preview => {
    const factions = preview.factions, faction = playerFaction(preview);
    let points: Point[], geometry: ConstructionPlan;
    try {
      preview.factions = factions.map(owner => owner.id === faction
        ? { ...owner, gold: Number.MAX_SAFE_INTEGER, food: Number.MAX_SAFE_INTEGER, production: Number.MAX_SAFE_INTEGER } : owner);
      points = constructionRoute(preview, selection, from, to);
      geometry = geometryQuotes.get(points) ?? planConstruction(preview, selection, points);
      geometryQuotes.set(points, geometry);
    } finally { preview.factions = factions; }
    const plan = planConstruction(preview, selection, points);
    return { points, plan, message: constructionRouteMessage(points) || plan.message || undefined,
      requestedCost: geometry.costs.gold, requestedTiles: geometry.tiles.length };
  }, refresh);
}

/** UI-only road quote, paired with previewConstructionRoute. */
export function previewConstructionPlan(state: GameState, selection: BuildSelection, points: Point[]): ConstructionPlan {
  if (selection === 'road') {
    const faction = playerFaction(state), unique = new Map(points.map(point => {
      const x = Math.floor(point.x), y = Math.floor(point.y);
      return [`${x},${y}`, { x, y }] as const;
    }));
    const remaining = new Set(unique.keys());
    for (const building of state.buildings) {
      if (!remaining.size) break;
      if (building.kind === 'road' && building.hp > 0 && building.faction === faction)
        remaining.delete(`${building.x},${building.y}`);
    }
    // The pointer normally rests over the road just purchased. No pricing,
    // territory, crop-free view or speculative transaction is needed here.
    if (!remaining.size) return { ok: true, message: '', tiles: [], skipped: 0, cost: 0,
      costs: { production: 0, food: 0, gold: 0 },
      cells: [...unique.values()].map(point => ({ ...point, existing: true, ok: true, message: '' })) };
  }
  return selection === 'road' || selection === 'irrigation'
    ? withInfrastructureDisplayState(state, selection, preview => planConstruction(preview, selection, points))
    : planConstruction(state, selection, points);
}
