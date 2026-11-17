import type { Building, GameState } from '../../src/game/types';
export const fixtureBuilding = (id:number, kind:Building['kind'], x:number,y:number, faction=0):Building => ({id,kind,x,y,faction,hp:250,maxHp:250,capacity:kind==='palace'?4:0});
export function riverFixture():GameState {
 const state:GameState={world:{width:40,height:28,seed:'river',source:'test',spawns:[],revision:1,tiles:Array.from({length:40*28},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:3,production:1,gold:0,variation:.5}))},
 buildings:[{...fixtureBuilding(1,'palace',7,7),governorPermissions:{farms:false,housing:false},populationGrowth:-10000}],
 units:[{id:100,kind:'leader',x:10.5,y:10.5,faction:0,hp:100,maxHp:100,morale:100,attack:0,defense:0,speed:3,range:1.1,order:'hold',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0}],
 factions:[{id:0,name:'Roma',color:'#f34f59',affinity:100,relation:'self',food:1000,gold:1000,production:0,population:20,yields:{food:0,gold:0,production:0},nextRaid:Infinity,nextRetinueAt:Infinity,defeated:false,research:{focus:'engineering',levels:{woodenTower:1,wall:1,engineering:1},progress:{},allocation:0}}],
 time:0,tick:0,paused:false,speed:1,events:[],particles:[],fields:[],selected:null,selectedType:null,buildMode:null,diplomacy:null,gameOver:false,victory:false,seed:'river',rngState:1,
 marauderPacks:[],raiderCamps:[],roamingMaraudersVersion:1,fogRaids:{nextAt:Infinity,waves:0,pressureVersion:2},wildlife:{herds:[],sequence:0,nextRespawnAt:Infinity,targetHerds:0}};
 for(let y=0;y<28;y++)state.world.tiles[y*40+12].terrain='river';
 return state;
}
