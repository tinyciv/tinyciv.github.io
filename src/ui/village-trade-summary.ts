import { RESOURCE_NAMES } from '../game/geography';
import type { villageTradeQuote } from '../game/village-trade-quote';

type Quote = ReturnType<typeof villageTradeQuote>;

/** Keep fractional village income visible without promising exact arrival timing. */
export function villageTradeRate(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value > 0 && value < .1) return '<0.1';
  return String(Math.round(value * 10) / 10);
}

/** Both village entry points share the same resource comparison and wording. */
export function villageTradeSummary(quote: Quote): string {
  const resource = RESOURCE_NAMES[quote.requiredResource];
  const without = quote.routeAvailable ? villageTradeRate(quote.withoutResourceGoldPer30).replace('<', '&lt;') : '—';
  const withResource = quote.routeAvailable ? villageTradeRate(quote.withResourceGoldPer30).replace('<', '&lt;') : '—';
  return `<section class="village-trade-summary" aria-label="Trade income estimate">
    <p class="village-trade-demand">Required: <strong>${resource}</strong>
      <span class="village-trade-availability">${quote.hasResource ? 'Available to your faction' : 'Not developed by your faction'}</span></p>
    <p class="village-trade-rate-label">Expected gold / 30 seconds</p>
    <dl>
      <div${quote.hasResource ? '' : ' class="is-current"'}><dt>Without ${resource}</dt><dd>${without}</dd></div>
      <div${quote.hasResource ? ' class="is-current"' : ''}><dt>With ${resource} · 4×</dt><dd>${withResource}</dd></div>
    </dl>${quote.routeAvailable ? '' : '<p class="village-trade-unreachable">No reachable settlement.</p>'}
  </section>`;
}
