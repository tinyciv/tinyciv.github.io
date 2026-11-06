import { entityStore, type EntityStore } from './entity-store';
import { simulationReadsActive, recordStructureChange, structureChangeRevision } from './simulation-reads';
import { worldStructureRevision } from './world-revisions';
import { wasmPath } from './navigation-wasm';
import { type GameState, type Point, type Tile, type World, WATER, tileAt, buildingReady, buildingPresent, buildingWidth, buildingHeight, isFarmKind, isWallKind } from './types';
import { ridgeEdgeAllowed, ridgeGroundWalkable } from './ridges';
import { invalidateIrrigation, IRRIGATION_MOVEMENT_MULTIPLIER } from './irrigation';
import { groundMovementMultiplier } from './geography';
import { factionRespectsForbidden, forbiddenCells, forbiddenRevision, isForbidden } from './forbidden-zones';

export function traversable(world: World, x: number, y: number): boolean {
  const tile = tileAt(world, x, y);
  return !!tile && !tile.waterfall && (!(tile.ridge || tile.stair) || ridgeGroundWalkable(world, x, y))
    && ((!WATER.has(tile.terrain) && tile.overlay !== 'volcano' && tile.overlay !== 'glacier') || tile.terrain === 'river' && tile.overlay === 'ford');
}

const isRoute = (kind: string): boolean => kind === 'road' || kind === 'bridge';
/** Art size is independent of the unit's one-tile logical placement footprint. */
export const UNIT_RADIUS = 0.5;

/** Raised ground can only be entered through an oriented native stair. */
export function canTraverseEdge(world: World, from: Point, to: Point): boolean {
  const x = Math.floor(from.x), y = Math.floor(from.y), nx = Math.floor(to.x), ny = Math.floor(to.y);
  const dx = nx - x, dy = ny - y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || x < 0 || y < 0 || nx < 0 || ny < 0
    || x >= world.width || nx >= world.width || y >= world.height || ny >= world.height) return false;
  const a = world.tiles[y * world.width + x], b = world.tiles[ny * world.width + nx];
  if (!a || !b || a.waterfall || b.waterfall) return false;
  // Almost every edge is level ground. Diagonal checks must include both
  // flanking cells: otherwise this shortcut could jump the corner of a ledge.
  if (!a.ridge && !a.stair && !b.ridge && !b.stair) {
    if (!dx || !dy) return true;
    const sideA = world.tiles[y * world.width + nx], sideB = world.tiles[ny * world.width + x];
    if (!sideA.ridge && !sideA.stair && !sideA.waterfall && !sideB.ridge && !sideB.stair && !sideB.waterfall) return true;
  }
  return ridgeEdgeAllowed(world, from, to);
}

/** Movement and route selection charge the same terrain travel times. */
export function movementMultiplier(state: GameState, x: number, y: number, routes?: Set<number>, bridges?: Set<number>): number {
  const tile = tileAt(state.world, x, y);
  if (!tile) return 0;
  const tx = Math.floor(x), ty = Math.floor(y);
  const topology = structures(state), index = ty * state.world.width + tx;
  const paved = (routes ?? topology.routes).has(index);
  // Bridges use normal speed across every water type, without a road bonus.
  if (paved && WATER.has(tile.terrain)) return (bridges ?? topology.bridges).has(index) ? 1 : .45;
  if (paved) return 1.5;
  const irrigation = topology.ditches.has(index) ? IRRIGATION_MOVEMENT_MULTIPLIER : 1;
  return groundMovementMultiplier(tile) * irrigation;
}

interface StructureSnapshot {
  kind: string; faction: number; x: number; y: number; alive: boolean; ready: boolean; present: boolean;
}
interface StructureGrid {
  width: number; buildings: StructureSnapshot[]; diplomacy: string; blocked: Set<number>; gates: { index: number; faction: number }[]; byFaction: Map<number, Set<number>>; routes: Set<number>; bridges: Set<number>; ditches: Set<number>; revision: number;
}
const structureCaches = new WeakMap<GameState, StructureGrid>();
const structureValidations = new WeakMap<GameState, { grid: StructureGrid; store: EntityStore; membership: number; changes: number; world: GameState['world']; revision: number; diplomacy: string }>();
const structureFrames = new WeakMap<GameState, { grid?: StructureGrid }>();

/** Combat probes share one topology validation per unit-update phase. Death
 * and evacuation hooks invalidate immediately; direct public calls outside a
 * frame retain full same-tick scalar validation. */
export function beginNavigationFrame(state: GameState): void { structureFrames.set(state, {}); }
export function endNavigationFrame(state: GameState): void { structureFrames.delete(state); }
/** Batch a read-only navigation query without closing an outer simulation frame. */
export function withNavigationFrame<T>(state: GameState, query: () => T): T {
  if (structureFrames.has(state)) return query();
  beginNavigationFrame(state);
  try { return query(); } finally { endNavigationFrame(state); }
}
export function invalidateNavigation(state: GameState): void {
  recordStructureChange(state);
  const frame = structureFrames.get(state);
  if (frame) frame.grid = undefined;
  invalidateIrrigation(state);
}

/** Validate scalar topology without allocating road lists and obstacle sets for
 * every contact/collision probe. This also sees same-tick edits made by combat,
 * construction, save migration, and test fixtures. Returned sets stay private. */
function structures(state: GameState): StructureGrid {
  const frame = structureFrames.get(state);
  if (frame?.grid) return frame.grid;
  let cached = structureCaches.get(state);
  const diplomacy = (state.factions ?? []).map(f => `${f.id}:${f.relation}`).join(';');
  const trusted = simulationReadsActive(state), store = trusted ? entityStore(state) : undefined;
  const membership = store?.buildings.revision ?? -1;
  const changes = structureChangeRevision(state), revision = trusted ? worldStructureRevision(state.world) : -1;
  const validation = structureValidations.get(state);
  if (!trusted) structureValidations.delete(state);
  if (trusted && cached && validation?.grid === cached && validation.store === store && validation.membership === membership
    && validation.changes === changes && validation.world === state.world && validation.revision === revision
    && validation.diplomacy === diplomacy) {
    if (frame) frame.grid = cached;
    return cached;
  }
  let valid = cached?.width === state.world.width && cached.buildings.length === state.buildings.length && cached.diplomacy === diplomacy;
  if (valid && cached) for (let i = 0; i < state.buildings.length; i++) {
    const building = state.buildings[i], old = cached.buildings[i];
    if (building.kind !== old.kind || building.faction !== old.faction || building.x !== old.x || building.y !== old.y || (building.hp > 0) !== old.alive || buildingReady(building) !== old.ready || buildingPresent(building) !== old.present) { valid = false; break; }
  }
  if (valid) {
    if (store) structureValidations.set(state, { grid: cached!, store, membership, changes, world: state.world, revision, diplomacy });
    if (frame) frame.grid = cached; return cached!;
  }
  const gates: { index: number; faction: number }[] = [];
  const roads = new Set<number>(), routes = new Set<number>(), bridges = new Set<number>(), ditches = new Set<number>(), blocked = new Set<number>();
  const buildings = state.buildings.map(building => {
    const snapshot = { kind: building.kind, faction: building.faction, x: building.x, y: building.y, alive: building.hp > 0, ready: buildingReady(building), present: buildingPresent(building) };
    // Even an ordered road reserves a gateway; paving bonuses wait for completion.
    if (snapshot.alive && building.kind === 'road') roads.add(building.y * state.world.width + building.x);
    if (snapshot.ready && building.kind === 'irrigation') ditches.add(building.y * state.world.width + building.x);
    if (snapshot.ready && isRoute(building.kind)) {
      const index = building.y * state.world.width + building.x;
      routes.add(index);
      if (building.kind === 'bridge') bridges.add(index);
    }
    return snapshot;
  });
  for (const building of state.buildings) {
    if (!buildingPresent(building) || isRoute(building.kind) || isFarmKind(building.kind) || building.kind === 'irrigation' || building.kind === 'ruin') continue;
    // Only active construction occupies ground. A road layer makes an owned gate.
    const index = building.y * state.world.width + building.x;
    if (isWallKind(building.kind) && roads.has(index)) { gates.push({ index, faction: building.faction }); continue; }
    const width = buildingWidth(building), height = buildingHeight(building);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) blocked.add((building.y + y) * state.world.width + building.x + x);
  }
  const sameSet = (left: Set<number>, right: Set<number>): boolean => {
    if (left.size !== right.size) return false;
    for (const cell of left) if (!right.has(cell)) return false;
    return true;
  };
  const navigationUnchanged = cached?.width === state.world.width && cached.diplomacy === diplomacy
    && sameSet(blocked, cached.blocked) && sameSet(routes, cached.routes) && sameSet(bridges, cached.bridges)
    && sameSet(ditches, cached.ditches) && gates.length === cached.gates.length
    && gates.every((gate, index) => gate.index === cached!.gates[index].index && gate.faction === cached!.gates[index].faction);
  // Farm readiness and cosmetic/nonblocking structure changes update the
  // scalar snapshot without rebuilding every faction's navigation arrays.
  cached = { width: state.world.width, buildings, diplomacy, blocked, gates,
    byFaction: navigationUnchanged ? cached!.byFaction : new Map(), routes, bridges, ditches,
    revision: (cached?.revision ?? 0) + Number(!navigationUnchanged) };
  structureCaches.set(state, cached);
  if (store) structureValidations.set(state, { grid: cached, store, membership, changes, world: state.world, revision, diplomacy });
  if (frame) frame.grid = cached;
  return cached;
}

/** Gates admit their owner and members of the player's confederation, never
 * neutral rivals or marauders merely because they are not at war yet. */
export function friendlyGateAccess(state: GameState, faction: number, owner: number): boolean {
  if (faction === owner) return true;
  if (state.multiplayer) return false;
  const member = (id: number): boolean => id === 0 || (state.factions ?? []).some(f => f.id === id && f.relation === 'confederated');
  return faction >= 0 && owner >= 0 && member(faction) && member(owner);
}
function factionBlockers(state: GameState, faction: number, topology = structures(state)): Set<number> {
  let blocked = topology.byFaction.get(faction);
  if (!blocked) {
    blocked = new Set(topology.blocked);
    // Abandoned gates are public crossings. Neutral solid wall sections remain
    // obstacles, and neutral walls do not count as a faction's enclosure.
    for (const gate of topology.gates) if (gate.faction !== -1 && !friendlyGateAccess(state, faction, gate.faction)) blocked.add(gate.index);
    topology.byFaction.set(faction, blocked);
  }
  return blocked;
}

/** Callers may remove an attack target or add occupied unit cells, so export an
 * independent set while ordinary movement reads the cached immutable set. */
export function buildingBlockers(state: GameState, faction: number): Set<number> {
  return new Set(factionBlockers(state, faction));
}

/** Read-only probes can combine obstacle layers without copying whole Sets. */
export type CellBlockers = Pick<ReadonlySet<number>, 'has'>;
const blockerViews = new WeakMap<Set<number>, CellBlockers>();

/** A shared snapshot for consumers that only test membership. The wrapper keeps
 * mutable navigation Sets private; topology changes produce a new snapshot. */
export function buildingBlockerView(state: GameState, faction: number): CellBlockers {
  const blocked = factionBlockers(state, faction);
  let view = blockerViews.get(blocked);
  if (!view) { view = { has: index => blocked.has(index) }; blockerViews.set(blocked, view); }
  return view;
}

export function canWalk(state: GameState, x: number, y: number, faction: number, blockers?: CellBlockers, avoidForbidden = false): boolean {
  if (avoidForbidden && isForbidden(state, x, y, faction)) return false;
  const tile = tileAt(state.world, x, y);
  if (!tile || tile.waterfall || (tile.ridge || tile.stair) && !ridgeGroundWalkable(state.world, x, y)) return false;
  const tx = Math.floor(x), ty = Math.floor(y);
  const index = ty * state.world.width + tx;
  const ground = !WATER.has(tile.terrain) && tile.overlay !== 'volcano' && tile.overlay !== 'glacier'
    || tile.terrain === 'river' && tile.overlay === 'ford';
  return (ground || WATER.has(tile.terrain) && structures(state).bridges.has(index))
    && !(blockers ?? factionBlockers(state, faction)).has(index);
}

/** Sweep every occupied cell, including long direct commands and stale paths.
 * Cell corners have zero area: a diagonal may pass between two touching obstacles.
 * Logical placement remains a full cell, independently of this explicit corner rule. */
export function canMove(state: GameState, from: Point, to: Point, faction: number, blockers: CellBlockers = factionBlockers(state, faction), avoidForbidden = false): boolean {
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return false;
  let x = Math.floor(from.x), y = Math.floor(from.y);
  const goalX = Math.floor(to.x), goalY = Math.floor(to.y);
  if (!canWalk(state, x, y, faction, blockers, avoidForbidden) || !canWalk(state, goalX, goalY, faction, blockers, avoidForbidden)) return false;
  const dx = to.x - from.x, dy = to.y - from.y, sx = Math.sign(dx), sy = Math.sign(dy);
  const deltaX = sx ? 1 / Math.abs(dx) : Infinity, deltaY = sy ? 1 / Math.abs(dy) : Infinity;
  let crossX = sx ? ((sx > 0 ? x + 1 : x) - from.x) / dx : Infinity;
  let crossY = sy ? ((sy > 0 ? y + 1 : y) - from.y) / dy : Infinity;
  while (x !== goalX || y !== goalY) {
    const previous = { x, y };
    if (Math.abs(crossX - crossY) < 1e-8) { x += sx; y += sy; crossX += deltaX; crossY += deltaY; }
    else if (crossX < crossY) { x += sx; crossX += deltaX; }
    else { y += sy; crossY += deltaY; }
    if (!canWalk(state, x, y, faction, blockers, avoidForbidden) || !canTraverseEdge(state.world, previous, { x, y })) return false;
  }
  return true;
}

class MinHeap {
  private indices = new Int32Array(64);
  private scores = new Float64Array(64);
  length = 0;
  poppedScore = 0;
  clear(): void { this.length = 0; }
  push(index: number, score: number): void {
    if (this.length === this.indices.length) {
      const indices = new Int32Array(this.length * 2), scores = new Float64Array(this.length * 2);
      indices.set(this.indices); scores.set(this.scores);
      this.indices = indices; this.scores = scores;
    }
    let i = this.length++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.scores[p] <= score) break;
      this.indices[i] = this.indices[p]; this.scores[i] = this.scores[p];
      i = p;
    }
    this.indices[i] = index; this.scores[i] = score;
  }
  pop(): number {
    const first = this.indices[0]; this.poppedScore = this.scores[0];
    const length = --this.length;
    if (!length) return first;
    const last = this.indices[length], score = this.scores[length];
    let i = 0;
    while (i * 2 + 1 < length) {
      let child = i * 2 + 1;
      if (child + 1 < length && this.scores[child + 1] < this.scores[child]) child++;
      if (this.scores[child] >= score) break;
      this.indices[i] = this.indices[child]; this.scores[i] = this.scores[child];
      i = child;
    }
    this.indices[i] = last; this.scores[i] = score;
    return first;
  }
}

const directions = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
const cardinalDirections = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const directionLengths = Float64Array.from(directions, ([dx, dy]) => dx && dy ? Math.SQRT2 : 1);
const CARDINAL_EDGES = 0b01011010;
interface ReachabilityWorkspace {
  seen: Uint32Array; queue: Int32Array; stamp: number; owner?: object; head: number; tail: number;
  reverseSeen: Uint32Array; reverseQueue: Int32Array; reverseStamp: number;
  unreachable: Uint32Array; checked: Uint32Array; blocked: Uint8Array;
}
interface NavigationGrid {
  open: Uint8Array; cost: Float64Array; edges: Uint8Array; component: Int32Array; offsets: Int32Array;
  componentQueue: Int32Array;
  costs: Float64Array; previous: Int32Array; seen: Uint32Array; closed: Uint32Array; stamp: number;
  frontier: MinHeap;
  reachability?: ReachabilityWorkspace;
  version: number; regionColumns: number; accessRegions: Uint32Array; costRegions: Uint32Array;
}
interface TerrainNavigation {
  tiles: World['tiles']; width: number; height: number; revision: number | undefined; version: number; geometryVersion: number;
  snapshots: { terrain: Tile['terrain']; overlay: Tile['overlay']; biome: Tile['biome']; ridge: Tile['ridge']; ridgeTier: Tile['ridgeTier']; stair: Tile['stair']; waterfall: Tile['waterfall']; villageTrail: Tile['villageTrail'] }[];
  open: Uint8Array; bridgeGround: Uint8Array; cost: Float64Array; edges: Uint8Array;
}
const terrainNavigationCaches = new WeakMap<World, TerrainNavigation>();

/** Terrain geometry belongs to the world, not to an army. Construction and
 * road traffic also increment world.revision, so compare terrain scalars when
 * that happens instead of recalculating every ridge edge for every faction.
 * Revisionless fixture worlds retain live scalar validation on every query. */
function terrainNavigation(world: World): TerrainNavigation {
  let cached = terrainNavigationCaches.get(world);
  const compatible = cached?.tiles === world.tiles && cached.width === world.width && cached.height === world.height;
  if (compatible && world.revision !== undefined && cached!.revision === world.revision) return cached!;
  let changed = !compatible, geometryChanged = !compatible;
  if (compatible) for (let i = 0; i < world.tiles.length; i++) {
    const tile = world.tiles[i], old = cached!.snapshots[i];
    if (tile.terrain === old.terrain && tile.overlay === old.overlay && tile.biome === old.biome && tile.ridge === old.ridge
      && tile.ridgeTier === old.ridgeTier && tile.stair === old.stair && tile.waterfall === old.waterfall && tile.villageTrail === old.villageTrail) continue;
    changed = true;
    // Forest and swamp changes affect speed, but cannot alter ridge geometry.
    if (tile.ridge !== old.ridge || tile.ridgeTier !== old.ridgeTier || tile.stair !== old.stair || tile.waterfall !== old.waterfall) geometryChanged = true;
  }
  if (!changed) { cached!.revision = world.revision; return cached!; }
  const count = world.width * world.height;
  if (!compatible) cached = { tiles: world.tiles, width: world.width, height: world.height,
    revision: world.revision, version: 0, geometryVersion: 0, snapshots: [], open: new Uint8Array(count), bridgeGround: new Uint8Array(count),
    cost: new Float64Array(count), edges: new Uint8Array(count) };
  cached = cached!;
  cached.revision = world.revision; cached.version++;
  for (let i = 0; i < count; i++) {
    const tile = world.tiles[i], x = i % world.width, y = Math.floor(i / world.width);
    cached.snapshots[i] = { terrain: tile.terrain, overlay: tile.overlay, biome: tile.biome, ridge: tile.ridge, ridgeTier: tile.ridgeTier, stair: tile.stair, waterfall: tile.waterfall, villageTrail: tile.villageTrail };
    const ground = !tile.waterfall && (!(tile.ridge || tile.stair) || ridgeGroundWalkable(world, x, y));
    cached.open[i] = Number(ground && ((!WATER.has(tile.terrain) && tile.overlay !== 'volcano' && tile.overlay !== 'glacier')
      || tile.terrain === 'river' && tile.overlay === 'ford'));
    cached.bridgeGround[i] = Number(ground && WATER.has(tile.terrain));
    cached.cost[i] = 1 / groundMovementMultiplier(tile);
  }
  if (geometryChanged) {
    cached.geometryVersion++;
    cached.edges.fill(0);
    for (let i = 0; i < count; i++) {
      const x = i % world.width, y = Math.floor(i / world.width);
      for (let d = 0; d < directions.length; d++) {
        const [dx, dy] = directions[d], nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height
          && canTraverseEdge(world, { x, y }, { x: nx, y: ny })) cached.edges[i] |= 1 << d;
      }
    }
  }
  terrainNavigationCaches.set(world, cached);
  return cached;
}

const NAVIGATION_REGION_SIZE = 16;

interface NavigationCache { terrain: TerrainNavigation; terrainVersion: number; terrainGeometryVersion: number; buildings: number; forbidden: number; grid: NavigationGrid; }
const navigationCaches = new WeakMap<GameState, Map<string, NavigationCache>>();

/** Terrain edits increment world.revision. Imported/fixture worlds without a
 * revision are fingerprinted too, so the cache is safe before normalization.
 * Building signatures include pending/ready/dead transitions, including edits
 * made in the same simulation tick. Unit occupancy never enters this cache. */
function navigationGrid(state: GameState, faction: number, avoidForbidden = false): NavigationGrid {
  avoidForbidden &&= forbiddenCells(state, faction).size > 0 && factionRespectsForbidden(state, faction);
  const { world } = state;
  const topology = structures(state), buildings = topology.revision;
  const terrain = terrainNavigation(world);
  let factionCaches = navigationCaches.get(state);
  if (!factionCaches) { factionCaches = new Map(); navigationCaches.set(state, factionCaches); }
  const cacheKey = `${faction}:${Number(avoidForbidden)}`, forbidden = avoidForbidden ? forbiddenRevision(state, faction) : 0;
  const cached = factionCaches.get(cacheKey);
  if (cached && cached.terrain === terrain && cached.terrainVersion === terrain.version && cached.buildings === buildings && cached.forbidden === forbidden) return cached.grid;
  const count = world.width * world.height, blockers = factionBlockers(state, faction, topology), routes = topology.routes, bridges = topology.bridges;
  const regionColumns = Math.ceil(world.width / NAVIGATION_REGION_SIZE), regionCount = regionColumns * Math.ceil(world.height / NAVIGATION_REGION_SIZE);
  const compatible = cached?.terrain === terrain;
  const grid: NavigationGrid = compatible ? cached.grid : {
    open: new Uint8Array(count), cost: new Float64Array(count), edges: new Uint8Array(count), component: new Int32Array(count),
    componentQueue: new Int32Array(count),
    offsets: Int32Array.from(directions, ([dx, dy]) => dy * world.width + dx),
    costs: new Float64Array(count), previous: new Int32Array(count), seen: new Uint32Array(count), closed: new Uint32Array(count), stamp: 0, frontier: new MinHeap(), version: 0,
    regionColumns, accessRegions: new Uint32Array(regionCount), costRegions: new Uint32Array(regionCount),
  };
  let connectivityChanged = !compatible || cached.terrainGeometryVersion !== terrain.geometryVersion;
  let navigationChanged = !compatible;
  const accessChanged = new Set<number>(), costChanged = new Set<number>();
  const region = (cell: number): number => Math.floor(cell % world.width / NAVIGATION_REGION_SIZE)
    + Math.floor(Math.floor(cell / world.width) / NAVIGATION_REGION_SIZE) * regionColumns;
  for (let i = 0; i < count; i++) {
    const open = Number(!blockers.has(i) && !(avoidForbidden && isForbidden(state, i % world.width, Math.floor(i / world.width), faction)) && (terrain.open[i] || bridges.has(i) && terrain.bridgeGround[i]));
    if (grid.open[i] !== open) { connectivityChanged = true; accessChanged.add(region(i)); }
    grid.open[i] = open;
    const cost = routes.has(i) ? WATER.has(world.tiles[i].terrain) ? bridges.has(i) ? 1 : 1 / .45 : 1 / 1.5
      : terrain.cost[i] / (topology.ditches.has(i) ? IRRIGATION_MOVEMENT_MULTIPLIER : 1);
    if (grid.cost[i] !== cost) costChanged.add(region(i));
    grid.cost[i] = cost;
  }
  // Most construction revisions are roads, farm orders or cost-only terrain
  // edits. Keep the existing edges, components and search workspaces whenever
  // the actual open cells and ridge geometry are unchanged.
  if (connectivityChanged) {
    grid.component.fill(0);
    if (grid.reachability) grid.reachability.owner = undefined;
    for (let i = 0; i < count; i++) {
      let edges = 0;
      if (grid.open[i]) for (let d = 0; d < directions.length; d++) {
        const next = i + grid.offsets[d];
        if (terrain.edges[i] & (1 << d) && grid.open[next]) edges |= 1 << d;
      }
      if (grid.edges[i] !== edges) accessChanged.add(region(i));
      grid.edges[i] = edges;
    }
    // Components reject impossible orders immediately instead of exhaustively
    // searching the entire reachable continent each time a unit reconsidered one.
    const queue = grid.componentQueue; let component = 0;
    for (let i = 0; i < count; i++) {
      if (!grid.open[i] || grid.component[i]) continue;
      component++; grid.component[i] = component; queue[0] = i;
      let head = 0, tail = 1;
      while (head < tail) {
        const current = queue[head++];
        for (let d = 0; d < directions.length; d++) if (grid.edges[current] & (1 << d)) {
          const next = current + grid.offsets[d];
          if (!grid.component[next]) { grid.component[next] = component; queue[tail++] = next; }
        }
      }
    }
  }
  for (const index of accessChanged) grid.accessRegions[index]++;
  for (const index of costChanged) grid.costRegions[index]++;
  navigationChanged ||= accessChanged.size > 0 || costChanged.size > 0;
  if (navigationChanged) grid.version++;
  factionCaches.set(cacheKey, { terrain, terrainVersion: terrain.version, terrainGeometryVersion: terrain.geometryVersion, buildings, forbidden, grid });
  return grid;
}

/** Route dependencies use actual navigation changes, not unrelated world edits.
 * A narrow halo includes neighboring shortcuts and changes across region edges. */
export interface NavigationRouteStamp {
  readonly grid: object;
  readonly regions: Map<number, { access: number; cost: number }>;
}
function stampRegion(grid: NavigationGrid, stamp: NavigationRouteStamp, region: number): void {
  if (!stamp.regions.has(region)) stamp.regions.set(region, { access: grid.accessRegions[region], cost: grid.costRegions[region] });
}
function stampCell(grid: NavigationGrid, stamp: NavigationRouteStamp, cell: number, width: number, height: number): void {
  const x = cell % width, y = Math.floor(cell / width);
  for (let ry = Math.floor(Math.max(0, y - 1) / NAVIGATION_REGION_SIZE); ry <= Math.floor(Math.min(height - 1, y + 1) / NAVIGATION_REGION_SIZE); ry++)
    for (let rx = Math.floor(Math.max(0, x - 1) / NAVIGATION_REGION_SIZE); rx <= Math.floor(Math.min(width - 1, x + 1) / NAVIGATION_REGION_SIZE); rx++)
      stampRegion(grid, stamp, ry * grid.regionColumns + rx);
}
function stampUnchanged(grid: NavigationGrid, stamp: NavigationRouteStamp, includeCosts: boolean): boolean {
  if (stamp.grid !== grid) return false;
  for (const [region, old] of stamp.regions) if (old.access !== grid.accessRegions[region]
    || includeCosts && old.cost !== grid.costRegions[region]) return false;
  return true;
}
export function navigationRouteStamp(state: GameState, faction: number, cells: Iterable<number>): NavigationRouteStamp {
  const grid = navigationGrid(state, faction, true), stamp = { grid, regions: new Map<number, { access: number; cost: number }>() };
  for (const cell of cells) stampCell(grid, stamp, cell, state.world.width, state.world.height);
  return stamp;
}
export function navigationRouteUnchanged(state: GameState, faction: number, stamp: NavigationRouteStamp, includeCosts = true): boolean {
  return stampUnchanged(navigationGrid(state, faction, true), stamp, includeCosts);
}

interface ReverseNode { cost: number; next: number; settled: boolean; }
export interface ReversePathResult { path?: Point[]; expanded: number; restarted: boolean; }

/** One destination search serves different starting cells. Only the explored
 * portion is retained; independent heap/storage permit interleaved A* calls.
 * Incoming edges and their forward costs are relaxed explicitly. Temporary
 * unit occupancy never enters this shared static field. */
export class ReversePathQuery {
  private stamp?: NavigationRouteStamp;
  private nodes = new Map<number, ReverseNode>();
  private frontier = new MinHeap();
  private width = 0;
  private height = 0;
  constructor(private readonly destination: Point, private readonly faction: number,
    private readonly maxNodes = 8192) {}
  get size(): number { return this.nodes.size; }
  findReversePath(state: GameState, from: Point, maxExpansions = 2048): ReversePathResult {
    const { width, height } = state.world, grid = navigationGrid(state, this.faction, true);
    let restarted = false;
    if (!this.stamp || this.width !== width || this.height !== height || !stampUnchanged(grid, this.stamp, true)) {
      this.width = width; this.height = height;
      this.nodes.clear(); this.frontier.clear(); this.stamp = { grid, regions: new Map() }; restarted = true;
      const gx = Math.floor(this.destination.x), gy = Math.floor(this.destination.y), goal = gy * width + gx;
      if (Number.isFinite(gx) && Number.isFinite(gy) && gx >= 0 && gy >= 0 && gx < width && gy < height) {
        stampCell(grid, this.stamp, goal, width, height);
        if (grid.open[goal]) { this.nodes.set(goal, { cost: 0, next: -1, settled: false }); this.frontier.push(goal, 0); }
      }
    }
    const x = Math.floor(from.x), y = Math.floor(from.y), start = y * width + x;
    const gx = Math.floor(this.destination.x), gy = Math.floor(this.destination.y), goal = gy * width + gx;
    const result: ReversePathResult = { expanded: 0, restarted };
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height
      || !grid.open[start] || !grid.open[goal] || grid.component[start] !== grid.component[goal]) return result;
    if (start === goal) return { ...result, path: [{ ...this.destination }] };
    while (this.frontier.length && !this.nodes.get(start)?.settled) {
      if (result.expanded >= maxExpansions || this.nodes.size + 8 > this.maxNodes) return result;
      const current = this.frontier.pop(), node = this.nodes.get(current)!;
      if (node.settled || this.frontier.poppedScore > node.cost) continue;
      node.settled = true; result.expanded++;
      stampCell(grid, this.stamp!, current, width, height);
      const cx = current % width, cy = Math.floor(current / width);
      for (let d = 0; d < directions.length; d++) {
        const [dx, dy] = directions[d], nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const predecessor = current + grid.offsets[d];
        // Recording blocked neighbors is essential: a later breach can join
        // this settled region even if that cell was never enqueued before.
        stampCell(grid, this.stamp!, predecessor, width, height);
        if (!(grid.edges[predecessor] & (1 << (7 - d)))) continue;
        const previous = this.nodes.get(predecessor);
        if (previous?.settled) continue;
        const cost = node.cost + directionLengths[d] * (grid.cost[predecessor] + grid.cost[current]) * .5;
        if (previous && previous.cost <= cost) continue;
        this.nodes.set(predecessor, { cost, next: current, settled: false }); this.frontier.push(predecessor, cost);
      }
    }
    if (!this.nodes.get(start)?.settled) return result;
    const path: Point[] = [];
    for (let cell = this.nodes.get(start)!.next; cell !== -1; cell = this.nodes.get(cell)!.next)
      path.push({ x: cell % width + .5, y: Math.floor(cell / width) + .5 });
    if (path.length && !canMove(state, from, path[0], this.faction, undefined, true)) path.unshift({ x: x + .5, y: y + .5 });
    result.path = path;
    return result;
  }
}

/** Whole-world connectivity from any valid start, without weighted searches.
 * Return an independent mask so placement callers may safely reuse or edit it. */
export function staticReachabilityMask(state: GameState, starts: readonly Point[], faction: number, avoidForbidden = false): Uint8Array {
  const { width, height } = state.world, grid = navigationGrid(state, faction, avoidForbidden);
  const components = new Set<number>(), mask = new Uint8Array(width * height);
  for (const start of starts) {
    if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) continue;
    const component = grid.component[Math.floor(start.y) * width + Math.floor(start.x)];
    if (component) components.add(component);
  }
  if (components.size === 1) {
    const component = components.values().next().value!;
    for (let i = 0; i < mask.length; i++) mask[i] = Number(grid.component[i] === component);
  } else if (components.size) {
    for (let i = 0; i < mask.length; i++) mask[i] = Number(components.has(grid.component[i]));
  }
  return mask;
}

/** A narrow cell has at most two cardinal exits. Units may traverse diagonal
 * corners, but stopping here can still block the only full-cell entrance. */
export function isNarrowPassage(state: GameState, point: Point, faction: number): boolean {
  const x = Math.floor(point.x), y = Math.floor(point.y);
  let exits = 0;
  for (const [dx, dy] of cardinalDirections) if (canWalk(state, x + dx, y + dy, faction) && canTraverseEdge(state.world, { x, y }, { x: x + dx, y: y + dy })) exits++;
  return exits <= 2;
}

/** Static connectivity ignores temporary crowds. Shared navigation components
 * make target eligibility cheap and see gates/breaches as soon as topology changes. */
export function hasStaticPath(state: GameState, from: Point, to: Point, faction: number, avoidForbidden = false): boolean {
  const { width, height } = state.world;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)
    || from.x < 0 || from.y < 0 || to.x < 0 || to.y < 0
    || from.x >= width || to.x >= width || from.y >= height || to.y >= height) return false;
  const grid = navigationGrid(state, faction, avoidForbidden), source = Math.floor(from.y) * width + Math.floor(from.x), target = Math.floor(to.y) * width + Math.floor(to.x);
  return !!grid.open[source] && !!grid.open[target] && grid.component[source] === grid.component[target];
}

/** Exact path existence for several goals against one unchanged occupancy view.
 * Combat candidate checks need connectivity, not a weighted route or its Points.
 * Keep this query within a synchronous read-only search: movement, death or
 * topology changes require a new query. Interleaved queries safely restart the
 * shared scratch search rather than reading another query's visited cells. */
export function createReachabilityQuery(state: GameState, from: Point, faction: number, dynamicBlockers?: CellBlockers, avoidForbidden = false): (to: Point) => boolean {
  const { width, height } = state.world;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || from.x < 0 || from.y < 0 || from.x >= width || from.y >= height) return () => false;
  const grid = navigationGrid(state, faction, avoidForbidden), start = Math.floor(from.y) * width + Math.floor(from.x), component = grid.component[start];
  if (!grid.open[start]) return () => false;
  if (!dynamicBlockers) return to => Number.isFinite(to.x) && Number.isFinite(to.y) && to.x >= 0 && to.y >= 0 && to.x < width && to.y < height
    && grid.component[Math.floor(to.y) * width + Math.floor(to.x)] === component;
  const owner = {};
  return to => {
    if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || to.x < 0 || to.y < 0 || to.x >= width || to.y >= height) return false;
    const goal = Math.floor(to.y) * width + Math.floor(to.x);
    if (!grid.open[goal] || grid.component[goal] !== component || goal !== start && dynamicBlockers.has(goal)) return false;
    if (goal === start) return true;
    const count = grid.open.length;
    const work = grid.reachability ??= { seen: new Uint32Array(count), queue: new Int32Array(count), stamp: 0, head: 0, tail: 0,
      reverseSeen: new Uint32Array(count), reverseQueue: new Int32Array(count), reverseStamp: 0,
      unreachable: new Uint32Array(count), checked: new Uint32Array(count), blocked: new Uint8Array(count) };
    if (work.owner !== owner) {
      work.owner = owner; work.stamp = (work.stamp + 1) >>> 0;
      if (!work.stamp) { work.seen.fill(0); work.unreachable.fill(0); work.checked.fill(0); work.stamp = 1; }
      work.head = 0; work.tail = 1; work.queue[0] = start; work.seen[start] = work.stamp;
    }
    const { seen, queue, stamp, reverseSeen, reverseQueue, unreachable, checked, blocked } = work;
    if (seen[goal] === stamp) return true;
    if (unreachable[goal] === stamp || work.head === work.tail) return false;
    work.reverseStamp = (work.reverseStamp + 1) >>> 0;
    if (!work.reverseStamp) { reverseSeen.fill(0); work.reverseStamp = 1; }
    const reverseStamp = work.reverseStamp;
    let reverseHead = 0, reverseTail = 1;
    reverseQueue[0] = goal; reverseSeen[goal] = reverseStamp;
    checked[goal] = stamp; blocked[goal] = 0;
    while (work.head < work.tail && reverseHead < reverseTail) {
      // Attack cells enclosed by an army usually have tiny components. Probe
      // both ends, favoring the smaller frontier, to reject those cells without
      // flooding the open continent behind the attacker. Keep choosing the
      // smaller frontier even for pockets larger than 128 cells: switching to
      // the open continent at that threshold made blocked city fights costly.
      // Both searches remain unlimited and exact.
      const forward = work.tail - work.head < reverseTail - reverseHead;
      const current = forward ? queue[work.head++] : reverseQueue[reverseHead++];
      const ownSeen = forward ? seen : reverseSeen, ownStamp = forward ? stamp : reverseStamp;
      const otherSeen = forward ? reverseSeen : seen, otherStamp = forward ? reverseStamp : stamp;
      const edges = grid.edges[current];
      let joined = false;
      for (let d = 0; d < directions.length; d++) if (edges & (1 << d)) {
        const next = current + grid.offsets[d];
        if (ownSeen[next] === ownStamp) continue;
        if (next !== start) {
          if (checked[next] !== stamp) { checked[next] = stamp; blocked[next] = Number(dynamicBlockers.has(next)); }
          if (blocked[next]) continue;
        }
        ownSeen[next] = ownStamp;
        if (forward) queue[work.tail++] = next;
        else reverseQueue[reverseTail++] = next;
        if (otherSeen[next] === otherStamp) joined = true;
      }
      if (joined) {
        // Every reverse-visited cell is now connected to the source. Expanded
        // reverse cells already exposed all neighbors; only their frontier
        // needs to join the source queue for subsequent candidate queries.
        for (let i = 0; i < reverseTail; i++) {
          const index = reverseQueue[i];
          if (seen[index] === stamp) continue;
          seen[index] = stamp;
          if (i >= reverseHead) queue[work.tail++] = index;
        }
        return true;
      }
    }
    if (reverseHead === reverseTail) for (let i = 0; i < reverseTail; i++) unreachable[reverseQueue[i]] = stamp;
    return false;
  };
}

/** Travel seconds from an origin; setup encounters account for slow terrain and fords. */
export function travelTimeMap(state: GameState, origin: Point, faction: number, speed: number, maxSeconds: number, avoidForbidden = false): Float32Array {
  return travelTimeMapFrom(state, [origin], faction, speed, maxSeconds, avoidForbidden);
}

/** One terrain-weighted search from every usable door of a building. */
export function travelTimeMapFrom(state: GameState, origins: readonly Point[], faction: number, speed: number, maxSeconds: number, avoidForbidden = false): Float32Array {
  const { width, height } = state.world, grid = navigationGrid(state, faction, avoidForbidden);
  const costs = new Float64Array(width * height).fill(Infinity);
  const frontier = grid.frontier; frontier.clear();
  for (const origin of origins) {
    const startX = Math.floor(origin.x), startY = Math.floor(origin.y), start = startY * width + startX;
    if (startX < 0 || startY < 0 || startX >= width || startY >= height || !grid.open[start] || costs[start] === 0) continue;
    costs[start] = 0; frontier.push(start, 0);
  }
  while (frontier.length) {
    const current = frontier.pop(), currentScore = frontier.poppedScore;
    if (currentScore > costs[current]) continue;
    for (let d = 0; d < directions.length; d++) if (grid.edges[current] & (1 << d)) {
      const [dx, dy] = directions[d], next = current + dy * width + dx;
      const cost = currentScore + (dx && dy ? Math.SQRT2 : 1) * (grid.cost[current] + grid.cost[next]) * 0.5 / speed;
      if (cost > maxSeconds || cost >= costs[next]) continue;
      costs[next] = cost; frontier.push(next, cost);
    }
  }
  return Float32Array.from(costs);
}

/** Cached eight-way weighted A*. Search stamps reuse scratch arrays without
 * clearing/allocating a map per request; reservations remain request-local. */
export function findPath(state: GameState, from: Point, to: Point, faction: number, allowPartial = false, dynamicBlockers?: CellBlockers, softBlockers?: Set<number>, congestion?: ReadonlyMap<number, number>, preferCardinal = false, avoidForbidden = false): Point[] {
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return [];
  const { width, height } = state.world;
  const startX = Math.floor(from.x), startY = Math.floor(from.y), goalX = Math.floor(to.x), goalY = Math.floor(to.y);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  if (!inside(startX, startY)) return [];
  const start = startY * width + startX, goal = goalY * width + goalX;
  const grid = navigationGrid(state, faction, avoidForbidden), component = grid.component[start];
  const open = (index: number) => !!grid.open[index] && (index === start || !dynamicBlockers?.has(index));
  const goalOpen = inside(goalX, goalY) && open(goal) && grid.component[goal] === component;
  if (!open(start) || !allowPartial && !goalOpen) return [];
  if (start === goal) return [{ x: to.x, y: to.y }];
  const { costs, previous, seen, closed } = grid;
  grid.stamp = (grid.stamp + 1) >>> 0;
  if (!grid.stamp) { seen.fill(0); closed.fill(0); grid.stamp = 1; }
  const stamp = grid.stamp, frontier = grid.frontier; frontier.clear();
  const heuristic = (x: number, y: number) => {
    const dx = Math.abs(goalX - x), dy = Math.abs(goalY - y);
    return (preferCardinal ? dx + dy : Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) / 1.5;
  };
  let nearestOpenDistance = Infinity;
  if (allowPartial && !goalOpen) {
    // The open start is already a valid candidate. Any closer cell has both
    // axis distances <= 1.5 * h(start), so nearby blocked orders do not need
    // a scan of the entire map. A one-cell margin covers floating-point bounds;
    // extreme public coordinates retain the unrestricted scan.
    const radius = Math.ceil(heuristic(startX, startY) * 1.5) + 1;
    const bounded = Number.isSafeInteger(radius) && Number.isSafeInteger(goalX) && Number.isSafeInteger(goalY);
    const x0 = bounded ? Math.max(0, goalX - radius) : 0, x1 = bounded ? Math.min(width - 1, goalX + radius) : width - 1;
    const y0 = bounded ? Math.max(0, goalY - radius) : 0, y1 = bounded ? Math.min(height - 1, goalY + radius) : height - 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (grid.component[i] === component && open(i)) nearestOpenDistance = Math.min(nearestOpenDistance, heuristic(x, y));
    }
  }
  const native = wasmPath(grid, grid.version, width, start, goalX, goalY, goalOpen, allowPartial, preferCardinal,
    nearestOpenDistance, dynamicBlockers, softBlockers, congestion);
  if (native !== undefined) {
    if (native === null) return preferCardinal ? findPath(state, from, to, faction, allowPartial, dynamicBlockers, softBlockers, congestion, false, avoidForbidden) : [];
    const path: Point[] = Array.from(native, step => ({ x: step % width + .5, y: Math.floor(step / width) + .5 }));
    const buildings = factionBlockers(state, faction);
    const movementBlockers = { has: (index: number) => buildings.has(index) || index !== start && !!dynamicBlockers?.has(index) };
    if (path.length && !canMove(state, from, path[0], faction, movementBlockers, avoidForbidden)) path.unshift({ x: startX + .5, y: startY + .5 });
    return path;
  }
  costs[start] = 0; seen[start] = stamp; previous[start] = -1; frontier.push(start, heuristic(startX, startY));
  let closest = start, closestDistance = heuristic(startX, startY);
  const edgeMask = preferCardinal ? CARDINAL_EDGES : 255;
  const reconstruct = (end: number): Point[] => {
    const path: Point[] = [];
    for (let step = end; step !== start && step !== -1; step = previous[step]) path.push({ x: step % width + 0.5, y: Math.floor(step / width) + 0.5 });
    path.reverse();
    const buildings = factionBlockers(state, faction);
    const movementBlockers = { has: (index: number) => buildings.has(index) || index !== start && !!dynamicBlockers?.has(index) };
    if (path.length && !canMove(state, from, path[0], faction, movementBlockers, avoidForbidden)) path.unshift({ x: startX + 0.5, y: startY + 0.5 });
    return path;
  };
  while (frontier.length) {
    const current = frontier.pop();
    if (closed[current] === stamp) continue;
    if (current === goal && goalOpen) return reconstruct(goal);
    closed[current] = stamp;
    const x = current % width, y = Math.floor(current / width), remaining = heuristic(x, y);
    if (nearestOpenDistance < Infinity && remaining <= nearestOpenDistance + 1e-8) return reconstruct(current);
    const currentCost = costs[current], currentTerrainCost = grid.cost[current], edges = grid.edges[current] & edgeMask;
    if (remaining < closestDistance || remaining === closestDistance && currentCost < costs[closest]) { closest = current; closestDistance = remaining; }
    for (let d = 0; d < directions.length; d++) if (edges & (1 << d)) {
      const next = current + grid.offsets[d];
      // Expanded cells cannot improve. Avoid another dynamic occupancy lookup
      // for those neighbors, which dominate large crowded-path searches.
      if (closed[next] === stamp || !open(next)) continue;
      const cost = currentCost + directionLengths[d] * (currentTerrainCost + grid.cost[next]) * 0.5 + (softBlockers?.has(next) ? 2 : 0) + (congestion?.get(next) ?? 0);
      if (seen[next] === stamp && cost >= costs[next]) continue;
      costs[next] = cost; previous[next] = current; seen[next] = stamp;
      frontier.push(next, cost + heuristic(x + directions[d][0], y + directions[d][1]));
    }
  }
  // Merchants favor connected cardinal road tiles, but a diagonal corner
  // passage must still be usable when it is the only route to their destination.
  if (preferCardinal) return findPath(state, from, to, faction, allowPartial, dynamicBlockers, softBlockers, congestion, false, avoidForbidden);
  return allowPartial && closest !== start ? reconstruct(closest) : [];
}
