import type { FarmField, GameState } from './types';
import { entityStore, type EntityStore } from './entity-store';

export interface FarmFieldIndex {
  readonly store: EntityStore;
  readonly world: GameState['world'];
  readonly source: FarmField[];
  readonly count: number;
  readonly width: number;
  readonly fields: Map<number, FarmField>;
  readonly camps: Map<number, FarmField[]>;
  readonly cells: Map<number, FarmField>;
  readonly order: Map<FarmField, number>;
}
const indexes = new WeakMap<GameState, FarmFieldIndex>();

/** Plot identity and coordinates are owned by farm topology. Food, claims and
 * crop clocks stay live on these same objects and never rebuild the index. */
export function farmFieldIndex(state: GameState): FarmFieldIndex {
  const source = state.fields ??= [], width = state.world.width, store = entityStore(state), old = indexes.get(state);
  if (old && old.store === store && old.world === state.world && old.source === source && old.count === source.length && old.width === width) return old;
  const fields = new Map<number, FarmField>(), camps = new Map<number, FarmField[]>(), cells = new Map<number, FarmField>(), order = new Map<FarmField, number>();
  for (let i = 0; i < source.length; i++) {
    const field = source[i]; order.set(field, i);
    fields.set(field.id, field);
    cells.set(field.y * width + field.x, field);
    const plots = camps.get(field.camp) ?? [];
    plots.push(field); camps.set(field.camp, plots);
  }
  const index = { store, world: state.world, source, count: source.length, width, fields, camps, cells, order };
  indexes.set(state, index);
  return index;
}

/** Required after an editor changes plot IDs, coordinates or camp membership
 * in place. Replacing the field array is detected automatically. */
export function invalidateFarmFieldIndex(state: GameState): void { indexes.delete(state); }
