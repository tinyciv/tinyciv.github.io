import { describe, expect, it, vi } from 'vitest';
import { createSailingDistance } from '../src/game/sailing-distance';
import type { World } from '../src/game/types';
function waterWorld(width=12,height=12):World {
 return {width,height,seed:'distances',source:'test',spawns:[],tiles:Array.from({length:width*height},()=>
  ({terrain:'coast',overlay:'none',elevation:.1,moisture:.5,food:0,production:0,gold:0,variation:0}))};
}
describe('coarse sailing distance field',()=>{
 it('provides octile distances in open water and shares work across queries',()=>{
  const world=waterWorld(),cell=vi.fn(()=>true),distance=createSailingDistance(world,cell,[{x:9.5,y:9.5}]);
  expect(distance({x:1.5,y:3.5})).toBeCloseTo(6*Math.SQRT2+2);
  const calls=cell.mock.calls.length;
  expect(distance({x:8.5,y:8.5})).toBeCloseTo(Math.SQRT2);
  expect(cell.mock.calls.length).toBe(calls);
 });
 it('guides a route around an island instead of through it',()=>{
  const world=waterWorld();
  const distance=createSailingDistance(world,(x,y)=>!(x>=4&&x<=7&&y>=2&&y<=9),[{x:10.5,y:6.5}]);
  const start=distance({x:1.5,y:6.5});
  expect(start).toBeGreaterThan(9);
  expect(distance({x:3.5,y:10.5})).toBeLessThan(start);
  expect(distance({x:5.5,y:6.5})).toBe(Infinity);
 });
 it('uses the closest reachable landing goal and rejects blocked corners',()=>{
  const world=waterWorld();
  const distance=createSailingDistance(world,(x)=>x!==6,[{x:3.5,y:3.5},{x:9.5,y:9.5}]);
  expect(distance({x:1.5,y:3.5})).toBe(2);
  expect(distance({x:10.5,y:9.5})).toBe(1);
  expect(distance({x:-.5,y:9.5})).toBe(Infinity);
  const corners=createSailingDistance(world,(x,y)=>x===y,[{x:2.5,y:2.5}]);
  expect(corners({x:1.5,y:1.5})).toBe(Infinity);
 });
 it('cannot use water across a ledge drop',()=>{
  const world=waterWorld();for(let y=0;y<12;y++)for(let x=6;x<12;x++)world.tiles[y*12+x].ridge=1;
  const distance=createSailingDistance(world,()=>true,[{x:3.5,y:3.5}]);
  expect(distance({x:9.5,y:3.5})).toBe(Infinity);
 });
});
