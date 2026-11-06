import { farmFieldIndex, type FarmFieldIndex } from './farm-index';
import { simulationReadsActive } from './simulation-reads';
import type { FarmField, GameState } from './types';

export interface FarmWorkGroup { anchor: number; faction: number; fields: FarmField[] }
export interface FarmWorkGroups {
  index: FarmFieldIndex; groups: FarmWorkGroup[]; byCamp: Map<number, FarmWorkGroup>; byField: Map<FarmField, FarmWorkGroup>;
  members: { field: FarmField; camp: number; faction: number; x: number; y: number; orchard: boolean }[];
}
const cache = new WeakMap<GameState, FarmWorkGroups>();

/** One cardinally connected crop parcel is one job. Different owners and crop
 * types never share a worker. Normal simulation edits invalidate the farm index;
 * standalone tools/fixtures also receive scalar validation. */
export function farmWorkGroups(state: GameState): FarmWorkGroups {
  const index = farmFieldIndex(state), old = cache.get(state);
  if (old && old.index.world === index.world && old.index.width === index.width && old.members.length === index.source.length
    && (old.index === index && simulationReadsActive(state) || index.source.every((field, i) => {
    const previous = old.members[i];
    return previous?.field === field && previous.camp === field.camp && previous.faction === field.faction
      && previous.x === field.x && previous.y === field.y && previous.orchard === !!field.orchard;
  }))) { old.index = index; return old; }
  const result: FarmWorkGroups = { index, groups: [], byCamp: new Map(), byField: new Map(),
    members: index.source.map(field => ({ field, camp: field.camp, faction: field.faction, x: field.x, y: field.y, orchard: !!field.orchard })) };
  const cells = new Map(index.source.map(field => [field.y * state.world.width + field.x, field]));
  for (const first of index.source) {
    if (result.byField.has(first)) continue;
    const group: FarmWorkGroup = { anchor: first.camp, faction: first.faction, fields: [first] };
    result.groups.push(group); result.byField.set(first, group);
    for (let i = 0; i < group.fields.length; i++) {
      const field = group.fields[i];
      group.anchor = Math.min(group.anchor, field.camp); result.byCamp.set(field.camp, group);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = field.x + dx, y = field.y + dy;
        if (x < 0 || y < 0 || x >= state.world.width || y >= state.world.height) continue;
        const next = cells.get(y * state.world.width + x);
        if (!next || next.faction !== first.faction || !!next.orchard !== !!first.orchard || result.byField.has(next)) continue;
        result.byField.set(next, group); group.fields.push(next);
      }
    }
  }
  cache.set(state, result);
  return result;
}
