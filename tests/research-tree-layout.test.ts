import { describe, expect, it } from 'vitest';
import { RESEARCH_BRANCHES } from '../src/game/research';
import { RESEARCH_COLUMNS, RESEARCH_POSITIONS, RESEARCH_CARD_WIDTH, RESEARCH_CARD_HEIGHT, RESEARCH_BOARD_WIDTH, RESEARCH_BOARD_HEIGHT, researchCardPosition, researchEdgePoints, researchNeighbor } from '../src/ui/research-tree-layout';

const edges = RESEARCH_BRANCHES.flatMap(branch => branch.prerequisites.map(from => ({ from, to: branch.id, points: researchEdgePoints(from, branch.id) })));
describe('horizontal research layout', () => {
  it('places every technology once with clear space between cards', () => {
    const ids = RESEARCH_COLUMNS.flat();
    expect(new Set(ids).size).toBe(RESEARCH_BRANCHES.length);
    expect(ids).toHaveLength(RESEARCH_BRANCHES.length);
    for (const column of RESEARCH_COLUMNS) {
      let bottom = -24;
      for (const id of column) {
        const { left, top } = researchCardPosition(id);
        expect(top - bottom).toBeGreaterThanOrEqual(24);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left + RESEARCH_CARD_WIDTH).toBeLessThan(RESEARCH_BOARD_WIDTH);
        bottom = top + RESEARCH_CARD_HEIGHT;
        expect(bottom).toBeLessThan(RESEARCH_BOARD_HEIGHT);
      }
    }
  });
  it('routes every actual prerequisite left to right without crossing any card', () => {
    for (const edge of edges) {
      expect(RESEARCH_POSITIONS.get(edge.from)!.x).toBeLessThan(RESEARCH_POSITIONS.get(edge.to)!.x);
      for (const point of edge.points) {
        expect(point.every(Number.isFinite), `${edge.from} → ${edge.to}`).toBe(true);
        for (const id of RESEARCH_POSITIONS.keys()) {
          const { left, top } = researchCardPosition(id);
          const right = left + RESEARCH_CARD_WIDTH, bottom = top + RESEARCH_CARD_HEIGHT;
          const inside = point[0] > left + .001 && point[0] < right - .001 && point[1] > top + .001 && point[1] < bottom - .001;
          expect(inside, `${edge.from} → ${edge.to} crosses ${id}`).toBe(false);
        }
      }
    }
  });
  it('keeps the prerequisite crossovers within the spaced layout budget', () => {
    const crossings: [number, number][] = [];
    for (let a = 0; a < edges.length; a++) for (let b = a + 1; b < edges.length; b++) {
      const first = edges[a], second = edges[b];
      if (first.from === second.from || first.to === second.to) continue;
      for (let i = 1; i < first.points.length; i++) for (let j = 1; j < second.points.length; j++) {
        const [p, q] = [first.points[i - 1], second.points[j - 1]];
        const r = [first.points[i][0] - p[0], first.points[i][1] - p[1]], s = [second.points[j][0] - q[0], second.points[j][1] - q[1]];
        const cross = (x: number[], y: number[]) => x[0] * y[1] - x[1] * y[0], denominator = cross(r, s);
        if (Math.abs(denominator) < .000001) continue;
        const delta = [q[0] - p[0], q[1] - p[1]], t = cross(delta, s) / denominator, u = cross(delta, r) / denominator;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const point: [number, number] = [p[0] + t * r[0], p[1] + t * r[1]];
        if (!crossings.some(other => Math.hypot(point[0] - other[0], point[1] - other[1]) < .5)) crossings.push(point);
      }
    }
    expect(crossings.length).toBeLessThanOrEqual(20);
  });
  it('navigates stage order and reveals the nearest neighboring branch', () => {
    expect(researchNeighbor('woodenTower', 'ArrowUp')).toBe('scoutLodge');
    expect(researchNeighbor('grainStorage', 'ArrowRight')).toBe('monument');
    expect(researchNeighbor('siegeEngines', 'ArrowDown')).toBe('horsebackRiding');
    expect(researchNeighbor('monument', 'Home')).toBe('irrigation');
    expect(researchNeighbor('monument', 'End')).toBe('militaryScience');
  });
});
