import { playerFaction } from './player-context';
import { buildingSize, type Building, type GameState, type Point, type Unit } from './types';
import { civilianFootprint, unitObstructs, unitBlocksNavigationCell, unitsCollide } from './collisions';
import { entityStore, type UnitRole } from './entity-store';

const BUCKET_SIZE = 4;
interface IndexedUnit {
  unit: Unit; order: number; cell: number; tile: number; bucketOrder: number; bucketSlot: number;
  seen: number;
  tilePrevious?: IndexedUnit; tileNext?: IndexedUnit;
}
interface UnitIndex {
  buckets: IndexedUnit[][];
  bucketVersions: number[];
  unitQueries: Map<number | string, { versions: number[]; units: Unit[] }>;
  occupancyViews: WeakMap<Unit, Pick<ReadonlySet<number>, 'has'>>;
  buildingQueries: Map<number | string, Building[]>;
  unitOrder: readonly Unit[];
  unitRevision: number;
  occupancyRevision: number;
  occupancyAdditions: Unit[];
  unitBits: Uint32Array;
  uniqueUnitOrders: boolean;
  buildingOrder: Building[];
  buildingBits: Uint32Array;
  tiles: Map<number, IndexedUnit>;
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

// Intrusive tile lists reuse the broad-phase entries. Most cells hold one unit,
// so point occupancy needs neither a full bucket scan nor a per-cell Set.
function addTile(index: UnitIndex, entry: IndexedUnit): void {
  const head = index.tiles.get(entry.tile);
  entry.tilePrevious = undefined; entry.tileNext = head;
  if (head) head.tilePrevious = entry;
  index.tiles.set(entry.tile, entry);
}
function removeTile(index: UnitIndex, entry: IndexedUnit): void {
  if (entry.tilePrevious) entry.tilePrevious.tileNext = entry.tileNext;
  else if (entry.tileNext) index.tiles.set(entry.tile, entry.tileNext);
  else index.tiles.delete(entry.tile);
  if (entry.tileNext) entry.tileNext.tilePrevious = entry.tilePrevious;
}

/** Reuse position buckets between steps. Movement updates only changed cells.
 * Original array order still defines deterministic query and yield priority. */
export function beginUnitFrame(state: GameState): void {
  let index = retained.get(state);
  const columns = Math.ceil(state.world.width / BUCKET_SIZE), rows = Math.ceil(state.world.height / BUCKET_SIZE);
  if (!index || index.width !== state.world.width || index.rows !== rows) {
    index = {
      buckets: [], bucketVersions: [], unitQueries: new Map(), buildingQueries: new Map(),
      occupancyViews: new WeakMap(),
      unitOrder: [], unitRevision: -1, occupancyRevision: -1, occupancyAdditions: [], unitBits: new Uint32Array(0), uniqueUnitOrders: true,
      buildingOrder: [], buildingBits: new Uint32Array(0), buildingCells: [], buildingSizes: [],
      buildingXs: [], buildingYs: [], buildingKinds: [], buildingEntries: [],
      tiles: new Map(), entries: new Map(), generation: 0,
      buildingBuckets: [], maxBuildingSize: 1, columns, rows, width: state.world.width, nextBucketOrder: 0,
    };
    retained.set(state, index);
  }
  index.generation++; index.uniqueUnitOrders = true;
  if (index.unitQueries.size > 1024) index.unitQueries.clear();
  if (index.buildingQueries.size > 1024) index.buildingQueries.clear();
  let buildingChanged = index.buildingOrder.length !== state.buildings.length;
  for (let order = 0; order < state.buildings.length; order++) {
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
  const units = entityStore(state).units;
  const unitOrderChanged = index.unitOrder !== state.units || index.unitRevision !== units.revision;
  index.unitOrder = state.units; index.unitRevision = units.revision;
  for (const unit of units.query('active')) {
    const order = units.indexOf(unit);
    let entry = index.entries.get(unit);
    const key = bucket(index, unit.x, unit.y), nextTile = tile(index, unit);
    if (!entry) {
      const group = index.buckets[key] ?? (index.buckets[key] = []);
      entry = { unit, order, cell: key, tile: nextTile, bucketOrder: order, bucketSlot: group.length, seen: index.generation };
      group.push(entry); index.entries.set(unit, entry); addTile(index, entry);
      index.bucketVersions[key] = (index.bucketVersions[key] ?? 0) + 1;
    } else {
      if (entry.tile !== nextTile) { removeTile(index, entry); entry.tile = nextTile; addTile(index, entry); }
      if (entry.cell !== key) moveBucket(index, entry, key);
      entry.order = order; entry.bucketOrder = order; entry.seen = index.generation;
    }
  }
  for (const [unit, entry] of index.entries) if (entry.seen !== index.generation) {
    removeBucket(index, entry); removeTile(index, entry); index.entries.delete(unit);
  }
  if (unitOrderChanged) index.unitQueries.clear();
  if (index.unitBits.length * 32 < state.units.length) index.unitBits = new Uint32Array(Math.ceil(state.units.length / 32));
  index.nextBucketOrder = state.units.length;
  index.occupancyRevision = units.revision;
  index.occupancyAdditions.length = 0;
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
  if (!index) return;
  let entry = index.entries.get(unit);
  if (entityStore(state).isUnitSleeping(unit)) {
    if (entry) { removeBucket(index, entry); removeTile(index, entry); index.entries.delete(unit); }
    return;
  }
  const key = bucket(index, unit.x, unit.y), nextTile = tile(index, unit);
  if (entry && entry.tile !== nextTile) {
    removeTile(index, entry); entry.tile = nextTile; addTile(index, entry);
  }
  if (key === entry?.cell) return;
  if (entry) moveBucket(index, entry, key);
  else {
    const order = entityStore(state).units.indexOf(unit), group = index.buckets[key] ?? (index.buckets[key] = []);
    entry = { unit, order, cell: key, tile: nextTile, bucketOrder: index.nextBucketOrder, bucketSlot: group.length, seen: index.generation };
    if (order < 0 || index.unitOrder[order] && index.unitOrder[order] !== unit) index.uniqueUnitOrders = false;
    if (order >= index.unitBits.length * 32) index.unitBits = new Uint32Array(Math.ceil((order + 1) / 32));
    index.entries.set(unit, entry); group.push(entry); addTile(index, entry);
    index.bucketVersions[key] = (index.bucketVersions[key] ?? 0) + 1;
  }
  entry.bucketOrder = index.nextBucketOrder++;
}
export function endUnitFrame(state: GameState): void { frames.delete(state); }

/** Stable bitECS role queries, including outside simulation updates. */
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
  return entityStore(state).units.query('leader').find(unit => unit.faction === faction && unit.hp > 0);
}

/** A moving unit probes only its next cell; do not build an all-unit occupancy
 * set for each sub-tile step. Health and hiding state remain live. */
export function cellOccupant(state: GameState, point: Point, unit: Unit): Unit | undefined {
  if (civilianFootprint(unit)) return undefined;
  const x = Math.floor(point.x), y = Math.floor(point.y), index = frames.get(state);
  if (!index) return state.units.find(other => unitObstructs(unit, other) && Math.floor(other.x) === x && Math.floor(other.y) === y);
  let occupant: Unit | undefined, order = Infinity;
  for (let entry = index.tiles.get(y * index.width + x); entry; entry = entry.tileNext) {
    const other = entry.unit;
    // Match the original bucket Set's insertion order when several units share
    // a cell: friendly-yield arbitration depends on which occupant is first.
    if (entry.bucketOrder < order && unitObstructs(unit, other) && Math.floor(other.x) === x && Math.floor(other.y) === y) {
      occupant = other; order = entry.bucketOrder;
    }
  }
  return occupant;
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
  const units = entityStore(state).units;
  if (index.occupancyRevision !== units.revision) {
    // Combat can recruit defenders after the frame's active-unit snapshot.
    // Discover them once per membership change. Keep this overlay separate
    // from sensing/movement buckets so a yield probe cannot reorder those
    // queries or bring forward a new recruit's normal first spatial refresh.
    index.occupancyAdditions.length = 0;
    for (const other of units.query('active')) if (!index.entries.has(other)) index.occupancyAdditions.push(other);
    index.occupancyRevision = units.revision;
  }
  // The requester may already have moved within advanceUnit's substeps; its
  // normal spatial refresh happens only when that movement call finishes.
  let last = units.indexOf(unit);
  let occupant: Unit | undefined = last >= 0 && matches(unit) ? unit : undefined;
  if (!occupant) last = -1;
  for (let entry = index.tiles.get(cell); entry; entry = entry.tileNext) {
    const order = units.indexOf(entry.unit);
    if (order > last && matches(entry.unit)) { occupant = entry.unit; last = order; }
  }
  for (const other of index.occupancyAdditions) {
    const order = units.indexOf(other);
    if (order > last && matches(other)) { occupant = other; last = order; }
  }
  return occupant;
}

/** Read-only unit occupancy for synchronous navigation probes. During a unit
 * frame this follows refreshed tile entries and checks live health/hiding;
 * public calls outside a frame receive an ordinary request-local snapshot.
 * Keep the indexed query lazy: serializing every unit for short probes is slower
 * than checking the few cells visited by JavaScript navigation. */
export function unitOccupancy(state: GameState, unit: Unit): Pick<ReadonlySet<number>, 'has'> {
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
      for (let entry = index.tiles.get(cell); entry; entry = entry.tileNext) if (unitBlocksNavigationCell(unit, entry.unit)) return true;
      return false;
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
