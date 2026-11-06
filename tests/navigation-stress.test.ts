import { expect, it } from 'vitest';
import { moveUnit, updateFriendlyYield } from '../src/game/simulation';
import { beginNavigationFrame, endNavigationFrame } from '../src/game/pathfinding';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from '../src/game/spatial';
import { runStress } from '../dev/navigation-lab/stress';

const driver = { moveUnit, updateFriendlyYield, beginNavigationFrame, endNavigationFrame, beginUnitFrame, endUnitFrame, refreshIndexedUnit };
it('clears long opposing queues through a single-cell corridor and passing bay', () => {
  const result = runStress('Opposing corridor', driver, 120);
  expect(result.arrived).toBe(32);
  expect(result.stuck).toEqual([]);
  expect(result.overlapSamples).toBe(0);
});
it('keeps a 128-unit crossing and a 256-unit procession moving without cell overlap', () => {
  for (const scenario of ['Crowded crossing', 'Large procession'] as const) {
    const result = runStress(scenario, driver, 60);
    expect(result.meanProgress).toBeGreaterThan(38);
    expect(result.maxStall).toBeLessThan(8);
    expect(result.overlapSamples).toBe(0);
    if (scenario === 'Large procession') {
      expect(result.arrived).toBeGreaterThanOrEqual(160);
      expect(result.stalledUnitSeconds).toBeLessThan(1100);
    }
  }
});
