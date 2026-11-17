import {it,expect,vi} from 'vitest';
import {scoutRealm} from './helpers/scouts';
import {entityStore} from '../src/game/entity-store';
import {buildAt,advanceConstructionReconciliation,buildCostAt,updateGame,validateBuildAt} from '../src/game/simulation';
import {updateGuardPosts} from '../src/game/guard-posts';
import {buildingMaintenance} from '../src/game/maintenance';
import * as builders from '../src/game/builders';
import * as archery from '../src/game/archery';
import {unlockBuildingResearch} from './helpers/research';
it('queues staffing and yields after an approved placement; paused frames finish the work',()=>{
 const state=scoutRealm();state.factions[0].population=200;state.factions[0].gold=100000;state.factions[0].culture=100000;unlockBuildingResearch(state.factions[0]);
 entityStore(state).buildings.replace([{id:500,kind:'palace',faction:0,x:10,y:10,hp:600,maxHp:600,capacity:200,unhousedResidents:200}]);
 Object.assign(state.units[0],{x:14.5,y:14.5});state.paused=true;
 const staff=vi.spyOn(builders,'ensureBuilders'),training=vi.spyOn(archery,'scheduleArcheryTraining');
 for(const kind of ['well','guardPost'] as const){const x=kind==='well'?14:16,y=16;expect(validateBuildAt(state,kind,x,y).ok).toBe(true);
  const before=performance.now(),result=buildAt(state,kind,x,y);const elapsed=performance.now()-before;expect(result.ok,result.message).toBe(true);
  console.log(`${kind} placement commit ms:`,elapsed);expect(elapsed).toBeLessThan(33);
 }
 expect(staff).not.toHaveBeenCalled();expect(training).not.toHaveBeenCalled();
 for(let i=0;i<5;i++)updateGame(state,.1,{up:false,down:false,left:false,right:false});
 expect(staff).toHaveBeenCalled();expect(state.units.some(u=>u.builder)).toBe(true);expect(state.time).toBe(0);
 staff.mockRestore();training.mockRestore();
});
it('makes bridge tiles on fords free while ordinary water still costs gold',()=>{
 const state=scoutRealm();state.world.tiles[10*44+10].terrain='river';state.world.tiles[10*44+10].overlay='ford';
 expect(buildCostAt(state,'bridge',10,10).gold).toBe(0);expect(buildCostAt(state,'bridge',11,10).gold).toBeGreaterThan(0);
});
it('keeps AI guard posts funded at zero gold and charges no tower upkeep',()=>{
 const state=scoutRealm();state.factions.push({...state.factions[0],id:1,gold:0,population:20,relation:'war'});
 const city={id:500,kind:'palace' as const,faction:1,x:10,y:10,hp:600,maxHp:600,capacity:20,unhousedResidents:20};
 const post:import('../src/game/types').Building={...city,id:501,kind:'guardPost' as const,x:12,y:12};entityStore(state).buildings.replace([city,post]);
 updateGuardPosts(state,{hostile:(a,b)=>a!==b});state.time=61;updateGuardPosts(state,{hostile:(a,b)=>a!==b});
 expect(post.guardPost?.funded).toBe(true);expect(state.factions[1].gold).toBe(0);
 expect(buildingMaintenance(state,{...post,kind:'woodenTower'})).toBe(0);
});
it('keeps dense-city placement and each follow-up phase inside the frame budget',async()=>{
 const {denseConstructionFixture}=await import('./helpers/construction-preview');
 const state=denseConstructionFixture();Object.assign(state.units[0],{x:82.5,y:72.5});
 const samples:number[]=[];
 for(const [kind,x,y] of [['well',82,72],['guardPost',82,74]] as const){
  expect(validateBuildAt(state,kind,x,y).ok).toBe(true);
  const start=performance.now();expect(buildAt(state,kind,x,y).ok).toBe(true);samples.push(performance.now()-start);
 }
 const phases:number[]=[];for(let i=0;i<8;i++){const start=performance.now();const work=advanceConstructionReconciliation(state);phases.push(performance.now()-start);if(!work)break;}
 console.log('Dense placement ms',samples,'follow-up phases ms',phases);expect(Math.max(...samples,...phases)).toBeLessThan(33);
});
