import { type Tile, type World, type Point, tileAt } from './types';

export const STAIR_UP = {
  north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 },
} as const;
export type StairDirection = keyof typeof STAIR_UP;
const STAIR_ENTRIES = Object.entries(STAIR_UP) as [StairDirection, Point][];
export const ridgeLevel = (tile: Tile | undefined): number => tile?.ridge ? tile.ridgeTier ?? 1 : 0;

/** Match the native edge and inner-corner artwork: its whole tile is cliff,
 * not walkable upper ground. Ramps have their own traversal rules below. */
export function ridgeIsLedge(world: World, x: number, y: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  const tile = tileAt(world, x, y);
  if (!tile?.ridge || tile.stair) return false;
  const level = ridgeLevel(tile);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const neighbor = tileAt(world, x + dx, y + dy);
    // A higher shelf draws its own cliff; the floor at its foot stays flat.
    if ((dx || dy) && (neighbor?.ridge !== tile.ridge || ridgeLevel(neighbor) < level)) return true;
  }
  return false;
}

/** A ramp needs a lower approach and a real upper floor at its opposite end.
 * A misplaced or backwards-facing stair sprite cannot make a cliff walkable. */
export function ridgeGroundWalkable(world: World, x: number, y: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  const tile = tileAt(world, x, y);
  if (!tile || tile.waterfall) return false;
  if (!tile.ridge) return !tile.stair;
  if (!tile.stair) return !ridgeIsLedge(world, x, y);
  const up = STAIR_UP[tile.stair], low = tileAt(world, x - up.x, y - up.y), high = tileAt(world, x + up.x, y + up.y);
  const level = ridgeLevel(tile);
  return !!low && ridgeLevel(low) === level - 1 && !low.stair && !ridgeIsLedge(world, x - up.x, y - up.y)
    && (level === 1 || low.ridge === tile.ridge)
    && high?.ridge === tile.ridge && ridgeLevel(high) === level
    && !high.stair && !ridgeIsLedge(world, x + up.x, y + up.y)
    && tileAt(world, x - up.y, y + up.x)?.ridge === tile.ridge && ridgeLevel(tileAt(world, x - up.y, y + up.x)) === level
    && tileAt(world, x + up.y, y - up.x)?.ridge === tile.ridge && ridgeLevel(tileAt(world, x + up.y, y - up.x)) === level;
}

/** An edge crossing is a genuine change of elevation, not a movement penalty.
 * Stairs occupy the high-side boundary cell and name their uphill direction. */
export function ridgeEdgeAllowed(world: World, from: Point, to: Point): boolean {
  const x = Math.floor(from.x), y = Math.floor(from.y), nx = Math.floor(to.x), ny = Math.floor(to.y);
  const a = tileAt(world, x, y), b = tileAt(world, nx, ny);
  if (!a || !b) return false;
  if (a.waterfall || b.waterfall || (a.ridge || a.stair) && !ridgeGroundWalkable(world, x, y)
    || (b.ridge || b.stair) && !ridgeGroundWalkable(world, nx, ny)) return false;
  if (x === nx && y === ny) return true;
  const dx = nx - x, dy = ny - y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  const level = ridgeLevel(a), nextLevel = ridgeLevel(b);
  // Ramp movement stays on its uphill/downhill axis, including its upper end.
  if (a.stair) {
    const up = STAIR_UP[a.stair];
    if (dx * up.y !== dy * up.x) return false;
  }
  if (b.stair) {
    const up = STAIR_UP[b.stair];
    if (dx * up.y !== dy * up.x) return false;
  }
  if (dx && dy) {
    // No diagonal corner-hopping across either lip of a cliff or stair.
    return level === nextLevel && ridgeLevel(tileAt(world, nx, y)) === level && ridgeLevel(tileAt(world, x, ny)) === level
      && ridgeGroundWalkable(world, nx, y) && ridgeGroundWalkable(world, x, ny);
  }
  if (level === nextLevel) return true;
  if (Math.abs(level - nextLevel) !== 1) return false;
  const high = level > nextLevel ? a : b, up = high.stair && STAIR_UP[high.stair];
  const sign = level > nextLevel ? -1 : 1;
  return !!up && up.x === dx * sign && up.y === dy * sign;
}

/** Structures may occupy a flat upper surface, but never bridge a ledge or
 * obstruct the only stair landing. x/y are the footprint's upper-left corner. */
export function ridgeFootprintAllowed(world: World, x: number, y: number, width = 1, height = width): boolean {
  const level = ridgeLevel(tileAt(world, x, y));
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const tile = tileAt(world, x + dx, y + dy);
    if (!tile || tile.waterfall || tile.stair || ridgeLevel(tile) !== level) return false;
    if (ridgeIsLedge(world, x + dx, y + dy)) return false;
    // Keep the low approach tile open as well as the high-side stair itself.
    for (const [direction, up] of STAIR_ENTRIES) {
      const landing = tileAt(world, x + dx + up.x, y + dy + up.y);
      if (landing?.stair === direction && ridgeLevel(landing) > ridgeLevel(tile)) return false;
      const stairBelow = tileAt(world, x + dx - up.x, y + dy - up.y);
      if (stairBelow?.stair === direction) return false;
    }
  }
  return true;
}
