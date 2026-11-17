import { tileAt, WATER, type World } from './types';

/** A town may straddle the polar frontier, but cannot start deep in tundra. */
export function tundraStartAllowed(world: Pick<World, 'width' | 'height' | 'tiles'>, x: number, y: number): boolean {
  const at = (x: number, y: number) => tileAt(world as World, x, y);
  const center = at(x, y);
  if (!center) return false;
  if (center.terrain !== 'tundra') return true;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (Math.abs(dx) + Math.abs(dy) > 2) continue;
    const tile = at(x + dx, y + dy);
    if (tile && tile.terrain !== 'tundra' && !WATER.has(tile.terrain)) return true;
  }
  return false;
}
