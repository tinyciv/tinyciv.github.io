import { describe, expect, it } from 'vitest';
import { merchantFrame } from '../src/game/merchant-art';

describe('Cloth-hat merchant poses', () => {
  it('plays the approved idle and walking rows in all four directions', () => {
    for (const [facing, idle] of [[0, 2], [Math.PI / 2, 0], [Math.PI, 4], [-Math.PI / 2, 6]]) {
      for (const column of [0, 1, 2, 3]) {
        expect(merchantFrame({ id: 0, facing, moving: false }, (column + .1) * .3)).toEqual({ row: idle, column });
        expect(merchantFrame({ id: 0, facing, moving: true }, (column + .1) / 7)).toEqual({ row: idle + 1, column });
      }
    }
  });
});
