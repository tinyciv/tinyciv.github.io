import { farmWorkGroups, type FarmWorkGroups } from './farm-work-groups';
import type { FarmField, GameState } from './types';

interface WheatGroup { fields: FarmField[]; visitedAt?: number }
export interface WheatGroups {
  parcels: FarmWorkGroups;
  groups: WheatGroup[];
  byCamp: Map<number, WheatGroup>;
}
const cache = new WeakMap<GameState, WheatGroups>();

/** The shared parcel index owns connectivity between placement, ownership
 * and orchard edits. A visit updates the whole wheat parcel once. */
export function wheatFieldGroups(state: GameState): WheatGroups {
  const parcels = farmWorkGroups(state), old = cache.get(state);
  if (old?.parcels === parcels) return old;
  const result: WheatGroups = { parcels, groups: [], byCamp: new Map() };
  for (const parcel of parcels.groups) {
    if (parcel.fields[0].orchard) continue;
    const group: WheatGroup = { fields: parcel.fields };
    result.groups.push(group);
    for (const field of group.fields) result.byCamp.set(field.camp, group);
  }
  cache.set(state, result);
  return result;
}
