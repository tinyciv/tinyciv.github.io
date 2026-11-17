import { describe, expect, it } from 'vitest';
import { orderedDistanceCells } from '../src/game/ordered-distance-cells';

const sorted = (distances: Float32Array): number[] => Array.from({ length: distances.length }, (_, cell) => cell)
  .sort((a, b) => distances[a] - distances[b] || a - b);

describe('lazy travel-field ordering', () => {
  it('matches the complete distance/index order with finite ties and unreachable cells', () => {
    let seed = 48271;
    for (const size of [0, 1, 2, 17, 256, 4096]) {
      const distances = Float32Array.from({ length: size }, () => {
        seed = Math.imul(seed, 1664525) + 1013904223 | 0;
        return seed % 9 === 0 ? Infinity : (seed >>> 0) % 101 / 7;
      });
      const original = distances.slice();
      expect([...orderedDistanceCells(distances)]).toEqual(sorted(distances));
      expect(distances).toEqual(original);
    }
    expect([...orderedDistanceCells(Float32Array.of(Infinity, 0, Infinity, 0, -0, Infinity))]).toEqual([1, 3, 4, 0, 2, 5]);
  });

  it('replays abandoned prefixes and supports interleaved independent searches', () => {
    const distances = Float32Array.from({ length: 2000 }, (_, cell) => (cell * 173) % 43);
    const expected = sorted(distances);
    const first = orderedDistanceCells(distances), second = orderedDistanceCells(distances);
    for (let index = 0; index < 120; index++) {
      expect(first.next().value).toBe(expected[index]);
      if (index % 3 === 0) expect(second.next().value).toBe(expected[index / 3]);
    }
    first.return(undefined);
    expect([...second]).toEqual(expected.slice(40));
    expect([...orderedDistanceCells(distances)]).toEqual(expected);
  });

  it('keeps separate travel-field generations independent', () => {
    const before = Float32Array.of(2, 1, Infinity, 1), after = Float32Array.of(0, Infinity, 2, 1);
    const previousSearch = orderedDistanceCells(before);
    expect(previousSearch.next().value).toBe(1);
    expect([...orderedDistanceCells(after)]).toEqual([0, 3, 2, 1]);
    expect([...previousSearch]).toEqual([3, 0, 2]);
  });
});
