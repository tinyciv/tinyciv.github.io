import { recordGoldInput, recordGoldOutlay, type GoldInputCategory } from './gold-ledger';
import { advanceResearchIncome } from './research';
import { rustEngine } from './rust-engine';
import { enemyFactionStrength } from './enemy-strength';
import type { Faction, GameState } from './types';

export type IncomeAmounts = { food: number; gold: number; culture: number };

/** Lifetime receipts, independent of spending, upkeep, consumption and refunds.
 * The HUD differences these counters over its rolling game-time window. */
export function recordIncome(faction: Faction, amounts: Partial<IncomeAmounts>): void {
  const totals = faction.incomeTotals ??= { food: 0, gold: 0, culture: 0 };
  for (const resource of ['food', 'gold', 'culture'] as const) {
    const amount = amounts[resource] ?? 0;
    if (Number.isFinite(amount) && amount > 0) totals[resource] = (totals[resource] ?? 0) + amount;
  }
}

/** Receive earned resources once, at the same point as their ledger entry. */
export function grantIncome(faction: Faction, amounts: Partial<IncomeAmounts>, state: GameState, category: GoldInputCategory = 'other'): void {
  if (amounts.gold) amounts = { ...amounts, gold: rustEngine.scenario_gold_income(state.world.scenario === 'tutorial' || state.world.scenario === 'island-deathmatch' ? 2 : 0, amounts.gold, Number(!['taxes', 'refunds', 'transfers', 'other'].includes(category))) * enemyFactionStrength(state, faction.id) };
  const gold = amounts.gold ?? 0;
  const diverted = advanceResearchIncome(state, faction, gold);
  for (const resource of ['food', 'gold', 'culture'] as const) {
    const amount = amounts[resource] ?? 0;
    if (Number.isFinite(amount) && amount > 0) faction[resource] = (faction[resource] ?? 0) + amount - (resource === 'gold' ? diverted : 0);
  }
  recordGoldInput(state, faction, gold, category);
  recordGoldOutlay(state, faction, diverted, 'science');
  recordIncome(faction, amounts);
}
