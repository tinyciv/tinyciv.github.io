import type { Faction, GameState, GoldInputCategory, GoldLedgerEntry, GoldOutlayCategory } from './types';
export type { GoldInputCategory, GoldOutlayCategory } from './types';

export const GOLD_FLOW_WINDOW = 60;
const inputLabels: Readonly<Record<GoldInputCategory, string>> = {
  taxes: 'Taxes', trade: 'Trade', loot: 'Loot', treasure: 'Treasure', refunds: 'Refunds', transfers: 'Transfers', other: 'Other',
};
const outlayLabels: Readonly<Record<GoldOutlayCategory, string>> = {
  construction: 'Construction', settlements: 'Settlement upkeep', defenses: 'Defenses', army: 'Army', science: 'Science',
  upgrades: 'Upgrades', immigration: 'Immigration', diplomacy: 'Diplomacy', raided: 'Raided', transfers: 'Transfers', other: 'Other',
};
const inputCategories = Object.keys(inputLabels) as GoldInputCategory[];
const outlayCategories = Object.keys(outlayLabels) as GoldOutlayCategory[];
export interface GoldFlowRow<Category> { category: Category; label: string; amount: number }
export interface GoldFlowSummary {
  inputs: GoldFlowRow<GoldInputCategory>[];
  outlays: GoldFlowRow<GoldOutlayCategory>[];
  totalInputs: number;
  totalOutlays: number;
  net: number;
  window: typeof GOLD_FLOW_WINDOW;
}
type Clock = Pick<GameState, 'time'>;
const positive = (amount: number): boolean => Number.isFinite(amount) && amount > 0;

/** Pruning belongs to simulation mutations, never a tooltip read. Exact game
 * timestamps preserve the rolling boundary even between economy intervals. */
function bucket(state: Clock, faction: Faction): GoldLedgerEntry {
  const ledger = faction.goldLedger ??= [], cutoff = state.time - GOLD_FLOW_WINDOW;
  let expired = 0;
  while (expired < ledger.length && ledger[expired].time <= cutoff) expired++;
  if (expired) ledger.splice(0, expired);
  // A simulation rewind starts a new branch of history; future receipts cannot
  // contaminate the restored time line when its next real transaction arrives.
  while (ledger.length && ledger[ledger.length - 1].time > state.time) ledger.pop();
  let current = ledger[ledger.length - 1];
  if (!current || current.time !== state.time) {
    current = { time: state.time, inputs: {}, outlays: {} }; ledger.push(current);
  }
  return current;
}
export function recordGoldInput(state: Clock, faction: Faction, amount: number, category: GoldInputCategory): void {
  if (!positive(amount) || !Number.isFinite(state.time)) return;
  const inputs = bucket(state, faction).inputs; inputs[category] = (inputs[category] ?? 0) + amount;
}
export function recordGoldOutlay(state: Clock, faction: Faction, amount: number, category: GoldOutlayCategory): void {
  if (!positive(amount) || !Number.isFinite(state.time)) return;
  const outlays = bucket(state, faction).outlays; outlays[category] = (outlays[category] ?? 0) + amount;
}
/** Purchases check affordability before committing. Mandatory charges consume
 * only available gold, never create debt, and record only the actual payment. */
export function spendGold(state: Clock, faction: Faction, amount: number, category: GoldOutlayCategory): number {
  if (!positive(amount)) return 0;
  const paid = Math.min(amount, Math.max(0, faction.gold));
  faction.gold = Math.max(0, faction.gold - paid);
  recordGoldOutlay(state, faction, paid, category);
  return paid;
}
/** Returning an earlier payment is cash flow, not new earnings or Science. */
export function refundGold(state: Clock, faction: Faction, amount: number): void {
  if (!positive(amount)) return;
  faction.gold += amount; recordGoldInput(state, faction, amount, 'refunds');
}

/** Reads saved transactions rather than polling balances. It cannot miss a
 * purchase/refund between frames and never changes authoritative game state. */
export function goldFlowSummary(state: Clock, faction: Pick<Faction, 'goldLedger'>): GoldFlowSummary {
  const inputs = new Map<GoldInputCategory, number>(), outlays = new Map<GoldOutlayCategory, number>();
  const cutoff = state.time - GOLD_FLOW_WINDOW;
  for (const entry of faction.goldLedger ?? []) {
    if (entry.time <= cutoff || entry.time > state.time) continue;
    for (const category of inputCategories) {
      const amount = entry.inputs[category] ?? 0;
      if (positive(amount)) inputs.set(category, (inputs.get(category) ?? 0) + amount);
    }
    for (const category of outlayCategories) {
      const amount = entry.outlays[category] ?? 0;
      if (positive(amount)) outlays.set(category, (outlays.get(category) ?? 0) + amount);
    }
  }
  const inputRows = inputCategories.filter(category => inputs.has(category))
    .map(category => ({ category, label: inputLabels[category], amount: inputs.get(category)! }));
  const outlayRows = outlayCategories.filter(category => outlays.has(category))
    .map(category => ({ category, label: outlayLabels[category], amount: outlays.get(category)! }));
  const totalInputs = inputRows.reduce((sum, row) => sum + row.amount, 0);
  const totalOutlays = outlayRows.reduce((sum, row) => sum + row.amount, 0);
  return { inputs: inputRows, outlays: outlayRows, totalInputs, totalOutlays, net: totalInputs - totalOutlays, window: GOLD_FLOW_WINDOW };
}
