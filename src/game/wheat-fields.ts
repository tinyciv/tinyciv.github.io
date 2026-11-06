import type { FarmField, GameState } from './types';

interface WheatGroup { fields: FarmField[]; ripe: Set<FarmField>; visitedAt?: number }
export interface WheatGroups {
  fields: FarmField[]; width: number; height: number;
  members: { field: FarmField; x: number; y: number; camp: number; faction: number; orchard: boolean }[];
  groups: WheatGroup[]; byField: Map<FarmField, WheatGroup>; byCamp: Map<number, WheatGroup>;
}
const cache = new WeakMap<GameState, WheatGroups>();

/** Cardinal membership is stable between placement, ownership and orchard edits.
 * Validation is linear; component searches happen only when that membership changes. */
export function wheatFieldGroups(state: GameState): WheatGroups {
  const fields = state.fields ?? [], old = cache.get(state), { width, height } = state.world;
  if (old && old.width === width && old.height === height && old.fields === fields && old.members.length === fields.length && fields.every((field, i) => {
    const prior = old.members[i];
    return prior.field === field && prior.x === field.x && prior.y === field.y && prior.camp === field.camp && prior.faction === field.faction && prior.orchard === !!field.orchard;
  })) return old;
  const result: WheatGroups = { fields, width, height, members: fields.map(field => ({ field, x: field.x, y: field.y, camp: field.camp, faction: field.faction, orchard: !!field.orchard })),
    groups: [], byField: new Map(), byCamp: new Map() };
  const cells = new Map(fields.filter(field => !field.orchard).map(field => [field.y * width + field.x, field]));
  for (const field of fields) {
    if (field.orchard) { delete field.wheatRipe; continue; }
    if (result.byField.has(field)) continue;
    const group: WheatGroup = { fields: [field], ripe: new Set() };
    result.groups.push(group); result.byField.set(field, group);
    for (let i = 0; i < group.fields.length; i++) {
      const member = group.fields[i]; result.byCamp.set(member.camp, group);
      if (member.food > 0) group.ripe.add(member);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = member.x + dx, y = member.y + dy;
        if (x < 0 || x >= width || y < 0 || y >= state.world.height) continue;
        const neighbor = cells.get(y * width + x);
        if (!neighbor || neighbor.faction !== member.faction || result.byField.has(neighbor)) continue;
        result.byField.set(neighbor, group); group.fields.push(neighbor);
      }
    }
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
