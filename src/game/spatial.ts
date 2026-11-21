import { playerFaction } from './player-context';
import { buildingHeight, buildingSize, buildingWidth, type Building, type GameState, type Point, type Unit } from './types';
import { civilianFootprint, unitObstructs, unitBlocksNavigationCell, unitsCollide } from './collisions';
import { entityStore, type UnitRole } from './entity-store';
import { nativeMovement, type NativeMovementWorld } from './movement-native';
import { structureIndex } from './structure-index';

const BUCKET_SIZE = 4;

const combatCell = (x: number, y: number) => `${x},${y}`;
class CombatBuckets<T extends Point> {
  private readonly cells = new Map<string, Set<T>>();
  private readonly entries = new Map<T, { cell: string; order: number }>();
  private nextOrder = 0;
  constructor(private readonly center: (entity: T) => Point) {}

  reset(entities: readonly T[]): void {
    this.cells.clear(); this.entries.clear(); this.nextOrder = 0;
    for (const entity of entities) this.refresh(entity);
  }

  refresh(entity: T): void {
    const point = this.center(entity);
    const cell = combatCell(Math.floor(point.x / BUCKET_SIZE), Math.floor(point.y / BUCKET_SIZE));
    const previous = this.entries.get(entity);
    if (previous?.cell === cell) return;
    if (previous) this.remove(entity);
    let group = this.cells.get(cell);
    if (!group) this.cells.set(cell, group = new Set());
    group.add(entity);
    this.entries.set(entity, { cell, order: previous?.order ?? this.nextOrder++ });
  }

  remove(entity: T): void {
    const previous = this.entries.get(entity);
    if (!previous) return;
    const group = this.cells.get(previous.cell)!;
    group.delete(entity);
    if (!group.size) this.cells.delete(previous.cell);
    this.entries.delete(entity);
  }

  around(point: Point, radius: number): T[] {
    const x0 = Math.floor((point.x - radius) / BUCKET_SIZE), x1 = Math.floor((point.x + radius) / BUCKET_SIZE);
    const y0 = Math.floor((point.y - radius) / BUCKET_SIZE), y1 = Math.floor((point.y + radius) / BUCKET_SIZE);
    const result: T[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      for (const entity of this.cells.get(combatCell(x, y)) ?? []) result.push(entity);
    }
    return result.sort((a, b) => this.entries.get(a)!.order - this.entries.get(b)!.order);
  }
}

const unitCenter = (unit: Unit): Point => unit;
const buildingCenter = (building: Building): Point => ({ x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });

/** The early combat phases precede movement indexing, and their targets can
 * include sleeping actors. Prepare each roster lazily and retain array order
 * for callbacks whose side effects are applied sequentially. */
class EarlyCombatQueries {
  active = false;
  private unitsCurrent = false;
  private buildingsCurrent = false;
  private readonly units = new CombatBuckets(unitCenter);
  private readonly buildings = new CombatBuckets(buildingCenter);
  private readonly unitObserver = {
    added: (unit: Unit) => this.refreshUnit(unit),
    removed: (unit: Unit) => this.units.remove(unit),
    changed: (unit: Unit) => this.refreshUnit(unit),
  };
  private readonly buildingObserver = {
    added: (building: Building) => this.refreshBuilding(building),
    removed: (building: Building) => this.buildings.remove(building),
    changed: (building: Building) => this.refreshBuilding(building),
  };
  constructor(readonly store: ReturnType<typeof entityStore>) {
    store.units.observe(this.unitObserver);
    store.buildings.observe(this.buildingObserver);
  }
  begin(): void { this.active = true; this.unitsCurrent = false; this.buildingsCurrent = false; }
  refreshUnit(unit: Unit): void { if (this.active && this.unitsCurrent) this.units.refresh(unit); }
  private refreshBuilding(building: Building): void { if (this.active && this.buildingsCurrent) this.buildings.refresh(building); }
  nearbyUnits(state: GameState, point: Point, radius: number): Unit[] {
    if (!this.unitsCurrent) { this.units.reset(state.units); this.unitsCurrent = true; }
    return this.units.around(point, radius);
  }
  nearbyBuildings(state: GameState, point: Point, radius: number): Building[] {
    if (!this.buildingsCurrent) { this.buildings.reset(state.buildings); this.buildingsCurrent = true; }
    return this.buildings.around(point, radius);
  }
}
const earlyCombatQueries = new WeakMap<GameState, EarlyCombatQueries>();

export function withEarlyCombatQueries<T>(state: GameState, run: () => T): T {
  let view = earlyCombatQueries.get(state);
  if (view?.active) return run();
  const store = entityStore(state);
  if (!view || view.store !== store) { view = new EarlyCombatQueries(store); earlyCombatQueries.set(state, view); }
  view.begin();
  try { return run(); } finally { view.active = false; }
}

export function earlyCombatUnits(state: GameState, point: Point, radius: number): readonly Unit[] {
  const view = earlyCombatQueries.get(state);
  return view?.active && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(radius)
    ? view.nearbyUnits(state, point, radius) : state.units;
}

export function earlyCombatBuildings(state: GameState, point: Point, radius: number): readonly Building[] {
  const view = earlyCombatQueries.get(state);
  return view?.active && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(radius)
    ? view.nearbyBuildings(state, point, radius) : state.buildings;
}

export function refreshEarlyCombatUnit(state: GameState, unit: Unit): void {
  earlyCombatQueries.get(state)?.refreshUnit(unit);
}

interface IndexedUnit {
  unit: Unit; order: number; cell: number; tile: number; bucketOrder: number; bucketSlot: number;
  seen: number;
}
interface UnitIndex {
  native: NativeMovementWorld;
  buckets: IndexedUnit[][];
  bucketVersions: number[];
  unitQueries: Map<number | string, { versions: number[]; units: Unit[] }>;
  occupancyViews: WeakMap<Unit, Pick<ReadonlySet<number>, 'has'>>;
  buildingQueries: Map<number | string, Building[]>;
  unitOrder: readonly Unit[];
  unitRevision: number;
  unitBits: Uint32Array;
  uniqueUnitOrders: boolean;
  buildingOrder: Building[];
  buildingSource?: readonly Building[];
  buildingGeometry?: number;
  buildingBits: Uint32Array;
  entries: Map<Unit, IndexedUnit>;
  generation: number;
  buildingCells: number[];
  buildingSizes: number[];
  buildingXs: number[];
  buildingYs: number[];
  buildingKinds: Building['kind'][];
  buildingEntries: { building: Building; order: number }[];
  buildingBuckets: { building: Building; order: number }[][];
  maxBuildingSize: number;
  columns: number;
  rows: number;
  width: number;
  nextBucketOrder: number;
}
const frames = new WeakMap<GameState, UnitIndex>();
const retained = new WeakMap<GameState, UnitIndex>();
const bucket = (index: UnitIndex, x: number, y: number): number => Math.floor(y / BUCKET_SIZE) * index.columns + Math.floor(x / BUCKET_SIZE);
const tile = (index: UnitIndex, unit: Point): number => Math.floor(unit.y) * index.width + Math.floor(unit.x);

/** Reuse position buckets between steps. Movement updates only changed cells.
 * Original array order still defines deterministic query and yield priority. */
export function beginUnitFrame(state: GameState): void {
  let index = retained.get(state);
  const columns = Math.ceil(state.world.width / BUCKET_SIZE), rows = Math.ceil(state.world.height / BUCKET_SIZE);
  if (!index || index.width !== state.world.width || index.rows !== rows) {
    index = {
      native: nativeMovement(state),
      buckets: [], bucketVersions: [], unitQueries: new Map(), buildingQueries: new Map(),
      occupancyViews: new WeakMap(),
      unitOrder: [], unitRevision: -1, unitBits: new Uint32Array(0), uniqueUnitOrders: true,
      buildingOrder: [], buildingBits: new Uint32Array(0), buildingCells: [], buildingSizes: [],
      buildingXs: [], buildingYs: [], buildingKinds: [], buildingEntries: [],
      entries: new Map(), generation: 0,
      buildingBuckets: [], maxBuildingSize: 1, columns, rows, width: state.world.width, nextBucketOrder: 0,
    };
    retained.set(state, index);
  }
  index.native = nativeMovement(state); index.native.begin(entityStore(state));
  index.generation++; index.uniqueUnitOrders = true;
  if (index.unitQueries.size > 1024) index.unitQueries.clear();
  if (index.buildingQueries.size > 1024) index.buildingQueries.clear();
  let buildingChanged = index.buildingOrder.length !== state.buildings.length;
  // The resident building index publishes every membership, position and kind
  // change. An unchanged geometry revision means every footprint below is
  // current, so the per-building comparison is skipped for the whole list.
  const geometry = structureIndex(state).geometry;
  const buildingsCurrent = !buildingChanged && index.buildingSource === state.buildings && index.buildingGeometry === geometry;
  index.buildingSource = state.buildings; index.buildingGeometry = geometry;
  if (!buildingsCurrent) for (let order = 0; order < state.buildings.length; order++) {
    const building = state.buildings[order];
    // Keep exact support for direct editor/test mutations, but only recalculate
    // geometry for changed objects. Health and ownership never affect buckets.
    if (index.buildingOrder[order] === building && index.buildingXs[order] === building.x
      && index.buildingYs[order] === building.y && index.buildingKinds[order] === building.kind) continue;
    const cell = bucket(index, building.x, building.y), size = buildingSize(building);
    if (index.buildingOrder[order] !== building || index.buildingCells[order] !== cell || index.buildingSizes[order] !== size) buildingChanged = true;
    index.buildingOrder[order] = building; index.buildingCells[order] = cell; index.buildingSizes[order] = size;
    index.buildingXs[order] = building.x; index.buildingYs[order] = building.y; index.buildingKinds[order] = building.kind;
    const entry = index.buildingEntries[order];
    if (entry) entry.building = building;
    else index.buildingEntries[order] = { building, order };
  }
  if (buildingChanged) {
    index.buildingOrder.length = index.buildingCells.length = index.buildingSizes.length = state.buildings.length;
    index.buildingXs.length = index.buildingYs.length = index.buildingKinds.length = index.buildingEntries.length = state.buildings.length;
    for (const group of index.buildingBuckets) if (group) group.length = 0;
    index.maxBuildingSize = 1;
    for (let order = 0; order < index.buildingOrder.length; order++) {
      const building = index.buildingOrder[order], key = index.buildingCells[order];
      const group = index.buildingBuckets[key] ?? (index.buildingBuckets[key] = []);
      group.push(index.buildingEntries[order]); index.maxBuildingSize = Math.max(index.maxBuildingSize, index.buildingSizes[order]);
    }
    index.buildingQueries.clear();
    if (index.buildingBits.length * 32 < state.buildings.length) index.buildingBits = new Uint32Array(Math.ceil(state.buildings.length / 32));
  }
  const store = entityStore(state), units = store.units;
  const unitOrderChanged = index.unitOrder !== state.units || index.unitRevision !== units.revision;
  index.unitOrder = state.units; index.unitRevision = units.revision;
  for (const unit of units.query('active')) {
    if (store.isWorkerDormant(unit)) continue;
    const order = units.indexOf(unit);
    let entry = index.entries.get(unit);
    const key = bucket(index, unit.x, unit.y), nextTile = tile(index, unit);
    if (!entry) {
      const group = index.buckets[key] ?? (index.buckets[key] = []);
      entry = { unit, order, cell: key, tile: nextTile, bucketOrder: order, bucketSlot: group.length, seen: index.generation };
      group.push(entry); index.entries.set(unit, entry);
      index.bucketVersions[key] = (index.bucketVersions[key] ?? 0) + 1;
    } else {
      entry.tile = nextTile;
      if (entry.cell !== key) moveBucket(index, entry, key);
      entry.order = order; entry.bucketOrder = order; entry.seen = index.generation;
    }
    index.native.index(unit, order, entry.bucketOrder, entry.tile);
  }
  for (const [unit, entry] of index.entries) if (entry.seen !== index.generation) {
    removeBucket(index, entry); index.native.remove(unit); index.entries.delete(unit);
  }
  if (unitOrderChanged) index.unitQueries.clear();
  if (index.unitBits.length * 32 < state.units.length) index.unitBits = new Uint32Array(Math.ceil(state.units.length / 32));
  index.nextBucketOrder = state.units.length;
  index.native.finishBegin();
  frames.set(state, index);
}

function removeBucket(index: UnitIndex, entry: IndexedUnit): void {
  const group = index.buckets[entry.cell], last = group.pop()!;
  if (last !== entry) { group[entry.bucketSlot] = last; last.bucketSlot = entry.bucketSlot; }
  index.bucketVersions[entry.cell] = (index.bucketVersions[entry.cell] ?? 0) + 1;
}
function moveBucket(index: UnitIndex, entry: IndexedUnit, key: number): void {
  removeBucket(index, entry); entry.cell = key;
  const group = index.buckets[key] ?? (index.buckets[key] = []);
  entry.bucketSlot = group.length; group.push(entry);
  index.bucketVersions[key] = (index.bucketVersions[key] ?? 0) + 1;
}

export function refreshIndexedUnit(state: GameState, unit: Unit): void {
  const index = frames.get(state);
  if (!index) { refreshEarlyCombatUnit(state, unit); return; }
  let entry = index.entries.get(unit);
  const store = entityStore(state);
  if (store.isWorkerDormant(unit) || store.isUnitSleeping(unit)) {
    if (entry) { removeBucket(index, entry); index.native.remove(unit); index.entries.delete(unit); }
    return;
  }
  const key = bucket(index, unit.x, unit.y), nextTile = tile(index, unit);
  if (entry && entry.tile !== nextTile) {
    entry.tile = nextTile;
  }
  if (key === entry?.cell) { index.native.index(unit, entry.order, entry.bucketOrder, entry.tile); return; }
  if (entry) moveBucket(index, entry, key);
  else {
    const order = store.units.indexOf(unit), group = index.buckets[key] ?? (index.buckets[key] = []);
    entry = { unit, order, cell: key, tile: nextTile, bucketOrder: index.nextBucketOrder, bucketSlot: group.length, seen: index.generation };
    if (order < 0 || index.unitOrder[order] && index.unitOrder[order] !== unit) index.uniqueUnitOrders = false;
    if (order >= index.unitBits.length * 32) index.unitBits = new Uint32Array(Math.ceil((order + 1) / 32));
    index.entries.set(unit, entry); group.push(entry);
    index.bucketVersions[key] = (index.bucketVersions[key] ?? 0) + 1;
  }
  entry.bucketOrder = index.nextBucketOrder++;
  index.native.index(unit, entry.order, entry.bucketOrder, entry.tile);
}
export function endUnitFrame(state: GameState): void {
  const index = frames.get(state); if (index) index.native.active = false;
  frames.delete(state);
}

/** Stable bevy_ecs role queries, including outside simulation updates. */
export function unitsWithRole(state: GameState, role: UnitRole): readonly Unit[] {
  return entityStore(state).units.query(role);
}

// The usual in-world bounds have a collision-free numeric key. Preserve the
// unbounded public broad phase with a string fallback for off-map queries.
function queryKey(index: UnitIndex, x0: number, x1: number, y0: number, y1: number): number | string {
  return x0 <= x1 && y0 <= y1 && y1 < index.rows
    ? x0 + index.columns * (x1 + index.columns * (y0 + index.rows * y1))
    : `${x0},${x1},${y0},${y1}`;
}

/** Emit marked array positions in original order without sorting candidates.
 * The scratch words are cleared before returning, so repeated queries allocate
 * only their result, not a second candidate array and comparator closures. */
function orderedMatches<T>(bits: Uint32Array, values: readonly T[], first: number, last: number): T[] {
  const result: T[] = [];
  for (let word = first; word <= last; word++) {
    let mask = bits[word]; bits[word] = 0;
    while (mask) {
      const lowest = mask & -mask;
      result.push(values[(word << 5) + 31 - Math.clz32(lowest)]);
      mask ^= lowest;
    }
  }
  return result;
}

/** Broad phase only: consumers retain exact range, allegiance and collision
 * checks. Outside a step, public simulation helpers safely scan live units. */
export function nearbyUnits(state: GameState, point: Point, radius: number): readonly Unit[] {
  const index = frames.get(state);
  if (!index || !Number.isFinite(radius)) return state.units;
  const x0 = Math.max(0, Math.floor((point.x - radius) / BUCKET_SIZE)), x1 = Math.min(index.columns - 1, Math.floor((point.x + radius) / BUCKET_SIZE));
  const y0 = Math.max(0, Math.floor((point.y - radius) / BUCKET_SIZE)), y1 = Math.floor((point.y + radius) / BUCKET_SIZE);
  const key = queryKey(index, x0, x1, y0, y1), cached = index.unitQueries.get(key);
  let cursor = 0, unchanged = !!cached;
  if (cached) for (let y = y0; y <= y1 && unchanged; y++) for (let x = x0; x <= x1; x++) {
    if (cached.versions[cursor++] !== (index.bucketVersions[y * index.columns + x] ?? 0)) { unchanged = false; break; }
  }
  if (unchanged) return cached!.units;
  const versions: number[] = [], bits = index.unitBits;
  let first = Infinity, last = -1;
  const fallback: IndexedUnit[] | undefined = index.uniqueUnitOrders ? undefined : [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cell = y * index.columns + x, group = index.buckets[cell];
    versions.push(index.bucketVersions[cell] ?? 0);
    if (group) for (let i = 0; i < group.length; i++) {
      const entry = group[i];
      if (fallback) { fallback.push(entry); continue; }
      const word = entry.order >>> 5;
      bits[word] |= 1 << (entry.order & 31);
      if (word < first) first = word;
      if (word > last) last = word;
    }
  }
  const units = fallback ? fallback.sort((a, b) => a.order - b.order || a.cell - b.cell || a.bucketOrder - b.bucketOrder).map(entry => entry.unit)
    : orderedMatches(bits, index.unitOrder, first, last);
  index.unitQueries.set(key, { versions, units });
  return units;
}

/** Allocation-free broad-phase visit for order-independent counts/queries.
 * Bucket order is intentionally unspecified; original array order is supplied
 * separately for callers that must choose a deterministic first matching unit.
 * The visitor must not move units or otherwise mutate index membership. */
export function forEachNearbyUnit(state: GameState, point: Point, radius: number, visit: (unit: Unit, order: number) => void): void {
  const index = frames.get(state);
  if (!index || !Number.isFinite(radius)) {
    for (let i = 0; i < state.units.length; i++) visit(state.units[i], i);
    return;
  }
  const x0 = Math.max(0, Math.floor((point.x - radius) / BUCKET_SIZE)), x1 = Math.min(index.columns - 1, Math.floor((point.x + radius) / BUCKET_SIZE));
  const y0 = Math.max(0, Math.floor((point.y - radius) / BUCKET_SIZE)), y1 = Math.floor((point.y + radius) / BUCKET_SIZE);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const group = index.buckets[y * index.columns + x];
    if (group) for (let i = 0; i < group.length; i++) { const entry = group[i]; visit(entry.unit, entry.order); }
  }
}

export function indexedUnit(state: GameState, id: number): Unit | undefined {
  return entityStore(state).units.get(id);
}

/** Keep first-living-leader selection in original unit order. Death remains
 * visible immediately even before the dead unit's index refresh. */
export function indexedLeader(state: GameState, faction = playerFaction(state)): Unit | undefined {
  return entityStore(state).units.queryFaction('leader', faction).find(unit => unit.hp > 0);
}

/** A moving unit probes only its next cell; do not build an all-unit occupancy
 * set for each sub-tile step. Health and hiding state remain live. */
export function cellOccupant(state: GameState, point: Point, unit: Unit): Unit | undefined {
  if (civilianFootprint(unit)) return undefined;
  const x = Math.floor(point.x), y = Math.floor(point.y), index = frames.get(state);
  if (!index || x < 0 || y < 0 || x >= state.world.width || y >= state.world.height)
    return state.units.find(other => unitObstructs(unit, other) && Math.floor(other.x) === x && Math.floor(other.y) === y);
  const id = index.native.occupant(y * index.width + x, unit, 0);
  return Number.isNaN(id) ? undefined : entityStore(state).units.get(id);
}

/** Yield chains formerly built a cell Map from the entire unit array. Preserve
 * that Map's last-matching-unit rule (including the requester), while probing
 * only the existing tile list. This is distinct from movement's first blocker. */
export function lastCollidingUnitInCell(state: GameState, cell: number, unit: Unit): Unit | undefined {
  const index = frames.get(state), width = state.world.width;
  const matches = (other: Unit): boolean => other.hp > 0 && !other.inside && unitsCollide(unit, other)
    && Math.floor(other.y) * width + Math.floor(other.x) === cell;
  if (!index) {
    for (let i = state.units.length - 1; i >= 0; i--) if (matches(state.units[i])) return state.units[i];
    return;
  }
  const id = index.native.occupant(cell, unit, 1);
  return Number.isNaN(id) ? undefined : entityStore(state).units.get(id);
}

const unblockedUnitCells = { has: () => false };
/** Read-only unit occupancy for synchronous navigation probes. During a unit
 * frame this follows refreshed tile entries and checks live health/hiding;
 * public calls outside a frame receive an ordinary request-local snapshot.
 * Keep the indexed query lazy: serializing every unit for short probes is slower
 * than checking the few cells visited by JavaScript navigation. */
export function unitOccupancy(state: GameState, unit: Unit): Pick<ReadonlySet<number>, 'has'> {
  if (unit.training) return unblockedUnitCells;
  const index = frames.get(state);
  if (!index) {
    const occupied = new Set<number>();
    if (civilianFootprint(unit)) return occupied;
    for (const other of state.units) if (unitBlocksNavigationCell(unit, other)) occupied.add(Math.floor(other.y) * state.world.width + Math.floor(other.x));
    return occupied;
  }
  let view = index.occupancyViews.get(unit);
  if (view) return view;
  view = {
    has: cell => {
      if (civilianFootprint(unit)) return false;
      return !Number.isNaN(index.native.occupant(cell, unit, 0));
    },
  };
  index.occupancyViews.set(unit, view);
  return view;
}

/** Buildings do not move during unit updates; health and construction state
 * stay live on the referenced object. Calls outside a step scan normally. */
export function indexedBuilding(state: GameState, id: number | undefined): Building | undefined {
  if (id === undefined) return undefined;
  return entityStore(state).buildings.get(id);
}

/** Broad-phase building candidates in original order, including large footprints. */
export function nearbyBuildings(state: GameState, point: Point, radius: number): readonly Building[] {
  const index = frames.get(state);
  if (!index || !Number.isFinite(radius)) return state.buildings;
  const padding = radius + index.maxBuildingSize;
  const x0 = Math.max(0, Math.floor((point.x - padding) / BUCKET_SIZE)), x1 = Math.min(index.columns - 1, Math.floor((point.x + radius) / BUCKET_SIZE));
  const y0 = Math.max(0, Math.floor((point.y - padding) / BUCKET_SIZE)), y1 = Math.floor((point.y + radius) / BUCKET_SIZE);
  const key = queryKey(index, x0, x1, y0, y1), cached = index.buildingQueries.get(key);
  if (cached) return cached;
  const bits = index.buildingBits;
  let first = Infinity, last = -1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const group = index.buildingBuckets[y * index.columns + x];
    if (group) for (let i = 0; i < group.length; i++) {
      const order = group[i].order, word = order >>> 5;
      bits[word] |= 1 << (order & 31);
      if (word < first) first = word;
      if (word > last) last = word;
    }
  }
  const buildings = orderedMatches(bits, index.buildingOrder, first, last);
  index.buildingQueries.set(key, buildings);
  return buildings;
}
