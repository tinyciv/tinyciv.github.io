import { describe, expect, it } from 'vitest';
import { runBenchmark } from '../dev/company-lab/benchmark';
import { CompanyLab } from '../dev/company-lab/engine';
import type { ScenarioId } from '../dev/company-lab/types';

describe('standalone company movement', () => {
  for (const scenario of ['plain', 'river', 'forest', 'town', 'urban', 'hills'] as ScenarioId[]) {
    it(`crosses ${scenario}, stays together, and comes to rest`, () => {
      const report = runBenchmark({ scenario, size: 'small', mode: 'movement', seconds: 120 });
      expect(report.movement.arrivalFraction).toBe(1);
      expect(report.movement.stalled).toBe(0);
      expect(report.cohesion.max).toBeLessThanOrEqual(3);
      expect(report.geometry.invalidSamples).toBe(0);
      expect(report.geometry.maxOverlapDepth).toBe(0);
      expect(report.idle.tilesPerSoldierSecond).toBe(0);
    });
  }

  it('parks 180 soldiers beyond the fortified town without sealing its gate', () => {
    const report = runBenchmark({ scenario: 'town', size: 'large', mode: 'movement', seconds: 180 });
    expect(report.movement.arrivalFraction).toBe(1);
    expect(report.movement.stalled).toBe(0);
    expect(report.geometry.invalidSamples).toBe(0);
    expect(report.geometry.maxOverlapDepth).toBe(0);
  }, 30_000);

  it('accepts a reversed order and settles after returning home', () => {
    const lab = new CompanyLab({ scenario: 'plain', size: 'small', combat: false });
    for (const soldier of lab.soldiers) if (soldier.team === 1) soldier.hp = 0;
    lab.command(0, lab.world.bases[1], 'move');
    for (let step = 0; step < 1800; step++) lab.step(1 / 30);
    lab.command(0, lab.world.bases[0], 'regroup');
    for (let step = 0; step < 1800; step++) lab.step(1 / 30);
    const living = lab.soldiers.filter(soldier => soldier.hp > 0);
    expect(living).toHaveLength(18);
    expect(living.every(soldier => soldier.x < 20 && !soldier.moving)).toBe(true);
    const distance = living.reduce((total, soldier) => total + soldier.traveled, 0);
    for (let step = 0; step < 300; step++) lab.step(1 / 30);
    expect(living.reduce((total, soldier) => total + soldier.traveled, 0)).toBe(distance);
  });
});
