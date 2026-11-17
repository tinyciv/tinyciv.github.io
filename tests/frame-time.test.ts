import { describe, expect, it } from 'vitest';
import { frameSimulationDelta } from '../src/game/frame-time';

describe('animation frame simulation budget', () => {
  it('keeps normal 30 fps time exact through 3× speed', () => {
    for (const speed of [1, 2, 3]) expect(frameSimulationDelta(1 / 30, speed)).toBe(1 / 30);
  });
  it('prevents delayed frames from causing a catch-up spiral at every speed', () => {
    for (const speed of [1, 2, 3, 4]) expect(frameSimulationDelta(.15, speed) * speed).toBeCloseTo(.1);
    expect(frameSimulationDelta(1 / 60, 4)).toBe(1 / 60);
    expect(frameSimulationDelta(-1, 2)).toBe(0);
    expect(frameSimulationDelta(NaN, 2)).toBe(0);
  });
});
