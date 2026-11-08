import type { Building, FarmField, GameState, Unit } from '../game/types';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** Missing object properties have an explicit deletion operation. Arrays carry
 * sparse index edits, so an explored map does not travel with every frame. */
export type ValueDelta = { value: Json } | { fields: Record<string, ValueDelta>; remove?: string[] }
  | { items: [number, ValueDelta][]; length?: number };
export interface EntityDelta<T> {
  added?: T[];
  changed?: [number, ValueDelta][];
  removed?: number[];
  /** Sent only when membership/order changes, preserving deterministic ties. */
  order?: number[];
}
export interface StateDelta {
  state?: ValueDelta;
  units?: EntityDelta<Unit>;
  buildings?: EntityDelta<Building>;
  fields?: EntityDelta<FarmField>;
  fieldsPresent?: boolean;
}

const scalar = (value: unknown): Json => typeof value === 'number' && !Number.isFinite(value) ? null
  : value === undefined ? null : value as Json;
function clone(value: unknown): Json {
  if (value === null || typeof value !== 'object') return scalar(value);
  if (Array.isArray(value)) return value.map(clone);
  const result: Record<string, Json> = {};
  for (const key of Object.keys(value)) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) result[key] = clone(item);
  }
  return result;
}

/** Advance a detached wire baseline while collecting only changed values.
 * Retaining live references here would miss in-place simulation mutations. */
function difference(previous: Json, current: unknown): ValueDelta | undefined {
  if (current === null || typeof current !== 'object') {
    const value = scalar(current);
    return previous === value ? undefined : { value };
  }
  if (Array.isArray(current)) {
    if (!Array.isArray(previous)) return { value: clone(current) };
    let items: [number, ValueDelta][] | undefined;
    const length = previous.length === current.length ? undefined : current.length;
    for (let i = 0; i < current.length; i++) {
      const patch = i < previous.length ? difference(previous[i], current[i]) : { value: clone(current[i]) };
      if (patch) { (items ??= []).push([i, patch]); if ('value' in patch) previous[i] = clone(patch.value); }
    }
    if (length !== undefined) previous.length = length;
    return items || length !== undefined ? { items: items ?? [], ...(length === undefined ? {} : { length }) } : undefined;
  }
  if (previous === null || typeof previous !== 'object' || Array.isArray(previous)) return { value: clone(current) };
  const next = current as Record<string, unknown>;
  let fields: Record<string, ValueDelta> | undefined, remove: string[] | undefined;
  for (const key of Object.keys(previous)) if (next[key] === undefined) {
    (remove ??= []).push(key); delete previous[key];
  }
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) continue;
    const patch = Object.hasOwn(previous, key) ? difference(previous[key], next[key]) : { value: clone(next[key]) };
    if (patch) { (fields ??= {})[key] = patch; if ('value' in patch) previous[key] = clone(patch.value); }
  }
  return fields || remove ? { fields: fields ?? {}, ...(remove ? { remove } : {}) } : undefined;
}

/** Apply only the transmitted fields, retaining unchanged object identities. */
export function applyValueDelta<T>(previous: T, patch: ValueDelta): T {
  if ('value' in patch) return patch.value as T;
  if ('items' in patch) {
    const array = previous as unknown as Json[];
    for (const [index, item] of patch.items) array[index] = applyValueDelta(array[index], item);
    if (patch.length !== undefined) array.length = patch.length;
    return previous;
  }
  const object = previous as unknown as Record<string, Json>;
  for (const key of patch.remove ?? []) delete object[key];
  for (const key of Object.keys(patch.fields)) object[key] = applyValueDelta(object[key], patch.fields[key]);
  return previous;
}

class CollectionEncoder<T extends { id: number }> {
  private values = new Map<number, Json>();
  private order: number[] = [];
  encode(current: readonly T[]): EntityDelta<T> | undefined {
    let added: T[] | undefined, changed: [number, ValueDelta][] | undefined, removed: number[] | undefined;
    let reordered = current.length !== this.order.length;
    const alive = new Set<number>();
    for (let i = 0; i < current.length; i++) {
      const entity = current[i]; alive.add(entity.id);
      if (this.order[i] !== entity.id) reordered = true;
      const old = this.values.get(entity.id);
      if (old === undefined) {
        const value = clone(entity); this.values.set(entity.id, value);
        // Outgoing additions must not alias the retained baseline.
        (added ??= []).push(clone(value) as unknown as T);
      } else {
        const patch = difference(old, entity);
        if (patch) { if ('value' in patch) this.values.set(entity.id, clone(patch.value)); (changed ??= []).push([entity.id, patch]); }
      }
    }
    for (const id of this.values.keys()) if (!alive.has(id)) { this.values.delete(id); (removed ??= []).push(id); }
    if (!added && !changed && !removed && !reordered) return;
    if (reordered) this.order = current.map(entity => entity.id);
    return { ...(added ? { added } : {}), ...(changed ? { changed } : {}), ...(removed ? { removed } : {}),
      ...(reordered ? { order: [...this.order] } : {}) };
  }
}

/** One encoder per viewer: concealment and faction-specific controls are
 * already applied before diffing, including deletion when a unit is hidden. */
export class StateDeltaEncoder {
  private units = new CollectionEncoder<Unit>();
  private buildings = new CollectionEncoder<Building>();
  private fields = new CollectionEncoder<FarmField>();
  private previous: Json = {};
  private fieldsPresent = false;
  constructor(snapshot: GameState) { this.encode(snapshot); }
  encode(view: GameState): StateDelta {
    const { world: _world, units, buildings, fields, ...metadata } = view;
    const state = difference(this.previous, metadata);
    if (state && 'value' in state) this.previous = clone(state.value);
    const unitChanges = this.units.encode(units ?? []), buildingChanges = this.buildings.encode(buildings ?? []), fieldChanges = this.fields.encode(fields ?? []);
    const presenceChanged = this.fieldsPresent !== (fields !== undefined); this.fieldsPresent = fields !== undefined;
    return { ...(state ? { state } : {}), ...(unitChanges ? { units: unitChanges } : {}),
      ...(buildingChanges ? { buildings: buildingChanges } : {}), ...(fieldChanges ? { fields: fieldChanges } : {}),
      ...(presenceChanged ? { fieldsPresent: this.fieldsPresent } : {}) };
  }
}
