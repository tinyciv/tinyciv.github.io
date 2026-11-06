import { describe, expect, it } from 'vitest';
import { GALLEY_LENGTH, GALLEY_WIDTH, galleyContainsPoint, galleyFootprintCells, galleyHullDistance, galleyOverlapsTile } from '../src/game/galley-footprint';

describe('rounded 2×1 galley footprint', () => {
  it('occupies exactly two aligned grid cells without counting edge-only contact', () => {
    expect([GALLEY_LENGTH,GALLEY_WIDTH]).toEqual([2,1]);
    expect(galleyFootprintCells({x:5,y:5.5,facing:0})).toEqual([{x:4,y:5},{x:5,y:5}]);
    expect(galleyFootprintCells({x:5.5,y:5,facing:Math.PI/2})).toEqual([{x:5,y:4},{x:5,y:5}]);
    expect(galleyOverlapsTile({x:5,y:5.5,facing:0},6,5)).toBe(false);
  });
  it('rotates both the bow and stern while excluding empty hull corners', () => {
    const horizontal={x:5,y:5,facing:0},vertical={...horizontal,facing:Math.PI/2};
    expect(galleyContainsPoint(horizontal,{x:5.9,y:5})).toBe(true);
    expect(galleyContainsPoint(vertical,{x:5.9,y:5})).toBe(false);
    expect(galleyContainsPoint(horizontal,{x:5.9,y:5.45})).toBe(false);
    expect(galleyHullDistance(horizontal,{x:6.5,y:5})).toBeCloseTo(.5);
  });
  it('fits turns inside a two-by-two pool with no phantom rectangular corners', () => {
    for (let angle=0;angle<Math.PI*2;angle+=.1) {
      const cells=galleyFootprintCells({x:5,y:5,facing:angle});
      expect(cells.every(p=>p.x>=4&&p.x<=5&&p.y>=4&&p.y<=5)).toBe(true);
    }
  });
});
