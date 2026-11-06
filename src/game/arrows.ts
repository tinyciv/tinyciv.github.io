import { buildingPresent, isWallKind, tileAt, type GameState, type Point } from './types';
import { nearbyBuildings } from './spatial';

/** Arrows pass other buildings but not walls, including a diagonal corner.
 * The target wall itself can be shot; no wall behind it can be reached. */
export function arrowLineClear(state: GameState, from: Point, target: Point, targetId?: number): boolean {
  const walls = new Set<number>();
  const midpoint = { x: (from.x + target.x) / 2, y: (from.y + target.y) / 2 };
  for (const building of nearbyBuildings(state, midpoint, Math.hypot(target.x - from.x, target.y - from.y) / 2 + 2))
    if (building.id !== targetId && isWallKind(building.kind) && buildingPresent(building)) walls.add(building.y * state.world.width + building.x);
  let x = Math.floor(from.x), y = Math.floor(from.y);
  const endX = Math.floor(target.x), endY = Math.floor(target.y), dx = target.x - from.x, dy = target.y - from.y;
  const sx = Math.sign(dx), sy = Math.sign(dy), deltaX = sx ? 1 / Math.abs(dx) : Infinity, deltaY = sy ? 1 / Math.abs(dy) : Infinity;
  let crossX = sx ? ((sx > 0 ? x + 1 : x) - from.x) / dx : Infinity;
  let crossY = sy ? ((sy > 0 ? y + 1 : y) - from.y) / dy : Infinity;
  const clear = (x: number, y: number) => !!tileAt(state.world, x, y) && !walls.has(y * state.world.width + x);
  while (true) {
    if (!clear(x, y)) return false;
    if (x === endX && y === endY) return true;
    if (Math.abs(crossX - crossY) < 1e-8) {
      if (!clear(x + sx, y) || !clear(x, y + sy)) return false;
      x += sx; y += sy; crossX += deltaX; crossY += deltaY;
    } else if (crossX < crossY) { x += sx; crossX += deltaX; }
    else { y += sy; crossY += deltaY; }
  }
}
