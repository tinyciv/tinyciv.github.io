import { describe, expect, it } from 'vitest';
import { villageTradeRate, villageTradeSummary } from '../src/ui/village-trade-summary';

const quote = { requiredResource: 'copper' as const, hasResource: false, routeAvailable: true,
  withoutResourceGoldPer30: 2.35, withResourceGoldPer30: 9.4 };

describe('village popup trade comparison', () => {
  it('shows both potential rates before trade and identifies the missing resource', () => {
    const html = villageTradeSummary(quote);
    expect(html).toContain('Required: <strong>Copper</strong>');
    expect(html).toContain('Not developed by your faction');
    expect(html).toContain('Expected gold / 30 seconds');
    expect(html).toContain('<div class="is-current"><dt>Without Copper</dt><dd>2.4</dd>');
    expect(html).toContain('<dt>With Copper · 4×</dt><dd>9.4</dd>');
  });
  it('marks the boosted rate as current once the faction has access', () => {
    const html = villageTradeSummary({ ...quote, hasResource: true });
    expect(html).toContain('Available to your faction');
    expect(html).toContain('<div class="is-current"><dt>With Copper · 4×</dt>');
    expect(html).not.toContain('<div class="is-current"><dt>Without Copper</dt>');
  });
  it('shows unreachable quotes as unavailable rather than promising zero or stale income', () => {
    const html = villageTradeSummary({ ...quote, routeAvailable: false });
    expect(html.match(/<dd>—<\/dd>/g)).toHaveLength(2);
    expect(html).toContain('No reachable settlement.');
    expect(html).not.toContain('<dd>2.4</dd>');
  });
  it('preserves small positive incomes and never renders invalid values', () => {
    expect(villageTradeRate(.04)).toBe('<0.1');
    expect(villageTradeRate(0)).toBe('0');
    expect(villageTradeRate(.15)).toBe('0.2');
    for (const invalid of [NaN, Infinity, -1]) expect(villageTradeRate(invalid)).toBe('—');
    expect(villageTradeSummary({ ...quote, withoutResourceGoldPer30: .04 })).toContain('<dd>&lt;0.1</dd>');
  });
});
