import { describe, expect, it } from 'vitest';
import { spreadFactionStarts, type StartingSite } from '../src/world/starting-sites';
import { DEFAULT_LANDSCAPE_PARAMETERS } from '../src/world/options';

describe('evenly distributed faction capitals', () => {
  it('covers a broad viable mainland without clustering in its more fertile corner', () => {
    const candidates: StartingSite[] = [];
    for (let y = 8; y < 160; y += 4) for (let x = 8; x < 220; x += 4)
      candidates.push({ x, y, quality: x < 65 && y < 65 ? 5 : 2, scenic: 0, tie: ((x * 13 + y * 7) % 101) / 101 });
    const starts = spreadFactionStarts(candidates, 11, 18);
    expect(starts).toHaveLength(11);
    expect(spreadFactionStarts(candidates, 11, 18)).toEqual(starts);
    const gaps = starts.map((point, n) => Math.min(...starts.filter((_, i) => i !== n).map(other => Math.hypot(point.x - other.x, point.y - other.y))));
    expect(Math.min(...gaps)).toBeGreaterThan(35);
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.8);
    const farthestUnserved = Math.max(...candidates.map(point => Math.min(...starts.map(other => Math.hypot(point.x - other.x, point.y - other.y)))));
    expect(farthestUnserved).toBeLessThan(57);
    expect(starts.filter(point => point.x > 110).length).toBeGreaterThanOrEqual(4);
    expect(starts.filter(point => point.x > 110).length).toBeLessThanOrEqual(7);
  });

  it('snaps relaxed starts to viable terrain and preserves the required minimum gap', () => {
    const candidates: StartingSite[] = [];
    for (let y = 0; y < 120; y += 3) for (let x = 0; x < 180; x += 3) {
      if (x > 70 && x < 110 && y > 30 || Math.hypot(x - 25, y - 85) < 20) continue;
      candidates.push({ x, y, quality: 3, scenic: 0, tie: .5 });
    }
    const starts = spreadFactionStarts(candidates, 11, 18, { ...DEFAULT_LANDSCAPE_PARAMETERS, startRelaxations: 6 });
    expect(starts).toHaveLength(11);
    for (let n = 0; n < starts.length; n++) {
      expect(candidates).toContain(starts[n]);
      for (let m = n + 1; m < starts.length; m++) expect(Math.hypot(starts[n].x - starts[m].x, starts[n].y - starts[m].y)).toBeGreaterThanOrEqual(18);
    }
    expect(spreadFactionStarts(candidates.slice(0, 1), 11, 18)).toEqual([]);
  });
});
