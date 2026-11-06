import { describe, expect, it } from 'vitest';
import { NO_INPUT, validatedInput } from '../src/multiplayer/input';

describe('authenticated movement input validation', () => {
  it('accepts held rotation and movement while stripping client identity and arbitrary fields', () => {
    expect(validatedInput({ ...NO_INPUT, up: true, turnLeft: true, faction: 1, heading: 99, speed: 1000 }))
      .toEqual({ ...NO_INPUT, up: true, turnLeft: true });
    expect(validatedInput({ ...NO_INPUT, turnLeft: true, turnRight: true }))
      .toEqual({ ...NO_INPUT, turnLeft: true, turnRight: true });
  });
  it('normalizes missing optional turn buttons to released without retaining old input', () => {
    expect(validatedInput({ up: false, down: false, left: false, right: false })).toEqual(NO_INPUT);
  });
  it.each([null, [], {}, true, { ...NO_INPUT, right: 1 }, { ...NO_INPUT, turnLeft: 1 }, { ...NO_INPUT, turnRight: 'true' },
    { ...NO_INPUT, turnLeft: null }, { ...NO_INPUT, turnRight: {} }])('rejects malformed input %j', input => {
    expect(validatedInput(input)).toBeUndefined();
  });
});
