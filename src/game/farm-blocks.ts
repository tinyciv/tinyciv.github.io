import { isFarmKind, type GameState, type Point } from './types';

export const FARM_BLOCK_MAX_CELLS = 16;
export const FARM_BLOCK_MAX_ASPECT = 1.5;
export const FARM_BLOCK_SHAPE_THRESHOLD = 6;

export interface FarmBlockGeometry { size: number; width: number; height: number; aspectRatio: number; }
export interface FarmBlockValidation {
  ok: boolean;
  message: string;
  reason?: 'size' | 'shape' | 'bounds';
  blocks: FarmBlockGeometry[];
}
export interface FarmBlockQueryOptions {
  /** Former plots in a relocation or redevelopment footprint. */
  removedCells?: ReadonlySet<number>;
  /** Destinations already reserved by the same atomic placement operation. */
  addedCells?: ReadonlySet<number>;
}
export interface FarmBlockQuery {
  canAdd(point: Point): FarmBlockValidation;
  /** Validate the final union, without testing incomplete intermediate shapes. */
  canAddAll(points: readonly Point[]): FarmBlockValidation;
}
interface Bounds { size: number; minX: number; maxX: number; minY: number; maxY: number; }
const geometry = (bounds: Bounds): FarmBlockGeometry => {
  const width = bounds.maxX - bounds.minX + 1, height = bounds.maxY - bounds.minY + 1;
  return { size: bounds.size, width, height, aspectRatio: Math.max(width, height) / Math.min(width, height) };
};
const merge = (target: Bounds, source: Bounds): void => {
  target.size += source.size;
  target.minX = Math.min(target.minX, source.minX); target.maxX = Math.max(target.maxX, source.maxX);
  target.minY = Math.min(target.minY, source.minY); target.maxY = Math.max(target.maxY, source.maxY);
};

/** Physical farm geometry ignores ownership, crop state, and orchard upgrades.
 * Live construction reservations count immediately, so pending orders and
 * later captures cannot bypass the cap. Build one component index per siting
 * pass; each candidate then touches at most four existing components.
 * Removals may fragment a field. Only the blocks receiving new plots are
 * checked, keeping demolition and city redevelopment possible. */
export function farmBlockPlacementQuery(state: GameState, options: FarmBlockQueryOptions = {}): FarmBlockQuery {
  const { width, height } = state.world, count = width * height, cells = new Set<number>();
  for (const farm of state.buildings) if (farm.hp > 0 && isFarmKind(farm.kind)
    && farm.x >= 0 && farm.x < width && farm.y >= 0 && farm.y < height) cells.add(farm.y * width + farm.x);
  for (const cell of options.removedCells ?? []) cells.delete(cell);
  let invalidReservation = false;
  for (const cell of options.addedCells ?? []) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= count) invalidReservation = true;
    else cells.add(cell);
  }
  const neighbors = (cell: number): number[] => {
    const x = cell % width, y = Math.floor(cell / width), result: number[] = [];
    if (x > 0) result.push(cell - 1); if (x + 1 < width) result.push(cell + 1);
    if (y > 0) result.push(cell - width); if (y + 1 < height) result.push(cell + width);
    return result;
  };
  const componentAt = new Map<number, number>(), components: Bounds[] = [];
  for (const cell of cells) {
    if (componentAt.has(cell)) continue;
    const id = components.length, x = cell % width, y = Math.floor(cell / width);
    const bounds: Bounds = { size: 0, minX: x, maxX: x, minY: y, maxY: y }, queue = [cell];
    components.push(bounds); componentAt.set(cell, id);
    for (let i = 0; i < queue.length; i++) {
      const next = queue[i], nx = next % width, ny = Math.floor(next / width);
      merge(bounds, { size: 1, minX: nx, maxX: nx, minY: ny, maxY: ny });
      for (const neighbor of neighbors(next)) if (cells.has(neighbor) && !componentAt.has(neighbor)) {
        componentAt.set(neighbor, id); queue.push(neighbor);
      }
    }
  }
  const canAddAll = (points: readonly Point[]): FarmBlockValidation => {
    if (invalidReservation || points.some(point => !Number.isInteger(point.x) || !Number.isInteger(point.y)
      || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height))
      return { ok: false, reason: 'bounds', message: 'Place farm plots inside the map.', blocks: [] };
    const parents = new Map<number, number>(), nodes = new Map<number, Bounds>(), additions = new Map<number, number>();
    const include = (id: number, bounds: Bounds): number => {
      if (!parents.has(id)) { parents.set(id, id); nodes.set(id, bounds); }
      return id;
    };
    const root = (id: number): number => {
      let parent = parents.get(id)!;
      while (parent !== parents.get(parent)) parent = parents.get(parent)!;
      parents.set(id, parent); return parent;
    };
    const join = (a: number, b: number): void => { a = root(a); b = root(b); if (a !== b) parents.set(b, a); };
    for (const point of points) {
      const cell = point.y * width + point.x;
      if (additions.has(cell)) continue;
      const existing = componentAt.get(cell), id = existing ?? components.length + additions.size;
      include(id, existing === undefined ? { size: 1, minX: point.x, maxX: point.x, minY: point.y, maxY: point.y } : components[id]);
      additions.set(cell, id);
    }
    for (const [cell, id] of additions) for (const neighbor of neighbors(cell)) {
      const added = additions.get(neighbor), existing = componentAt.get(neighbor);
      if (added !== undefined) join(id, added);
      else if (existing !== undefined) join(id, include(existing, components[existing]));
    }
    const combined = new Map<number, Bounds>();
    for (const [id, bounds] of nodes) {
      const key = root(id), previous = combined.get(key);
      if (previous) merge(previous, bounds); else combined.set(key, { ...bounds });
    }
    const blocks = [...combined.values()].map(geometry);
    if (blocks.some(block => block.size > FARM_BLOCK_MAX_CELLS))
      return { ok: false, reason: 'size', message: `Farm blocks can contain at most ${FARM_BLOCK_MAX_CELLS} plots. Leave a gap for another block.`, blocks };
    if (blocks.some(block => block.size > FARM_BLOCK_SHAPE_THRESHOLD && block.aspectRatio > FARM_BLOCK_MAX_ASPECT))
      return { ok: false, reason: 'shape', message: `Farm blocks over ${FARM_BLOCK_SHAPE_THRESHOLD} plots must have an aspect ratio of at most ${FARM_BLOCK_MAX_ASPECT}:1.`, blocks };
    return { ok: true, message: '', blocks };
  };
  return { canAdd: point => canAddAll([point]), canAddAll };
}
