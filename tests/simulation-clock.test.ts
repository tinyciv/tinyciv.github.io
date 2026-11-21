import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../src/game/simulation-clock';

describe('simulation host clock', () => {
  it('retains every step at 32× across uneven timer delivery and budget limits', () => {
    const clock = new SimulationClock();
    clock.sample(0, 32);
    let completed = 0;
    for (const now of [16, 53, 74, 350, 381, 1000]) {
      clock.sample(now, 32);
      const steps = Math.min(3, clock.dueSteps);
      completed += steps;
      clock.consume(steps * clock.stepSeconds);
    }
    expect(clock.stepSeconds).toBe(.1);
    expect(completed + clock.dueSteps).toBe(320);
    clock.consume(clock.dueSteps * clock.stepSeconds);
    expect(clock.dueSteps).toBe(0);
  });

  it('preserves time earned before a pause or speed change and resets for a new world', () => {
    const clock = new SimulationClock();
    clock.sample(0, 1);
    clock.sample(25, 32);
    clock.sample(125, 0);
    expect(clock.dueSteps).toBe(0);
    clock.sample(20_125, 1);
    expect(clock.dueSteps).toBe(193);
    clock.reset(20_125);
    clock.sample(20_150, 1);
    expect(clock.dueSteps).toBe(0);
  });

  it('gives fast-forward more time only while the simulation is behind', () => {
    const clock = new SimulationClock();
    clock.sample(0, 128);
    clock.sample(20, 128);
    expect(clock.fastForwardBehind).toBe(false);
    clock.sample(40, 128);
    expect(clock.fastForwardBehind).toBe(true);

    clock.consume(4.2);
    expect(clock.fastForwardBehind).toBe(false);
    clock.sample(80, 8);
    expect(clock.fastForwardBehind).toBe(false);
    clock.sample(120, 128);
    expect(clock.fastForwardBehind).toBe(true);
    clock.sample(120, 0);
    expect(clock.fastForwardBehind).toBe(false);
  });
});
