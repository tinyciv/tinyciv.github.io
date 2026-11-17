import { observeScalars, type ScalarObserver } from './scalar-observer';
import { type Building, type GameState, type World, buildingReady, tileAt } from './types';
import { entityStore, type EntityStore, type EntityObserver } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';

export const IRRIGATION_GOLD = 35;
export const IRRIGATION_RADIUS = 2;
export const IRRIGATION_YIELD_MULTIPLIER = 2;
export const IRRIGATION_MOVEMENT_MULTIPLIER = .5;

export function isFreshwaterSource(state: GameState, x: number, y: number): boolean {
  const terrain = tileAt(state.world, x, y)?.terrain;
  return terrain === 'river' || terrain === 'lake';
}

const cardinal = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
export type IrrigationConnectionQuery = (x: number, y: number, reservedDitches?: ReadonlySet<number>) => boolean;
interface ConnectionCache {
  world: World; width: number; height: number; buildings: GameState['buildings']; store: EntityStore;
  membership: number; structures: number; query: IrrigationConnectionQuery;
}
const connections = new WeakMap<GameState, ConnectionCache>();

/** Snapshot ditch membership once for a synchronous planner. Existing members'
 * health and location, and freshwater terrain, stay live. Speculative accepted
 * cells can extend the network without adding entities to a private world. */
export function createIrrigationConnectionQuery(state: GameState): IrrigationConnectionQuery {
  const { world } = state, ditches = new Map<string, Building[]>();
  for (const building of state.buildings) if (building.kind === 'irrigation') {
    const key = `${building.x},${building.y}`, members = ditches.get(key);
    if (members) members.push(building); else ditches.set(key, [building]);
  }
  return (x, y, reservedDitches) => cardinal.some(([dx, dy]) => {
    const nx = x + dx, ny = y + dy;
    return isFreshwaterSource(state, nx, ny)
      || nx >= 0 && ny >= 0 && nx < world.width && ny < world.height && !!reservedDitches?.has(ny * world.width + nx)
      || !!ditches.get(`${nx},${ny}`)?.some(building => building.hp > 0 && building.kind === 'irrigation'
        && building.x === nx && building.y === ny);
  });
}

/** Cardinal connections accept living ditches of any owner, including pending
 * orders. Trusted runtime/planner reads share one index per topology revision;
 * standalone editor calls rebuild so direct scalar edits remain observable. */
export function irrigationConnects(state: GameState, x: number, y: number, reservedDitches?: ReadonlySet<number>): boolean {
  if (!simulationReadsActive(state)) return createIrrigationConnectionQuery(state)(x, y, reservedDitches);
  const world = state.world, store = entityStore(state), membership = store.buildings.revision, structures = structureChangeRevision(state);
  let cached = connections.get(state);
  if (!cached || cached.world !== world || cached.width !== world.width || cached.height !== world.height
    || cached.buildings !== state.buildings || cached.store !== store || cached.membership !== membership || cached.structures !== structures) {
    cached = { world, width: world.width, height: world.height, buildings: state.buildings, store, membership, structures,
      query: createIrrigationConnectionQuery(state) };
    connections.set(state, cached);
  }
  return cached.query(x, y, reservedDitches);
}

/** Tile-center offsets shared by the harvest bonus and placement highlight. */
export const IRRIGATION_OFFSETS: readonly (readonly [number, number])[] = Array.from(
  { length: (IRRIGATION_RADIUS * 2 + 1) ** 2 }, (_, index) => [index % (IRRIGATION_RADIUS * 2 + 1) - IRRIGATION_RADIUS, Math.floor(index / (IRRIGATION_RADIUS * 2 + 1)) - IRRIGATION_RADIUS] as const,
).filter(([x, y]) => x * x + y * y <= IRRIGATION_RADIUS * IRRIGATION_RADIUS);

interface IrrigationCoverage {
  world: World; width: number; height: number;
  roster: readonly Building[]; structures: number; raw?: number; entities?: EntityObserver<Building>;
  ditches: ReadonlySet<number>; coverage: Uint8Array; counts: Uint32Array; origins: Map<number, number>;
  members: Map<Building, number | undefined>; dirty: Set<Building>; observer: ScalarObserver;
}
const caches = new WeakMap<GameState, IrrigationCoverage>();

/** Lifecycle publications also cover deletion of optional construction data. */
export function invalidateIrrigation(state: GameState): void {
  const cached = caches.get(state);
  if (cached) { cached.structures = -1; for (const building of cached.roster) cached.dirty.add(building); }
}

/** Completed ditch footprints enter/leave a reference-counted coverage layer.
 * Reads across simulation times do no work when no ditch has changed. */
export function prepareIrrigation(state: GameState): IrrigationCoverage {
  const world = state.world, roster = entityStore(state).buildings.query('irrigation');
  let index = caches.get(state);
  if (!index || index.world !== world || index.width !== world.width || index.height !== world.height) {
    const dirty = new Set<Building>();
    const observer: ScalarObserver = { changed(target, key, before, after) {
      if (key !== 'hp' || (Number(before) > 0) !== (Number(after) > 0)) dirty.add(target as Building);
    } };
    index = { world, width: world.width, height: world.height, roster: [], structures: -1,
      ditches: new Set(), coverage: new Uint8Array(world.width * world.height), counts: new Uint32Array(world.width * world.height),
      members: new Map(), origins: new Map(), dirty, observer };
    const current = index;
    const changed = (building: Building): void => {
      if (current.members.has(building) || building.kind === 'irrigation') {
        current.dirty.add(building); observeScalars(building, ['kind', 'x', 'y', 'hp', 'construction'], current.observer);
      }
    };
    index.entities = { added: changed, removed: changed, changed };
    entityStore(state).buildings.observe(index.entities);
    caches.set(state, index);
  }
  const trusted = simulationReadsActive(state), structures = structureChangeRevision(state);
  const validate = !trusted && world.revision === undefined || index.structures !== structures || index.raw !== world.revision;
  if (index.roster !== roster || validate) {
    const present = new Set(roster);
    for (const building of index.members.keys()) if (!present.has(building)) index.dirty.add(building);
    for (const building of roster) {
      if (!index.members.has(building) || validate) index.dirty.add(building);
      observeScalars(building, ['kind', 'x', 'y', 'hp', 'construction'], index.observer);
    }
    index.roster = roster; index.structures = structures; index.raw = world.revision;
  }
  if (!index.dirty.size) return index;
  const present = new Set(roster), ditches = new Set(index.ditches), delta = new Map<number, number>();
  // Multiple entities can occupy one ditch tile; coverage counts include all
  // of them, and removing one cannot clear a surviving overlapping footprint.
  const adjust = (cell: number, amount: number): void => {
    const x = cell % world.width, y = Math.floor(cell / world.width);
    const count = (index!.origins.get(cell) ?? 0) + amount;
    if (count) index!.origins.set(cell, count); else index!.origins.delete(cell);
    for (const [dx, dy] of IRRIGATION_OFFSETS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height) {
        const at = ny * world.width + nx; delta.set(at, (delta.get(at) ?? 0) + amount);
      }
    }
  };
  const changedCells = new Set<number>();
  for (const building of index.dirty) {
    const old = index.members.get(building), x = Math.floor(building.x), y = Math.floor(building.y);
    const next = present.has(building) && building.kind === 'irrigation' && buildingReady(building)
      && x >= 0 && y >= 0 && x < world.width && y < world.height ? y * world.width + x : undefined;
    if (old !== next) {
      if (old !== undefined) { adjust(old, -1); changedCells.add(old); }
      if (next !== undefined) { adjust(next, 1); changedCells.add(next); }
    }
    if (present.has(building)) index.members.set(building, next); else index.members.delete(building);
  }
  for (const cell of changedCells) {
    if (index.origins.has(cell)) ditches.add(cell); else ditches.delete(cell);
  }
  let coverage = index.coverage;
  // Coverage is a borrowed immutable cache dependency used by economy reads.
  // Copy only when boolean coverage actually changes, never on a cache hit.
  for (const [cell, amount] of delta) {
    index.counts[cell] += amount;
    if (coverage[cell] !== Number(index.counts[cell] > 0)) {
      if (coverage === index.coverage) coverage = coverage.slice();
      coverage[cell] = Number(index.counts[cell] > 0);
    }
  }
  index.ditches = ditches; index.coverage = coverage; index.dirty.clear();
  return index;
}

export function irrigationAt(state: GameState, x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= state.world.width || ty >= state.world.height) return false;
  return prepareIrrigation(state).ditches.has(ty * state.world.width + tx);
}

/** Water benefits nearby farmland irrespective of ownership; overlap never stacks. */
export function irrigationYieldMultiplier(state: GameState, x: number, y: number): 1 | 2 | 3 {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= state.world.width || ty >= state.world.height) return 1;
  if (!prepareIrrigation(state).coverage[ty * state.world.width + tx]) return 1;
  // Double the added benefit: +200% on desert, +100% on other ground.
  return tileAt(state.world, tx, ty)?.terrain === 'desert' ? 3 : 2;
}
