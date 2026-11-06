import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { moveUnit, updateFriendlyYield } from '../src/game/simulation';
import { updateCollector } from '../src/game/farms';
import type { GameState, Unit } from '../src/game/types';

function unit(id:number,kind:Unit['kind'],x:number,y:number):Unit { return {id,kind,faction:0,x,y,hp:100,morale:100,attack:0,defense:0,speed:3,range:1,order:'work',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0}; }
function fixture():GameState {
  return {world:{width:12,height:12,seed:'courier-traffic',source:'test',spawns:[],tiles:Array.from({length:144},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:3,production:1,gold:0,variation:.5}))},
    units:[],buildings:[{id:1,kind:'palace',faction:0,x:5,y:5,hp:650,maxHp:650,capacity:0},{id:2,kind:'camp',faction:0,x:9,y:8,hp:100,maxHp:100,capacity:0}],
    factions:[{id:0,name:'Home',color:'#3988ff',affinity:100,relation:'self',food:0,gold:100,population:10,production:0,yields:{food:0,gold:0,production:0},nextRaid:1e9,defeated:false}],
    time:5,tick:0,paused:false,speed:1,events:[],particles:[],selected:null,selectedType:null,buildMode:null,diplomacy:null,gameOver:false,victory:false,seed:'courier-traffic',rngState:1};
}

describe('palace courier traffic', () => {
  it('lets a courier unload at an entrance before yielding to a passing peasant', () => {
    const state=fixture(), leader=unit(10,'worker',3.9,5.5), courier=unit(20,'worker',4.5,5.5);
    Object.assign(courier,{collector:true,collectorCamp:2,home:1,collectPhase:'returning',cargo:4.8,cargoBatches:[{amount:4.8,expiresAt:50}],cargoExpiresAt:50});
    entityStore(state).units.replace([leader,courier]);
    moveUnit(state,leader,{x:4.5,y:5.5},.1,true);
    expect(updateFriendlyYield(state,courier,.1)).toBe(false);
    expect(courier).toMatchObject({x:4.5,y:5.5});
    updateCollector(state,courier,.1,moveUnit);
    expect(courier.inside).toBe(true);
    expect(state.factions[0].food).toBeCloseTo(4.8);
  });

  it('lets loaded returning workers pass busy outbound workers without redirecting their orders', () => {
    const state=fixture(), returning=unit(30,'worker',2.9,8.5), outbound=unit(10,'worker',3.5,8.5);
    Object.assign(returning,{collector:true,collectPhase:'returning',cargo:4.8,destination:{x:6.5,y:8.5}});
    Object.assign(outbound,{collector:true,collectPhase:'outbound',destination:{x:1.5,y:8.5},moving:true});
    entityStore(state).units.replace([returning,outbound]);
    moveUnit(state,returning,{x:3.5,y:8.5},.1,true);
    expect(updateFriendlyYield(state,outbound,.1)).toBe(false);
    expect(outbound).toMatchObject({x:3.5,y:8.5,destination:{x:1.5,y:8.5}});
    expect(returning.x).toBeGreaterThan(2.9);
    expect(Math.hypot(returning.x-outbound.x,returning.y-outbound.y)).toBeGreaterThanOrEqual(.28);
  });
});

it('recenters before a diagonal sidestep instead of deadlocking against an adjacent courier', () => {
  const state=fixture(), moving=unit(20,'worker',3.05,7.46), waiting=unit(10,'worker',2.88,7.15);
  entityStore(state).units.replace([moving,waiting]);
  entityStore(state).buildings.add({id:9,kind:'house',faction:0,x:3,y:8,hp:100,maxHp:100,capacity:4});
  const goal={x:2.5,y:8.5};
  moving.path=[goal]; moving.pathGoal=goal; moving.repathAt=100;
  for(let i=0;i<30;i++) { state.time+=.1; moveUnit(state,moving,goal,.1); }
  expect(Math.hypot(moving.x-goal.x,moving.y-goal.y)).toBeLessThan(.12);
  expect(waiting).toMatchObject({x:2.88,y:7.15});
});
