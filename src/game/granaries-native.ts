import { rustEngine } from './rust-engine';
import { simCore, SimSlot } from './sim-handle';
import { BUILDING_KIND_CODES, entityStore, type EntityObserver, type EntityStore } from './entity-store';
import { observeScalars, type ScalarObserver } from './scalar-observer';
import { buildingReady, type Building, type GameState, type Point, type Unit } from './types';

export const GRANARY_GOLD = rustEngine.granary_constant(0);
export const GRANARY_UPKEEP = rustEngine.granary_constant(1);
export const GRANARY_HP = rustEngine.granary_constant(2);
export const GRANARY_RADIUS = rustEngine.granary_constant(3);
export const FARM_COLLECTION_RADIUS = rustEngine.granary_constant(5);
export const STORAGE_REASSIGN = 1, STORAGE_ENTER = 2;
const relevant = (building: Building): boolean => building.kind === 'palace' || building.kind === 'granary';
const networks = new SimSlot<NativeGranaries>();

/** Transport only. Observe the small town/storage roster, publishing changed
 * rows once; crop reads perform no building, footprint or distance scans. */
class NativeGranaries implements ScalarObserver {
  readonly handle: number;
  readonly store: EntityStore;
  private readonly dirty = new Set<Building>();
  private readonly tracked = new Set<Building>();
  private readonly observer: EntityObserver<Building>;
  constructor(state: GameState) {
    this.handle = simCore(state).handle; this.store = entityStore(state);
    rustEngine.sim_granary_reset(this.handle);
    this.observer = {
      added: building => this.track(building),
      changed: building => this.track(building),
      removed: building => {
        if (this.tracked.delete(building)) rustEngine.sim_granary_remove(this.handle, building.id);
        this.dirty.delete(building);
      },
    };
    this.store.buildings.observe(this.observer);
    for (const building of state.buildings) this.track(building);
  }
  private track(building: Building): void {
    if (!relevant(building) && !this.tracked.has(building)) return;
    this.tracked.add(building); this.dirty.add(building);
    observeScalars(building, ['kind', 'faction', 'x', 'y', 'hp', 'construction'], this);
  }
  changed(target: object, key: string, before: unknown, after: unknown): void {
    if (key !== 'hp' || (Number(before) > 0) !== (Number(after) > 0)) this.dirty.add(target as Building);
  }
  flush(): this {
    for (const building of this.dirty) if (this.store.buildings.get(building.id) === building) {
      rustEngine.sim_granary_upsert(this.handle, building.id, BUILDING_KIND_CODES[building.kind], building.faction,
        building.x, building.y, Number(building.hp > 0) | Number(buildingReady(building)) << 1);
    }
    this.dirty.clear(); return this;
  }
}

function network(state: GameState): NativeGranaries {
  let current = networks.get(state);
  if (!current || current.store !== entityStore(state)) current = networks.set(state, new NativeGranaries(state));
  return current.flush();
}
export function granarySiteError(state: GameState, faction: number, point: Point): string | undefined {
  return [undefined, 'A granary needs a completed city.', 'Only one granary per city, including construction orders.']
    [rustEngine.sim_granary_placement(network(state).handle, faction, point.x, point.y)];
}
export function granaryCity(state: GameState, granary: Building): Building | undefined {
  const current = network(state), id = rustEngine.sim_granary_owner(current.handle, granary.id);
  return current.store.buildings.get(id);
}
export function cityGranary(state: GameState, city: Building): Building | undefined {
  const current = network(state), id = rustEngine.sim_granary_for_city(current.handle, city.id);
  return current.store.buildings.get(id);
}
export function granaryYieldMultiplier(state: GameState, faction: number, x: number, y: number): number {
  return rustEngine.sim_granary_yield(network(state).handle, faction, x, y);
}
export function selectFarmStorage(state: GameState, city: Building, granary: Building | undefined, townCost: number, granaryCost: number): Building {
  const id = rustEngine.sim_granary_select(network(state).handle, city.id, townCost, granaryCost);
  return id === granary?.id ? granary : city;
}
export function assignFarmStorage(state: GameState, unit: Unit, city: Building, storage: Building): { storage: Building; flags: number } {
  const current = network(state);
  const pointer = rustEngine.sim_granary_assign(current.handle, unit.id, city.id, storage.id, unit.collectorStorage ?? unit.home ?? NaN, Number(!!unit.inside));
  const [id, flags] = new Float64Array(rustEngine.memory.buffer, pointer, 2);
  return { storage: current.store.buildings.get(id)!, flags };
}
export function depositGranaryFood(state: GameState, courier: Unit, city: Building, storage: Building, amount: number): number {
  return rustEngine.sim_granary_deposit(network(state).handle, courier.id, city.id, storage.id, courier.faction, amount);
}
export function farmCollectionRangeQuery(state: GameState, city: Building): (x: number, y: number) => boolean {
  const handle = network(state).handle;
  return (x, y) => !!rustEngine.sim_granary_in_range(handle, city.id, x, y);
}
export function farmCollectionBounds(state: GameState, city: Building): { left: number; right: number; top: number; bottom: number } {
  const pointer = rustEngine.sim_granary_bounds(network(state).handle, city.id, state.world.width, state.world.height);
  const [left, right, top, bottom] = new Float64Array(rustEngine.memory.buffer, pointer, 4);
  return { left, right, top, bottom };
}
