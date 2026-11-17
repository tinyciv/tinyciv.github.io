import { clearDesertStones } from './desert-stones';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import type { Building, BuildingKind, GameState, Unit, UnitKind } from './types';

export type UnitRole = 'unit' | 'worker' | 'builder' | 'collector' | 'soldier' | 'leader' | 'retinue' | 'active' | 'wildlife' | 'wounded' | 'damageClock' | 'collision' | 'vessel';
export type BuildingRole = 'building' | 'palace' | 'farm' | 'construction' | 'library' | 'monument' | 'healerShack' | 'ballista' | 'scoutLodge' | 'supplyDepot' | 'towerWeapon' | 'irrigation' | 'shipyard';
// Role bit order in rust/src/sim/entities.rs.
const unitRoles: UnitRole[] = ['unit', 'worker', 'builder', 'collector', 'soldier', 'leader', 'retinue', 'active', 'wildlife', 'wounded', 'damageClock', 'collision', 'vessel'];
const buildingRoles: BuildingRole[] = ['building', 'palace', 'farm', 'construction', 'library', 'monument', 'healerShack', 'ballista', 'scoutLodge', 'supplyDepot', 'towerWeapon', 'irrigation', 'shipyard'];

// Encoding only: rust/src/sim/kinds.rs decides what each kind means. The codes
// are the declaration order of UnitKind and BuildingKind.
export const UNIT_KIND_CODES: Record<UnitKind, number> = {
  slinger: 0, skirmisher: 1, levyInfantry: 2, supplyCart: 3, leader: 4, warrior: 5, swordsman: 6, spearman: 7, pikeman: 8,
  archer: 9, horseman: 10, horseArcher: 11, knight: 12, scout: 13, militia: 14, worker: 15, merchant: 16, sailboat: 17,
  boar: 18, marshBird: 19, deer: 20, buffalo: 21, elephant: 22, ostrich: 23, musketman: 24, fieldCannon: 25,
};
export const BUILDING_KIND_CODES: Record<BuildingKind, number> = {
  fort: 0, supplyDepot: 1, palace: 2, camp: 3, house: 4, shack: 5, cottage: 6, road: 7, wall: 8, palisade: 9,
  bridge: 10, dock: 11, irrigation: 12, ruin: 13, tower: 14, woodenTower: 15, well: 16, monument: 17, blacksmith: 18,
  guardPost: 19, archeryRange: 20, scoutLodge: 21, observationPost: 22, healerShack: 23, ballista: 24, siegeCannon: 30, stable: 25,
  library: 26, villageTent: 27, colosseum: 28, barracks: 29, forum: 31, granary: 32, thermalBath: 33, shipyard: 34, whalingPost: 35, foundry: 36, militaryAcademy: 37,
};
const UNKNOWN_KIND = 255;
const UNITS = 0, BUILDINGS = 1;
/** sim_entity_remove result for an ID that was not registered (u32::MAX,
 * which WebAssembly returns to JavaScript as a signed integer). */
const MISSING = -1;
type Sleep = -1 | 0 | 1;

export interface EntityObserver<T> { added(value: T): void; removed(value: T): void; changed?(value: T): void }

/** Host view of one native entity table (rust/src/sim/entities.rs).
 *
 * Rust owns lifetime, array order, sleeping, role membership, the membership
 * revision and ID allocation. This class keeps the id-to-object map, the
 * observers and caches derived from native answers: role views (arrays of the
 * live view objects, dropped when a mutation reports changed role bits), the
 * array-order lookup and the last revision read. The arrays in GameState are
 * the serializable views of the same objects; health, position and ownership
 * stay live on them. */
class EntityCollection<T extends { id: number }, R extends string> {
  private records = new Map<number, T>();
  private views = new Map<R, readonly T[]>();
  /** id -> array index, rebuilt from the native order after a removal. */
  private orders?: Map<number, number>;
  private revisionValue?: number;
  private observers = new Set<WeakRef<EntityObserver<T>>>();
  /** A newer store imported this game; this view no longer reaches Rust. */
  private detached = false;
  get revision(): number {
    return this.revisionValue ??= this.detached ? 0 : rustEngine.sim_entity_revision(this.sim, this.table);
  }
  observe(observer: EntityObserver<T>): void { this.observers.add(new WeakRef(observer)); }
  private publish(value: T, added: boolean): void {
    for (const reference of this.observers) {
      const observer = reference.deref();
      if (observer) { if (added) observer.added(value); else observer.removed(value); }
      else this.observers.delete(reference);
    }
  }

  /** `traits` publishes the scalars the roles depend on and returns the role
   * bits Rust changed. */
  constructor(private values: T[], private assign: (values: T[]) => void, private roles: readonly R[], private sim: number,
    private table: number, private traits: (value: T, sleep: Sleep, trackRevision: boolean) => number, private onRegister?: (value: T) => void) {
    // Indexing an existing state is read-only, including virtual placement views.
    for (let i = 0; i < values.length; i++) this.register(values[i], false);
  }
  detach(): void { this.detached = true; }
  private dropViews(mask: number): void {
    for (let bit = 0; bit < this.roles.length; bit++) if (mask & (1 << bit)) this.views.delete(this.roles[bit]);
  }
  private register(value: T, notify = true): void {
    if (this.records.has(value.id)) throw new Error(`Duplicate entity ID: ${value.id}`);
    if (notify) this.onRegister?.(value);
    if (!Number.isSafeInteger(value.id)) throw new Error(`Invalid simulation entity ID: ${value.id}`);
    if (!this.detached && !rustEngine.sim_entity_insert(this.sim, this.table, value.id)) throw new Error(`Duplicate entity ID: ${value.id}`);
    this.records.set(value.id, value);
    this.orders?.set(value.id, this.orders.size);
    this.updateRoles(value);
    this.publish(value, true);
  }
  get(id: number): T | undefined { return this.records.get(id); }
  indexOf(value: T): number {
    if (this.records.get(value.id) !== value) return -1;
    if (!this.orders) {
      this.orders = new Map();
      if (this.detached) this.values.forEach((entry, index) => this.orders!.set(entry.id, index));
      else {
        const pointer = rustEngine.sim_entity_order(this.sim, this.table);
        const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
        const ids = new Float64Array(rustEngine.memory.buffer, pointer + 8, count);
        for (let index = 0; index < count; index++) this.orders.set(ids[index], index);
      }
    }
    return this.orders.get(value.id) ?? -1;
  }
  ids(): IterableIterator<number> { return this.records.keys(); }
  add(value: T): T;
  add(...values: T[]): void;
  add(...values: T[]): T | undefined {
    for (const value of values) { this.register(value); this.values.push(value); }
    return values[0];
  }
  /** Speculative reservations need indexed membership without authoritative
   * registration effects such as clearing scenery from the live world. */
  addPreview(value: T): T {
    this.register(value, false); this.values.push(value); return value;
  }
  replace(values: T[]): void {
    this.retain(() => false);
    for (let i = 0; i < values.length; i++) this.register(values[i]);
    this.assign(this.values = values);
    this.orders = undefined;
    if (!this.detached) rustEngine.sim_entity_touch(this.sim, this.table);
    this.revisionValue = undefined;
  }
  retain(keep: (value: T) => boolean): void {
    let retained: T[] | undefined;
    for (let index = 0; index < this.values.length; index++) {
      const value = this.values[index];
      if (keep(value)) { retained?.push(value); continue; }
      retained ??= this.values.slice(0, index);
      const mask = this.detached ? 0 : rustEngine.sim_entity_remove(this.sim, this.table, value.id);
      this.records.delete(value.id);
      this.orders = undefined;
      this.publish(value, false);
      this.revisionValue = undefined;
      if (mask !== MISSING) this.dropViews(mask);
    }
    if (retained) this.assign(this.values = retained);
  }
  /** Republish the role inputs of a registered entity. */
  updateRoles(value: T, trackRevision = true, sleep: Sleep = -1): void {
    if (this.detached) return;
    const changed = this.traits(value, sleep, trackRevision);
    if (!changed) return;
    this.revisionValue = undefined;
    this.dropViews(changed);
    for (const reference of this.observers) reference.deref()?.changed?.(value);
  }
  query(role: R): readonly T[] {
    let view = this.views.get(role);
    if (!view) {
      const built: T[] = [];
      if (!this.detached) {
        const pointer = rustEngine.sim_entity_view(this.sim, this.table, this.roles.indexOf(role));
        const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
        const ids = new Float64Array(rustEngine.memory.buffer, pointer + 8, count);
        for (let index = 0; index < count; index++) built.push(this.records.get(ids[index])!);
      }
      view = built; this.views.set(role, view);
    }
    return view;
  }
}

export class EntityStore {
  private unitCollection?: EntityCollection<Unit, UnitRole>;
  private buildingCollection?: EntityCollection<Building, BuildingRole>;
  private simHandle?: number;
  constructor(private state: GameState) {}
  /** The game's native tables, emptied once for this store: it is importing
   * the state's current arrays (a load, a clone or a wholesale replacement). */
  private get sim(): number {
    if (this.simHandle === undefined) {
      this.simHandle = simCore(this.state).handle;
      rustEngine.sim_entities_reset(this.simHandle);
    }
    return this.simHandle;
  }
  /** A newer store took over this game's native tables. */
  detach(): void { this.unitCollection?.detach(); this.buildingCollection?.detach(); }
  /** One import scan, then constant-time allocation across every spawn system.
   * Explicit/rebuild IDs reserve their range too; removals never reuse IDs. */
  peekId(): number {
    void this.units; void this.buildings;
    return rustEngine.sim_entity_peek_id(this.sim);
  }
  allocateId(minimum = 1): number {
    void this.units; void this.buildings;
    return rustEngine.sim_entity_allocate_id(this.sim, minimum);
  }
  get units(): EntityCollection<Unit, UnitRole> {
    const owned = this.state as unknown as { units: Unit[] }, sim = this.sim;
    return this.unitCollection ??= new EntityCollection(owned.units, units => { owned.units = units; }, unitRoles, sim, UNITS,
      (unit, sleep, track) => rustEngine.sim_unit_traits(sim, unit.id, UNIT_KIND_CODES[unit.kind] ?? UNKNOWN_KIND,
        (unit.builder ? 1 : 0) | (unit.collector ? 2 : 0) | (unit.engineer ? 4 : 0) | (Number.isFinite(unit.lastDamagedAt) ? 0 : 8)
          | (unit.maxHp == null ? 16 : 0),
        unit.hp, unit.maxHp ?? NaN, sleep, Number(track)));
  }
  get buildings(): EntityCollection<Building, BuildingRole> {
    const owned = this.state as unknown as { buildings: Building[] }, sim = this.sim;
    return this.buildingCollection ??= new EntityCollection(owned.buildings, buildings => { owned.buildings = buildings; }, buildingRoles, sim, BUILDINGS,
      (building, _sleep, track) => rustEngine.sim_building_traits(sim, building.id, BUILDING_KIND_CODES[building.kind] ?? UNKNOWN_KIND,
        Number(!!building.construction), Number(track)),
      building => clearDesertStones(this.state.world, building));
  }
  setUnitRole(unit: Unit, role: Pick<Unit, 'kind' | 'builder' | 'collector'>): void {
    // A changed role wakes the unit.
    const wake = unit.kind !== role.kind || 'builder' in role && unit.builder !== role.builder
      || 'collector' in role && unit.collector !== role.collector;
    Object.assign(unit, role); this.units.updateRoles(unit, true, wake ? 0 : -1);
  }
  /** Runtime scheduling changes no gameplay role or settlement membership. */
  isUnitSleeping(unit: Unit): boolean {
    return this.units.get(unit.id) === unit && !!rustEngine.sim_unit_sleeping(this.sim, unit.id);
  }
  setUnitSleeping(unit: Unit, sleeping: boolean): void {
    if (this.units.get(unit.id) !== unit || this.isUnitSleeping(unit) === sleeping) return;
    this.units.updateRoles(unit, false, sleeping ? 1 : 0);
  }
  setBuildingKind(building: Building, kind: Building['kind']): void {
    building.kind = kind; this.buildings.updateRoles(building);
  }
}
const stores = new WeakMap<GameState, EntityStore>();
export function entityStore(state: GameState): EntityStore {
  let store = stores.get(state);
  if (!store) { store = new EntityStore(state); stores.set(state, store); }
  return store;
}
/** Indexed form of `state.buildings.find(b => b.id === id && accept(b))`. */
export function buildingWithId(state: GameState, id: number | undefined, accept?: (building: Building) => boolean): Building | undefined {
  if (id === undefined) return undefined;
  const building = entityStore(state).buildings.get(id);
  return building && (!accept || accept(building)) ? building : undefined;
}
/** Explicit import boundary for a loaded state or a wholesale editor snapshot. */
export function resetEntities(state: GameState): void { stores.get(state)?.detach(); stores.delete(state); }
