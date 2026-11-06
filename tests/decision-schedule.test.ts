import { describe, expect, it } from 'vitest';
import { decisionDue, type DecisionClock } from '../src/game/decision-schedule';

describe('staggered game-time decisions', () => {
  it('samples quiet and active units at their intended rates independently of fast-step frequency', () => {
    for (const hz of [30, 60, 120]) for (const active of [false, true]) {
      const clock: DecisionClock = {};
      let decisions = 0;
      for (let frame = 0; frame < hz * 4; frame++) {
        const due = decisionDue(clock, frame / hz, 17, active);
        if (frame >= hz && due) decisions++;
      }
      expect(decisions).toBe(9);
    }
  });

  it('spreads a crowd across the interval instead of waking every unit on one frame', () => {
    const clocks = Array.from({ length: 120 }, () => ({} as DecisionClock));
    const counts: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      const count = clocks.filter((clock, id) => decisionDue(clock, frame / 60, id + 1)).length;
      if (frame >= 60) counts.push(count);
    }
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(360);
    expect(Math.max(...counts)).toBeLessThan(12);
  });

  it('caps repeated damage, commands and entering combat at three observations per second', () => {
    const clock: DecisionClock = {}, samples: number[] = [];
    for (let frame = 0; frame < 600; frame++) {
      const now = frame / 120;
      if (decisionDue(clock, now, 23, frame % 2 === 0, true)) samples.push(now);
    }
    for (let index = 1; index < samples.length; index++) expect(samples[index] - samples[index - 1]).toBeGreaterThanOrEqual(1 / 3 - 1e-9);
    expect(samples.length).toBeLessThanOrEqual(15);
    expect(decisionDue(clock, samples.at(-1)!, 23, true, true)).toBe(false);
  });

  it('pauses with game time, follows speed changes, and coalesces missed decisions', () => {
    const clock: DecisionClock = {};
    decisionDue(clock, 0, 7);
    for (let frame = 0; frame < 120; frame++) expect(decisionDue(clock, 0, 7)).toBe(false);
    let decisions = 0;
    for (let frame = 1; frame <= 60; frame++) if (decisionDue(clock, frame * 2 / 60, 7)) decisions++;
    expect(decisions).toBeGreaterThanOrEqual(5);
    expect(decisions).toBeLessThanOrEqual(6);
    expect(decisionDue(clock, 100, 7)).toBe(true);
    expect(decisionDue(clock, 100, 7)).toBe(false);
    expect(decisionDue(clock, .1, 7)).toBe(true);
    expect(decisionDue(clock, NaN, 7)).toBe(false);
  });
});
