import { isSoldier } from '../game/types';
import { type GameState, type RetinueStance } from '../game/types';
import { setRetinueStance } from '../game/simulation';
import { playerFaction } from '../game/player-context';

/** Stance commands apply to the entire retinue, regardless of selection. */
export function retinueCommand(state: GameState): { stance: RetinueStance; nextStance: RetinueStance } {
  const units = state.units.filter(unit => unit.faction === playerFaction(state) && isSoldier(unit) && unit.hp > 0);
  const held = units.length > 0 && units.every(unit => (unit.order === 'flee' ? unit.routOrder : unit.order) === 'hold');
  const stance = state.retinueStance ?? (held ? 'hold' : 'aggressive');
  const nextStance = stance === 'aggressive' ? 'defensive' : stance === 'defensive' ? 'hold' : 'aggressive';
  return { stance, nextStance };
}

export function toggleRetinueOrder(state: GameState): void {
  if (!state.gameOver) setRetinueStance(state, retinueCommand(state).nextStance);
}
