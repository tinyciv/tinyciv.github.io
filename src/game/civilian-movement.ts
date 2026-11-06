import { unitBlocksNavigationCell } from './collisions';
import { cellOccupant } from './spatial';
import type { GameState, Point, Unit } from './types';

/** Non-military units may overlap each other; soldiers still reserve their cells.
 * Terrain and buildings are checked separately by the movement caller. */
export function unitPositionBlocked(state: GameState, unit: Unit, point: Point): boolean {
  const other = cellOccupant(state, point, unit);
  return !!other && unitBlocksNavigationCell(unit, other);
}
