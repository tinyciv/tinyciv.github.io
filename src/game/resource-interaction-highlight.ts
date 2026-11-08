import { BUILDING_ACTIVITY_RANGE } from './building-activity';
import { pointInSight, type FogView } from './fog';
import { playerFaction } from './player-context';
import { resourceCityAt } from './resource-development';
import { indexedLeader } from './spatial';
import type { GameState } from './types';

/** Match building interaction reach without scanning units or deposits per frame. */
export function resourceInteractionColor(state: GameState, x: number, y: number, fog: FogView): string | undefined {
  if (state.gameOver || !pointInSight(fog, x + .5, y + .5)) return;
  const faction = playerFaction(state), leader = indexedLeader(state, faction);
  if (!leader || leader.inside) return;
  const dx = Math.max(x - leader.x, 0, leader.x - x - 1), dy = Math.max(y - leader.y, 0, leader.y - y - 1);
  if (dx * dx + dy * dy > BUILDING_ACTIVITY_RANGE ** 2) return;
  if (resourceCityAt(state, x, y)?.faction !== faction) return;
  return state.factions.find(owner => owner.id === faction)?.color;
}
