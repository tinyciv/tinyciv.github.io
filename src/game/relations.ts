import { isHumanFaction } from './player-context';
import { villageHostility } from './villages';
import type { GameState } from './types';

export function atWar(state: GameState, a: number, b: number): boolean {
  if (state.multiplayer && isHumanFaction(state, a) && isHumanFaction(state, b)) return a !== b;
  const villageWar = villageHostility(state, a, b);
  if (villageWar !== undefined) return villageWar;
  if (a === -2 || b === -2) return a !== b && (a >= 0 || b >= 0);
  if (a < 0 || b < 0 || a === b) return false;
  if (a === 0) return state.factions.find(faction => faction.id === b)?.relation === 'war';
  if (b === 0) return state.factions.find(faction => faction.id === a)?.relation === 'war';
  return false;
}
