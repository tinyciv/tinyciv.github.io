import { playerFaction } from './player-context';
import type { Building, BuildingKind, GameState } from './types';

/** Retain the old defense until its stone replacement finishes. Neutral walls
 * can be improved inside our borders; other factions' walls remain occupied. */
export function palisadeForUpgrade(state: GameState, kind: BuildingKind, x: number, y: number, faction = playerFaction(state)): Building | undefined {
  if (kind !== 'wall') return;
  x = Math.floor(x); y = Math.floor(y);
  return state.buildings.find(building => building.kind === 'palisade' && building.hp > 0
    && (building.faction === faction || building.faction === -1) && building.x === x && building.y === y);
}
