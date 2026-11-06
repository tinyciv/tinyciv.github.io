import { playerFaction } from './player-context';
import { isForbidden } from './forbidden-zones';
import { prepareFarmForAutomaticRoad } from './automatic-road-farms';
import { entityStore } from './entity-store';
import { markWorldChanged } from './world-revisions';
import { type Building, type GameState, type Point, type Unit, WATER, buildingReady, buildingWidth, buildingHeight, isFarmKind, isFord, isRetinueMember, isWallKind, tileAt } from './types';
import { hasGateWall, validateNetworkPlacement } from './network-placement';
import { buildingWithinBorders } from './border-placement';
import { insideOwnBorders, territory, type Territory } from './borders';
import { ridgeFootprintAllowed } from './ridges';
import { removeVillageTrailAt } from './village-trails';
import { simulationReadsActive } from './simulation-reads';
import { CHECK_INTERVAL } from './work-cadence';

export const ROAD_TRAFFIC_WINDOW = 180;
export const ROAD_TRAFFIC_THRESHOLD = 12;
const lastSweep = new WeakMap<GameState, number>();
const cardinal = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;
interface TrafficStructures {
  buildings: readonly Building[];
  count: number;
  occupied: Set<number>;
  roads: Set<number>;
  readyRoads: Set<number>;
  walls: Map<number, Set<number>>;
}
interface NetworkCache {
  width: number; height: number; buildings: readonly Building[]; count: number;
  topology: { kind: Building['kind']; faction: number; x: number; y: number }[];
  decisions: Map<string, boolean>;
}
interface TrafficFrame { structures?: TrafficStructures; borders?: Territory; network?: NetworkCache; }
const frames = new WeakMap<GameState, TrafficFrame>();
const networks = new WeakMap<GameState, NetworkCache>();
const structureSamples = new WeakMap<GameState, { at: number; store: ReturnType<typeof entityStore>; world: GameState['world']; value: TrafficStructures }>();

/** Traffic runs after movement, with fixed building footprints and borders.
 * Only newly worn roads mutate this phase, and addRoad updates its indexes.
 * Public calls outside a frame continue to inspect current state directly. */
export function beginTrafficFrame(state: GameState): void { frames.set(state, {}); }
export function endTrafficFrame(state: GameState): void { frames.delete(state); }
function trafficStructures(state: GameState): TrafficStructures | undefined {
  const frame = frames.get(state);
  if (!frame) return undefined;
  if (frame.structures?.buildings === state.buildings && frame.structures.count === state.buildings.length) return frame.structures;
  const trusted = simulationReadsActive(state), old = structureSamples.get(state), store = entityStore(state);
  if (trusted && old?.store === store && old.world === state.world && state.time >= old.at && state.time + 1e-9 < old.at + CHECK_INTERVAL)
    return frame.structures = old.value;
  const structures: TrafficStructures = { buildings: state.buildings, count: state.buildings.length,
    occupied: new Set(), roads: new Set(), readyRoads: new Set(), walls: new Map() };
  const width = state.world.width;
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    if (!isFarmKind(building.kind) && building.kind !== 'irrigation')
      for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++)
        structures.occupied.add((building.y + dy) * width + building.x + dx);
    if (building.kind === 'road' || building.kind === 'bridge') {
      const key = building.y * width + building.x;
      structures.roads.add(key);
      if (buildingReady(building)) structures.readyRoads.add(key);
    }
    if (isWallKind(building.kind)) {
      const key = building.y * width + building.x;
      let owners = structures.walls.get(key);
      if (!owners) { owners = new Set(); structures.walls.set(key, owners); }
      owners.add(building.faction);
    }
  }
  if (trusted) structureSamples.set(state, { at: state.time, store, world: state.world, value: structures });
  return frame.structures = structures;
}
function trafficBorders(state: GameState): Territory {
  const frame = frames.get(state);
  return frame ? frame.borders ??= territory(state) : territory(state);
}

/** Mature trails retry every second, but a rejected junction stays rejected
 * until road/wall topology changes. Validate those live scalars once per
 * traffic frame, retaining direct-mutation checks for standalone callers. */
function roadNetworkAllows(state: GameState, x: number, y: number, faction: number): boolean {
  const frame = frames.get(state);
  let cache = frame?.network;
  if (!cache || cache.buildings !== state.buildings || cache.count !== state.buildings.length) {
    cache = networks.get(state);
    let unchanged = cache?.width === state.world.width && cache.height === state.world.height, index = 0;
    if (unchanged) for (const building of state.buildings) {
      if (building.hp <= 0 || building.kind !== 'road' && building.kind !== 'bridge' && !isWallKind(building.kind)) continue;
      const old = cache!.topology[index++];
      if (!old || old.kind !== building.kind || old.faction !== building.faction || old.x !== building.x || old.y !== building.y) { unchanged = false; break; }
    }
    if (index !== cache?.topology.length) unchanged = false;
    if (!unchanged) {
      cache = { width: state.world.width, height: state.world.height, buildings: state.buildings, count: state.buildings.length,
        topology: state.buildings.filter(building => building.hp > 0 && (building.kind === 'road' || building.kind === 'bridge' || isWallKind(building.kind)))
          .map(({ kind, faction, x, y }) => ({ kind, faction, x, y })), decisions: new Map() };
      networks.set(state, cache);
    }
    cache = cache!; cache.buildings = state.buildings; cache.count = state.buildings.length;
    if (frame) frame.network = cache;
  }
  const key = `${faction}:${Math.floor(x)}:${Math.floor(y)}`;
  const previous = cache.decisions.get(key);
  if (previous !== undefined) return previous;
  const allowed = validateNetworkPlacement(state, 'road', x, y, faction).ok;
  cache.decisions.set(key, allowed);
  return allowed;
}

/** Roads extend cardinal roads/bridges or begin at a natural ford's bank. */
export function hasNeighboringRoad(state: GameState, x: number, y: number, { includeConstruction = true }: { includeConstruction?: boolean } = {}): boolean {
  if (cardinal.some(([dx, dy]) => isFord(tileAt(state.world, x + dx, y + dy)))) return true;
  const structures = trafficStructures(state);
  if (structures) {
    const roads = includeConstruction ? structures.roads : structures.readyRoads;
    return cardinal.some(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < state.world.width && y + dy < state.world.height
      && roads.has((y + dy) * state.world.width + x + dx));
  }
  return state.buildings.some(b => b.hp > 0 && (b.kind === 'road' || b.kind === 'bridge')
    && (includeConstruction || buildingReady(b)) && Math.abs(b.x - x) + Math.abs(b.y - y) === 1);
}

/** Ordinary roads extend the network; a road inside an existing wall opens a gate. */
export function canPlaceRoad(state: GameState, x: number, y: number, faction = playerFaction(state), borders?: Territory): boolean {
  if (isForbidden(state, x, y, faction) || !buildingWithinBorders(state, 'road', x, y, faction, borders)) return false;
  const structures = trafficStructures(state), owners = structures?.walls.get(Math.floor(y) * state.world.width + Math.floor(x));
  const gate = structures ? !!owners && (owners.has(faction) || owners.has(-1)) : hasGateWall(state, x, y, faction);
  return (gate || hasNeighboringRoad(state, x, y)) && roadNetworkAllows(state, x, y, faction);
}
function eligible(state: GameState, x: number, y: number): boolean {
  const tile = tileAt(state.world, x, y);
  if (!tile || WATER.has(tile.terrain) || !ridgeFootprintAllowed(state.world, x, y)) return false;
  // Ambient foot traffic only wears paths into open, bare ground.
  if (tile.overlay !== 'none') return false;
  // Farms are eligible only after a replacement plot is secured by addRoad.
  const structures = trafficStructures(state);
  return structures ? !structures.occupied.has(y * state.world.width + x)
    : !state.buildings.some(b => b.hp > 0 && !isFarmKind(b.kind) && b.kind !== 'irrigation'
      && x >= b.x && x < b.x + buildingWidth(b) && y >= b.y && y < b.y + buildingHeight(b));
}

function addRoad(state: GameState, x: number, y: number, faction: number): boolean {
  // Observation is sampled, but committing a road must still respect a new
  // worksite, a destroyed connection or a changed junction immediately. This
  // exact scan only runs for a mature trail that is about to create a road.
  let connected = cardinal.some(([dx, dy]) => isFord(tileAt(state.world, x + dx, y + dy)));
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    if (!isFarmKind(building.kind) && building.kind !== 'irrigation'
      && x >= building.x && y >= building.y && x < building.x + buildingWidth(building) && y < building.y + buildingHeight(building)) return false;
    if ((building.kind === 'road' || building.kind === 'bridge') && buildingReady(building)
      && Math.abs(building.x - x) + Math.abs(building.y - y) === 1) connected = true;
  }
  if (!connected || isForbidden(state, x, y, faction) || !buildingWithinBorders(state, 'road', x, y, faction)
    || !validateNetworkPlacement(state, 'road', x, y, faction).ok) return false;
  if (!prepareFarmForAutomaticRoad(state, { x, y })) return false;
  const road: Building = { id: Math.max(0, ...state.units.map(u => u.id), ...state.buildings.map(b => b.id)) + 1,
    kind: 'road', faction, x, y, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.add(road);
  const structures = frames.get(state)?.structures;
  if (structures) {
    const key = y * state.world.width + x;
    structures.count = state.buildings.length;
    structures.occupied.add(key);
    structures.roads.add(key); structures.readyRoads.add(key);
  }
  networks.delete(state);
  const frame = frames.get(state);
  if (frame) frame.network = undefined;
  const tile = tileAt(state.world, x, y);
  const removedPalm = !!tile?.palm;
  const removedTrail = removeVillageTrailAt(state.world, x, y);
  if (tile) delete tile.palm;
  delete state.traffic?.[String(y * state.world.width + x)];
  markWorldChanged(state.world, removedPalm || removedTrail ? 'appearance' : 'structure');
  return true;
}

/** Work crews and faction armies never wear roads into fields. Only eligible
 * civilian/post traffic contributes here; merchants lay their routes separately. */
export function recordTraffic(state: GameState, unit: Unit, from: Point): boolean {
  if (unit.inside || unit.hp <= 0 || unit.faction < 0 || unit.builder || unit.collector) return false;
  if (unit.kind === 'leader' || unit.kind === 'scout' || isRetinueMember(unit) && unit.guardPost === undefined && unit.villageId === undefined) return false;
  const x = Math.floor(unit.x), y = Math.floor(unit.y);
  if (x === Math.floor(from.x) && y === Math.floor(from.y)) return false;
  if (isForbidden(state, x, y, unit.faction) || !eligible(state, x, y)) return false;
  const borders = trafficBorders(state);
  if (!insideOwnBorders(state, unit.faction, x + .5, y + .5, borders)) return false;
  if (!buildingWithinBorders(state, 'road', x, y, unit.faction, borders)) return false;
  const key = String(y * state.world.width + x);
  const history = (state.traffic ??= {});
  const visits = (history[key] ?? []).filter(time => time > state.time - ROAD_TRAFFIC_WINDOW);
  visits.push(state.time);
  history[key] = visits;
  if (visits.length < ROAD_TRAFFIC_THRESHOLD) return false;
  if (!hasNeighboringRoad(state, x, y, { includeConstruction: false }) || !canPlaceRoad(state, x, y, unit.faction, borders)) return false;
  return addRoad(state, x, y, unit.faction);
}

/** Bound save size and discard unused trails from the rolling time window. */
export function updateTraffic(state: GameState): boolean {
  const second = Math.floor(state.time);
  if (lastSweep.get(state) === second) return false;
  lastSweep.set(state, second);
  for (const [key, history] of Object.entries(state.traffic ?? {})) {
    const visits = history.filter(time => Number.isFinite(time) && time > state.time - ROAD_TRAFFIC_WINDOW && time <= state.time);
    if (visits.length) state.traffic![key] = visits;
    else delete state.traffic![key];
  }
  // A frequently walked trail can mature beyond the road frontier. Extend it
  // from the connected end once that frontier arrives, even if nobody enters
  // those already-worn cells again in this frame.
  const pending = Object.entries(state.traffic ?? {}).filter(([, visits]) => visits.length >= ROAD_TRAFFIC_THRESHOLD)
    .map(([key]) => ({ x: Number(key) % state.world.width, y: Math.floor(Number(key) / state.world.width) }));
  if (!pending.length) return false;
  const borders = trafficBorders(state);
  let changed = false, extended = true;
  while (extended) {
    extended = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const { x, y } = pending[i];
      const owner = borders.owners[y * borders.width + x];
      // Worn trails must still be claimed when their roads finally connect.
      const faction = owner >= 0 ? owner : undefined;
      if (faction === undefined || !eligible(state, x, y) || !hasNeighboringRoad(state, x, y, { includeConstruction: false }) || !canPlaceRoad(state, x, y, faction, borders)) continue;
      if (!addRoad(state, x, y, faction)) continue;
      pending.splice(i, 1); extended = changed = true;
    }
  }
  return changed;
}
