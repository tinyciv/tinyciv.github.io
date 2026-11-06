import { entityStore } from '../../src/game/entity-store';
import { synchronizeFarms } from '../../src/game/farms';
import { RESEARCH_BRANCHES } from '../../src/game/research';
import type { GameState, Building } from '../../src/game/types';
export function denseConstructionFixture(): GameState {
 const s: GameState = { world: {width:192,height:144,revision:0,seed:'dense-construction',source:'fixture',spawns:[],tiles:Array.from({length:192*144},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:2,production:0,gold:0,variation:.5}))},
 buildings:[{id:1,kind:'palace',faction:0,x:78,y:70,hp:650,maxHp:650,capacity:1000,unhousedResidents:320}],
 units:[{id:2,kind:'leader',faction:0,x:91.5,y:70.5,hp:100,maxHp:100,morale:100,attack:25,defense:5,speed:3.6,range:4,order:'hold',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0}],
 fields:[], factions:[{id:0,name:'Rome',color:'#f00',affinity:100,relation:'self',food:1000,gold:10000,production:0,population:320,culture:100000,yields:{food:0,gold:0,production:0},nextRaid:Infinity,defeated:false,research:{focus:'wall',levels:Object.fromEntries(RESEARCH_BRANCHES.map(b=>[b.id,1])),progress:{}}}],
 time:30,tick:1,paused:true,speed:1,events:[],particles:[],selected:null,selectedType:null,buildMode:null,diplomacy:null,gameOver:false,victory:false,seed:'dense-construction',rngState:1 };
 let id=10; const add=(kind:Building['kind'],x:number,y:number)=>entityStore(s).buildings.add({id:id++,kind,faction:0,x,y,hp:100,maxHp:100,capacity:0});
 add('road',83,69); s.world.tiles[67*192+83].terrain='river';
 for(let by=0;by<4;by++)for(let bx=0;bx<5;bx++)for(let y=0;y<4;y++)for(let x=0;x<4;x++) add('camp',84+bx*5+x,68+by*5+y);
 for(let y=5;y<125;y+=3)for(let x=5;x<60;x+=3)add('road',x,y);
 for(let i=0;i<300;i++)entityStore(s).units.add({...s.units[0],id:3000+i,kind:'warrior',x:65+i%20,y:45+Math.floor(i/20),faction:0});
 synchronizeFarms(s); return s;
}