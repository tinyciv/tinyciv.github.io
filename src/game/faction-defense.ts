import { factionAIPolicy, factionAIDecision } from './faction-ai-profile';
import { stoneDefenseMultiplier } from './stone-defense';
import { isHumanFaction } from './player-context';
import { buildingReady, type GameState } from './types';
import { factionDevelopmentReserve } from './faction-development';
import { isBuildingUnlocked } from './research';
import { canSustainFactionDefense, factionCommittedBudget } from './faction-budget';
import { PALISADE_GOLD, STONE_WALL_GOLD } from './wall-stats';
import { FACTION_CITY_TOWERS, factionCityTowers, nextFactionTowerEnclosure } from './faction-tower-layout';

export type DefenseKind = 'road' | 'wall' | 'palisade' | 'woodenTower';
type Order = (faction: number, kind: DefenseKind, x: number, y: number) => { ok: boolean };
export interface DefenseOrders { validate: Order; build: Order }
const nextPlans = new WeakMap<GameState, Map<number, number>>();

/** NPC realms replace missing towers without adding surrounding palisades. */
export function updateFactionDefenses(state: GameState, orders: DefenseOrders): void {
  let schedule = nextPlans.get(state);
  if (!schedule) { schedule = new Map(); nextPlans.set(state, schedule); }
  for (const faction of state.factions) {
    if ((faction.id <= 0 || isHumanFaction(state, faction.id)) || faction.villageId !== undefined || faction.defeated || faction.relation === 'confederated' || faction.population < 1
      || state.time < (schedule.get(faction.id) ?? 6 + faction.id)) continue;
    schedule.set(faction.id, state.time + factionAIPolicy(state,faction.id).parameters.developmentInterval);
    if (faction.gold < 15) continue;
    const owned = state.buildings.filter(building => building.faction === faction.id && building.hp > 0);
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
    const attempt = (kind: DefenseKind, x: number, y: number): boolean => {
      const cost = (kind === 'woodenTower' ? 40 : kind === 'wall' ? STONE_WALL_GOLD : kind === 'palisade' ? PALISADE_GOLD : 10) * stoneDefenseMultiplier(state, faction.id, kind);
      if (!budget || (faction.constructionPauseUntil?.[kind] ?? 0) > state.time || !isBuildingUnlocked(faction, kind) || faction.gold - cost < Math.max(underAttack ? 0 : 20, reserve)
        || kind === 'woodenTower' && !canSustainFactionDefense(state, faction, kind)
        || !orders.validate(faction.id, kind, x, y).ok) return false;
      if (!orders.build(faction.id, kind, x, y).ok) return false;
      budget--; return true;
    };
    for (const palace of owned.filter(building => building.kind === 'palace' && buildingReady(building))) {
      if (palace.depopulated) continue;
      const towers = factionCityTowers(state, palace);
      if (budget && towers.length < FACTION_CITY_TOWERS && isBuildingUnlocked(faction, 'woodenTower')
        && canSustainFactionDefense(state, faction, 'woodenTower') && (faction.constructionPauseUntil?.woodenTower ?? 0) <= state.time) {
        const enclosure = nextFactionTowerEnclosure(state, palace,
          point => orders.validate(faction.id, 'woodenTower', point.x, point.y).ok);
        if (enclosure) attempt('woodenTower', enclosure.tower.x, enclosure.tower.y);
      }
      if (!budget) break;
    }
  }
}
