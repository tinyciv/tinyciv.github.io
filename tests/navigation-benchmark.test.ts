import { expect, it } from 'vitest';
import * as current from '../src/game/simulation';
import * as baseline from '../dev/navigation-lab/baseline-simulation';
import { run, SCENARIOS } from '../dev/navigation-lab/scenarios';
it('engages every attacker around front lines and obstacles while preserving unique occupied cells', () => {
  const results = SCENARIOS.map(scenario => ({ scenario, baseline: run(scenario, baseline), current: run(scenario, current) }));
  for (const result of results) {
    expect(result.current.overlappingSamples).toBe(0);
    expect(result.current.stalledUnitSeconds).toBeLessThan(result.baseline.stalledUnitSeconds);
    if (result.scenario === 'Crossing traffic') {
      expect(result.current.arrived).toBe(24);
      expect(result.current.maxStall).toBeLessThan(6);
    } else {
      expect(result.current.engaged).toBe(12);
      expect(result.current.maxStall).toBeLessThan(2);
      expect(result.current.meanEngaged).toBeGreaterThan(result.baseline.meanEngaged);
    }
  }
}, 20000);
