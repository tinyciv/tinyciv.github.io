import {it,expect} from 'vitest';
import {scoutRealm} from './helpers/scouts';
import {entityStore} from '../src/game/entity-store';
import {updateWallPatrol} from '../src/game/wall-patrols';
import {palaceEnclosures} from '../src/game/enclosures';
import {unitsCollide} from '../src/game/collisions';
import {updateGame} from '../src/game/simulation';
import type {Building,GameState,Unit,Point} from '../src/game/types';
function fixture(){const state=scoutRealm();
 const city:Building={id:500,kind:'palace',faction:0,x:10,y:10,hp:600,maxHp:600,capacity:20,unhousedResidents:20,governorPermissions:{housing:false,farms:false}};
 const post:Building={...city,id:501,kind:'guardPost',x:12,y:12,guardPost:{funded:true,nextUpkeepAt:30}};
 const walls:Building[]=[];let id=600;for(let y=6;y<=18;y++)for(let x=6;x<=18;x++)if(x===6||x===18||y===6||y===18)walls.push({...city,id:id++,kind:'wall',x,y});
 const gate=walls.find(w=>w.x===6&&w.y===10)!;
 const houses:Building[]=[[8,8],[16,8],[8,16],[16,16]].map(([x,y],i)=>({...city,id:950+i,kind:'house',x,y,capacity:0,unhousedResidents:undefined}));
 entityStore(state).buildings.replace([city,post,...houses,...walls,{...gate,id:900,kind:'road'}]);
 const guard:Unit={...state.units[1],id:1000,kind:'militia',guardPost:post.id,guardCity:city.id,x:6.5,y:10.5};entityStore(state).units.replace([{...state.units[0],x:11.5,y:14.5,attack:0},guard]);
 return {state,city,post,guard,gate,walls};}
const move=(_s:GameState,u:Unit,p:Point)=>{u.x=p.x;u.y=p.y;};
it('enters at a gateway, hides for three seconds, patrols stone and dies with its support',()=>{
 const {state,city,post,guard,gate}=fixture();expect(palaceEnclosures(state,true).regions.length).toBe(1);
 const update=()=>updateWallPatrol(state,guard,city,post,.1,move,()=>{},(a,b)=>a!==b);
 expect(update()).toBe(true);expect(guard.inside).toBe(true);expect(guard.wallPatrol?.gate).toBe(gate.id);
 state.time=2.9;update();expect(guard.inside).toBe(true);state.time=3;update();expect(guard.inside).toBe(false);expect(guard.range).toBe(5);
 expect(unitsCollide(guard,guard)).toBe(false);
 const support=state.buildings.find(b=>b.id===guard.wallPatrol?.wall)!;support.hp=0;update();expect(guard.hp).toBe(0);
});
it('does not allow wall patrols in open or palisade-only cities',()=>{const {state,city,post,guard,walls}=fixture();walls[5].kind='palisade';expect(updateWallPatrol(state,guard,city,post,.1,move,()=>{},()=>true)).toBe(false);});
it('shoots javelins outside the wall without leaving the parapet',()=>{
 const {state,city,post,guard}=fixture();state.factions[0].population=20;
 // The unit starts as an existing parapet guard; regular simulation handles the shot.
 const support=state.buildings.find(b=>b.kind==='wall'&&b.x===6&&b.y===10)!;
 guard.wallPatrol={gate:support.id,wall:support.id};guard.range=5;guard.attack=20;
 const enemy={...guard,id:1100,kind:'warrior' as const,faction:-2,x:3.5,guardPost:undefined,wallPatrol:undefined,hp:1000,maxHp:1000,attack:0,order:'hold' as const};entityStore(state).units.add(enemy);
 for(let i=0;i<20;i++)updateGame(state,.05,{up:false,down:false,left:false,right:false});
 expect(enemy.hp).toBeLessThan(1000);expect(guard.x).toBe(6.5);expect(guard.wallPatrol?.wall).toBe(support.id);
});

it('emerges from the gateway after three seconds during normal simulation',()=>{
 const {state,guard,gate}=fixture();state.factions[0].population=20;
 guard.wallPatrol={gate:gate.id};
 for(let i=0;i<82;i++)updateGame(state,.05,{up:false,down:false,left:false,right:false});
 expect({hp:guard.hp,inside:guard.inside,patrol:guard.wallPatrol,time:state.time,gameOver:state.gameOver}).toMatchObject({inside:false,patrol:{wall:expect.any(Number)}});
});
