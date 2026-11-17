import { describe, expect, it } from 'vitest';
import { riverFixture } from './helpers/river';
import { entityStore } from '../src/game/entity-store';
import { type FishingBoat } from '../src/game/fishing';
import { sailingNavigation, updateSailingLeader } from '../src/game/sailing';
import { galleyHullDistance } from '../src/game/galley-footprint';
import { smallBoatTrafficClear, refreshWaterTraffic } from '../src/game/water-traffic';
import { distance } from '../src/game/types';
const idle={up:false,down:false,left:false,right:false};
function fixture(){
 const state=riverFixture();entityStore(state).buildings.replace([]);
 for(const tile of state.world.tiles)tile.terrain='coast';
 const boat=(id:number,x:number,y:number):FishingBoat=>({id,dock:id,city:1,faction:0,hp:80,x,y,home:{x,y},phase:'outbound',cargo:0,facing:0,moving:false,path:[],nextPlanAt:0});
 state.fishing={seed:'traffic',startedAt:0,sequence:2,whales:[],buffs:{},nextTick:1,zones:[],fish:[],boats:[],receipts:[],replacements:{}};
 return {state,boat};
}
describe('shared water traffic',()=>{
 it('Leader galleys cannot sail through fishing boats, and river traders plan around them',()=>{
  const {state,boat}=fixture(), captain=state.units[0], obstacle=boat(1,13.5,10.5);
  const galley={...captain,id:200,kind:'sailboat' as const,x:8.5,y:10.5,facing:0,sailboat:{dock:1,passenger:captain.id}};
  entityStore(state).units.add(galley);captain.embarkedOn=galley.id;state.fishing!.boats.push(obstacle);
  for(let i=0;i<120;i++){state.time+=.05;updateSailingLeader(state,captain,.05,{...idle,up:true});}
  expect(galley.x).toBeGreaterThan(10);expect(galley.x).toBeLessThan(13);
  expect(galleyHullDistance(galley,obstacle)).toBeGreaterThanOrEqual(.3);
  const merchant={...captain,id:201,kind:'merchant' as const,aboardRiverTrade:true};
  expect(sailingNavigation(state,merchant).position(obstacle)).toBe(false);
  obstacle.x=25;refreshWaterTraffic(state,obstacle);
  expect(smallBoatTrafficClear(state,merchant,{x:25,y:10.5})).toBe(false);
  obstacle.hp=0;expect(smallBoatTrafficClear(state,merchant,{x:25,y:10.5})).toBe(true);
 });
});
