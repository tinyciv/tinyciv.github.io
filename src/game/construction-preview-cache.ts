import { engineerBuildMultiplier } from './leader-abilities';
import { playerFaction } from './player-context';
import { forbiddenRevision } from './forbidden-zones';
import { territory } from './borders';
import { worldRevisions } from './world-revisions';
import { buildingPresent, buildingReady, buildingWidth, buildingHeight, type GameState, type Point } from './types';
import type { ConstructionPlan } from './construction';

interface PreviewContext {
  world: GameState['world']; tiles: GameState['world']['tiles']; signature: string;
  plans: Map<string, ConstructionPlan>; routes: Map<string, Point[]>; cropFreeState?: GameState;
}
const contexts = new WeakMap<GameState, PreviewContext>();
const MAX_PREVIEWS = 32;

/** Mouse movement does not change construction geometry. Validate live scalar
 * dependencies once per query, then reuse both successful and rejected routes.
 * Spending, unlocks, ownership, destroyed structures, boats and engineer death
 * invalidate immediately, even when an editor omitted a revision increment. */
export function constructionPreviewContext(state: GameState): PreviewContext {
  const faction = playerFaction(state), revisions = worldRevisions(state.world);
  const signature = JSON.stringify([faction, state.gameOver, state.world.width, state.world.height,
    state.world.revision, revisions.geometry, forbiddenRevision(state), territory(state).revision,
    engineerBuildMultiplier(state, 'road', faction),
    state.units.filter(unit => unit.hp > 0 && (unit.kind === 'leader' && unit.faction === faction || unit.kind === 'sailboat'))
      .map(unit => [unit.id, unit.kind, unit.faction, unit.x, unit.y, unit.embarkedOn, unit.kind === 'sailboat' ? unit.facing : undefined]),
    state.factions.map(owner => [owner.id, owner.relation, owner.defeated, owner.gold, owner.food, owner.production,
      owner.population, owner.research?.levels]),
    state.buildings.map(building => [building.id, building.kind, building.faction, building.x, building.y,
      buildingWidth(building), buildingHeight(building), building.hp > 0, buildingReady(building), buildingPresent(building),
      !!building.farmSuppressed, !!building.fort?.destroyed]),
    state.fields?.map(field => [field.camp, field.faction, field.x, field.y])]);
  let context = contexts.get(state);
  if (!context || context.world !== state.world || context.tiles !== state.world.tiles || context.signature !== signature) {
    context = { world: state.world, tiles: state.world.tiles, signature, plans: new Map(), routes: new Map() };
    contexts.set(state, context);
  }
  return context;
}

export function rememberConstructionPreview<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= MAX_PREVIEWS) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}
