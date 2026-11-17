import { farmWorkGroups, type FarmWorkGroups } from './farm-work-groups';
import type { FarmField, GameState } from './types';

interface WheatGroup { fields: FarmField[]; ripe: Set<FarmField>; visitedAt?: number }
export interface WheatGroups {
  fields: FarmField[]; width: number; height: number; parcels: FarmWorkGroups;
  members: { field: FarmField; x: number; y: number; camp: number; faction: number; orchard: boolean }[];
  groups: WheatGroup[]; byField: Map<FarmField, WheatGroup>; byCamp: Map<number, WheatGroup>;
}
const cache = new WeakMap<GameState, WheatGroups>();

/** Cardinal membership is stable between placement, ownership and orchard edits.
 * The shared parcel index owns connectivity; crop queries never repeat its flood fill. */
export function wheatFieldGroups(state: GameState): WheatGroups {
  const fields = state.fields ?? [], old = cache.get(state), { width, height } = state.world, parcels = farmWorkGroups(state);
  if (old && old.parcels === parcels) return old;
  const result: WheatGroups = { fields, width, height, parcels,
    members: parcels.members, groups: [], byField: new Map(), byCamp: new Map() };
  for (const parcel of parcels.groups) {
    if (parcel.fields[0].orchard) { for (const field of parcel.fields) delete field.wheatRipe; continue; }
    const group: WheatGroup = { fields: parcel.fields, ripe: new Set(parcel.fields.filter(field => field.food > 0)) };
    result.groups.push(group);
    for (const field of group.fields) { result.byField.set(field, group); result.byCamp.set(field.camp, group); }
  }
  cache.set(state, result);
  return result;
}

/** Keep crop appearance shared while pickup crates and expiry remain per tile.
 * The pickup path changes one set entry; only the final pickup repaints a patch. */
export function refreshWheatReadiness(state: GameState, changed?: FarmField): void {
  const groups = cache.get(state) ?? wheatFieldGroups(state);
  if (changed) {
    const group = groups.byField.get(changed);
    if (!group) return;
    const wasRipe = group.ripe.size > 0;
    if (changed.food > 0) group.ripe.add(changed); else group.ripe.delete(changed);
    if (wasRipe === (group.ripe.size > 0)) return;
    for (const field of group.fields) field.wheatRipe = group.ripe.size > 0;
  } else for (const group of groups.groups) {
    group.ripe.clear();
    for (const field of group.fields) if (field.food > 0) group.ripe.add(field);
    for (const field of group.fields) field.wheatRipe = group.ripe.size > 0;
  }
}
