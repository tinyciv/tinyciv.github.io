import { clearDesertStones } from './desert-stones';
import { addComponent, addEntity, createWorld, query, removeComponent, removeEntity } from 'bitecs';
import { isFarmKind, isSoldier, isRetinueMember, unitMaxHp, type Building, type GameState, type Unit } from './types';

export type UnitRole = 'unit' | 'worker' | 'builder' | 'collector' | 'soldier' | 'leader' | 'retinue' | 'active' | 'wildlife' | 'wounded' | 'damageClock';
export type BuildingRole = 'building' | 'palace' | 'farm' | 'construction' | 'library' | 'monument' | 'healerShack' | 'ballista' | 'scoutLodge' | 'supplyDepot' | 'towerWeapon';
const unitRoles: UnitRole[] = ['unit', 'worker', 'builder', 'collector', 'soldier', 'leader', 'retinue', 'active', 'wildlife', 'wounded', 'damageClock'];
const buildingRoles: BuildingRole[] = ['building', 'palace', 'farm', 'construction', 'library', 'monument', 'healerShack', 'ballista', 'scoutLodge', 'supplyDepot', 'towerWeapon'];
const unitMask = (unit: Unit): number => 1 | (unit.kind === 'worker' ? 2 : 0) | (unit.builder ? 4 : 0)
  | (unit.collector ? 8 : 0) | (isSoldier(unit) ? 16 : 0) | (unit.kind === 'leader' ? 32 : 0) | (isRetinueMember(unit) ? 64 : 0)
  | (unit.kind === 'boar' || unit.kind === 'marshBird' ? 256 : 0)
  | (unit.hp > 0 && unit.hp < unitMaxHp(unit) ? 512 : 0) | (!Number.isFinite(unit.lastDamagedAt) ? 1024 : 0);
const buildingMask = (building: Building): number => 1 | (building.kind === 'palace' ? 2 : 0) | (isFarmKind(building.kind) ? 4 : 0)
  | (building.construction ? 8 : 0) | (building.kind === 'library' ? 16 : 0) | (building.kind === 'monument' ? 32 : 0)
  | (building.kind === 'healerShack' ? 64 : 0) | (building.kind === 'ballista' ? 128 : 0) | (building.kind === 'scoutLodge' ? 256 : 0)
  | (building.kind === 'supplyDepot' ? 512 : 0)
  | (building.kind === 'woodenTower' || building.kind === 'fort' || building.kind === 'palace' ? 1024 : 0);
interface Entry<T> { eid: number; order: number; mask: number; value: T; }

/** One owner for entity lifetime, IDs and bitECS role membership. The arrays in
 * GameState are the serializable views of these same objects. After import,
 * callers add/remove entities and change roles here; queries never reconcile
 * the arrays or rescan gameplay fields. Health, position and ownership stay live. */
class EntityCollection<T extends { id: number }, R extends string> {
  private world = createWorld();
  private components: object[];
  private records = new Map<number, Entry<T>>();
  private entries: (Entry<T> | undefined)[] = [];
  private views = new Map<R, readonly T[]>();
  private nextOrder = 0;
  private arrayOrders = new Map<T, number>();
  private revisionValue = 0;
  get revision(): number { return this.revisionValue; }

  constructor(private values: T[], private assign: (values: T[]) => void, private roles: readonly R[], private mask: (value: T) => number,
    private revisionMask = -1, private onRegister?: (value: T) => void) {
    this.components = roles.map(() => ({}));
    // Indexing an existing state is read-only, including virtual placement views.
    for (let i = 0; i < values.length; i++) this.register(values[i], i, false);
  }
  private register(value: T, arrayOrder = this.values.length, notify = true): void {
    if (this.records.has(value.id)) throw new Error(`Duplicate entity ID: ${value.id}`);
    if (notify) this.onRegister?.(value);
    const entry = { eid: addEntity(this.world), order: this.nextOrder++, value, mask: 0 };
    this.records.set(value.id, entry); this.entries[entry.eid] = entry;
    this.arrayOrders.set(value, arrayOrder);
    this.updateRoles(value);
  }
  get(id: number): T | undefined { return this.records.get(id)?.value; }
  indexOf(value: T): number { return this.arrayOrders.get(value) ?? -1; }
  ids(): IterableIterator<number> { return this.records.keys(); }
  add(value: T): T;
  add(...values: T[]): void;
  add(...values: T[]): T | undefined {
    for (const value of values) { this.register(value); this.values.push(value); }
    return values[0];
  }
  replace(values: T[]): void {
    this.retain(() => false);
    for (let i = 0; i < values.length; i++) this.register(values[i], i);
    this.assign(this.values = values);
    this.revisionValue++;
  }
  retain(keep: (value: T) => boolean): void {
    let retained: T[] | undefined;
    let shifted = false;
    for (let index = 0; index < this.values.length; index++) {
      const value = this.values[index];
      if (keep(value)) { if (shifted) { this.arrayOrders.set(value, retained!.length); retained!.push(value); } continue; }
      retained ??= this.values.slice(0, index);
      shifted = true;
      const entry = this.records.get(value.id)!;
      removeEntity(this.world, entry.eid);
      this.records.delete(value.id); this.entries[entry.eid] = undefined;
      this.arrayOrders.delete(value);
      this.revisionValue++;
      for (let bit = 0; bit < this.roles.length; bit++) if (entry.mask & (1 << bit)) this.views.delete(this.roles[bit]);
    }
    if (retained) this.assign(this.values = retained);
  }
  updateRoles(value: T, trackRevision = true): void {
    const entry = this.records.get(value.id)!;
    const mask = this.mask(value), changed = entry.mask ^ mask;
    if ((changed & this.revisionMask) && trackRevision) this.revisionValue++;
    for (let bit = 0; bit < this.roles.length; bit++) if (changed & (1 << bit)) {
      if (mask & (1 << bit)) addComponent(this.world, entry.eid, this.components[bit]);
      else removeComponent(this.world, entry.eid, this.components[bit]);
      this.views.delete(this.roles[bit]);
    }
    entry.mask = mask;
  }
  query(role: R): readonly T[] {
    let view = this.views.get(role);
    if (!view) {
      const records = Array.from(query(this.world, [this.components[this.roles.indexOf(role)]]), eid => this.entries[eid]!);
      records.sort((a, b) => a.order - b.order);
      view = records.map(entry => entry.value); this.views.set(role, view);
    }
    return view;
  }
}

export class EntityStore {
  private unitCollection?: EntityCollection<Unit, UnitRole>;
  private buildingCollection?: EntityCollection<Building, BuildingRole>;
  private sleeping = new WeakSet<Unit>();
  constructor(private state: GameState) {}
  get units(): EntityCollection<Unit, UnitRole> {
    const owned = this.state as unknown as { units: Unit[] };
    return this.unitCollection ??= new EntityCollection(owned.units, units => { owned.units = units; }, unitRoles,
      unit => unitMask(unit) | (this.sleeping.has(unit) ? 0 : 128), 127 | 256);
  }
  get buildings(): EntityCollection<Building, BuildingRole> {
    const owned = this.state as unknown as { buildings: Building[] };
    return this.buildingCollection ??= new EntityCollection(owned.buildings, buildings => { owned.buildings = buildings; }, buildingRoles, buildingMask, -1, building => clearDesertStones(this.state.world, building));
  }
  setUnitRole(unit: Unit, role: Pick<Unit, 'kind' | 'builder' | 'collector'>): void {
    if (unit.kind !== role.kind || 'builder' in role && unit.builder !== role.builder
      || 'collector' in role && unit.collector !== role.collector) this.sleeping.delete(unit);
    Object.assign(unit, role); this.units.updateRoles(unit);
  }
  /** Runtime scheduling changes no gameplay role or settlement membership. */
  isUnitSleeping(unit: Unit): boolean { return this.sleeping.has(unit); }
  setUnitSleeping(unit: Unit, sleeping: boolean): void {
    if (this.units.get(unit.id) !== unit || this.sleeping.has(unit) === sleeping) return;
    if (sleeping) this.sleeping.add(unit); else this.sleeping.delete(unit);
    this.units.updateRoles(unit, false);
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
/** Explicit import boundary for a loaded state or a wholesale editor snapshot. */
export function resetEntities(state: GameState): void { stores.delete(state); }
