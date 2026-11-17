import type { GameState, NeutralVillage } from '../game/types';
import { villageTradeQuote, type VillageTradeQuote } from '../game/village-trade-quote';

/** The caravan estimate plans two paths (often 10+ ms). Its exact cache key
 * changes whenever any building changes, which is nearly every second in a
 * live game, so open popups re-read it on this slower display clock. */
export const VILLAGE_TRADE_ESTIMATE_MS = 1500;
const estimates = new WeakMap<GameState, Map<number, { at: number; quote: VillageTradeQuote }>>();

export function villageTradeEstimate(state: GameState, village: NeutralVillage, now = performance.now()): VillageTradeQuote {
  let cache = estimates.get(state);
  if (!cache) { cache = new Map(); estimates.set(state, cache); }
  const previous = cache.get(village.id);
  if (previous && now - previous.at < VILLAGE_TRADE_ESTIMATE_MS) return previous.quote;
  const quote = villageTradeQuote(state, village);
  cache.set(village.id, { at: now, quote });
  return quote;
}

/** A recent estimate when one exists; otherwise undefined, so the caller can
 * paint a placeholder first and compute after the popup is on screen. */
export function cachedVillageTradeEstimate(state: GameState, village: NeutralVillage, now = performance.now()): VillageTradeQuote | undefined {
  const previous = estimates.get(state)?.get(village.id);
  return previous && now - previous.at < VILLAGE_TRADE_ESTIMATE_MS ? previous.quote : undefined;
}
