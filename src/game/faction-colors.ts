import type { GameState } from './types';

/** Rendering follows faction identity, never the faction's array position. */
export function factionColor(state: Pick<GameState, 'factions'>, id: number, fallback = '#b5a587'): string {
  return state.factions.find(faction => faction.id === id)?.color ?? fallback;
}
