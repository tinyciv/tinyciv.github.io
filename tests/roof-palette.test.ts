import { describe, expect, it } from 'vitest';
import { roofColor } from '../src/game/roof-palette';
describe('shaded faction roofs', () => {
 it('keeps distinct roof highlights instead of clipping them to the same red', () => {
  for(const color of ['#f34f59','#4188ff','#ffffff']) {
   const shades=[[130,10,20],[210,25,35],[255,70,80],[255,145,150]].map(([r,g,b])=>roofColor(r,g,b,color));
   expect(new Set(shades.map(s=>s.join(','))).size).toBe(4);
   const light=shades.map(s=>(Math.max(...s)+Math.min(...s))/2);
   expect(light.every((v,i)=>!i||v>light[i-1])).toBe(true);
  }
  expect(roofColor(170,110,55,'#4188ff')).toEqual([170,110,55]);
 });
});
