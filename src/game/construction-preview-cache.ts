import { engineerBuildMultiplier } from './leader-abilities';
import { playerFaction } from './player-context';
import { forbiddenRevision } from './forbidden-zones';
import { territory } from './borders';
import { worldRevisions } from './world-revisions';
import { buildingPresent, buildingReady, buildingWidth, buildingHeight, type BuildSelection, type GameState, type Point } from './types';
import { terrainNavigationRevision } from './pathfinding';
import type { ConstructionPlan } from './construction';
import { constructionPreviewRegion } from './construction-preview-region';

interface PreviewContext {
  world: GameState['world']; tiles: GameState['world']['tiles']; signature: string;
  plans: Map<string, FundedPreview<ConstructionPlan>>; routes: Map<string, FundedPreview<Point[]>>; cropFreeState?: GameState;
  routeChecks: Map<string, { allowed: boolean; funds: ConstructionFunds }>;
  displayState?: GameState;
}
interface ConstructionFunds { gold: number; food: number; production: number }
interface FundedPreview<T> { value: T; funds: ConstructionFunds }
const contexts = new WeakMap<GameState, Map<BuildSelection | undefined, PreviewContext>>();
const displayContexts = new WeakMap<GameState, Map<BuildSelection | undefined, PreviewContext>>();
const displayReads = new WeakMap<GameState, Map<BuildSelection | undefined, PreviewContext>>();
const MAX_PREVIEWS = 32;

/** Only a private UI view enters this synchronous read scope.
 * Route and quote queries may mutate their caches, but gameplay scalars stay
 * unchanged; speculative transactions own separate states. Never apply this
 * scope to simulation or authoritative purchase batches, which make writes. */
export function withConstructionDisplayReads<T>(state: GameState, run: () => T,
  validated?: { selection: BuildSelection; context: PreviewContext }): T {
  if (displayReads.has(state)) return run();
  displayReads.set(state, new Map(validated ? [[validated.selection, validated.context]] : []));
  try { return run(); } finally { displayReads.delete(state); }
}
export function constructionDisplayReadsActive(state: GameState): boolean { return displayReads.has(state); }

/** Local infrastructure feedback owns separate caches from public planners.
 * Its quote can ignore road crop relocation without leaking optimistic results
 * into authoritative commands. Irrigation keeps every live farm/road layer. */
export function constructionDisplayContext(state: GameState, selection: BuildSelection): PreviewContext {
  return selection === 'road' || selection === 'irrigation' ? previewContext(state, selection, true)
    : constructionPreviewContext(state, selection);
}

/** Mouse movement does not change construction geometry. Validate live scalar
 * dependencies once per query, then reuse both successful and rejected routes.
 * Unlocks, ownership, destroyed structures, boats and engineer death
 * invalidate immediately, even when an editor omitted a revision increment. */
export function constructionPreviewContext(state: GameState, selection?: BuildSelection): PreviewContext {
  return previewContext(state, selection, false);
}

function previewContext(state: GameState, selection: BuildSelection | undefined, display: boolean): PreviewContext {
  const scope = displayReads.get(state), validated = scope?.get(selection);
  if (validated) return validated;
  const faction = playerFaction(state), revisions = worldRevisions(state.world);
  const leader = selection === 'road' || display && selection === 'irrigation'
    ? state.units.find(unit => unit.kind === 'leader' && unit.faction === faction && unit.hp > 0) : undefined;
  const region = leader && constructionPreviewRegion(state, leader);
  const nearby = (x: number, y: number, width = 1, height = 1): boolean => !region
    || x <= region.right && y <= region.bottom && x + width > region.left && y + height > region.top;
  const signature = JSON.stringify([faction, state.gameOver, state.world.width, state.world.height,
    region ? [region.left, region.top, region.right, region.bottom, region.terrainRevision, region.claimsRevision]
      : [revisions.sight, revisions.geometry, terrainNavigationRevision(state.world), territory(state).revision], forbiddenRevision(state),
    engineerBuildMultiplier(state, 'road', faction),
    state.units.filter(unit => unit.hp > 0 && (unit.kind === 'leader' && unit.faction === faction
      || unit.kind === 'sailboat' && (selection === undefined || selection === 'bridge' || selection === 'dock')))
      .map(unit => [unit.id, unit.kind, unit.faction, unit.x, unit.y, unit.embarkedOn, unit.kind === 'sailboat' ? unit.facing : undefined]),
    state.factions.map(owner => [owner.id, owner.relation, owner.defeated,
      region ? undefined : owner.population, !region || owner.id === faction ? owner.research?.levels : undefined]),
    state.buildings.filter(building => building.kind === 'palace' || nearby(building.x, building.y, buildingWidth(building), buildingHeight(building)))
      .map(building => [building.id, building.kind, building.faction, building.x, building.y,
      buildingWidth(building), buildingHeight(building), building.hp > 0,
      region && (building.kind === 'road' || building.kind === 'irrigation' || building.kind === 'camp') ? undefined : buildingReady(building),
      region && (building.kind === 'road' || building.kind === 'irrigation' || building.kind === 'camp') ? undefined : buildingPresent(building),
      !!building.farmSuppressed, !!building.fort?.destroyed, building.dockFacing]),
    state.fields?.filter(field => nearby(field.x, field.y)).map(field => [field.camp, field.faction, field.x, field.y]),
    state.hermits?.filter(hermit => nearby(hermit.x, hermit.y, 2, 2)).map(hermit => [hermit.id, hermit.x, hermit.y, hermit.status])]);
  const storage = display ? displayContexts : contexts;
  let selections = storage.get(state);
  if (!selections) { selections = new Map(); storage.set(state, selections); }
  let context = selections.get(selection);
  if (!context || context.world !== state.world || context.tiles !== state.world.tiles || context.signature !== signature) {
    context = { world: state.world, tiles: state.world.tiles, signature, plans: new Map(), routes: new Map(), routeChecks: new Map() };
    selections.set(selection, context);
  }
  scope?.set(selection, context);
  return context;
}

export function rememberConstructionPreview<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= MAX_PREVIEWS) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

/** Treasury changes do not change geometry. A fully accepted quote remains
 * exact while its total is affordable; rejected/partial quotes are retried as
 * soon as any balance changes. Commit still validates and pays each tile. */
export function constructionFunds(state: GameState): ConstructionFunds {
  const faction = state.factions.find(owner => owner.id === playerFaction(state));
  return { gold: faction?.gold ?? 0, food: faction?.food ?? 0, production: faction?.production ?? 0 };
}
export function sameConstructionFunds(a: ConstructionFunds, b: ConstructionFunds): boolean {
  return a.gold === b.gold && a.food === b.food && a.production === b.production;
}
export function constructionQuoteAffordable(plan: ConstructionPlan, funds: ConstructionFunds): boolean {
  return plan.ok && !plan.skipped && plan.costs.gold <= funds.gold && plan.costs.food <= funds.food && plan.costs.production <= funds.production;
}
