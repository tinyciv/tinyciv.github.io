import { entityStore } from '../../src/game/entity-store';
import type { GameState, Point, Unit } from '../../src/game/types';
import { distance } from '../../src/game/types';
export type ScenarioName = 'Open melee' | 'Choke' | 'Obstacle flank' | 'Crossing traffic';
export const SCENARIOS: ScenarioName[] = ['Open melee', 'Choke', 'Obstacle flank', 'Crossing traffic'];
export interface Driver { updateGame: (state: GameState, dt: number, input: {up:boolean;down:boolean;left:boolean;right:boolean}) => void; moveUnit: (state: GameState, unit: Unit, goal: Point, dt: number) => void; updateFriendlyYield: (state: GameState, unit: Unit, dt: number) => boolean; }
const idle = { up: false, down: false, left: false, right: false };
export function scenario(name: ScenarioName): GameState {
  const width = 32, height = 24;
  const state: GameState = { world: { width, height, seed: `navigation:${name}`, source: 'Deterministic crowd test', spawns: [], revision: 1, tiles: Array.from({length:width*height},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:0,production:0,gold:0,variation:.5})) }, units: [], buildings: [{id:1,kind:'palace',faction:0,x:1,y:1,hp:10000,maxHp:10000,capacity:0}], factions: [{id:0,name:'Defenders',color:'#3988ff',affinity:100,relation:'self',food:500,gold:500,production:500,population:0,yields:{food:0,gold:0,production:0},nextRaid:Infinity,defeated:false}], fields:[], marauderPacks:[], time:0,tick:0,paused:false,speed:1,events:[],particles:[],selected:null,selectedType:null,buildMode:null,diplomacy:null,gameOver:false,victory:false,seed:name,rngState:12345 };
  let id=10;
  const add=(x:number,y:number,faction:number, kind:Unit['kind']='warrior'): Unit=>{ const unit:Unit={id:id++,x,y,kind,faction,hp:10000,morale:100,attack:17,defense:4,speed:3.6,range:1.1,order:'hold',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0};entityStore(state).units.add(unit);return unit; };
  add(2.5,4.5,0,'leader');
  const block=(x:number,y:number)=>state.world.tiles[y*width+x].terrain='lake';
  if(name==='Crossing traffic') {
    for(let lane=0;lane<3;lane++)for(let row=0;row<4;row++){
      const a=add(5.5+row,10.5+lane,0);a.destination={x:24.5-row,y:10.5+lane};
      const b=add(24.5-row,14.5+lane,0);b.destination={x:5.5+row,y:14.5+lane};
    }
    // Cross both streams diagonally, forcing shared cells and head-on traffic.
    for(const unit of state.units.slice(1)) unit.destination!.y = 27 - unit.y;
    return state;
  }
  if(name==='Choke')for(let y=4;y<22;y++)if(y!==12&&y!==13)block(16,y);
  if(name==='Obstacle flank')for(let y=8;y<17;y++)for(let x=15;x<18;x++)block(x,y);
  for(let row=0;row<4;row++)for(let col=0;col<3;col++){
    const unit=add(10.5-col,10.5+row,-2);unit.marauderPack=1;unit.order='wander';
  }
  for(let row=0;row<4;row++)for(let col=0;col<2;col++)add(20.5+col,10.5+row,0);
  // A fixed defensive response supplies the engagement waypoint. Free-roaming
  // bands now acquire settlement objectives instead of patrolling arbitrary points.
  state.marauderPacks=[{id:1,name:'Attackers',color:'#ed9d45',targetFaction:0,home:{x:10.5,y:12.5},waypoint:{x:20.5,y:12.5},nextWanderAt:Infinity,
    campDefense:true,defenseUntil:Number.MAX_SAFE_INTEGER}];
  return state;
}
export interface Metrics { arrived:number; engaged:number; meanEngaged:number; maxStall:number; stalledUnitSeconds:number; overlappingSamples:number; elapsed:number; }
export function tracker(state:GameState) {
 const tracked=state.units.filter(u=>u.kind!=='leader'&&(u.faction===-2||u.destination)), ids=new Set(tracked.map(u=>u.id)), stalled=new Map<number,number>(), touched=new Set<number>();let engagedSamples=0,frames=0,maxStall=0,stallSeconds=0,overlaps=0;
 return { sample(dt:number) {frames++;let engaged=0;const cells=new Set<number>();for(const unit of state.units){if(unit.inside||unit.hp<=0)continue;const cell=Math.floor(unit.y)*state.world.width+Math.floor(unit.x);if(cells.has(cell))overlaps++;cells.add(cell);if(!ids.has(unit.id))continue;const fighting=state.time-unit.lastCombat<1.1;if(fighting){touched.add(unit.id);engaged++;}const arrived=unit.destination&&distance(unit,unit.destination)<.2;const wait=!fighting&&!arrived&&!unit.moving;const duration=wait?(stalled.get(unit.id)??0)+dt:0;stalled.set(unit.id,duration);maxStall=Math.max(maxStall,duration);if(duration>1)stallSeconds+=dt;}engagedSamples+=engaged; }, result():Metrics{return{arrived:tracked.filter(u=>u.destination&&distance(u,u.destination)<.2).length,engaged:touched.size,meanEngaged:Math.round(engagedSamples/frames*100)/100,maxStall:Math.round(maxStall*100)/100,stalledUnitSeconds:Math.round(stallSeconds*100)/100,overlappingSamples:overlaps,elapsed:Math.round(state.time*10)/10};}};
}
export function step(state:GameState,name:ScenarioName,driver:Driver,dt=.1):void {
 if(name!=='Crossing traffic'){driver.updateGame(state,dt,idle);return;}
 state.time+=dt;for(const unit of state.units){unit.moving=false;if(!unit.destination)continue;if(!driver.updateFriendlyYield(state,unit,dt))driver.moveUnit(state,unit,unit.destination,dt);}
}
export function run(name:ScenarioName,driver:Driver,seconds=24){const state=scenario(name), stats=tracker(state);for(let i=0;i<seconds*10;i++){step(state,name,driver);stats.sample(.1);}return stats.result();}
