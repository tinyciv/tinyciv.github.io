import { describe, expect, it } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';
import { toggleInfantryFormation } from '../src/game/infantry-drill';
import { updateGame, recallRetinue, setRetinueStance } from '../src/game/simulation';
import { distance } from '../src/game/types';
const idle = {up:false,down:false,left:false,right:false};
function world(count = 40) {
 const state = scoutRealm(), leader=state.units[0], template=state.units[1];
 Object.assign(leader,{x:31.5,y:15.5,attack:0});
 const soldiers=Array.from({length:count},(_,i)=>({...template,id:10+i,x:5.5+i%8,y:8.5+Math.floor(i/8),retinueStance:'aggressive' as const,hp:1000,maxHp:1000}));
 entityStore(state).units.replace([leader,...soldiers]); entityStore(state).buildings.replace([{id:1000,kind:'palace',faction:0,x:2,y:25,hp:650,maxHp:650,capacity:4,governorPermissions:{farms:false,housing:false}}]);
 state.factions[0].research!.levels.infantryDrill=1;
 return {state,leader,soldiers};
}
function run(state:ReturnType<typeof world>['state'], seconds:number){for(let i=0;i<seconds*20;i++)updateGame(state,.05,idle);}
describe('retinue path scheduling and recruitment combat',()=>{
 it('lets every member of a large formation get a route through an urban choke',()=>{
  const {state,soldiers}=world();
  for(let y=0;y<32;y++)if(y<14||y>16) entityStore(state).buildings.add({id:200+y,kind:'wall',faction:0,x:20,y,hp:500,maxHp:500,capacity:0});
  expect(toggleInfantryFormation(state).ok).toBe(true);
  run(state,30);
  expect(soldiers.filter(u=>u.x>20).length,JSON.stringify(soldiers.map(u=>[u.id,u.x,u.y]))).toBe(40);
 });
 it.each(['recall', 'aggressive'] as const)('%s overrides an outbound training trip', command=>{
  const {state,leader,soldiers}=world(1), soldier=soldiers[0];
  entityStore(state).buildings.add({id:90,kind:'archeryRange',faction:0,x:2,y:2,hp:250,maxHp:250,capacity:0});
  soldier.training={range:90,role:'archer'};
  if(command==='recall')recallRetinue(state);else setRetinueStance(state,'aggressive');
  const before=distance(soldier,leader);run(state,4);
  expect(soldier.training).toBeUndefined();expect(distance(soldier,leader)).toBeLessThan(before-5);
 });
 it('cancels training when construction closes the route to its school',()=>{
  const {state,soldiers}=world(1), soldier=soldiers[0];
  entityStore(state).buildings.add({id:90,kind:'archeryRange',faction:0,x:2,y:2,hp:250,maxHp:250,capacity:0});
  soldier.training={range:90,role:'archer'};
  for(let y=1;y<=3;y++)for(let x=1;x<=4;x++)if(x===1||x===4||y===1||y===3)
    entityStore(state).buildings.add({id:300+y*10+x,kind:'wall',faction:0,x,y,hp:500,maxHp:500,capacity:0});
  const before={x:soldier.x,y:soldier.y};run(state,4);
  expect(soldier.training).toBeUndefined();expect(distance(soldier,before)).toBeGreaterThan(5);
 });
 it('aggressive soldiers abandon outbound training to defend against nearby enemies',()=>{
  const {state,soldiers}=world(1), soldier=soldiers[0];
  entityStore(state).buildings.add({id:90,kind:'archeryRange',faction:0,x:2,y:2,hp:250,maxHp:250,capacity:0});
  soldier.training={range:90,role:'archer'};
  const enemy={...soldier,training:undefined,id:100,faction:-2,x:soldier.x+2,y:soldier.y,attack:0,order:'hold' as const,cooldown:1000};
  entityStore(state).units.add(enemy);run(state,3);
  expect(soldier.training).toBeUndefined();expect(enemy.hp).toBeLessThan(1000);
 });
 it('aggressive reinforcements fight nearby enemies before reaching a distant Leader',()=>{
  const {state,soldiers}=world(1), soldier=soldiers[0];soldier.joiningRetinue=true;
  const enemy={...soldier,id:100,faction:-2,x:soldier.x+3,y:soldier.y,attack:0,joiningRetinue:false,order:'hold' as const,cooldown:1000};
  entityStore(state).units.add(enemy);run(state,3);
  expect(enemy.hp, JSON.stringify({soldier, enemy,gameOver:state.gameOver})).toBeLessThan(1000);expect(distance(soldier,enemy)).toBeLessThan(1.5);
 });
});
