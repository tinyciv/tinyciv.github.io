import { forbiddenRevision } from './forbidden-zones';
import { constructionEdges } from './builders';
import { decisionRevision, QUIET_DECISION_HZ } from './decision-schedule';
import { entityStore, type EntityStore } from './entity-store';
import { travelTimeMapFrom, withNavigationFrame } from './pathfinding';
import { buildingPresent, buildingReady, isFarmKind, isWallKind, type Building, type GameState } from './types';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';

export const FARM_TRAVEL_EDIT_BATCH = 20;
export const FARM_TRAVEL_MAX_DELAY = FARM_TRAVEL_EDIT_BATCH / QUIET_DECISION_HZ;

interface StructureSnapshot {
  entity: Building; id: number; kind: Building['kind']; faction: number; x: number; y: number;
  alive: boolean; ready: boolean; present: boolean;
}

interface TravelCache {
  world: GameState['world']; store: EntityStore; membership: number; commands: number; inspectedAt: number; structureChanges: number;
  forbiddenRevision: number; revision: number | undefined; tiles: GameState['world']['tiles']; width: number; height: number; diplomacy: string;
  buildings: StructureSnapshot[]; criticalSources: StructureSnapshot[];
  palaces: Map<number, Float32Array>;
  generation: object; pendingEdits: number; pendingSince?: number;
}
const caches = new WeakMap<GameState, TravelCache>();

function snapshot(entity: Building): StructureSnapshot {
  return { entity, id: entity.id, kind: entity.kind, faction: entity.faction, x: entity.x, y: entity.y,
    alive: entity.hp > 0, ready: buildingReady(entity), present: buildingPresent(entity) };
}
function unchanged(old: StructureSnapshot, building: Building): boolean {
  return old.entity === building && old.id === building.id && old.kind === building.kind && old.faction === building.faction
    && old.x === building.x && old.y === building.y && old.alive === (building.hp > 0)
    && old.ready === buildingReady(building) && old.present === buildingPresent(building);
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
  const old = new Map(before.map(building => [building.id, building]));
  for (const building of after) {
    const previous = old.get(building.id); old.delete(building.id);
    if (previous && unchanged(previous, building.entity)) continue;
    if (critical(building) || previous && critical(previous)) return true;
  }
  return [...old.values()].some(critical);
}

function publish(cache: TravelCache): void {
  cache.palaces.clear(); cache.generation = {}; cache.pendingEdits = 0; cache.pendingSince = undefined;
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
      buildings, criticalSources: buildings.filter(criticalStructureQuery(buildings, state.world.width)),
      palaces: new Map(), generation: {}, pendingEdits: 0 };
    caches.set(state, cache);
    return cache;
  }

  // Full building validation happens at most once per unchanged game step,
  // shared by all cities and draw calls. Lifetime edits and explicit commands
  // can wake the check within a step. Access-changing structures stay live too:
  // a wall can die between two callers without a terrain or membership edit.
  const forbiddenChanged = cache.forbiddenRevision !== forbiddenRevision(state);
  const criticalChanged = (!trusted || cache.structureChanges !== structureChanges)
    && cache.criticalSources.some(old => !unchanged(old, old.entity));
  if (!trusted && cache.inspectedAt !== state.time || cache.revision !== state.world.revision || cache.membership !== membership
    || cache.structureChanges !== structureChanges
    || cache.commands !== commands || cache.diplomacy !== diplomacy || criticalChanged || forbiddenChanged) {
    const buildingsChanged = cache.buildings.length !== state.buildings.length
      || state.buildings.some((building, index) => !unchanged(cache!.buildings[index], building));
    const revisionChanged = cache.revision !== state.world.revision;
    let urgent = cache.diplomacy !== diplomacy || criticalChanged || forbiddenChanged;
    if (buildingsChanged) {
      const buildings = state.buildings.map(snapshot);
      urgent ||= criticalStructures(cache.buildings, buildings, state.world.width);
      cache.buildings = buildings;
      cache.criticalSources = buildings.filter(criticalStructureQuery(buildings, state.world.width));
      // A single edit commonly advances both counters. Do not count it twice.
      cache.pendingEdits += Math.max(1, (state.world.revision ?? 0) - (cache.revision ?? 0), membership - cache.membership);
      cache.pendingSince ??= state.time;
    } else if (revisionChanged) {
      // An unexplained terrain revision may change cliffs/water/passability.
      // Only known nonblocking structural edits use the slower planning cache.
      urgent = true;
    }
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

/** Terrain-weighted planning distances. Ordinary road/farm edits are coalesced
 * twenty at a time, with a bounded game-time delay; movement uses live geometry.
 * Fresh maps are still calculated immediately when a palace is first queried. */
export function palaceWalkingDistances(state: GameState, palace: Building): Float32Array {
  const cache = travelCache(state);
  let distances = cache.palaces.get(palace.id);
  if (!distances) {
    distances = withNavigationFrame(state, () => travelTimeMapFrom(state, constructionEdges(state, palace, true), palace.faction, 1, Infinity, true));
    cache.palaces.set(palace.id, distances);
  }
  return distances;
}

/** Route cost to the single crop tile. */
export function farmWalkingDistance(distances: Float32Array, width: number, x: number, y: number): number {
  return distances[y * width + x];
}

/** Farms belong to the city their courier can reach most easily. Isolated
 * farms keep a nearest-city assignment so the worker can wait for access. */
export function farmCityQuery(state: GameState, faction: number): (farm: Pick<Building, 'x' | 'y'>) => Building | undefined {
  const palaces = state.buildings.filter(palace => palace.kind === 'palace' && palace.faction === faction && buildingReady(palace))
    .map(palace => ({ palace, distances: palaceWalkingDistances(state, palace) }));
  return farm => {
    let best: Building | undefined, bestWalking = Infinity, bestDirect = Infinity;
    for (const { palace, distances } of palaces) {
      const walking = farmWalkingDistance(distances, state.world.width, farm.x, farm.y);
      const direct = Math.hypot(farm.x - palace.x, farm.y - palace.y);
      if (!best || walking < bestWalking || walking === bestWalking && (Number.isFinite(walking)
        ? palace.id < best.id : direct < bestDirect || direct === bestDirect && palace.id < best.id)) {
        best = palace; bestWalking = walking; bestDirect = direct;
      }
    }
    return best;
  };
}
