import { describe, expect, it } from 'vitest';
import { multiplierPercent, wholeNumber } from '../src/ui/number-format';
import { formatResearchCost } from '../src/ui/research-format';

describe('whole-number presentation', () => {
  it('rounds fractional combat, health, upkeep, and cargo values without changing their source values', () => {
    const values = [48.25, 66.7, 8.75, 2.6, 37.5, .5333333333];
    expect(values.map(wholeNumber)).toEqual(['48', '67', '9', '3', '38', '1']);
    expect(values).toEqual([48.25, 66.7, 8.75, 2.6, 37.5, .5333333333]);
  });

  it('shows fractional equipment factors and soil fertility as precise whole percentages', () => {
    expect([1.15, 1.3, 1.5, 1.7, 1.9, 2.1, .75, .5, 1.25].map(multiplierPercent))
      .toEqual(['115%', '130%', '150%', '170%', '190%', '210%', '75%', '50%', '125%']);
  });

  it('rounds discounted research costs without decimals', () => {
    expect(formatResearchCost(103.75)).toBe('104');
    expect(formatResearchCost(450)).toBe('450');
  });
});
