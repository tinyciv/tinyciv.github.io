import { describe, expect, it } from 'vitest';
import { actionTooltip, buildTooltip, BUILD_DESCRIPTIONS } from '../src/ui/action-tooltips';
import { BUILD_OPTIONS } from '../src/ui/build-controls';
import { BUILD_COSTS } from '../src/game/simulation';
import { CONSTRUCTION_SECONDS } from '../src/game/structures';

describe('action and building tooltip coverage', () => {
  it.each(BUILD_OPTIONS)('describes $label with its live cost, build time and reuse delay', ({ kind }) => {
    const text = buildTooltip(kind, BUILD_COSTS[kind].gold, CONSTRUCTION_SECONDS[kind]);
    expect(BUILD_DESCRIPTIONS[kind].length).toBeGreaterThan(20);
    expect(text).toContain(`Cost: ${Math.round(BUILD_COSTS[kind].gold)} gold`);
    expect(text).toContain('Cooldown: None');
    expect(text).toContain(`Build time: ${Math.round(CONSTRUCTION_SECONDS[kind])}s`);
    expect(text.length).toBeLessThan(240);
  });
  it('shows cooldowns separately from construction time and supports variable costs', () => {
    expect(actionTooltip('Draft citizens.', '15 gold / citizen', 30)).toBe('Draft citizens.\nCost: 15 gold / citizen · Cooldown: 30s');
    expect(buildTooltip('observationPost',20,0)).toContain('20 gold + 1 population');
    expect(buildTooltip('road',5,2)).toContain('5 gold / tile');
  });
});
