import type { GameState } from './types';
import { updateWallStats } from './wall-stats';

/** Keep an authored base, including stronger raider walls, so ownership and
 * repeated research refreshes never compound a previous owner's bonus. */
export { applyDefensiveStats as applyDefenseResearch } from './wall-stats';

/** Research completion updates existing defenses immediately. New structures
 * and captured property use the same single-building calculation. */
export function updateDefenseResearch(state: GameState): void {
  updateWallStats(state, true);
}
