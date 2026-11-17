import { forbiddenRevision } from './forbidden-zones';
import { constructionEdges } from './builders';
import { decisionRevision, QUIET_DECISION_HZ } from './decision-schedule';
import { entityStore, type EntityStore } from './entity-store';
import { nearestOriginMap, terrainNavigationRevision, travelTimeMapFrom, withNavigationFrame } from './pathfinding';
import { buildingPresent, buildingReady, isFarmKind, isWallKind, type Building, type GameState } from './types';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { cityGranary, selectFarmStorage } from './granaries-native';

export const FARM_TRAVEL_EDIT_BATCH = 20;
export const FARM_TRAVEL_MAX_DELAY = FARM_TRAVEL_EDIT_BATCH / QUIET_DECISION_HZ;

interface StructureSnapshot {
  entity: Building; id: number; kind: Building['kind']; faction: number; x: number; y: number;
  alive: boolean; ready: boolean; present: boolean;
}

interface TravelCache {
  world: GameState['world']; store: EntityStore; membership: number; commands: number; inspectedAt: number; structureChanges: number;
  forbiddenRevision: number; revision: number | undefined; tiles: GameState['world']['tiles']; width: number; height: number; diplomacy: string;
  terrainRevision: number;
  buildings: StructureSnapshot[]; criticalSources: StructureSnapshot[];
  palaces: Map<number, Float32Array>;
  cityOwners: Map<number, Int32Array>;
  previousCityOwners: Map<number, Int32Array>;
  generation: object; pendingEdits: number; pendingSince?: number;
  planningSource?: { state: GameState; generation: object; allowDeferred: boolean };
}
const caches = new WeakMap<GameState, TravelCache>();
const planningSteps = new WeakSet<GameState>();

function snapshot(entity: Building): StructureSnapshot {
  return { entity, id: entity.id, kind: entity.kind, faction: entity.faction, x: entity.x, y: entity.y,
    alive: entity.hp > 0, ready: buildingReady(entity), present: buildingPresent(entity) };
}
function unchanged(old: StructureSnapshot, building: Building): boolean {
  return old.entity === building && old.id === building.id && old.kind === building.kind && old.faction === building.faction
    && old.x === building.x && old.y === building.y && old.alive === (building.hp > 0)
    && old.ready === buildingReady(building) && old.present === buildingPresent(building);
}
function travelUnchanged(old: StructureSnapshot, building: Building): boolean {
  return old.entity === building && old.id === building.id && old.kind === building.kind && old.faction === building.faction
    && old.x === building.x && old.y === building.y && old.alive === (building.hp > 0)
    && old.present === buildingPresent(building)
    // Completed houses/walls already blocked while their builders worked.
    // A new palace origin or finished route does change distance planning.
    && (old.kind !== 'palace' && old.kind !== 'granary' && old.kind !== 'bridge' && old.kind !== 'road' && old.kind !== 'irrigation'
      || old.ready === buildingReady(building));
}
const routineStructure = (kind: Building['kind']): boolean => kind === 'road' || kind === 'irrigation' || kind === 'ruin' || isFarmKind(kind);

function criticalStructureQuery(buildings: StructureSnapshot[], width: number): (building: StructureSnapshot) => boolean {
  const walls = new Set(buildings.filter(building => building.alive && isWallKind(building.kind))
    .map(building => building.y * width + building.x));
  return building => !routineStructure(building.kind)
    || building.kind === 'road' && walls.has(building.y * width + building.x);
}

/** Roads only change travel cost unless they add/remove the road layer of a
 * wall gate. Bridges and solid buildings can change access, so refresh them
 * immediately. The exact navigation/collision caches are never throttled. */
function criticalStructures(before: StructureSnapshot[], after: StructureSnapshot[], width: number): boolean {
  const critical = criticalStructureQuery([...before, ...after], width);
  // Ordered roads immediately open friendly wall gates; paving bonuses still
  // wait for completion. Other solid footprints only block after work starts.
  const affectsTravel = (building: StructureSnapshot): boolean => building.kind === 'road'
    ? building.alive : building.present || building.ready;
  const old = new Map(before.map(building => [building.id, building]));
  for (const building of after) {
    const previous = old.get(building.id); old.delete(building.id);
    if (previous && travelUnchanged(previous, building.entity)) continue;
    // An unstarted footprint is reserved for placement, but still pathable.
    // Keep the existing distance maps until work begins and it becomes solid.
    if (critical(building) && affectsTravel(building)
      || previous && critical(previous) && affectsTravel(previous)) return true;
  }
  return [...old.values()].some(building => critical(building) && affectsTravel(building));
}

function publish(cache: TravelCache): void {
  // Retain one immutable field per faction until its replacement is ready.
  // Map insertion order is the refresh queue; repeated edits cannot move an
  // already waiting faction behind a newly invalidated one.
  for (const [faction, owners] of cache.cityOwners) cache.previousCityOwners.set(faction, owners);
  cache.palaces.clear(); cache.cityOwners.clear(); cache.generation = {}; cache.pendingEdits = 0; cache.pendingSince = undefined;
  cache.planningSource = undefined;
}
function travelCache(state: GameState): TravelCache {
  const store = entityStore(state), membership = store.buildings.revision, commands = decisionRevision(state);
  const structureChanges = structureChangeRevision(state), trusted = simulationReadsActive(state);
  const diplomacy = state.factions.map(f => `${f.id},${f.relation}`).join(';');
  let cache = caches.get(state);
  if (!cache || cache.world !== state.world || cache.store !== store || cache.tiles !== state.world.tiles
    || cache.width !== state.world.width || cache.height !== state.world.height || state.time < cache.inspectedAt
    || (state.world.revision ?? 0) < (cache.revision ?? 0)) {
    const buildings = state.buildings.map(snapshot);
    cache = { world: state.world, store, membership, commands, inspectedAt: state.time, structureChanges,
      forbiddenRevision: forbiddenRevision(state), revision: state.world.revision, tiles: state.world.tiles, width: state.world.width, height: state.world.height, diplomacy,
      terrainRevision: terrainNavigationRevision(state.world),
      buildings, criticalSources: buildings.filter(criticalStructureQuery(buildings, state.world.width)),
      palaces: new Map(), cityOwners: new Map(), previousCityOwners: new Map(), generation: {}, pendingEdits: 0 };
    caches.set(state, cache);
    return cache;
  }

  // Full building validation happens at most once per unchanged game step,
  // shared by all cities and draw calls. Lifetime edits and explicit commands
  // can wake the check within a step. Access-changing structures stay live too:
  // a wall can die between two callers without a terrain or membership edit.
  const forbiddenChanged = cache.forbiddenRevision !== forbiddenRevision(state);
  const criticalChanged = (!trusted || cache.structureChanges !== structureChanges)
    && cache.criticalSources.some(old => !travelUnchanged(old, old.entity));
  if (!trusted && cache.inspectedAt !== state.time || cache.revision !== state.world.revision || cache.membership !== membership
    || cache.structureChanges !== structureChanges
    || cache.commands !== commands || cache.diplomacy !== diplomacy || criticalChanged || forbiddenChanged) {
    const buildingsChanged = cache.buildings.length !== state.buildings.length
      || state.buildings.some((building, index) => !unchanged(cache!.buildings[index], building));
    const revisionChanged = cache.revision !== state.world.revision;
    const terrainRevision = revisionChanged ? terrainNavigationRevision(state.world) : cache.terrainRevision;
    let urgent = cache.diplomacy !== diplomacy || criticalChanged || forbiddenChanged || terrainRevision !== cache.terrainRevision;
    if (buildingsChanged) {
      const buildings = state.buildings.map(snapshot);
      urgent ||= criticalStructures(cache.buildings, buildings, state.world.width);
      cache.buildings = buildings;
      cache.criticalSources = buildings.filter(criticalStructureQuery(buildings, state.world.width));
      // A single edit commonly advances both counters. Do not count it twice.
      cache.pendingEdits += Math.max(1, (state.world.revision ?? 0) - (cache.revision ?? 0), membership - cache.membership);
      cache.pendingSince ??= state.time;
    }
    // Classified crop appearance, repaired wall health and road wear do not
    // change travel. The shared terrain layer still checks unknown raw edits
    // exactly, and sees trail speed, vegetation, water and ridge changes.
    cache.terrainRevision = terrainRevision;
    cache.revision = state.world.revision; cache.membership = membership; cache.commands = commands; cache.structureChanges = structureChanges;
    cache.inspectedAt = state.time; cache.diplomacy = diplomacy; cache.forbiddenRevision = forbiddenRevision(state);
    if (urgent) publish(cache);
  }
  if (cache.pendingEdits >= FARM_TRAVEL_EDIT_BATCH
    || cache.pendingSince !== undefined && state.time + 1e-9 >= cache.pendingSince + FARM_TRAVEL_MAX_DELAY) publish(cache);
  return cache;
}

/** Shared planning generation for courier-home and other derived caches. The
 * last pending edit eventually publishes even if nineteen more never arrive. */
export function farmTravelRevision(state: GameState): object { return travelCache(state).generation; }

/** Replace at most one existing faction ownership field per fast simulation
 * step. Briefly stale home assignments never change live movement geometry.
 * Cold maps, explicit commands and standalone queries still calculate exactly. */
export function withFarmTravelPlanningStep<T>(state: GameState, run: () => T): T {
  if (planningSteps.has(state)) return run();
  planningSteps.add(state);
  try {
    const existing = caches.get(state);
    if (existing && (existing.cityOwners.size || existing.previousCityOwners.size)) {
      const cache = travelCache(state);
      for (const faction of cache.previousCityOwners.keys()) {
        const cities = factionCities(state, faction);
        if (cities.length <= 1) {
          cache.previousCityOwners.delete(faction); cache.generation = {};
          continue;
        }
        cityOwnership(state, faction, cities, false);
        break;
      }
    }
    return run();
  } finally { planningSteps.delete(state); }
}

/** A construction preview starts with an exact world/building copy. Borrow
 * current immutable distance maps until its own edits require a refresh.
 * Strict callers require no deferred source edits. Interactive previews may
 * explicitly reuse the same bounded-deferred costs as live farm planning;
 * their candidate occupancy/access and actual purchases remain authoritative. */
export function forkFarmTravelPlanning(source: GameState, target: GameState, allowDeferred = false): void {
  const original = travelCache(source), preview = travelCache(target);
  if (allowDeferred || !original.pendingEdits) preview.planningSource = { state: source, generation: original.generation, allowDeferred };
}

/** Terrain-weighted planning distances. Ordinary road/farm edits are coalesced
 * twenty at a time, with a bounded game-time delay; movement uses live geometry.
 * Fresh maps are still calculated immediately when a palace is first queried. */
export function palaceWalkingDistances(state: GameState, palace: Building): Float32Array {
  const cache = travelCache(state);
  let distances = cache.palaces.get(palace.id);
  if (!distances && cache.planningSource) {
    const source = cache.planningSource, original = travelCache(source.state);
    if ((source.allowDeferred || !original.pendingEdits) && original.generation === source.generation) {
      const originalPalace = entityStore(source.state).buildings.get(palace.id);
      if (originalPalace) distances = palaceWalkingDistances(source.state, originalPalace);
    }
  }
  if (!distances) {
    distances = withNavigationFrame(state, () => travelTimeMapFrom(state, constructionEdges(state, palace, true), palace.faction, 1, Infinity, true));
  }
  cache.palaces.set(palace.id, distances);
  return distances;
}

/** Route cost to the single crop tile. */
export function farmWalkingDistance(distances: Float32Array, width: number, x: number, y: number): number {
  return distances[y * width + x];
}

/** The same route observations serve staffing, farm investment and governor
 * estimates. Rust selects the collection point; distance fields stay shared
 * and immutable until the normal travel generation changes. */
export function farmCollectionQuery(state: GameState, palace: Building): (farm: Pick<Building, 'x' | 'y'>) => { storage: Building; walkingDistance: number } {
  const granary = cityGranary(state, palace), townWalking = palaceWalkingDistances(state, palace);
  const granaryWalking = granary ? palaceWalkingDistances(state, granary) : undefined, width = state.world.width;
  return farm => {
    const townCost = farmWalkingDistance(townWalking, width, farm.x, farm.y);
    if (!granaryWalking || !granary) return { storage: palace, walkingDistance: townCost };
    const granaryCost = farmWalkingDistance(granaryWalking, width, farm.x, farm.y);
    const storage = selectFarmStorage(state, palace, granary, townCost, granaryCost);
    return { storage, walkingDistance: storage.id === granary.id ? granaryCost : townCost };
  };
}

/** Ordinary towns retain the cheap single-origin staffing path. */
export function farmStorageQuery(state: GameState, palace: Building): (farm: Pick<Building, 'x' | 'y'>) => Building {
  if (!cityGranary(state, palace)) return () => palace;
  const collect = farmCollectionQuery(state, palace);
  return farm => collect(farm).storage;
}

const factionCities = (state: GameState, faction: number): Building[] => state.buildings
  .filter(palace => palace.kind === 'palace' && palace.faction === faction && buildingReady(palace));

function cityOwnership(state: GameState, faction: number, cities: Building[], allowPrevious = planningSteps.has(state)): Int32Array {
  const cache = travelCache(state);
  let owners = cache.cityOwners.get(faction);
  const previous = cache.previousCityOwners.get(faction);
  if (!owners && allowPrevious && previous) return previous;
  if (!owners && cache.planningSource) {
    const source = cache.planningSource, original = travelCache(source.state);
    if ((source.allowDeferred || !original.pendingEdits) && original.generation === source.generation) {
      owners = cityOwnership(source.state, faction, factionCities(source.state, faction), allowPrevious);
    }
  }
  if (!owners) owners = withNavigationFrame(state, () => nearestOriginMap(state,
    cities.flatMap(palace => {
      const granary = cityGranary(state, palace);
      return [palace, ...(granary ? [granary] : [])].flatMap(storage =>
        constructionEdges(state, storage, true).map(point => ({ point, id: palace.id })));
    }), faction, true));
  cache.cityOwners.set(faction, owners);
  if (previous) {
    cache.previousCityOwners.delete(faction);
    // Courier-home and economic indexes may already have consumed the old
    // field after its topology publication. Publish the completed labels too.
    cache.generation = {};
  }
  return owners;
}

/** Farms belong to the city their courier can reach most easily. Isolated
 * farms keep a nearest-city assignment so the worker can wait for access.
 * Exact purchase checks bypass a pending background ownership publication. */
export function farmCityQuery(state: GameState, faction: number, exact = false): (farm: Pick<Building, 'x' | 'y'>) => Building | undefined {
  const cities = factionCities(state, faction);
  // With one city every field has the same owner, including unreachable fields
  // waiting for access. No world-wide route search can change that choice.
  if (cities.length <= 1) return () => cities[0];
  // One multi-source field replaces a world-sized flood for every palace.
  // Individual palace distances remain available for building placement.
  const owners = cityOwnership(state, faction, cities, exact ? false : undefined), byId = new Map(cities.map(palace => [palace.id, palace]));
  const width = state.world.width;
  return farm => {
    const reachable = byId.get(owners[farm.y * width + farm.x]);
    if (reachable) return reachable;
    let best: Building | undefined, bestDirect = Infinity;
    for (const palace of cities) {
      const direct = Math.hypot(farm.x - palace.x, farm.y - palace.y);
      if (!best || direct < bestDirect || direct === bestDirect && palace.id < best.id) {
        best = palace; bestDirect = direct;
      }
    }
    return best;
  };
}
