import {it,expect} from 'vitest';
import {scoutRealm} from './helpers/scouts';
import {entityStore} from '../src/game/entity-store';
import {beginSeaInvasion,updateSeaRaids,updateSeaRetreat,seaMusterGoal} from '../src/game/sea-raids';
import {updateGame} from '../src/game/simulation';
import {unitAttack,unitDefense} from '../src/game/veterancy';
import {distance,type GameState} from '../src/game/types';
function fixture(){const state=scoutRealm();state.world.width=64;state.world.height=48;state.world.tiles=Array.from({length:64*48},(_,i)=>({...state.world.tiles[0],terrain:i%64<30?'coast' as const:'grassland' as const}));
 const city={id:500,kind:'palace' as const,faction:0,x:48,y:24,hp:10000,maxHp:10000,capacity:4,governorPermissions:{farms:false,housing:false}};
 entityStore(state).buildings.replace([city]);for(const u of state.units){u.x=50+u.id%3;u.y=25;u.attack=20;u.defense=10;}
 state.factions[0].population=20;return {state,city};}
it('lands a fleet carrying the defending army plus 50 and collapses only after leader and ships die',()=>{
 const {state,city}=fixture();const invasion=beginSeaInvasion(state,city,{x:30.5,y:24.5},{x:6.5,y:24.5});expect(invasion.total).toBe(54);
 for(let i=0;i<1800;i++){
  state.time+=.1;updateSeaRaids(state,.1);
  // Troops clear the beach into their actual muster goals; fleet navigation is real.
  for(const u of state.units)if(u.seaInvasion===invasion.id&&u.kind!=='sailboat'){const goal=seaMusterGoal(state,u),d=distance(u,goal),step=Math.min(d,.32);if(d){u.x+=(goal.x-u.x)*step/d;u.y+=(goal.y-u.y)*step/d;}}
 }
 expect(invasion.stage,JSON.stringify({invasion,boats:state.units.filter(u=>u.kind==='sailboat')})).toBe('landed');
 const troops=state.units.filter(u=>u.seaInvasion===invasion.id&&u.kind!=='sailboat');expect(troops).toHaveLength(54);expect(invasion.packs.length).toBe(3);
 expect(troops.every(u=>Math.abs(unitAttack(u)-14)<.01&&Math.abs(unitDefense(u)-10)<.01)).toBe(true);
 const leader=state.units.find(u=>u.id===invasion.leader)!;leader.hp=0;updateSeaRaids(state,.1);expect(invasion.stage).toBe('landed');
 for(const b of invasion.boats)state.units.find(u=>u.id===b.id)!.hp=0;updateSeaRaids(state,.1);expect(invasion.stage).toBe('collapsed');
 const survivor=troops.find(u=>u.hp>0)!;survivor.morale=100;expect(updateSeaRetreat(state,survivor,.1,()=>{})).toBe(true);expect(survivor.morale).toBe(0);
});
it('waits for population and time thresholds before creating a fleet',()=>{const {state}=fixture();state.time=400;updateSeaRaids(state,.1);expect(state.seaRaids?.invasions).toEqual([]);state.time=500;updateSeaRaids(state,.1);expect(state.seaRaids?.invasions).toEqual([]);});
it('forms multiple armies in the full simulation after a coordinated landing',()=>{
 const {state,city}=fixture();state.units[0].hp=state.units[0].maxHp=100000;state.units[0].attack=0;
 const invasion=beginSeaInvasion(state,city,{x:30.5,y:24.5},{x:6.5,y:24.5}),formed=new Set<number>();
 for(let i=0;i<900;i++){
  updateGame(state,.1,{up:false,down:false,left:false,right:false});
  for(const u of state.units)if(u.seaInvasion===invasion.id&&u.infantryFormation?.active)formed.add(u.id);
 }
 expect(invasion.stage,JSON.stringify(invasion)).toBe('landed');expect(formed.size).toBeGreaterThanOrEqual(2);
});
it('discovers a reachable coast incrementally once a city grows to 100 residents',()=>{
 const {state}=fixture();state.time=480;state.factions[0].population=100;
 updateSeaRaids(state,.1);expect(state.seaRaids!.invasions).toHaveLength(0);
 for(let i=0;i<20;i++){state.time+=.1;updateSeaRaids(state,.1);}
 expect(state.seaRaids!.invasions).toHaveLength(1);expect(state.seaRaids!.invasions[0].boats.length).toBeGreaterThan(0);
});
it('carries a large army without dropping troops when all beach berths are assigned',()=>{
 const {state,city}=fixture(),template=state.units[1];
 entityStore(state).units.add(...Array.from({length:116},(_,i)=>({...template,id:1000+i,x:55+i%4,y:20+Math.floor(i/4)%8})));
 const invasion=beginSeaInvasion(state,city,{x:30.5,y:24.5},{x:6.5,y:24.5});expect(invasion.total).toBe(170);
 let worst=0;
 for(let i=0;i<1500;i++){
  state.time+=.1;const start=performance.now();updateSeaRaids(state,.1);worst=Math.max(worst,performance.now()-start);
  for(const u of state.units)if(u.seaInvasion===invasion.id&&u.kind!=='sailboat'){const goal=seaMusterGoal(state,u),d=distance(u,goal),step=Math.min(d,.32);if(d){u.x+=(goal.x-u.x)*step/d;u.y+=(goal.y-u.y)*step/d;}}
 }
 expect(invasion.stage).toBe('landed');expect(invasion.boats).toHaveLength(6);expect(state.units.filter(u=>u.seaInvasion===invasion.id&&u.kind!=='sailboat')).toHaveLength(170);
 console.log('170-troop invasion worst fleet update ms',worst);
});
