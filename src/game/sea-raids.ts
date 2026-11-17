import { entityStore } from './entity-store';
import { armyAverages, armySoldier } from './raider-technology';
import { unitAttack, unitDefense } from './veterancy';
import { sailingNavigation, sailingPath, updateSailingVessel } from './sailing';
import { canWalk, findPath } from './pathfinding';
import { refreshIndexedUnit } from './spatial';
import { banditIntensity } from './bandit-intensity';
import { raiderMayAttack } from './raider-aggression';
import { rustEngine } from './rust-engine';
import { refreshFogUnit } from './fog';
import { buildingReady, distance, type Building, type GameState, type Point, type Unit } from './types';

export const SEA_RAID_MIN_POPULATION = 100;
export const SEA_RAID_FIRST_SECONDS = 480;
export const SEA_RAID_CAPACITY = rustEngine.barbarian_galley_constant(0);
export const SEA_RAID_COLOR = '#a4a8ad';
interface Transport { id:number; shore:Point; berth:Point; cargo:number; arrived:boolean; nextUnloadAt:number }
export interface SeaInvasion {
 id:number; faction:number; target:number; boats:Transport[]; packs:number[]; leader?:number; total:number;
 attack:number; defense:number; hp:number; landing:Point; origin:Point; remaining:number; nextPlanAt:number;
 stage:'launching'|'sailing'|'landed'|'collapsed'; nextStrategyAt:number; startedAt:number;
}
export interface SeaRaidState { nextAt:number; sequence:number; invasions:SeaInvasion[] }
const directions=[[0,-1],[1,0],[0,1],[-1,0]];
const center=(b:Building):Point=>({x:b.x+1,y:b.y+1});
const newId=(state:GameState):number=>entityStore(state).allocateId();
const hull=(id:number,p:Point,invasion:number):Unit=>({id,kind:'sailboat',faction:-2,...p,hp:rustEngine.barbarian_galley_constant(3),maxHp:rustEngine.barbarian_galley_constant(3),attack:0,defense:6,
 morale:100,speed:rustEngine.barbarian_galley_constant(4),range:rustEngine.barbarian_galley_constant(1),order:'hold',cooldown:0,lastCombat:-100,moving:false,facing:0,attackTime:0,
 seaInvasion:invasion,sailboat:{dock:-1},barbarianGalley:{}});
interface CoastSearch { city:number; cursor:number; candidates:{shore:Point;berth:Point;score:number}[] }
const searches=new WeakMap<GameState,CoastSearch>();
/** At most 512 tiles per update. Coast discovery never runs a whole-world
 * search in the spawn/click frame, and each ship gets its route on a later turn. */
function chooseCoast(state:GameState,city:Building):{shore:Point;origin:Point}|undefined|null {
 let search=searches.get(state);
 if(!search||search.city!==city.id){search={city:city.id,cursor:0,candidates:[]};searches.set(state,search);}
 const nav=sailingNavigation(state,undefined,false,true),w=state.world.width;
 for(let i=0;i<512&&search.cursor<state.world.tiles.length;i++,search.cursor++){
  const cell=search.cursor,tile=state.world.tiles[cell];
  if(tile.terrain!=='coast'&&tile.terrain!=='ocean')continue;
  const berth={x:cell%w+.5,y:Math.floor(cell/w)+.5};
  if(distance(berth,center(city))>70||!nav.position(berth,0)||!nav.position(berth,Math.PI/2))continue;
  for(const [dx,dy] of directions){const shore={x:berth.x+dx*2,y:berth.y+dy*2};
   if(canWalk(state,shore.x,shore.y,-2)){search.candidates.push({shore,berth,score:distance(shore,center(city))});break;}
  }
 }
 if(search.cursor<state.world.tiles.length)return null;
 searches.delete(state);
 // Retry a small number of beaches; the army must be able to approach the city.
 for(const candidate of search.candidates.sort((a,b)=>a.score-b.score).slice(0,6)){
  const route=findPath(state,candidate.shore,center(city),-2,true);
  if(!route.length||distance(route.at(-1)!,center(city))>8)continue;
  // An offshore origin and a valid water route prevent lake/island teleports.
  for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
   const origin={x:candidate.berth.x+dx*24,y:candidate.berth.y+dy*24};
   if(!nav.position(origin,0))continue;
   if(sailingPath(state,hull(-1,origin,-1),candidate.berth,false,true).length)return {shore:candidate.shore,origin};
  }
 }
 return undefined;
}
export function beginSeaInvasion(state:GameState,city:Building,landing:Point,origin:Point):SeaInvasion {
 const clock=state.seaRaids??={nextAt:SEA_RAID_FIRST_SECONDS,sequence:0,invasions:[]};
 const army=state.units.filter(u=>u.faction===city.faction&&armySoldier(u));
 const averages=armyAverages(state,army),total=rustEngine.barbarian_galley_fleet(army.length);
 const invasion:SeaInvasion={id:++clock.sequence,faction:city.faction,target:city.id,boats:[],packs:[],total,
  ...averages,landing,origin,remaining:total,nextPlanAt:state.time,stage:'launching',nextStrategyAt:state.time,startedAt:state.time};
 clock.invasions.push(invasion);return invasion;
}
function launchTransport(state:GameState,invasion:SeaInvasion):boolean {
 const nav=sailingNavigation(state,undefined,false,true),index=invasion.boats.length;
 const occupied=state.units.filter(u=>u.kind==='sailboat'&&u.hp>0);
 let launch:Point|undefined,berth:Point|undefined,shore:Point|undefined;
 for(let r=0;r<=12&&!launch;r+=3)for(let dy=-r;dy<=r&&!launch;dy+=3)for(let dx=-r;dx<=r&&!launch;dx+=3){
  const p={x:invasion.origin.x+dx,y:invasion.origin.y+dy};
  if(nav.position(p,0)&&occupied.every(u=>distance(u,p)>2.5))launch=p;
 }
 const candidates:{p:Point;shore:Point;score:number}[]=[];
 for(let y=-12;y<=12;y++)for(let x=-12;x<=12;x++){
  const p={x:invasion.landing.x+x,y:invasion.landing.y+y};
  if(!nav.position(p,0)||!nav.position(p,Math.PI/2)||invasion.boats.some(b=>distance(b.berth,p)<3))continue;
  for(const [dx,dy]of directions){const land={x:p.x+dx*2,y:p.y+dy*2};
   if(canWalk(state,land.x,land.y,-2)){candidates.push({p,shore:land,score:distance(p,invasion.landing)});break;}}
 }
 if(!launch)return false;
 const boat=hull(newId(state),launch,invasion.id);
 for(const candidate of candidates.sort((a,b)=>a.score-b.score).slice(0,6)){
  const path=sailingPath(state,boat,candidate.p,false,true);
  if(path.length){boat.path=path;boat.destination=candidate.p;berth=candidate.p;shore=candidate.shore;break;}
 }
 if(!berth||!shore)return false;
 const cargo=Math.min(SEA_RAID_CAPACITY,invasion.remaining);invasion.remaining-=cargo;
 entityStore(state).units.add(boat);
 invasion.boats.push({id:boat.id,shore,berth,cargo,arrived:false,nextUnloadAt:state.time});
 embarkArcher(state,invasion,boat);
 if(index===0)state.events.unshift({id:(state.events[0]?.id??0)+1,time:state.time,text:'Gray sails sighted! A sea invasion is approaching. Muster your levy.',kind:'warning'});
 return true;
}
function embarkArcher(state:GameState,invasion:SeaInvasion,boat:Unit):void {
 const point={x:boat.x,y:boat.y},group=0;
 let pack=state.marauderPacks?.find(p=>p.id===invasion.packs[group]);
 if(!pack){const id=Math.max(0,...(state.marauderPacks??[]).map(p=>p.id))+1;
  pack={id,name:'Sea raiders',color:SEA_RAID_COLOR,targetFaction:invasion.faction,targetBuilding:invasion.target,
   home:invasion.landing,waypoint:invasion.landing,nextWanderAt:state.time+60,raid:true,motivation:'assault',phase:'muster',
   spawnedAt:state.time,seaInvasion:invasion.id};(state.marauderPacks??=[]).push(pack);invasion.packs[group]=id;}
 const commander=pack.leaderId===undefined;
 const unit:Unit={id:newId(state),kind:'archer',faction:-2,...point,
  hp:invasion.hp,maxHp:invasion.hp,attack:17,defense:4,morale:100,speed:3.2,range:rustEngine.barbarian_galley_constant(1),
  order:'raid',cooldown:0,lastCombat:-100,moving:false,facing:0,attackTime:0,marauderPack:pack.id,seaInvasion:invasion.id,
  marauderLeader:commander||undefined,inside:true,embarkedOn:boat.id};
 unit.raiderBonus={attack:Math.max(0,invasion.attack-unitAttack(unit)),defense:Math.max(0,invasion.defense-unitDefense(unit))};
 if(commander){pack.leaderId=unit.id;invasion.leader??=unit.id;pack.startingTroops=invasion.total-1;}
 entityStore(state).units.add(unit);boat.sailboat!.passenger=unit.id;
}
function unload(state:GameState,invasion:SeaInvasion,transport:Transport):void {
 if(!transport.cargo||state.time<transport.nextUnloadAt)return;
 const boat=entityStore(state).units.get(transport.id),archer=entityStore(state).units.get(boat?.sailboat?.passenger??-1);
 if(!boat||!archer||archer.hp<=0){transport.cargo=0;return;}
 const candidates=[transport.shore,...directions.map(([dx,dy])=>({x:transport.shore.x+dx,y:transport.shore.y+dy}))];
 const point=candidates.find(p=>!!rustEngine.galley_landing(boat.x,boat.y,boat.facing,p.x,p.y)&&canWalk(state,p.x,p.y,-2)&&!state.units.some(u=>u.hp>0&&!u.inside&&distance(u,p)<.7));
 if(!point)return;
 Object.assign(archer,point,{inside:false,embarkedOn:undefined});boat.sailboat!.passenger=undefined;
 refreshIndexedUnit(state,archer);refreshFogUnit(state,archer);transport.cargo=0;
}
export function seaInvasionFor(state:GameState,unit:Unit):SeaInvasion|undefined {return state.seaRaids?.invasions.find(i=>i.id===unit.seaInvasion);}
export function updateSeaRaids(state:GameState,dt:number):void {
 const clock=state.seaRaids??={nextAt:SEA_RAID_FIRST_SECONDS,sequence:0,invasions:[]};
 if(state.time>=clock.nextAt&&banditIntensity(state)>0&&!clock.invasions.some(i=>i.stage!=='collapsed')){
  const cities=state.buildings.filter(b=>raiderMayAttack(state,b.faction)&&b.kind==='palace'&&buildingReady(b)&&state.factions.some(f=>f.id===b.faction&&!f.defeated&&f.villageId===undefined&&f.population>=SEA_RAID_MIN_POPULATION));
  const city=cities.sort((a,b)=>a.id-b.id)[clock.sequence%Math.max(1,cities.length)];
  if(!city)clock.nextAt=state.time+60;
  else {const coast=chooseCoast(state,city);if(coast!==null){clock.nextAt=state.time+(coast?Math.max(360,600-Math.max(0,(state.factions.find(f=>f.id===city.faction)?.population??100)-100)):60);if(coast)beginSeaInvasion(state,city,coast.shore,coast.origin);}}
 }
 for(const invasion of clock.invasions){
  const store=entityStore(state),livingBoats=invasion.boats.map(t=>store.units.get(t.id)).filter((u):u is Unit=>!!u&&u.hp>0);
  const leader=invasion.leader===undefined?undefined:store.units.get(invasion.leader);
  if(invasion.stage!=='collapsed'&&invasion.stage!=='launching'&&!livingBoats.length&&(!leader||leader.hp<=0)){
   invasion.stage='collapsed';invasion.remaining=0;
   for(const u of state.units)if(u.seaInvasion===invasion.id&&u.kind!=='sailboat'){u.morale=0;u.routed=true;u.order='flee';u.target=undefined;u.infantryDrillLeader=undefined;if(u.infantryFormation)u.infantryFormation.active=false;}
  }
  if(invasion.stage==='collapsed')continue;
  if(invasion.stage==='launching'&&state.time>=invasion.nextPlanAt){
   invasion.nextPlanAt=state.time+1;
   if(!launchTransport(state,invasion)){invasion.nextPlanAt=state.time+5;if(!invasion.boats.length&&state.time-invasion.startedAt>30){invasion.stage='collapsed';continue;}}
   if(!invasion.remaining)invasion.stage='sailing';
  }
  for(const transport of invasion.boats){
   const boat=store.units.get(transport.id);if(!boat||boat.hp<=0){transport.cargo=0;continue;}
   if(!transport.arrived){
    // Ships keep the fleet close instead of racing to individual beaches.
    // A straggler whose route is blocked (often by the fleet waiting for it)
    // must not hold the others back, or the fleet deadlocks in the channel.
    const slowest=Math.max(...livingBoats.filter(u=>u.destination&&!u.sailingRouteFailures).map(u=>distance(u,invasion.landing)),0);
    if(distance(boat,invasion.landing)>=slowest-8||distance(boat,invasion.landing)<12)updateSailingVessel(state,boat,dt);
    // A transport whose last stretch stays blocked (another hull parked in the
    // channel) lands where it is instead of searching for a route forever.
    transport.arrived=distance(boat,transport.berth)<.2||(boat.sailingRouteFailures??0)>=3&&distance(boat,transport.berth)<8;
    if(transport.arrived){boat.destination=undefined;boat.path=undefined;boat.moving=false;boat.sailboat!.velocity={x:0,y:0};}
    refreshIndexedUnit(state,boat);
   }
   if(transport.arrived)unload(state,invasion,transport);
  }
  if(!invasion.remaining&&invasion.boats.every(t=>!t.cargo))invasion.stage='landed';
  if(state.time>=invasion.nextStrategyAt){
   invasion.nextStrategyAt=state.time+3;
   const cities=state.buildings.filter(b=>b.kind==='palace'&&b.faction===invasion.faction&&buildingReady(b));
   for(const pack of state.marauderPacks??[])if(pack.seaInvasion===invasion.id){
    const commander=store.units.get(pack.leaderId??-1),from=commander??invasion.landing;
    const target=cities.sort((a,b)=>distance(a,from)-distance(b,from))[0];
    pack.targetBuilding=target?.id;pack.waypoint=target?center(target):invasion.landing;pack.phase=invasion.stage==='landed'?'attack':'muster';
    pack.returning=!target;pack.raid=true;
   }
  }
 }
}
/** Routing invasion troops never rejoin a camp or recover morale after the
 * command ship/leader defeat condition. Survivors withdraw to a living boat. */
export function updateSeaRetreat(state:GameState,unit:Unit,dt:number,move:(state:GameState,u:Unit,p:Point,dt:number)=>void):boolean {
 const invasion=seaInvasionFor(state,unit);if(!invasion||unit.kind==='sailboat')return false;
 if(invasion.stage!=='collapsed'&&unit.order!=='flee'&&!unit.marauderRetreating)return false;
 unit.morale=0;unit.order='flee';unit.routed=true;unit.infantryDrillLeader=undefined;if(unit.infantryFormation)unit.infantryFormation.active=false;
 const transports=invasion.boats.filter(t=>{const boat=entityStore(state).units.get(t.id);return boat&&boat.hp>0
   &&!!rustEngine.barbarian_galley_board(boat.sailboat?.passenger??-1,unit.id);});
 const refuge=transports.sort((a,b)=>distance(a.shore,unit)-distance(b.shore,unit))[0];
 if(refuge){if(distance(unit,refuge.shore)<.7){const boat=entityStore(state).units.get(refuge.id)!;
   unit.inside=true;unit.moving=false;unit.embarkedOn=boat.id;boat.sailboat!.passenger=unit.id;
   unit.x=boat.x;unit.y=boat.y;refreshIndexedUnit(state,unit);refreshFogUnit(state,unit);
 }else move(state,unit,refuge.shore,dt);}
 else {unit.moving=false;unit.target=undefined;}
 return true;
}

export function seaMusterGoal(state:GameState,unit:Unit):Point {
 const invasion=seaInvasionFor(state,unit);if(!invasion)return unit;
 const angle=Math.atan2(invasion.landing.y-invasion.origin.y,invasion.landing.x-invasion.origin.x);
 for(let row=0;row<4;row++){
  const forward=4+Math.floor(unit.id%24/6)+row,side=(unit.id%6-2.5)*1.1;
  const point={x:invasion.landing.x+Math.cos(angle)*forward-Math.sin(angle)*side,y:invasion.landing.y+Math.sin(angle)*forward+Math.cos(angle)*side};
  if(canWalk(state,point.x,point.y,unit.faction))return point;
 }
 return unit;
}
