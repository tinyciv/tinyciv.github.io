import { rustEngine } from './rust-engine';
import { diplomaticAccess } from './diplomacy-view';
import { questGateAccess } from './quest-permissions';
import { entityStore, type EntityStore } from './entity-store';
import { structureIndex, type StructureIndex } from './structure-index';
import { simulationReadsActive, recordStructureChange, structureChangeRevision } from './simulation-reads';
import { worldChangesSince, worldStructureRevision } from './world-revisions';
import { wasmNearestOriginMap, wasmPath, wasmPathBetween, wasmTravelTimeMap, wasmPreferLandRoute, wasmRouteIsGround, wasmPreferLandBetween } from './navigation-wasm';
import { type GameState, type Point, type Tile, type World, type Building, type Unit, WATER, tileAt, buildingReady, buildingPresent, buildingWidth, buildingHeight, isFarmKind, isWallKind } from './types';
import { reliefEdgeAllowed, reliefGroundWalkable, rockFootprint } from './relief';
import { invalidateIrrigation, IRRIGATION_MOVEMENT_MULTIPLIER } from './irrigation';
import { applySnowSpeed, groundMovementMultiplier } from './geography';
import { factionRespectsForbidden, forbiddenCells, forbiddenRevision, isForbidden } from './forbidden-zones';
import { resourceBlocksGround } from './resource-terrain';
import { NativeMovementGeometry, NativeMovementWorld, nativeMovement, nativeBlockerSource, registerNativeBlockers } from './movement-native';
import { navigableWaterCell } from './water-navigation';
import { rowboatProfile, mirrorRowboat } from './rowboats-native';
import { offensiveBuildingTargetable } from './building-targeting';

export function traversable(world: World, x: number, y: number, saltAccess = false): boolean {
  const tile = tileAt(world, x, y);
  return !!tile && !tile.waterfall && !resourceBlocksGround(tile, saltAccess) && reliefGroundWalkable(world, x, y)
    && ((!WATER.has(tile.terrain) && tile.overlay !== 'volcano' && tile.overlay !== 'glacier') || tile.terrain === 'river' && tile.overlay === 'ford');
}

const DIRT_ROAD_SPEED = rustEngine.paved_road_speed(0), PAVED_ROAD_SPEED = rustEngine.paved_road_speed(1);

const isRoute = (kind: string): boolean => kind === 'road' || kind === 'bridge';
/** Art size is independent of the unit's one-tile logical placement footprint. */
export const UNIT_RADIUS = 0.5;

/** Check static terrain obstacles before building and faction access. */
export function canTraverseEdge(world: World, from: Point, to: Point, saltAccess?: ReadonlySet<number> | true): boolean {
  const x = Math.floor(from.x), y = Math.floor(from.y), nx = Math.floor(to.x), ny = Math.floor(to.y);
  const dx = nx - x, dy = ny - y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || x < 0 || y < 0 || nx < 0 || ny < 0
    || x >= world.width || nx >= world.width || y >= world.height || ny >= world.height) return false;
  const a = world.tiles[y * world.width + x], b = world.tiles[ny * world.width + nx];
  const allowed = (cell: number) => saltAccess === true || !!saltAccess?.has(cell);
  if (!a || !b || a.waterfall || b.waterfall || resourceBlocksGround(a, allowed(y * world.width + x))
    || resourceBlocksGround(b, allowed(ny * world.width + nx))) return false;
  return reliefEdgeAllowed(world, from, to, saltAccess);
}

export function canTraverseNavigationEdge(state: GameState, from: Point, to: Point): boolean {
  return canTraverseEdge(state.world, from, to, saltAccessViews.get(state));
}

/** Movement and route selection charge the same terrain travel times. */
export function movementMultiplier(state: GameState, x: number, y: number, routes?: Set<number>, bridges?: Set<number>): number {
  const tile = tileAt(state.world, x, y);
  if (!tile) return 0;
  const tx = Math.floor(x), ty = Math.floor(y);
  const topology = structures(state), index = ty * state.world.width + tx;
  if (rowboatViews.has(state) && WATER.has(tile.terrain) && !(topology.flags[index] & BRIDGE))
    return 1 / navigationTerrain(state).cost[index];
  const paved = routes ? routes.has(index) : !!(topology.flags[index] & ROUTE);
  if (paved) return roadMovementMultiplier(tile, topology.flags[index], bridges?.has(index));
  const irrigation = (topology.flags[index] & DITCH) ? IRRIGATION_MOVEMENT_MULTIPLIER : 1;
  return groundMovementMultiplier(tile) * irrigation;
}

const ROUTE = 1, BRIDGE = 2, DITCH = 4, SOLID = 8, PAVED = 16;
function roadMovementMultiplier(tile: Tile, flags: number, bridge = !!(flags & BRIDGE)): number {
  // Bridges use normal speed across every water type, without a road bonus.
  if (WATER.has(tile.terrain)) return bridge ? 1 : .45;
  return applySnowSpeed(tile, flags & PAVED ? PAVED_ROAD_SPEED : DIRT_ROAD_SPEED);
}
interface CellChanges { revision: number; cells: readonly number[] }
const MAX_CHANGE_HISTORY = 64;
function changedCells(history: readonly CellChanges[], since: number, revision: number): Set<number> | undefined {
  if (since === revision) return new Set();
  if (!history.length || since < history[0].revision - 1) return;
  const cells = new Set<number>();
  for (const change of history) if (change.revision > since) for (const cell of change.cells) cells.add(cell);
  return cells;
}
function publishCells(owner: { revision: number; history: CellChanges[] }, cells: readonly number[]): void {
  owner.revision++;
  owner.history.push({ revision: owner.revision, cells });
  if (owner.history.length > MAX_CHANGE_HISTORY) owner.history.shift();
}
interface StructureSnapshot {
  entity: Building; id: number; kind: Building['kind']; faction: number; x: number; y: number;
  width: number; height: number; alive: boolean; ready: boolean; present: boolean; paved: boolean;
}
interface StructureGrid {
  width: number; height: number; buildings: StructureSnapshot[]; byId: Map<number, StructureSnapshot>; contributors: Map<number, StructureSnapshot>; diplomacy: string;
  native?: StructureIndex; nativeCursor?: number; filter?: (building: Building) => boolean;
  flags: Uint8Array; occupants: Map<number, StructureSnapshot[]>; gates: Map<number, readonly number[]>;
  hermits?: GameState['hermits']; cabins: Set<number>;
  blocked: Set<number>; publicBlockers?: Set<number>; byFaction: Map<number, Set<number>>; revision: number; history: CellChanges[];
}
const structureCaches = new WeakMap<GameState, StructureGrid>();
const structureValidations = new WeakMap<GameState, { grid: StructureGrid; store: EntityStore; buildings: readonly Building[]; membership: number; changes: number; sourceChanges: number; world: GameState['world']; revision: number; diplomacy: string; nativeRevision: number; filter?: (building: Building) => boolean }>();
/** Navigation views retain the authoritative mutation boundary. Without this
 * association every civilian movement probe reconciles every building again,
 * even though its source already owns and reports all structural mutations. */
const navigationSources = new WeakMap<GameState, GameState>();
const navigationFilters = new WeakMap<GameState, (building: Building) => boolean>();
const navigationGateDependents = new WeakSet<GameState>();
const structureFrames = new WeakMap<GameState, { grid?: StructureGrid; children?: WeakMap<GameState, StructureGrid> }>();

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
  if (frame) { frame.grid = undefined; frame.children = undefined; }
  const source = navigationSources.get(state);
  if (source) structureFrames.get(source)?.children?.delete(state);
  invalidateIrrigation(state);
}

function structureSnapshot(building: Building): StructureSnapshot {
  return { entity: building, id: building.id, kind: building.kind, faction: building.faction, x: building.x, y: building.y,
    width: buildingWidth(building), height: buildingHeight(building), alive: building.hp > 0,
    ready: buildingReady(building), present: buildingPresent(building), paved: !!building.roadPaved };
}
function structureMatches(old: StructureSnapshot | undefined, building: Building): boolean {
  return !!old && old.entity === building && old.id === building.id && old.kind === building.kind && old.faction === building.faction
    && old.x === building.x && old.y === building.y && old.alive === (building.hp > 0)
    && old.ready === buildingReady(building) && old.present === buildingPresent(building) && old.paved === !!building.roadPaved;
}
function contributes(building: StructureSnapshot): boolean {
  return building.kind === 'road' && building.alive || building.ready && (isRoute(building.kind) || building.kind === 'irrigation')
    || building.present && !isRoute(building.kind) && !isFarmKind(building.kind) && building.kind !== 'irrigation' && building.kind !== 'ruin';
}
function footprint(grid: StructureGrid, building: StructureSnapshot, visit: (cell: number) => void): void {
  if (!Number.isInteger(building.x) || !Number.isInteger(building.y)) return;
  for (let y = Math.max(0, building.y); y < Math.min(grid.height, building.y + building.height); y++)
    for (let x = Math.max(0, building.x); x < Math.min(grid.width, building.x + building.width); x++) visit(y * grid.width + x);
}

/** Retain packed structural layers and recalculate only changed footprints.
 * Contributor lists preserve overlapping roads/walls/buildings on removal.
 * Public editor calls still reconcile exact building scalars. */
function structures(state: GameState): StructureGrid {
  const frame = structureFrames.get(state);
  if (frame?.grid) return frame.grid;
  const source = navigationSources.get(state) ?? state, parent = source !== state ? structureFrames.get(source) : undefined;
  const inherited = parent?.children?.get(state);
  if (inherited) { if (frame) frame.grid = inherited; return inherited; }
  let cached = structureCaches.get(state);
  const diplomacy = `${Number(!!state.multiplayer)};${state.diplomacyState?.accessRevision ?? 0};` + (state.factions ?? []).map(f => `${f.id}:${f.relation}`).join(';');
  const trusted = simulationReadsActive(source), store = trusted ? entityStore(source) : undefined;
  const native = trusted ? structureIndex(source) : undefined, filter = navigationFilters.get(state);
  const membership = store?.buildings.revision ?? -1;
  const changes = structureChangeRevision(state), revision = trusted ? worldStructureRevision(state.world) : -1;
  const sourceChanges = structureChangeRevision(source), validation = structureValidations.get(state);
  if (!trusted) structureValidations.delete(state);
  const remember = (grid: StructureGrid): StructureGrid => {
    if (frame) frame.grid = grid;
    if (parent) (parent.children ??= new WeakMap()).set(state, grid);
    return grid;
  };
  if (trusted && cached && validation?.grid === cached && validation.store === store && validation.buildings === state.buildings && validation.membership === membership
    && validation.changes === changes && validation.sourceChanges === sourceChanges && validation.world === state.world && validation.revision === revision
    && validation.diplomacy === diplomacy && validation.nativeRevision === native!.revision && validation.filter === filter
    && cached.hermits === state.hermits) return remember(cached);
  const compatible = cached?.width === state.world.width && cached.height === state.world.height;
  if (!compatible) cached = { width: state.world.width, height: state.world.height, buildings: [], byId: new Map(), contributors: new Map(), diplomacy,
    flags: new Uint8Array(state.world.width * state.world.height), occupants: new Map(), gates: new Map(),
    cabins: new Set(), blocked: new Set(), byFaction: new Map(), revision: 0, history: [] };
  const grid = cached!, edits: { old?: StructureSnapshot; next?: StructureSnapshot }[] = [];
  const journal = native?.changesSince(grid.native === native && grid.filter === filter ? grid.nativeCursor : undefined);
  if (native && journal && !journal.full) {
    const changed = new Set(journal.ids);
    if (source !== state && navigationGateDependents.has(state)) {
      const topology = structures(source);
      // Merchant projections remove partner walls only while a living road
      // makes a gate. A road edit changes those unchanged wall memberships too.
      for (const id of journal.ids) {
        const old = grid.byId.get(id), next = store!.buildings.get(id);
        for (const road of [old, next]) if (road?.kind === 'road') {
          const cell = road.y * grid.width + road.x;
          for (const wall of topology.occupants.get(cell) ?? []) if (isWallKind(wall.kind)) changed.add(wall.id);
          for (const wall of grid.occupants.get(cell) ?? []) if (isWallKind(wall.kind)) changed.add(wall.id);
        }
      }
    }
    for (const id of changed) {
      const old = grid.byId.get(id), building = store!.buildings.get(id);
      const next = building && (!filter || filter(building)) ? building : undefined;
      if (next && structureMatches(old, next) || !next && !old) continue;
      edits.push({ old, next: next ? structureSnapshot(next) : undefined });
    }
  } else {
    // Standalone/editor queries keep exact scalar validation, including direct
    // array replacements/deletions which did not publish a simulation event.
    const buildings = native ? source.buildings : state.buildings, seen = new Set<number>();
    for (const building of buildings) {
      if (native && filter && !filter(building)) continue;
      seen.add(building.id);
      const old = grid.byId.get(building.id);
      if (!structureMatches(old, building)) edits.push({ old, next: structureSnapshot(building) });
    }
    for (const old of grid.byId.values()) if (!seen.has(old.id)) edits.push({ old });
  }
  if (edits.length || grid.diplomacy !== diplomacy || grid.hermits !== state.hermits) {
    const dirty = new Set<number>(); let contributorsChanged = false;
    if (grid.hermits !== state.hermits) {
      for (const cell of grid.cabins) dirty.add(cell);
      grid.cabins.clear();
      // Each permanently placed cabin contributes its one ground cell to the
      // same blocker layer as buildings, even after its occupant leaves.
      for (const { x, y } of state.hermits ?? []) if (x >= 0 && y >= 0 && x < grid.width && y < grid.height) {
        const cell = y * grid.width + x;
        grid.cabins.add(cell); dirty.add(cell);
      }
      grid.hermits = state.hermits;
    }
    for (const { old, next } of edits) {
      if (old && contributes(old)) {
        contributorsChanged = true; grid.contributors.delete(old.id);
        footprint(grid, old, cell => {
          dirty.add(cell); const occupants = grid.occupants.get(cell)!;
          occupants.splice(occupants.indexOf(old), 1);
          if (!occupants.length) grid.occupants.delete(cell);
        });
      }
      if (next) grid.byId.set(next.id, next); else if (old) grid.byId.delete(old.id);
    }
    for (const { next } of edits) if (next && contributes(next)) {
      contributorsChanged = true; grid.contributors.set(next.id, next);
      footprint(grid, next, cell => {
        dirty.add(cell); const occupants = grid.occupants.get(cell);
        if (occupants) occupants.push(next); else grid.occupants.set(cell, [next]);
      });
    }
    // A road at a wall's origin makes its entire footprint a gate, including
    // future multi-cell wall kinds. Revisit those contributions together.
    for (const cell of [...dirty]) for (const building of grid.occupants.get(cell) ?? [])
      if (isWallKind(building.kind)) footprint(grid, building, other => dirty.add(other));
    if (grid.diplomacy !== diplomacy) for (const cell of grid.gates.keys()) dirty.add(cell);
    const changed: number[] = [];
    for (const cell of dirty) {
      const occupants = grid.occupants.get(cell) ?? [];
      let flags = grid.cabins.has(cell) ? SOLID : 0; const gates: number[] = [];
      for (const building of occupants) {
        const origin = building.y * grid.width + building.x;
        if (cell === origin && building.ready) {
          if (isRoute(building.kind)) flags |= ROUTE;
          if (building.kind === 'road' && building.paved) flags |= PAVED;
          if (building.kind === 'bridge') flags |= BRIDGE;
          if (building.kind === 'irrigation') flags |= DITCH;
        }
        if (!building.present || isRoute(building.kind) || isFarmKind(building.kind) || building.kind === 'irrigation' || building.kind === 'ruin') continue;
        const gate = isWallKind(building.kind) && building.x >= 0 && building.y >= 0 && building.x < grid.width && building.y < grid.height
          && grid.occupants.get(origin)?.some(other => other.kind === 'road' && other.alive);
        if (gate) { if (cell === origin) gates.push(building.faction); }
        else flags |= SOLID;
      }
      gates.sort((a, b) => a - b);
      const oldGates = grid.gates.get(cell) ?? [];
      const gateChanged = gates.length !== oldGates.length || gates.some((faction, i) => faction !== oldGates[i])
        || grid.diplomacy !== diplomacy && gates.length > 0;
      if (flags !== grid.flags[cell] || gateChanged) changed.push(cell);
      grid.flags[cell] = flags;
      if (flags & SOLID) grid.blocked.add(cell); else grid.blocked.delete(cell);
      if (gates.length) grid.gates.set(cell, gates); else grid.gates.delete(cell);
    }
    if (changed.length) {
      publishCells(grid, changed);
      grid.byFaction.clear(); grid.publicBlockers = undefined;
    }
    if (contributorsChanged) grid.buildings = [...grid.contributors.values()];
    grid.diplomacy = diplomacy;
  }
  grid.native = native; grid.nativeCursor = journal?.revision; grid.filter = filter;
  structureCaches.set(state, grid);
  if (store) structureValidations.set(state, { grid, store, buildings: state.buildings, membership, changes, sourceChanges, world: state.world, revision, diplomacy, nativeRevision: native!.revision, filter });
  return remember(grid);
}

export type WallBreachingPolicy = { kind: 'raider' } | { kind: 'faction' | 'offensive'; faction: number; hostile: (owner: number) => boolean };
interface PlanningView { state: GameState; buildings: readonly Building[]; source?: readonly StructureSnapshot[]; policy: string; inherited?: (building: Building) => boolean }
const planningViews = new WeakMap<GameState, Map<string, PlanningView>>();
/** Navigation-only view with stable identity and live source state. Strategic
 * wall access is isolated from the authoritative civilian/military grid. */
export function wallBreachingNavigation(state: GameState, policy: WallBreachingPolicy): GameState {
  let views = planningViews.get(state);
  if (!views) { views = new Map(); planningViews.set(state, views); }
  const key = policy.kind === 'raider' ? 'raider' : `${policy.kind}:${policy.faction}`;
  const topology = structures(state);
  const ignored = new Set<number>();
  const isBreachable = policy.kind === 'offensive' ? offensiveBuildingTargetable : (building: Building) => isWallKind(building.kind);
  for (const building of topology.buildings) if (isBreachable(building.entity)
    && (policy.kind === 'raider' ? building.faction >= 0 : policy.hostile(building.faction))) ignored.add(building.faction);
  const signature = [...ignored].sort((a, b) => a - b).join(',');
  let entry = views.get(key);
  if (!entry) {
    const view = Object.create(state) as GameState;
    entry = { state: view, buildings: [], policy: signature };
    Object.defineProperty(view, 'buildings', { get: () => entry!.buildings, enumerable: true });
    navigationSources.set(view, navigationSources.get(state) ?? state);
    Object.freeze(view);
    views.set(key, entry);
  }
  const inherited = navigationFilters.get(state);
  if (navigationGateDependents.has(state)) navigationGateDependents.add(entry.state);
  if (entry.source !== topology.buildings || entry.policy !== signature || entry.inherited !== inherited) {
    let include = navigationFilters.get(entry.state);
    if (!include || entry.policy !== signature || entry.inherited !== inherited) {
      include = (building: Building) => (!inherited || inherited(building)) && (!ignored.has(building.faction) || !isBreachable(building));
      navigationFilters.set(entry.state, include);
    }
    entry.buildings = state.buildings.filter(include);
    entry.source = topology.buildings; entry.policy = signature; entry.inherited = inherited;
    invalidateNavigation(entry.state);
  }
  return entry.state;
}

/** Gates admit their owner and members of the player's confederation, never
 * neutral rivals or marauders merely because they are not at war yet. */
export function friendlyGateAccess(state: GameState, faction: number, owner: number): boolean {
  if (faction === owner || diplomaticAccess(state, faction, owner) || questGateAccess(state,faction,owner)) return true;
  if (state.multiplayer) return false;
  const member = (id: number): boolean => id === 0 || (state.factions ?? []).some(f => f.id === id && f.relation === 'confederated');
  return faction >= 0 && owner >= 0 && member(faction) && member(owner);
}
const saltAccessViews = new WeakMap<GameState, ReadonlySet<number>>();
const saltBlockerCaches = new WeakMap<GameState, { terrain: TerrainNavigation; version: number; factions: Map<number, { base: Set<number>; blocked: Set<number> }> }>();
function factionBlockers(state: GameState, faction: number, topology = structures(state)): Set<number> {
  let blocked = topology.byFaction.get(faction);
  if (!blocked) {
    // Abandoned gates are public crossings. Neutral solid wall sections remain
    // obstacles, and neutral walls do not count as a faction's enclosure.
    let publicBlockers = topology.publicBlockers;
    if (!publicBlockers) {
      publicBlockers = new Set(topology.blocked);
      for (const [cell, owners] of topology.gates) if (owners.some(owner => owner !== -1)) publicBlockers.add(cell);
      topology.publicBlockers = publicBlockers;
    }
    // Factions with no usable private gate share the same immutable snapshot.
    for (const [cell, owners] of topology.gates) {
      if (!publicBlockers.has(cell) || topology.blocked.has(cell)
        || owners.some(owner => owner !== -1 && !friendlyGateAccess(state, faction, owner))) continue;
      blocked ??= new Set(publicBlockers);
      blocked.delete(cell);
    }
    blocked ??= publicBlockers;
    topology.byFaction.set(faction, blocked);
  }
  const access = saltAccessViews.get(state);
  if (!access) return blocked;
  const terrain = terrainNavigation(state.world);
  let cache = saltBlockerCaches.get(state);
  if (!cache || cache.terrain !== terrain || cache.version !== terrain.version) {
    cache = { terrain, version: terrain.version, factions: new Map() }; saltBlockerCaches.set(state, cache);
  }
  let entry = cache.factions.get(faction);
  if (entry?.base !== blocked) {
    const combined = new Set(blocked);
    for (const cell of terrain.restricted) if (!access.has(cell)) combined.add(cell);
    entry = { base: blocked, blocked: combined }; cache.factions.set(faction, entry);
  }
  return entry!.blocked;
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
  if (!view) {
    view = { has: index => blocked.has(index) }; blockerViews.set(blocked, view);
    registerNativeBlockers(view, blocked);
  }
  return view;
}

export function canWalk(state: GameState, x: number, y: number, faction: number, blockers?: CellBlockers, avoidForbidden = false, landOnly = false): boolean {
  if (avoidForbidden && isForbidden(state, x, y, faction)) return false;
  const tile = tileAt(state.world, x, y);
  if (!tile || tile.waterfall || resourceBlocksGround(tile, !!saltAccessViews.get(state)?.has(Math.floor(y) * state.world.width + Math.floor(x)))
    || !reliefGroundWalkable(state.world, x, y)) return false;
  const tx = Math.floor(x), ty = Math.floor(y);
  const index = ty * state.world.width + tx;
  const ground = !WATER.has(tile.terrain) && tile.overlay !== 'volcano' && tile.overlay !== 'glacier'
    || tile.terrain === 'river' && tile.overlay === 'ford';
  return (ground || !landOnly && rowboatViews.has(state) && !!navigationTerrain(state).open[index]
    || WATER.has(tile.terrain) && !!(structures(state).flags[index] & BRIDGE))
    && !(blockers ?? factionBlockers(state, faction)).has(index);
}

/** Sweep every occupied cell, including long direct commands and stale paths.
 * Cell corners have zero area: a diagonal may pass between two touching obstacles.
 * Logical placement remains a full cell, independently of this explicit corner rule. */
export function canMove(state: GameState, from: Point, to: Point, faction: number, blockers?: CellBlockers, avoidForbidden = false): boolean {
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return false;
  if (from.x < 0 || from.y < 0 || to.x < 0 || to.y < 0 || from.x >= state.world.width || to.x >= state.world.width
    || from.y >= state.world.height || to.y >= state.world.height) return false;
  const source = navigationSources.get(state) ?? state;
  if (!simulationReadsActive(source) || state.world.revision === undefined) {
    // Public editor/fixture calls retain exact scalar validation of touched
    // tiles. Native DDA still owns the sweep, without fingerprinting the world.
    const geometry = scalarMovementGeometry(state);
    const scalarBlockers = blockers ?? factionBlockers(state, faction);
    return geometry.withScalarTerrain(from, to,
      (x, y) => canWalk(state, x, y, faction, scalarBlockers, avoidForbidden),
      (a, b) => canTraverseNavigationEdge(state, a, b));
  }
  const geometry = residentMovementGeometry(state);
  const forbidden = avoidForbidden && factionRespectsForbidden(state, faction) ? forbiddenCells(state, faction) : undefined;
  const installed = blockers === undefined ? factionBlockers(state, faction) : nativeBlockerSource(blockers);
  return installed ? geometry.canMove(from, to, installed, forbidden)
    : geometry.withExtraBlockers(from, to, blockers!, forbidden);
}

/** Resident swept-movement layers as native mask handles. Undefined outside
 * simulation reads, where scalar validation of touched tiles stays authoritative. */
export interface NativeMoveLayers { engine: NativeMovementWorld; grid: number; blockers: number; forbidden: number; }
export function nativeMoveLayers(state: GameState, faction: number, avoidForbidden: boolean): NativeMoveLayers | undefined {
  const source = navigationSources.get(state) ?? state;
  if (!simulationReadsActive(source) || state.world.revision === undefined) return;
  const geometry = residentMovementGeometry(state);
  const forbidden = avoidForbidden && factionRespectsForbidden(state, faction) ? forbiddenCells(state, faction) : undefined;
  return { engine: geometry.engine, grid: geometry.grid, blockers: geometry.engine.mask(factionBlockers(state, faction)),
    forbidden: geometry.engine.mask(forbidden) };
}

const scalarMovementGeometries = new Map<string, NativeMovementGeometry>();
function scalarMovementGeometry(state: GameState): NativeMovementGeometry {
  const { width, height } = state.world, key = `${width}:${height}`;
  let geometry = scalarMovementGeometries.get(key);
  if (!geometry) {
    // Raw DDA depends only on dimensions. Never retain a live/preview world or
    // allocate a map-sized topology when the caller validates scalar terrain.
    const engine = new NativeMovementWorld({ width, height });
    geometry = new NativeMovementGeometry(engine, state.world.width, state.world.height);
    if (scalarMovementGeometries.size >= 4) scalarMovementGeometries.delete(scalarMovementGeometries.keys().next().value!);
    scalarMovementGeometries.set(key, geometry);
  }
  return geometry;
}
interface MovementGeometryCache {
  terrain: TerrainNavigation; terrainVersion: number; topology: StructureGrid; structureRevision: number;
  geometry: NativeMovementGeometry;
}
const residentMovementGeometries = new WeakMap<GameState, MovementGeometryCache>();
const saltMovementGeometries = new WeakMap<GameState, MovementGeometryCache>();
const saltGeometrySources = new WeakMap<GameState, GameState>();
function residentMovementGeometry(state: GameState): NativeMovementGeometry {
  const owner = saltGeometrySources.get(state) ?? state;
  const caches = saltGeometrySources.has(state) ? saltMovementGeometries : residentMovementGeometries;
  const engine = nativeMovement(owner), terrain = navigationTerrain(state), topology = structures(owner);
  const previous = caches.get(owner);
  const compatible = previous?.geometry.engine === engine && previous.terrain === terrain;
  if (compatible && previous.terrainVersion === terrain.version && previous.topology === topology
    && previous.structureRevision === topology.revision) return previous.geometry;
  const terrainCells = compatible ? changedCells(terrain.history, previous.terrainVersion, terrain.version) : undefined;
  const structureCells = compatible && previous.topology === topology
    ? changedCells(topology.history, previous.structureRevision, topology.revision) : undefined;
  const cells = terrainCells && structureCells ? new Set([...terrainCells, ...structureCells]) : undefined;
  const geometry = compatible ? previous.geometry : new NativeMovementGeometry(engine, state.world.width, state.world.height);
  geometry.patch(cells, (cell, output, offset) => {
    const flags = topology.flags[cell];
    output[offset] = cell;
    output[offset + 1] = Number(!!terrain.open[cell] || !!(flags & BRIDGE) && !!terrain.bridgeGround[cell]);
    output[offset + 2] = terrain.edges[cell];
    output[offset + 3] = flags & ROUTE ? 1 / roadMovementMultiplier(state.world.tiles[cell], flags)
      : terrain.cost[cell] / (flags & DITCH ? IRRIGATION_MOVEMENT_MULTIPLIER : 1);
  });
  caches.set(owner, { terrain, terrainVersion: terrain.version, topology, structureRevision: topology.revision, geometry });
  return geometry;
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
interface SearchScratch {
  costs: Float64Array; previous: Int32Array; seen: Uint32Array; closed: Uint32Array; stamp: number;
  frontier: MinHeap;
}
interface NavigationGrid {
  open: Uint8Array; cost: Float64Array; edges: Uint8Array; component: Int32Array; offsets: Int32Array;
  componentParents: Map<number, number>;
  land?: Uint8Array; landVersion: number;
  nativeChangesSince: (version: number) => ReadonlySet<number> | undefined;
  nativeHistory: CellChanges[];
  search?: SearchScratch;
  frontier?: MinHeap;
  reachability?: ReachabilityWorkspace;
  version: number; regionColumns: number; accessRegions: Uint32Array; costRegions: Uint32Array;
}
function componentAt(grid: NavigationGrid, cell: number): number {
  let label = grid.component[cell];
  let parent = grid.componentParents.get(label);
  while (parent !== undefined) {
    const next = grid.componentParents.get(parent);
    if (next === undefined) return parent;
    grid.componentParents.set(label, next);
    label = parent;
    parent = next;
  }
  return label;
}
function searchScratch(grid: NavigationGrid): SearchScratch {
  const count = grid.open.length;
  return grid.search ??= { costs: new Float64Array(count), previous: new Int32Array(count),
    seen: new Uint32Array(count), closed: new Uint32Array(count), stamp: 0, frontier: new MinHeap() };
}
type TerrainSnapshot = Pick<Tile, 'terrain' | 'overlay' | 'biome' | 'resource' | 'relief' | 'reliefFlags' | 'reliefSpeed' | 'waterfall' | 'creek' | 'villageTrail' | 'snow' | 'seaIce'> & { rock: boolean };
interface TerrainNavigation {
  tiles: World['tiles']; width: number; height: number; cursor: number; version: number; geometryVersion: number;
  snapshots: TerrainSnapshot[]; history: CellChanges[];
  restricted: Set<number>;
  open: Uint8Array; bridgeGround: Uint8Array; water: Uint8Array; cost: Float64Array; edges: Uint8Array;
}
const terrainNavigationCaches = new WeakMap<World, TerrainNavigation>();
function terrainSnapshot(tile: Tile): TerrainSnapshot {
  return { terrain: tile.terrain, overlay: tile.overlay, biome: tile.biome, resource: tile.resource,
    relief:tile.relief,reliefFlags:tile.reliefFlags,rock:rockFootprint(tile),reliefSpeed:tile.reliefSpeed, waterfall: tile.waterfall, creek: tile.creek, villageTrail: tile.villageTrail,
    snow: tile.snow, seaIce: tile.seaIce };
}
function terrainMatches(tile: Tile, old: TerrainSnapshot): boolean {
  return tile.terrain === old.terrain && tile.overlay === old.overlay && tile.biome === old.biome && tile.resource === old.resource
    && tile.relief === old.relief && tile.reliefFlags === old.reliefFlags && rockFootprint(tile) === old.rock && tile.reliefSpeed === old.reliefSpeed
    && tile.waterfall === old.waterfall && tile.creek === old.creek && tile.villageTrail === old.villageTrail
    && tile.snow === old.snow && tile.seaIce === old.seaIce;
}
function addHalo(cells: Set<number>, cell: number, radius: number, width: number, height: number): void {
  const x = cell % width, y = Math.floor(cell / width);
  for (let ny = Math.max(0, y - radius); ny <= Math.min(height - 1, y + radius); ny++)
    for (let nx = Math.max(0, x - radius); nx <= Math.min(width - 1, x + radius); nx++) cells.add(ny * width + nx);
}

/** One world-owned terrain layer. Journaled edits update their cells and any
 * adjacent edges affected by changed obstacles. */
function terrainNavigation(world: World): TerrainNavigation {
  let cached = terrainNavigationCaches.get(world);
  const compatible = cached?.tiles === world.tiles && cached.width === world.width && cached.height === world.height;
  const changes = worldChangesSince(world, compatible ? cached!.cursor : undefined);
  if (compatible && world.revision !== undefined && !changes.full && !changes.cells.length) {
    cached!.cursor = changes.revision; return cached!;
  }
  const count = world.width * world.height;
  if (!compatible) cached = { tiles: world.tiles, width: world.width, height: world.height,
    cursor: changes.revision, version: 0, geometryVersion: 0, snapshots: [], history: [], restricted: new Set(),
    open: new Uint8Array(count), bridgeGround: new Uint8Array(count), water: new Uint8Array(count), cost: new Float64Array(count), edges: new Uint8Array(count) };
  const terrain = cached!, values = new Set<number>(), edges = new Set<number>();
  const inspect = (i: number): void => {
    const tile = world.tiles[i], old = terrain.snapshots[i];
    if (old && terrainMatches(tile, old)) return;
    terrain.snapshots[i] = terrainSnapshot(tile); values.add(i);
    if (!old || tile.relief !== old.relief || tile.reliefFlags !== old.reliefFlags || rockFootprint(tile) !== old.rock
      || tile.waterfall !== old.waterfall || tile.resource !== old.resource) {
      // Diagonal movement reads both side cells as well as the endpoints.
      addHalo(edges, i, 1, world.width, world.height);
    }
  };
  if (!compatible) for (let i = 0; i < count; i++) { terrain.snapshots[i] = terrainSnapshot(world.tiles[i]); values.add(i); edges.add(i); }
  else if (changes.full || world.revision === undefined) for (let i = 0; i < count; i++) inspect(i);
  else for (const i of changes.cells) inspect(i);
  const changed = new Set<number>();
  let restrictionChanged = false;
  for (const i of values) {
    const tile = world.tiles[i], x = i % world.width, y = Math.floor(i / world.width);
    const restricted = resourceBlocksGround(tile) && !resourceBlocksGround(tile, true);
    if (terrain.restricted.has(i) !== restricted) { changed.add(i); restrictionChanged = true; }
    if (restricted) terrain.restricted.add(i);
    else terrain.restricted.delete(i);
    const ground = !tile.waterfall && !resourceBlocksGround(tile) && reliefGroundWalkable(world, x, y);
    const open = Number(ground && ((!WATER.has(tile.terrain) && tile.overlay !== 'volcano' && tile.overlay !== 'glacier')
      || tile.terrain === 'river' && tile.overlay === 'ford'));
    const bridgeGround = Number(ground && WATER.has(tile.terrain)), cost = 1 / groundMovementMultiplier(tile);
    const water = Number(navigableWaterCell(world, x, y));
    if (open !== terrain.open[i] || bridgeGround !== terrain.bridgeGround[i] || cost !== terrain.cost[i] || water !== terrain.water[i]) changed.add(i);
    terrain.open[i] = open; terrain.bridgeGround[i] = bridgeGround; terrain.cost[i] = cost;
    terrain.water[i] = water;
  }
  let geometryChanged = restrictionChanged;
  for (const i of edges) {
    const x = i % world.width, y = Math.floor(i / world.width); let mask = 0;
    for (let d = 0; d < directions.length; d++) {
      const [dx, dy] = directions[d], nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height
        && canTraverseEdge(world, { x, y }, { x: nx, y: ny })) mask |= 1 << d;
    }
    if (mask !== terrain.edges[i]) { geometryChanged = true; changed.add(i); }
    terrain.edges[i] = mask;
  }
  if (geometryChanged) terrain.geometryVersion++;
  if (changed.size || !compatible) {
    terrain.version++;
    terrain.history.push({ revision: terrain.version, cells: [...changed] });
    if (terrain.history.length > MAX_CHANGE_HISTORY) terrain.history.shift();
  }
  terrain.cursor = changes.revision;
  terrainNavigationCaches.set(world, terrain);
  return terrain;
}

/** Borrowed world-owned eight-direction edge mask; callers must not mutate it.
 * Bit order: NW, N, NE, W, E, SW, S, SE. Includes terrain obstacles only. */
export function terrainNavigationEdges(world: World): Uint8Array { return terrainNavigation(world).edges; }

/** Only actual passability, edge or travel-cost changes advance this revision;
 * cosmetic tile journal entries leave planning distance fields reusable. */
export function terrainNavigationRevision(world: World): number { return terrainNavigation(world).version; }
/** Borrow immutable, revisioned terrain facts for the native scenario audit. */
export function scenarioAccessTerrain(world: World): Pick<TerrainNavigation, 'open' | 'bridgeGround' | 'edges' | 'version'> {
  return terrainNavigation(world);
}

/** Seed an exact terrain copy used by a construction transaction. The private
 * layers accept journaled crop/cover edits without rebuilding every world edge
 * for each pointer movement, and can never mutate the live world's navigation. */
export function forkTerrainNavigation(source: World, target: World): void {
  const terrain = terrainNavigation(source);
  terrainNavigationCaches.set(target, { ...terrain, tiles: target.tiles,
    cursor: worldChangesSince(target).revision, snapshots: [...terrain.snapshots], history: [...terrain.history],
    restricted: new Set(terrain.restricted),
    open: terrain.open.slice(), bridgeGround: terrain.bridgeGround.slice(), water: terrain.water.slice(), cost: terrain.cost.slice(), edges: terrain.edges.slice() });
}

const NAVIGATION_REGION_SIZE = 16;

const rowboatViews = new WeakSet<GameState>();
const rowboatTerrains = new WeakMap<TerrainNavigation, { source: TerrainNavigation; version: number; terrain: TerrainNavigation }>();
const saltTerrains = new WeakMap<World, { source: TerrainNavigation; version: number; terrain: TerrainNavigation }>();
/** One shared geometry profile serves every salt crew; per-site masks limit
 * entry to its assignment. Only journaled terrain changes patch the profile. */
function saltTerrain(world: World, source: TerrainNavigation): TerrainNavigation {
  const entry = saltTerrains.get(world), previous = entry?.source === source ? entry : undefined;
  if (previous?.version === source.version) return previous.terrain;
  const dirty = previous ? changedCells(source.history, previous.version, source.version) : undefined;
  const patches = dirty ?? new Set(source.restricted);
  for (const cell of [...patches]) addHalo(patches, cell, 1, world.width, world.height);
  const cells = [...patches];
  const terrain = dirty && previous ? previous.terrain : { ...source, open: source.open.slice(), edges: source.edges.slice(), history: [] };
  for (const cell of cells) {
    const x = cell % world.width, y = Math.floor(cell / world.width);
    terrain.open[cell] = Number(traversable(world, x, y, true));
    let mask = 0;
    for (let d = 0; d < directions.length; d++) {
      const [dx, dy] = directions[d];
      if (canTraverseEdge(world, { x, y }, { x: x + dx, y: y + dy }, true)) mask |= 1 << d;
    }
    terrain.edges[cell] = mask;
  }
  terrain.version = source.version; terrain.geometryVersion = source.geometryVersion;
  terrain.history.push({ revision: terrain.version, cells });
  if (terrain.history.length > MAX_CHANGE_HISTORY) terrain.history.shift();
  saltTerrains.set(world, { source, version: source.version, terrain });
  return terrain;
}
function navigationTerrain(state: GameState): TerrainNavigation {
  const ordinary = terrainNavigation(state.world);
  const source = saltAccessViews.has(state) ? saltTerrain(state.world, ordinary) : ordinary;
  if (!rowboatViews.has(state)) return source;
  const entry = rowboatTerrains.get(source);
  const previous = entry?.source === source ? entry : undefined;
  if (previous && previous.version === source.version) return previous.terrain;
  const dirty = previous ? changedCells(source.history, previous.version, source.version) : undefined;
  const cells = dirty ? [...dirty] : Array.from({ length: source.open.length }, (_, cell) => cell);
  const terrain = previous ? previous.terrain : { ...source, open: source.open.slice(), cost: source.cost.slice(), history: [] };
  // Bound the native transport buffers even when a world needs its first profile.
  for (let start = 0; start < cells.length; start += 1024) {
    const rows = rowboatProfile(navigationSources.get(state) ?? state, cells.slice(start, start + 1024), source.open, source.cost,
      cell => !!source.water[cell]);
    for (let row = 0; row < rows.length; row += 3) {
      const cell = rows[row]; terrain.open[cell] = rows[row + 1]; terrain.cost[cell] = rows[row + 2];
    }
  }
  terrain.edges = source.edges; terrain.geometryVersion = source.geometryVersion;
  terrain.version = source.version;
  terrain.history.push({ revision: terrain.version, cells });
  if (terrain.history.length > MAX_CHANGE_HISTORY) terrain.history.shift();
  rowboatTerrains.set(source, { source, version: source.version, terrain });
  return terrain;
}

function centerGroundRoute(grid: NavigationGrid, from: Point, width: number, path: Point[]): void {
  if (!grid.land || !path.length) return;
  const x = Math.floor(from.x), y = Math.floor(from.y), start = y * width + x;
  if (from.x === x + .5 && from.y === y + .5) return;
  if (wasmRouteIsGround(grid, grid.version, width, start, path.map(point => Math.floor(point.y) * width + Math.floor(point.x)))
    && (path[0].x !== x + .5 || path[0].y !== y + .5)) path.unshift({ x: x + .5, y: y + .5 });
}

/** Cached suffixes may have a different land/boat ratio from their original
 * source. Native selection runs once for each newly used immutable suffix. */
export function preferCivilianPath(state: GameState, from: Point, path: Point[], faction: number, blockers?: CellBlockers): Point[] {
  const grid = navigationGrid(state, faction, true), width = state.world.width;
  const start = Math.floor(from.y) * width + Math.floor(from.x);
  const selected = wasmPreferLandRoute(grid, grid.version, width, start,
    path.map(point => Math.floor(point.y) * width + Math.floor(point.x)),
    blockers ? nativeBlockerSource(blockers) ?? blockers : undefined);
  if (selected) path = Array.from(selected, cell => ({ x: cell % width + .5, y: Math.floor(cell / width) + .5 }));
  centerGroundRoute(grid, from, width, path);
  return path;
}

const civilianRouteModes = new WeakMap<readonly Point[], { grid: NavigationGrid; version: number; ground: boolean }>();
/** A selected ground route keeps its swept movement and waypoint smoothing on
 * ground too. Route arrays shift in place; removing a prefix preserves this mode. */
export function civilianGroundRoute(state: GameState, unit: Unit): boolean {
  const path = unit.path;
  if (!path?.length) return false;
  const grid = navigationGrid(state, unit.faction, true);
  if (!grid.land) return false;
  const width = state.world.width, start = Math.floor(unit.y) * width + Math.floor(unit.x);
  if (!grid.land[start]) return false;
  let cached = civilianRouteModes.get(path);
  if (!cached || cached.grid !== grid || cached.version !== grid.landVersion) {
    cached = { grid, version: grid.landVersion, ground: wasmRouteIsGround(grid, grid.version, width, start,
      path.map(point => Math.floor(point.y) * width + Math.floor(point.x))) };
    civilianRouteModes.set(path, cached);
  }
  return cached.ground;
}

/** Embarkation is derived from the authoritative terrain and completed bridges. */
export function refreshCivilianRowboat(state: GameState, unit: Unit): void {
  const terrain = terrainNavigation(state.world);
  const cell = Math.floor(unit.y) * state.world.width + Math.floor(unit.x);
  mirrorRowboat(state, unit, !!terrain.open[cell], !!terrain.water[cell], !!(structures(state).flags[cell] & BRIDGE));
}

interface NavigationCache { topology: StructureGrid; terrain: TerrainNavigation; terrainVersion: number; terrainGeometryVersion: number; buildings: number; forbidden: number; grid: NavigationGrid; }
const navigationCaches = new WeakMap<GameState, Map<string, NavigationCache>>();
const componentQueues = new WeakMap<World, Int32Array>();

/** Terrain edits increment world.revision. Imported/fixture worlds without a
 * revision are fingerprinted too, so the cache is safe before normalization.
 * Building signatures include pending/ready/dead transitions, including edits
 * made in the same simulation tick. Unit occupancy never enters this cache. */
function navigationGrid(state: GameState, faction: number, avoidForbidden = false): NavigationGrid {
  avoidForbidden &&= forbiddenCells(state, faction).size > 0 && factionRespectsForbidden(state, faction);
  const { world } = state;
  const topology = structures(state), buildings = topology.revision;
  const terrain = navigationTerrain(state);
  let factionCaches = navigationCaches.get(state);
  if (!factionCaches) { factionCaches = new Map(); navigationCaches.set(state, factionCaches); }
  const sharedBlockers = !avoidForbidden && !saltAccessViews.has(state) ? factionBlockers(state, faction, topology) : undefined;
  const cacheKey = sharedBlockers && sharedBlockers === topology.publicBlockers ? 'public' : `${faction}:${Number(avoidForbidden)}`;
  const forbidden = avoidForbidden ? forbiddenRevision(state, faction) : 0;
  const cached = factionCaches.get(cacheKey);
  if (cached && cached.topology === topology && cached.terrain === terrain && cached.terrainVersion === terrain.version && cached.buildings === buildings && cached.forbidden === forbidden) return cached.grid;
  const count = world.width * world.height;
  const regionColumns = Math.ceil(world.width / NAVIGATION_REGION_SIZE), regionCount = regionColumns * Math.ceil(world.height / NAVIGATION_REGION_SIZE);
  const compatible = cached?.terrain === terrain;
  const grid: NavigationGrid = compatible ? cached.grid : {
    open: new Uint8Array(count), cost: new Float64Array(count), edges: new Uint8Array(count), component: new Int32Array(count),
    componentParents: new Map(),
    land: rowboatViews.has(state) ? new Uint8Array(count) : undefined, landVersion: 0,
    offsets: Int32Array.from(directions, ([dx, dy]) => dy * world.width + dx),
    nativeHistory: [], nativeChangesSince(version) { return changedCells(this.nativeHistory, version, this.version); }, version: 0,
    regionColumns, accessRegions: new Uint32Array(regionCount), costRegions: new Uint32Array(regionCount),
  };
  const structureCells = compatible && cached.topology === topology ? changedCells(topology.history, cached.buildings, buildings) : undefined;
  const terrainCells = compatible ? changedCells(terrain.history, cached.terrainVersion, terrain.version) : undefined;
  const full = !structureCells || !terrainCells || cached?.forbidden !== forbidden;
  const dirty = structureCells ?? new Set<number>();
  if (terrainCells) for (const cell of terrainCells) dirty.add(cell);
  const forbiddenSet = avoidForbidden ? forbiddenCells(state, faction) : undefined;
  const blockers = sharedBlockers ?? factionBlockers(state, faction, topology);
  const edgeCells = new Set<number>(terrainCells);
  const nativeDirty = new Set<number>();
  let connectivityChanged = !compatible;
  let connectivityRemoved = full;
  let navigationChanged = !compatible;
  const accessChanged = new Set<number>(), costChanged = new Set<number>();
  const region = (cell: number): number => Math.floor(cell % world.width / NAVIGATION_REGION_SIZE)
    + Math.floor(Math.floor(cell / world.width) / NAVIGATION_REGION_SIZE) * regionColumns;
  const ground = grid.land ? (saltAccessViews.has(state) ? saltTerrain(world, terrainNavigation(world)) : terrainNavigation(world)) : undefined;
  const refresh = (i: number): void => {
    const flags = topology.flags[i];
    const blocked = blockers.has(i);
    const open = Number(!blocked && !forbiddenSet?.has(i) && (terrain.open[i] || (flags & BRIDGE) && terrain.bridgeGround[i]));
    if (grid.open[i] !== open) {
      if (!open) connectivityRemoved = true;
      connectivityChanged = true; accessChanged.add(region(i));
      if (!full) { addHalo(edgeCells, i, 1, world.width, world.height); nativeDirty.add(i); }
    }
    grid.open[i] = open;
    // Transport the existing ground profile; native navigation owns the
    // civilian boat-vs-land policy. Bridges and river fords count as land.
    if (grid.land) {
      const land = Number(open && (ground!.open[i] || (flags & BRIDGE) && terrain.bridgeGround[i]));
      if (grid.land[i] !== land) accessChanged.add(region(i));
      grid.land[i] = land;
    }
    const cost = flags & ROUTE ? 1 / roadMovementMultiplier(world.tiles[i], flags)
      : terrain.cost[i] / (flags & DITCH ? IRRIGATION_MOVEMENT_MULTIPLIER : 1);
    if (grid.cost[i] !== cost) {
      costChanged.add(region(i));
      if (!full) nativeDirty.add(i);
    }
    grid.cost[i] = cost;
  };
  if (full) for (let i = 0; i < count; i++) refresh(i);
  else for (const i of dirty) refresh(i);
  const refreshEdges = (i: number): void => {
    let edges = 0;
    if (grid.open[i]) for (let d = 0; d < directions.length; d++) {
      const next = i + grid.offsets[d];
      if (terrain.edges[i] & (1 << d) && grid.open[next]) edges |= 1 << d;
    }
    if (grid.edges[i] !== edges) {
      if (grid.edges[i] & ~edges) connectivityRemoved = true;
      accessChanged.add(region(i)); connectivityChanged = true;
      if (!full) nativeDirty.add(i);
    }
    grid.edges[i] = edges;
  };
  if (full) for (let i = 0; i < count; i++) refreshEdges(i);
  else for (const i of edgeCells) refreshEdges(i);
  // Opening ground can only merge components. Relabel those components lazily
  // through their roots, and flood only when a closure may split one.
  if (connectivityChanged) {
    if (grid.reachability) grid.reachability.owner = undefined;
  }
  if (connectivityChanged && !connectivityRemoved) {
    for (const cell of edgeCells) if (grid.open[cell] && !grid.component[cell]) grid.component[cell] = cell + 1;
    for (const cell of edgeCells) for (let d = 0; d < directions.length; d++) {
      if (!(grid.edges[cell] & (1 << d))) continue;
      const from = componentAt(grid, cell), to = componentAt(grid, cell + grid.offsets[d]);
      if (from !== to) grid.componentParents.set(Math.max(from, to), Math.min(from, to));
    }
  } else if (connectivityChanged) {
    grid.component.fill(0);
    grid.componentParents.clear();
    // Components reject impossible orders immediately instead of exhaustively
    // searching the entire reachable continent each time a unit reconsidered one.
    let queue = componentQueues.get(world);
    if (!queue || queue.length !== count) { queue = new Int32Array(count); componentQueues.set(world, queue); }
    for (let i = 0; i < count; i++) {
      if (!grid.open[i] || grid.component[i]) continue;
      const component = i + 1;
      grid.component[i] = component; queue[0] = i;
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
  if (navigationChanged) {
    grid.version++;
    if (full) grid.nativeHistory.length = 0;
    else {
      grid.nativeHistory.push({ revision: grid.version, cells: [...nativeDirty] });
      if (grid.nativeHistory.length > MAX_CHANGE_HISTORY) grid.nativeHistory.shift();
    }
  }
  if (accessChanged.size) grid.landVersion++;
  factionCaches.set(cacheKey, { topology, terrain, terrainVersion: terrain.version, terrainGeometryVersion: terrain.geometryVersion, buildings, forbidden, grid });
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
      || !grid.open[start] || !grid.open[goal] || componentAt(grid, start) !== componentAt(grid, goal)) return result;
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
    const preferred = wasmPreferLandRoute(grid, grid.version, width, start,
      path.map(point => Math.floor(point.y) * width + Math.floor(point.x)));
    if (preferred) {
      path.length = 0;
      for (const cell of preferred) {
        path.push({ x: cell % width + .5, y: Math.floor(cell / width) + .5 });
        stampCell(grid, this.stamp!, cell, width, height);
      }
    }
    centerGroundRoute(grid, from, width, path);
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
    const component = componentAt(grid, Math.floor(start.y) * width + Math.floor(start.x));
    if (component) components.add(component);
  }
  if (components.size === 1) {
    const component = components.values().next().value!;
    for (let i = 0; i < mask.length; i++) mask[i] = Number(componentAt(grid, i) === component);
  } else if (components.size) {
    for (let i = 0; i < mask.length; i++) mask[i] = Number(components.has(componentAt(grid, i)));
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
  return !!grid.open[source] && !!grid.open[target] && componentAt(grid, source) === componentAt(grid, target);
}

/** Exact reachability between entrance sets on one unchanged static graph.
 * Construction eligibility needs connected sides, not a weighted route for
 * every pair. The grid includes the same terrain edges and forbidden cells
 * used by findPath and findShortestPathBetween. */
export function hasStaticPathBetween(state: GameState, origins: readonly Point[], goals: readonly Point[],
  faction: number, avoidForbidden = false): boolean {
  if (!origins.length || !goals.length) return false;
  const { width, height } = state.world, grid = navigationGrid(state, faction, avoidForbidden);
  const component = (point: Point): number => Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.y >= 0 && point.x < width && point.y < height
    ? componentAt(grid, Math.floor(point.y) * width + Math.floor(point.x)) : 0;
  const originsAt = new Set(origins.map(component)); originsAt.delete(0);
  return goals.some(point => originsAt.has(component(point)));
}

/** Exact path existence for several goals against one unchanged occupancy view.
 * Combat candidate checks need connectivity, not a weighted route or its Points.
 * Keep this query within a synchronous read-only search: movement, death or
 * topology changes require a new query. Interleaved queries safely restart the
 * shared scratch search rather than reading another query's visited cells. */
export function createReachabilityQuery(state: GameState, from: Point, faction: number, dynamicBlockers?: CellBlockers, avoidForbidden = false): (to: Point) => boolean {
  const { width, height } = state.world;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || from.x < 0 || from.y < 0 || from.x >= width || from.y >= height) return () => false;
  const grid = navigationGrid(state, faction, avoidForbidden), start = Math.floor(from.y) * width + Math.floor(from.x), component = componentAt(grid, start);
  if (!grid.open[start]) return () => false;
  if (!dynamicBlockers) return to => Number.isFinite(to.x) && Number.isFinite(to.y) && to.x >= 0 && to.y >= 0 && to.x < width && to.y < height
    && componentAt(grid, Math.floor(to.y) * width + Math.floor(to.x)) === component;
  const owner = {};
  return to => {
    if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || to.x < 0 || to.y < 0 || to.x >= width || to.y >= height) return false;
    const goal = Math.floor(to.y) * width + Math.floor(to.x);
    if (!grid.open[goal] || componentAt(grid, goal) !== component || goal !== start && dynamicBlockers.has(goal)) return false;
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
  const starts = new Set<number>();
  for (const origin of origins) {
    const x = Math.floor(origin.x), y = Math.floor(origin.y), start = y * width + x;
    if (x >= 0 && y >= 0 && x < width && y < height && grid.open[start]) starts.add(start);
  }
  const native = wasmTravelTimeMap(grid, grid.version, width, [...starts], speed, maxSeconds);
  if (native) return native;
  const costs = new Float64Array(width * height).fill(Infinity);
  const frontier = grid.frontier ??= new MinHeap(); frontier.clear();
  for (const start of starts) {
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

/** Closest reachable source ID at every tile, or -1 where none can reach.
 * Compare full-precision weighted distances; exact ties favor the smaller ID.
 * Unlike comparing separate float32 fields, near-ties retain their precision. */
export function nearestOriginMap(state: GameState, origins: readonly { point: Point; id: number }[], faction: number, avoidForbidden = false): Int32Array {
  const { width, height } = state.world, grid = navigationGrid(state, faction, avoidForbidden);
  const starts = new Map<number, number>();
  for (const { point, id } of origins) {
    const x = Math.floor(point.x), y = Math.floor(point.y), start = y * width + x;
    if (x >= 0 && y >= 0 && x < width && y < height && grid.open[start]
      && (!starts.has(start) || id < starts.get(start)!)) starts.set(start, id);
  }
  const native = wasmNearestOriginMap(grid, grid.version, width, starts);
  if (native) return native;
  const costs = new Float64Array(width * height).fill(Infinity), owners = new Int32Array(width * height).fill(-1);
  const frontier = grid.frontier ??= new MinHeap(); frontier.clear();
  for (const [start, id] of starts) { costs[start] = 0; owners[start] = id; frontier.push(start, 0); }
  while (frontier.length) {
    const current = frontier.pop(), currentScore = frontier.poppedScore;
    if (currentScore > costs[current]) continue;
    const owner = owners[current];
    for (let d = 0; d < directions.length; d++) if (grid.edges[current] & (1 << d)) {
      const [dx, dy] = directions[d], next = current + dy * width + dx;
      const cost = currentScore + (dx && dy ? Math.SQRT2 : 1) * (grid.cost[current] + grid.cost[next]) * .5;
      if (cost < costs[next]) {
        costs[next] = cost; owners[next] = owner; frontier.push(next, cost);
      // Positive edge costs ensure every equal-cost predecessor is expanded
      // before this cell, so a tie-label update needs no extra heap entry.
      } else if (cost === costs[next] && owner < owners[next]) owners[next] = owner;
    }
  }
  return owners;
}

export interface PathBetween { from: Point; to: Point; path: Point[]; cost: number }

/** Find the cheapest static journey between sets of cell-centered entrances.
 * One multi-source A* replaces the Cartesian product of separate searches.
 * Equal-cost choices retain deterministic heap order; callers own occupancy
 * filtering so temporary traffic never alters the shared navigation graph. */
export function findShortestPathBetween(state: GameState, origins: readonly Point[], goals: readonly Point[],
  faction: number, avoidForbidden = false): PathBetween | undefined {
  if (!origins.length || !goals.length) return;
  const { width, height } = state.world, grid = navigationGrid(state, faction, avoidForbidden);
  const cells = (points: readonly Point[]): number[] => [...new Set(points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.y >= 0 && point.x < width && point.y < height
    && point.x % 1 === .5 && point.y % 1 === .5)
    .map(point => Math.floor(point.y) * width + Math.floor(point.x)).filter(cell => grid.open[cell]))];
  let starts = cells(origins), ends = cells(goals);
  const components = new Set(starts.map(cell => componentAt(grid, cell)));
  ends = ends.filter(cell => components.has(componentAt(grid, cell)));
  const targetComponents = new Set(ends.map(cell => componentAt(grid, cell)));
  starts = starts.filter(cell => targetComponents.has(componentAt(grid, cell)));
  if (!starts.length || !ends.length) return;
  const point = (cell: number): Point => ({ x: cell % width + .5, y: Math.floor(cell / width) + .5 });
  const unpack = (route: readonly number[] | Int32Array, cost: number): PathBetween => ({
    from: point(route[0]), to: point(route[route.length - 1]), path: Array.from(route).slice(1).map(point), cost,
  });
  const targets = new Set(ends), shared = starts.find(cell => targets.has(cell));
  if (shared !== undefined) return unpack([shared], 0);
  const native = wasmPathBetween(grid, grid.version, width, starts, ends);
  if (native !== undefined) return native ? unpack(native.cells, native.cost) : undefined;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const cell of ends) {
    const x = cell % width, y = Math.floor(cell / width);
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const heuristic = (cell: number): number => {
    const x = cell % width, y = Math.floor(cell / width);
    const dx = Math.max(minX - x, 0, x - maxX), dy = Math.max(minY - y, 0, y - maxY);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) / PAVED_ROAD_SPEED;
  };
  const scratch = searchScratch(grid), { costs, previous, seen, closed, frontier } = scratch;
  scratch.stamp = (scratch.stamp + 1) >>> 0;
  if (!scratch.stamp) { seen.fill(0); closed.fill(0); scratch.stamp = 1; }
  const stamp = scratch.stamp; frontier.clear();
  for (const cell of starts) { costs[cell] = 0; previous[cell] = -1; seen[cell] = stamp; frontier.push(cell, heuristic(cell)); }
  while (frontier.length) {
    const current = frontier.pop();
    if (closed[current] === stamp) continue;
    if (targets.has(current)) {
      const path: number[] = [];
      for (let step = current; step !== -1; step = previous[step]) path.push(step);
      path.reverse();
      const preferred = wasmPreferLandBetween(grid, grid.version, width, starts, ends, path, costs[current]);
      return preferred ? unpack(preferred.cells, preferred.cost) : unpack(path, costs[current]);
    }
    closed[current] = stamp;
    for (let direction = 0; direction < directions.length; direction++) if (grid.edges[current] & (1 << direction)) {
      const next = current + grid.offsets[direction];
      if (closed[next] === stamp) continue;
      const cost = costs[current] + directionLengths[direction] * (grid.cost[current] + grid.cost[next]) * .5;
      if (seen[next] === stamp && cost >= costs[next]) continue;
      costs[next] = cost; previous[next] = current; seen[next] = stamp; frontier.push(next, cost + heuristic(next));
    }
  }
  return;
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
  const grid = navigationGrid(state, faction, avoidForbidden), component = componentAt(grid, start);
  const open = (index: number) => !!grid.open[index] && (index === start || !dynamicBlockers?.has(index));
  const goalOpen = inside(goalX, goalY) && open(goal) && componentAt(grid, goal) === component;
  if (!open(start) || !allowPartial && !goalOpen) return [];
  if (start === goal) return [{ x: to.x, y: to.y }];
  const heuristic = (x: number, y: number) => {
    const dx = Math.abs(goalX - x), dy = Math.abs(goalY - y);
    return (preferCardinal ? dx + dy : Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) / PAVED_ROAD_SPEED;
  };
  let nearestOpenDistance = Infinity;
  if (allowPartial && !goalOpen) {
    // The open start is already a valid candidate. Any closer cell has both
    // axis distances <= PAVED_ROAD_SPEED * h(start), so nearby blocked orders do not need
    // a scan of the entire map. A one-cell margin covers floating-point bounds;
    // extreme public coordinates retain the unrestricted scan.
    const radius = Math.ceil(heuristic(startX, startY) * PAVED_ROAD_SPEED) + 1;
    const bounded = Number.isSafeInteger(radius) && Number.isSafeInteger(goalX) && Number.isSafeInteger(goalY);
    const x0 = bounded ? Math.max(0, goalX - radius) : 0, x1 = bounded ? Math.min(width - 1, goalX + radius) : width - 1;
    const y0 = bounded ? Math.max(0, goalY - radius) : 0, y1 = bounded ? Math.min(height - 1, goalY + radius) : height - 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (componentAt(grid, i) === component && open(i)) nearestOpenDistance = Math.min(nearestOpenDistance, heuristic(x, y));
    }
  }
  const native = wasmPath(grid, grid.version, width, start, goalX, goalY, goalOpen, allowPartial, preferCardinal,
    nearestOpenDistance, dynamicBlockers ? nativeBlockerSource(dynamicBlockers) ?? dynamicBlockers : undefined, softBlockers, congestion);
  if (native !== undefined) {
    if (native === null) return preferCardinal ? findPath(state, from, to, faction, allowPartial, dynamicBlockers, softBlockers, congestion, false, avoidForbidden) : [];
    const path: Point[] = Array.from(native, step => ({ x: step % width + .5, y: Math.floor(step / width) + .5 }));
    centerGroundRoute(grid, from, width, path);
    const buildings = factionBlockers(state, faction);
    const movementBlockers = { has: (index: number) => buildings.has(index) || index !== start && !!dynamicBlockers?.has(index) };
    if (path.length && !canMove(state, from, path[0], faction, movementBlockers, avoidForbidden)) path.unshift({ x: startX + .5, y: startY + .5 });
    return path;
  }
  // Opaque blocker predicates can issue other route queries synchronously.
  // Their fallback owns its scratch until the outer search finishes.
  const scratch = searchScratch(grid);
  grid.search = undefined;
  try {
    const { costs, previous, seen, closed, frontier } = scratch;
    scratch.stamp = (scratch.stamp + 1) >>> 0;
    if (!scratch.stamp) { seen.fill(0); closed.fill(0); scratch.stamp = 1; }
    const stamp = scratch.stamp;
    frontier.clear();
    costs[start] = 0; seen[start] = stamp; previous[start] = -1; frontier.push(start, heuristic(startX, startY));
    let closest = start, closestDistance = heuristic(startX, startY);
    const edgeMask = preferCardinal ? CARDINAL_EDGES : 255;
    const reconstruct = (end: number): Point[] => {
      const path: Point[] = [];
      for (let step = end; step !== start && step !== -1; step = previous[step]) path.push({ x: step % width + 0.5, y: Math.floor(step / width) + 0.5 });
      path.reverse();
      const preferred = wasmPreferLandRoute(grid, grid.version, width, start,
        path.map(point => Math.floor(point.y) * width + Math.floor(point.x)),
        dynamicBlockers ? nativeBlockerSource(dynamicBlockers) ?? dynamicBlockers : undefined);
      if (preferred) {
        path.length = 0;
        for (const cell of preferred) path.push({ x: cell % width + .5, y: Math.floor(cell / width) + .5 });
      }
      centerGroundRoute(grid, from, width, path);
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
  } finally {
    grid.search = scratch;
  }
}

// These views affect navigation only: real structures remain targetable and
// keep their ownership, collision rules for soldiers, and economy roles.
const workerViews = new WeakMap<GameState, Map<string, { view: GameState; source?: readonly StructureSnapshot[]; buildings: readonly Building[]; topology?: StructureGrid; include?: (building: Building) => boolean; inherited?: (building: Building) => boolean }>>();
const saltWorkViews = new WeakMap<GameState, WeakMap<readonly number[], GameState>>();
/** A shared view per assigned footprint. The Rust work policy authorizes
 * callers; this bridge transports the exact cell mask without editing tiles. */
export function saltWorkNavigationState(state: GameState, cells: readonly number[]): GameState {
  let views = saltWorkViews.get(state);
  if (!views) { views = new WeakMap(); saltWorkViews.set(state, views); }
  let view = views.get(cells);
  if (!view) {
    view = Object.create(state) as GameState;
    navigationSources.set(view, navigationSources.get(state) ?? state);
    const include = navigationFilters.get(state); if (include) navigationFilters.set(view, include);
    if (navigationGateDependents.has(state)) navigationGateDependents.add(view);
    saltGeometrySources.set(view, state);
    saltAccessViews.set(view, new Set(cells));
    if (rowboatViews.has(state)) rowboatViews.add(view);
    views.set(cells, view);
  }
  const include = navigationFilters.get(state);
  if (navigationFilters.get(view) !== include) {
    if (include) navigationFilters.set(view, include); else navigationFilters.delete(view);
    invalidateNavigation(view);
  }
  return view;
}
export function workNavigationState(state: GameState, builder = false, faction = -1, tradePartner?: number, rowboat = builder): GameState {
  if (!builder && tradePartner === undefined && !rowboat) return state;
  let views = workerViews.get(state); if (!views) { views = new Map(); workerViews.set(state, views); }
  const key = `${builder}:${faction}:${tradePartner}:${rowboat}`, topology = structures(state);
  let entry = views.get(key);
  if (!entry) {
    entry = { view: Object.create(state), buildings: [] };
    Object.defineProperty(entry.view, 'buildings', { get: () => entry!.buildings, enumerable: true });
    navigationSources.set(entry.view, navigationSources.get(state) ?? state);
    if (rowboat) rowboatViews.add(entry.view);
    views.set(key, entry);
  }
  const inherited = navigationFilters.get(state), source = navigationSources.get(state) ?? state;
  if (tradePartner !== undefined || navigationGateDependents.has(state)) navigationGateDependents.add(entry.view);
  entry.topology = topology;
  if (!entry.include || entry.inherited !== inherited) {
    entry.inherited = inherited;
    entry.include = (building: Building): boolean => {
      if (inherited && !inherited(building)) return false;
      if (builder && building.kind === 'house') return false;
      if (tradePartner !== undefined && isWallKind(building.kind) && building.faction === tradePartner
        && (structureCaches.get(source) ?? entry!.topology!).occupants.get(building.y * state.world.width + building.x)?.some(b => b.kind === 'road' && b.alive)) return false;
      return true;
    };
    navigationFilters.set(entry.view, entry.include);
    entry.source = undefined;
  }
  if (entry.source !== topology.buildings) {
    entry.buildings = state.buildings.filter(entry.include);
    entry.source = topology.buildings;
  }
  return entry.view;
}
