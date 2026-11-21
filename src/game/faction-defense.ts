import { factionAIPolicy, factionAIDecision } from './faction-ai-profile';
import { isHumanFaction } from './player-context';
import type { GameState } from './types';
import {
  defenseKindMask, nativeDefenseCity, nativeDefenseDue, nativeDefenseFacts,
  nativeDefenseOrder, nativeDefenseOrderRejected, type DefenseKind,
} from './faction-defense-native';
import { factionDevelopmentReserve } from './faction-development';
import { isBuildingUnlocked } from './research';
import { canSustainFactionDefense, factionCommittedBudget } from './faction-budget';

export type { DefenseKind } from './faction-defense-native';
export interface DefenseOrders {
  cost: (kind: DefenseKind, faction: number) => number;
  build: (faction: number, kind: DefenseKind, x: number, y: number) => { ok: boolean };
}

/** Publish the economy's current constraints and submit a single native order
 * through ordinary construction, including its upkeep and placement checks. */
export function updateFactionDefenses(state: GameState, orders: DefenseOrders): void {
  for (const faction of state.factions) {
    if (faction.id <= 0 || isHumanFaction(state, faction.id) || faction.villageId !== undefined
      || faction.defeated || faction.relation === 'confederated' || faction.population < 1
      || !nativeDefenseDue(state, faction.id, factionAIPolicy(state, faction.id).parameters.developmentInterval)) continue;
    const { productive, pending, underAttack } = nativeDefenseFacts(state, faction.id);
    if (productive >= factionAIDecision(state, faction.id, 'developmentLimit') + 1 && !underAttack) continue;
    if (pending >= factionAIDecision(state, faction.id, 'defenseLimit', productive, faction.population)) continue;
    const city = nativeDefenseCity(state, faction.id);
    if (!city) continue;
    const reserve = underAttack ? factionCommittedBudget(state, faction).upkeep
      : Math.max(20, factionDevelopmentReserve(state, faction));
    let available = 0;
    for (const kind of ['woodenTower', 'palisade', 'wall'] as const) {
      if ((faction.constructionPauseUntil?.[kind] ?? 0) > state.time || !isBuildingUnlocked(faction, kind)
        || faction.gold < reserve + orders.cost(kind, faction.id)
        || kind === 'woodenTower' && !canSustainFactionDefense(state, faction, kind)) continue;
      available |= defenseKindMask(kind);
    }
    if (!available) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      const order = nativeDefenseOrder(state, city, faction.population, available);
      if (!order || orders.build(faction.id, order.kind, order.x, order.y).ok) break;
      nativeDefenseOrderRejected(state, city, order);
    }
  }
}
