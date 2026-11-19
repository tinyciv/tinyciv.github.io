import { factionAIPolicy, factionAIDecision } from './faction-ai-profile';
import { stoneDefenseMultiplier } from './stone-defense';
import { marbleConstructionMultiplier } from './resource-development';
import { isHumanFaction } from './player-context';
import type { GameState } from './types';
import { nativeDefenseBuildings, nativeDefenseCity, nativeDefenseDue, nativeDefenseRejected } from './faction-defense-native';
import { factionDevelopmentReserve } from './faction-development';
import { isBuildingUnlocked } from './research';
import { canSustainFactionDefense, factionCommittedBudget } from './faction-budget';
import { PALISADE_GOLD, STONE_WALL_GOLD } from './wall-stats';
import { FACTION_CITY_TOWERS, factionCityTowers, nextFactionTowerEnclosure } from './faction-tower-layout';

export type DefenseKind = 'road' | 'wall' | 'palisade' | 'woodenTower';
type Order = (faction: number, kind: DefenseKind, x: number, y: number) => { ok: boolean };
export interface DefenseOrders { validate: Order; build: Order }

/** NPC realms replace missing towers without adding surrounding palisades. */
export function updateFactionDefenses(state: GameState, orders: DefenseOrders): void {
  for (const faction of state.factions) {
    if ((faction.id <= 0 || isHumanFaction(state, faction.id)) || faction.villageId !== undefined || faction.defeated || faction.relation === 'confederated' || faction.population < 1
      || !nativeDefenseDue(state, faction.id, factionAIPolicy(state,faction.id).parameters.developmentInterval)) continue;
    if (faction.gold < 15) continue;
    const owned = nativeDefenseBuildings(state, faction.id);
    const productiveWork = owned.filter(building => building.construction && ['camp', 'house', 'well', 'monument', 'library'].includes(building.kind)).length;
    const underAttack = owned.some(building => state.time - (building.lastAttacked ?? -Infinity) < 12);
    // Do not bury the opening farms behind a long perimeter-building queue.
    // A recent attack still permits a tower to protect the working city.
    if (productiveWork >= factionAIDecision(state,faction.id,'developmentLimit')+1 && !underAttack) continue;
    // Replacement towers share the city's actual budget and workforce;
    // farm and housing orders retain priority over further fortifications.
    const reserve = underAttack ? factionCommittedBudget(state, faction).upkeep : factionDevelopmentReserve(state, faction);
    const pending = owned.filter(building => building.construction && ['wall', 'palisade', 'woodenTower', 'road'].includes(building.kind)).length;
    const limit = factionAIDecision(state,faction.id,'defenseLimit',productiveWork,faction.population);
    if (pending >= limit) continue;
    let budget = limit - pending;
    const marble = marbleConstructionMultiplier(state, faction.id);
    const attempt = (kind: DefenseKind, x: number, y: number, validated = false): boolean => {
      const cost = (kind === 'woodenTower' ? 40 : kind === 'wall' ? STONE_WALL_GOLD : kind === 'palisade' ? PALISADE_GOLD : 10)
        * stoneDefenseMultiplier(state, faction.id, kind) * marble;
      if (!budget || (faction.constructionPauseUntil?.[kind] ?? 0) > state.time || !isBuildingUnlocked(faction, kind) || faction.gold - cost < Math.max(underAttack ? 0 : 20, reserve)
        || kind === 'woodenTower' && !canSustainFactionDefense(state, faction, kind)
        || !validated && !orders.validate(faction.id, kind, x, y).ok) return false;
      if (!orders.build(faction.id, kind, x, y).ok) return false;
      budget--; return true;
    };
    const palace = nativeDefenseCity(state, faction.id);
    if (palace) {
      const towers = factionCityTowers(state, palace);
      if (budget && towers.length < FACTION_CITY_TOWERS && isBuildingUnlocked(faction, 'woodenTower')
        && canSustainFactionDefense(state, faction, 'woodenTower') && (faction.constructionPauseUntil?.woodenTower ?? 0) <= state.time
        && faction.gold - 40 * stoneDefenseMultiplier(state, faction.id, 'woodenTower') * marble >= Math.max(underAttack ? 0 : 20, reserve)) {
        const enclosure = nextFactionTowerEnclosure(state, palace,
          point => orders.validate(faction.id, 'woodenTower', point.x, point.y).ok);
        if (enclosure && !attempt('woodenTower', enclosure.tower.x, enclosure.tower.y, true)) nativeDefenseRejected(state, palace);
      }
    }
  }
}
