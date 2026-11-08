import { entityStore, resetEntities } from '../game/entity-store';
import { invalidateFog, useReplicatedFog } from '../game/fog';
import { invalidateFarmFieldIndex } from '../game/farm-index';
import { recordStructureChange } from '../game/simulation-reads';
import type { Building, FarmField, GameState, Unit } from '../game/types';
import { applyValueDelta, type EntityDelta, type StateDelta } from './state-delta';

interface Collection<T extends { id: number }> {
  get(id: number): T | undefined;
  add(value: T): T;
  retain(keep: (value: T) => boolean): void;
  replace(values: T[]): void;
  updateRoles(value: T): void;
}
export interface UnitChanges {
  before(unit: Unit): void;
  after(unit: Unit, added: boolean): void;
  removed(id: number): void;
}

/** Persistent replication indexes share the same objects used by gameplay
 * queries. Ordinary property edits never discard and rebuild the EntityStore. */
export class ClientStateReplica {
  private fields = new Map<number, FarmField>();
  constructor(readonly state: GameState) {
    resetEntities(state);
    useReplicatedFog(state);
    for (const field of state.fields ?? []) this.fields.set(field.id, field);
  }
  apply(delta: StateDelta, units?: UnitChanges): void {
    if (delta.state) {
      applyValueDelta(this.state, delta.state);
      // Fog owns immutable observation snapshots. Renew its container when
      // authoritative memories change so its private cache imports them.
      if ('fields' in delta.state && delta.state.fields.fog && this.state.fog) this.state.fog = { ...this.state.fog };
      // Root and control fog are independently encoded wire values. Aliasing
      // them here would apply the next sparse array patch twice to one object.
    }
    const store = entityStore(this.state);
    if (delta.units) this.entities(delta.units, store.units, () => this.state.units, units);
    if (delta.buildings) {
      this.entities(delta.buildings, store.buildings, () => this.state.buildings);
      const patch = delta.buildings;
      if (patch.added || patch.removed || patch.order || patch.changed?.some(([, fields]) => 'value' in fields
        || 'fields' in fields && ['x', 'y', 'kind', 'faction', 'hp', 'construction', 'dockFacing', 'palaceLevel']
          .some(key => key in fields.fields || fields.remove?.includes(key)))) recordStructureChange(this.state);
    }
    if (delta.fields) {
      const patch = delta.fields;
      if (patch.added || patch.removed || patch.order || patch.changed?.some(([, fields]) => 'value' in fields
        || 'fields' in fields && ['id', 'x', 'y', 'camp'].some(key => key in fields.fields || fields.remove?.includes(key))))
        invalidateFarmFieldIndex(this.state);
      for (const id of patch.removed ?? []) this.fields.delete(id);
      for (const field of patch.added ?? []) this.fields.set(field.id, field);
      for (const [id, changes] of patch.changed ?? []) {
        const field = this.fields.get(id);
        if (!field) throw new Error(`Missing replicated field ${id}`);
        this.fields.set(id, applyValueDelta(field, changes));
      }
      if (patch.order) this.state.fields = patch.order.map(id => this.fields.get(id)!);
      else if (patch.added || patch.removed) this.state.fields = [...this.fields.values()];
    }
    if (delta.fieldsPresent === false) { delete this.state.fields; this.fields.clear(); }
    else if (delta.fieldsPresent === true) this.state.fields ??= [];
    invalidateFog(this.state);
  }
  private entities<T extends Unit | Building>(patch: EntityDelta<T>, collection: Collection<T>, current: () => readonly T[], changes?: UnitChanges): void {
    if (patch.removed?.length) {
      const removed = new Set(patch.removed);
      collection.retain(entity => !removed.has(entity.id));
      for (const id of removed) changes?.removed(id);
    }
    for (const entity of patch.added ?? []) { collection.add(entity); changes?.after(entity as Unit, true); }
    for (const [id, fields] of patch.changed ?? []) {
      const entity = collection.get(id);
      if (!entity) throw new Error(`Missing replicated entity ${id}`);
      changes?.before(entity as Unit);
      applyValueDelta(entity, fields); collection.updateRoles(entity);
      changes?.after(entity as Unit, false);
    }
    // Normal additions/removals already have the authoritative order. A rare
    // explicit reorder needs fresh role views, but retains the entity objects.
    if (patch.order && (patch.order.length !== current().length || patch.order.some((id, i) => current()[i].id !== id)))
      collection.replace(patch.order.map(id => collection.get(id)!));
  }
}
