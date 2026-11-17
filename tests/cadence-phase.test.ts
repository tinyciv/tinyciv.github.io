import { describe, expect, it } from 'vitest';
import { decisionDue, type DecisionClock } from '../src/game/decision-schedule';
import { CHECK_INTERVAL, recurringWorkElapsed, recurringWorkInterval, withImmediateMaintenance } from '../src/game/work-cadence';
import type { GameState } from '../src/game/types';

const steps = [.05, .05, .1, .02, .06, .08, .1, .04];
const fixture = () => ({ world: { width: 1, height: 1, revision: 0, tiles: [] }, units: [], buildings: [], time: 0 } as unknown as GameState);

describe('persistent recurring phases', () => {
  it('slows only selected housekeeping while research, harvests, wakeups and tactical sensing keep their rates', () => {
    const state = fixture(), slow = ['builders:staff', 'collectors:staff', 'farms:sync', 'wall-ownership',
      'fog-raids', 'faction-strategies', 'dead-entities'];
    const fast = ['research', 'harvests', 'courier-wakeups', 'construction-completion', 'unlisted'];
    const keys = [...slow, ...fast], counts = new Map<string, number>(), elapsed = new Map<string, number>();
    const decision: DecisionClock = {}; let decisions = 0;
    for (let frame = 0; frame <= 720; frame++) {
      state.time = frame / 120;
      for (const key of keys) {
        const dt = frame ? 1 / 120 : 0;
        const due = recurringWorkElapsed(state, key, dt, 0);
        if (due !== undefined) { counts.set(key, (counts.get(key) ?? 0) + 1); elapsed.set(key, (elapsed.get(key) ?? 0) + due); }
        expect(recurringWorkElapsed(state, key, dt, 0)).toBeUndefined();
      }
      if (decisionDue(decision, state.time, 17) && frame > 120) decisions++;
    }
    slow.forEach(key => expect(counts.get(key)).toBe(13));
    fast.forEach(key => expect(counts.get(key)).toBe(19));
    keys.forEach(key => expect(elapsed.get(key)).toBeCloseTo(6, 9));
    expect(decisions).toBe(15);
  });

  it.each(['builders:staff', 'research'])('forces paused %s publications once and preserves its own next deadline', key => {
    const state = fixture(), interval = recurringWorkInterval(key);
    expect(recurringWorkElapsed(state, key, 0, 0)).toBe(0);
    state.time = .2;
    expect(recurringWorkElapsed(state, key, .2, 0)).toBeUndefined();
    state.paused = true;
    withImmediateMaintenance(state, () => {
      expect(recurringWorkElapsed(state, key, 0, 0)).toBe(.2);
      withImmediateMaintenance(state, () => expect(recurringWorkElapsed(state, key, 0, 0)).toBeUndefined());
    });
    expect(recurringWorkElapsed(state, key, 0, 0)).toBeUndefined();
    state.paused = false; state.time += interval;
    expect(recurringWorkElapsed(state, key, interval, 0)).toBeCloseTo(interval, 9);
    expect(recurringWorkElapsed(state, key, interval, 0)).toBeUndefined();
  });

  it('treats zero-dt staffing publications as due work without inventing elapsed credit', () => {
    const state = fixture();
    expect(recurringWorkElapsed(state, 'collectors:staff', 0, 0)).toBe(0);
    state.time = .49;
    expect(recurringWorkElapsed(state, 'collectors:staff', 0, 0)).toBeUndefined();
    state.time = .5;
    expect(recurringWorkElapsed(state, 'collectors:staff', 0, 0)).toBe(0);
    expect(recurringWorkElapsed(state, 'collectors:staff', 0, 0)).toBeUndefined();
    state.time = 10;
    expect(recurringWorkElapsed(state, 'collectors:staff', 0, 0)).toBe(0);
    expect(recurringWorkElapsed(state, 'collectors:staff', 0, 0)).toBeUndefined();
  });

  it('keeps a large crowd dispersed through variable and coarse game-time steps', () => {
    const clocks: DecisionClock[] = Array.from({ length: 120 }, () => ({})), samples = clocks.map(() => [] as number[]);
    let now = 0, maximum = 0;
    for (let frame = 0; frame < 1200; frame++) {
      let due = 0;
      for (let id = 0; id < clocks.length; id++) {
        if (decisionDue(clocks[id], now, id + 1)) { due++; samples[id].push(now); }
        expect(decisionDue(clocks[id], now, id + 1)).toBe(false);
      }
      if (now > 5) maximum = Math.max(maximum, due);
      now += steps[frame % steps.length];
    }
    // A late frame may include nearby phases; it must not permanently merge
    // most of the crowd into one cohort on all subsequent checks.
    expect(maximum).toBeLessThan(45);
    for (const times of samples) {
      expect(times.length).toBeLessThanOrEqual(Math.floor(now / CHECK_INTERVAL) + 1);
      expect(times.length).toBeGreaterThan(now / CHECK_INTERVAL - 3);
      expect(times[1]).toBeGreaterThanOrEqual(CHECK_INTERVAL);
      expect(times[1]).toBeLessThanOrEqual(2 * CHECK_INTERVAL + .1);
      for (let i = 2; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(CHECK_INTERVAL - .1 - 1e-8);
        expect(times[i] - times[i - 1]).toBeLessThanOrEqual(CHECK_INTERVAL + .1 + 1e-8);
      }
    }
  });

  it('disperses direct settlement maintenance and preserves every elapsed increment', () => {
    const state = fixture(), keys = ['builders:staff', 'farms:sync', 'collectors:staff'];
    const samples = keys.map(() => [] as number[]), integrated = keys.map(() => 0), phases = new Set<string>();
    for (let frame = 0; frame < 800; frame++) {
      const dt = frame ? steps[(frame - 1) % steps.length] : 0;
      state.time += dt;
      const due: string[] = [];
      keys.forEach((key, index) => {
        const elapsed = recurringWorkElapsed(state, key, dt);
        if (elapsed !== undefined) { samples[index].push(state.time); integrated[index] += elapsed; due.push(key); }
        expect(recurringWorkElapsed(state, key, dt)).toBeUndefined();
      });
      if (state.time > 5 && due.length) phases.add(due.join(','));
    }
    expect(new Set(samples.map(times => times[1])).size).toBeGreaterThan(1);
    expect(phases.size).toBeGreaterThan(1);
    samples.forEach((times, index) => {
      const interval = recurringWorkInterval(keys[index]);
      expect(times.length).toBeLessThanOrEqual(Math.floor(state.time / interval) + 1);
      expect(times.length).toBeGreaterThan(state.time / interval - 3);
      for (let i = 2; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(interval - .1 - 1e-8);
        expect(times[i] - times[i - 1]).toBeLessThanOrEqual(interval + .1 + 1e-8);
      }
      expect(integrated[index]).toBeCloseTo(times.at(-1)!, 9);
    });
  });

  it('coalesces a long hitch and restores separate phases without duplicate catch-up', () => {
    const clocks: DecisionClock[] = Array.from({ length: 120 }, () => ({}));
    clocks.forEach((clock, id) => decisionDue(clock, 0, id + 1));
    clocks.forEach((clock, id) => {
      expect(decisionDue(clock, 100, id + 1)).toBe(true);
      expect(decisionDue(clock, 100, id + 1)).toBe(false);
      expect(clock.nextAt).toBeGreaterThan(100);
      expect(clock.nextAt).toBeLessThanOrEqual(100 + CHECK_INTERVAL + 1e-8);
    });
    let maximum = 0;
    for (let frame = 1; frame <= 20; frame++) {
      const now = 100 + frame / 60;
      maximum = Math.max(maximum, clocks.filter((clock, id) => decisionDue(clock, now, id + 1)).length);
    }
    expect(maximum).toBeLessThan(12);
  });

  it('deduplicates paused explicit work and restarts bounded distinct follow-up phases', () => {
    const state = fixture(), keys = ['builders:staff', 'farms:sync', 'collectors:staff'];
    keys.forEach(key => recurringWorkElapsed(state, key, 0));
    state.time = .1;
    keys.forEach(key => expect(recurringWorkElapsed(state, key, .1)).toBeUndefined());
    withImmediateMaintenance(state, () => keys.forEach(key => {
      expect(recurringWorkElapsed(state, key, 0)).toBe(.1);
      expect(recurringWorkElapsed(state, key, 0)).toBeUndefined();
    }));
    const followed = new Map<string, number>();
    for (let frame = 1; frame <= 65; frame++) {
      state.time = .1 + frame / 60;
      keys.forEach(key => {
        const elapsed = recurringWorkElapsed(state, key, 1 / 60);
        if (elapsed !== undefined && !followed.has(key)) {
          followed.set(key, state.time);
          expect(elapsed).toBeCloseTo(state.time - .1, 9);
          expect(state.time - .1).toBeGreaterThanOrEqual(recurringWorkInterval(key));
          expect(state.time - .1).toBeLessThanOrEqual(2 * recurringWorkInterval(key) + 1 / 60);
        }
      });
    }
    expect(followed.size).toBe(3);
    expect(new Set(followed.values()).size).toBeGreaterThan(1);
  });
});
