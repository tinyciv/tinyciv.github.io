import type { Building, FarmField, GameState } from './types';
import { resetEntities } from './entity-store';
import { forkTerrainNavigation, invalidateNavigation } from './pathfinding';
import { forkFarmTravelPlanning } from './farm-travel';
import { forkTerritory } from './borders';
import { markWorldChanged, worldChangesSince } from './world-revisions';

interface PreviewState {
  state: GameState; world: GameState['world']; tiles: GameState['world']['tiles'];
  sourceCursor: number; draftCursor: number;
  buildings: Map<Building, Building>; fields: Map<FarmField, FarmField>;
}
const previews = new WeakMap<GameState, Map<boolean, PreviewState>>();

function assignExact<T extends object>(target: T, source: T, overrides?: Partial<T>): void {
  for (const key of Object.keys(target)) if (!Object.hasOwn(source, key) && !Object.hasOwn(overrides ?? {}, key))
    delete (target as Record<string, unknown>)[key];
  Object.assign(target, source, overrides);
}

/** Each source owns at most two resettable transactions. Keeping the draft's
 * world and navigation layers alive lets changing drag endpoints reuse their
 * arrays and native kernel instead of allocating a world-sized VM every time. */
export function constructionPreviewState(source: GameState, movesFarms: boolean): GameState {
  let variants = previews.get(source);
  if (!variants) { variants = new Map(); previews.set(source, variants); }
  let record = variants.get(movesFarms);
  const compatible = record?.world === source.world && record.tiles === source.world.tiles
    && record.state.world.width === source.world.width && record.state.world.height === source.world.height;
  if (!compatible) {
    const world = movesFarms ? { ...source.world, tiles: [...source.world.tiles] } : source.world;
    const state = { ...source, world };
    record = { state, world: source.world, tiles: source.world.tiles,
      sourceCursor: worldChangesSince(source.world).revision, draftCursor: worldChangesSince(world).revision,
      buildings: new Map(), fields: new Map() };
    variants.set(movesFarms, record);
    if (movesFarms) forkTerrainNavigation(source.world, world);
  } else if (movesFarms) {
    const world = record!.state.world, tiles = world.tiles;
    const own = worldChangesSince(world, record!.draftCursor), changed = worldChangesSince(source.world, record!.sourceCursor);
    const full = own.full || changed.full, cells = full ? undefined : new Set([...own.cells, ...changed.cells]);
    if (full) for (let i = 0; i < tiles.length; i++) tiles[i] = source.world.tiles[i];
    else for (const cell of cells!) tiles[cell] = source.world.tiles[cell];
    // Keep the draft's monotonic revision and array identity. Its own journal
    // restores exactly the cells edited by the preceding speculative stroke.
    assignExact(world, source.world, { tiles, revision: world.revision });
    if (full || cells!.size) markWorldChanged(world, 'geometry', cells);
    record!.sourceCursor = changed.revision;
  }
  const draft = record!.state, world = draft.world;
  const buildings = new Map<Building, Building>();
  const values = movesFarms ? source.buildings.map(building => {
    const copy = record!.buildings.get(building) ?? { ...building };
    assignExact(copy, building, { construction: building.construction && { ...building.construction } });
    buildings.set(building, copy); return copy;
  }) : [...source.buildings];
  const fields = new Map<FarmField, FarmField>();
  const plots = movesFarms ? source.fields?.map(field => {
    const copy = record!.fields.get(field) ?? { ...field };
    assignExact(copy, field); fields.set(field, copy); return copy;
  }) : source.fields;
  assignExact(draft, source, {
    world, buildings: values, fields: plots,
    multiplayer: source.multiplayer && structuredClone(source.multiplayer),
    factions: source.factions.map(faction => ({ ...faction })),
    fog: source.fog && { ...source.fog, explored: [...source.fog.explored],
      buildings: source.fog.buildings && [...source.fog.buildings], fields: source.fog.fields && [...source.fog.fields] },
  });
  record!.buildings = buildings; record!.fields = fields;
  resetEntities(draft);
  // Numeric ECS revisions restart with each reset. Give other derived caches
  // a monotonic transaction generation even when only scalar occupancy changed.
  invalidateNavigation(draft);
  // Both terrain and claim sources now match the source exactly. Subsequent
  // cover edits detach the shared territory through its normal validation.
  forkTerritory(source, draft);
  if (movesFarms) {
    // Preview ranking may use the same bounded-deferred travel costs as live
    // farming. Candidate occupancy/access and every actual purchase stay live.
    forkFarmTravelPlanning(source, draft, true);
    record!.draftCursor = worldChangesSince(world).revision;
  }
  return draft;
}
