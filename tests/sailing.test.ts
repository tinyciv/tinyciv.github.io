import { describe, expect, it } from 'vitest';
import { boardBoat, boardedBoat, canSail, commandSailingMove, disembarkLeader, orderBoardBoat, resolveSailingPassengers, sailingPath, updateSailboatLaunches, updateSailingLeader } from '../src/game/sailing';
import { commandMove, updateGame } from '../src/game/simulation';
import { applyGameCommand } from '../src/multiplayer/commands';
import { entityStore } from '../src/game/entity-store';
import { withPlayerFaction } from '../src/game/player-context';
import type { Building, GameState, InputState, Unit } from '../src/game/types';

const idle:InputState={up:false,down:false,left:false,right:false};
const leader=(id=1,faction=0):Unit=>({id,kind:'leader',faction,x:4.5,y:3.5,hp:100,maxHp:100,morale:100,attack:25,defense:5,speed:3.6,range:4,order:'hold',cooldown:0,lastCombat:-100,moving:false,facing:0,attackTime:0});
function fixture():GameState {
 const width=18,height=14;
 return {
  world:{width,height,seed:'sailing',source:'test',spawns:[],tiles:Array.from({length:width*height},(_,i)=>({terrain:Math.floor(i/width)<=3||Math.floor(i/width)>=10?'grassland':'coast',overlay:'none',elevation:.1,moisture:.5,food:1,production:0,gold:0,variation:.5}))},
  units:[leader()],buildings:[{id:20,kind:'dock',faction:0,x:5,y:3,dockFacing:2,hp:250,maxHp:250,capacity:0}],
  factions:[{id:0,name:'Player',color:'#3988ff',affinity:100,relation:'self',food:500,gold:2000,production:0,population:0,culture:0,yields:{food:0,production:0,gold:0},nextRaid:1e9,defeated:false,research:{focus:'sailing',levels:{sailing:1},progress:{}}}],
  time:0,tick:0,paused:false,speed:1,gameOver:false,victory:false,events:[],particles:[],selected:1,selectedType:'unit',buildMode:null,diplomacy:null,seed:'sailing',rngState:1,
  fields:[],raiderCamps:[],marauderPacks:[],villages:[],fogRaids:{nextAt:1e9,waves:0,pressureVersion:1},retinueStance:'hold',movementMode:'travel',
 } as GameState;
}
function launched(){const state=fixture();updateSailboatLaunches(state);return {state,captain:state.units[0],boat:state.units.find(u=>u.kind==='sailboat')!};}
function sailFor(state:GameState,captain:Unit,seconds:number,input=idle){for(let frame=0;frame<Math.round(seconds/.05);frame++){state.time+=.05;updateSailingLeader(state,captain,.05,input);}}

describe('sailboats and Leader transport',()=>{
 it('launches one adjacent boat after completion, retries blocked moorings and never replaces a sunk boat',()=>{
  const state=fixture(),dock=state.buildings[0];dock.construction={startedAt:0,duration:30};
  updateSailboatLaunches(state);expect(state.units).toHaveLength(1);delete dock.construction;
  const blockers:Unit[]=[{...leader(2),kind:'sailboat' as const,x:4.5,y:4.5},{...leader(3),kind:'sailboat' as const,x:6.5,y:4.5}];
  entityStore(state).units.add(...blockers);updateSailboatLaunches(state);expect(dock.dockBoatLaunched).not.toBe(true);
  entityStore(state).units.retain(u=>!blockers.includes(u));updateSailboatLaunches(state);
  const boat=state.units.find(u=>u.kind==='sailboat')!;expect(boat).toBeDefined();expect(boat.sailboat?.dock).toBe(dock.id);
  updateSailboatLaunches(state);expect(state.units.filter(u=>u.kind==='sailboat')).toHaveLength(1);
  boat.hp=0;entityStore(state).units.retain(u=>u.hp>0);updateSailboatLaunches(state);expect(state.units.some(u=>u.kind==='sailboat')).toBe(false);
 });
 it('boards only an empty friendly boat at a shore and retains the Leader identity',()=>{
  const {state,captain,boat}=launched();expect(boardBoat(state,boat,captain).ok).toBe(true);
  expect(captain.kind).toBe('leader');expect(captain.inside).toBe(true);expect(boardedBoat(state,captain)).toBe(boat);expect(state.selected).toBe(boat.id);
  expect(boardBoat(state,boat,leader(8,1)).ok).toBe(false);
 });
 it('walks to board from distant reachable land without teleporting',()=>{
  const {state,captain,boat}=launched();captain.x=1.5;
  const original={x:captain.x,y:captain.y};expect(orderBoardBoat(state,boat,captain).ok).toBe(true);
  expect({x:captain.x,y:captain.y}).toEqual(original);expect(captain.boardingBoat).toBe(boat.id);expect(captain.embarkedOn).toBeUndefined();expect(captain.path?.length).toBeGreaterThan(0);
 });
 it('completes a distant boarding order through ordinary simulation movement',()=>{
  const {state,captain,boat}=launched();captain.x=1.5;
  entityStore(state).buildings.add({id:100,kind:'palace',faction:0,x:1,y:0,hp:650,maxHp:650,capacity:0,governorPermissions:{farms:false,housing:false}});
  expect(commandMove(state,boat.x,boat.y)).toBe(true);expect(captain.embarkedOn).toBeUndefined();
  updateGame(state,2,idle);
  expect(captain.embarkedOn).toBe(boat.id);expect(captain.inside).toBe(true);expect(captain.x).toBe(boat.x);
 });
 it('sails around islands, and does not cross land, bridge decks or the jetty',()=>{
  const {state,captain,boat}=launched();boardBoat(state,boat,captain);
  for(let y=4;y<8;y++)state.world.tiles[y*18+8].terrain='grassland';
  const path=sailingPath(state,boat,{x:12.5,y:5.5});expect(path.length).toBeGreaterThan(0);expect(path.every(p=>canSail(state,p,boat))).toBe(true);
  expect(canSail(state,{x:5.5,y:4.5},boat)).toBe(false);
  entityStore(state).buildings.add({id:99,kind:'bridge',faction:0,x:7,y:5,hp:100,maxHp:100,capacity:0});
  expect(canSail(state,{x:7.5,y:5.5},boat)).toBe(false);
  expect(commandSailingMove(state,captain,{x:12.5,y:5.5}).ok).toBe(true);sailFor(state,captain,8);
  expect(boat.x).toBeCloseTo(12.5,1);expect(boat.y).toBeCloseTo(5.5,1);expect(captain.x).toBe(boat.x);
 });
 it('launches and boards on a level plateau lake without sailing across cliff drops',()=>{
  const state=fixture();for(const tile of state.world.tiles)tile.ridge=1;
  updateSailboatLaunches(state);const captain=state.units[0],boat=state.units.find(u=>u.kind==='sailboat')!;
  expect(boat).toBeDefined();expect(boardBoat(state,boat,captain).ok).toBe(true);
  expect(sailingPath(state,boat,{x:12.5,y:8.5}).length).toBeGreaterThan(0);
  for(let x=0;x<state.world.width;x++)delete state.world.tiles[7*state.world.width+x].ridge;
  expect(sailingPath(state,boat,{x:12.5,y:8.5})).toEqual([]);
 });
 it('treats waterfall faces as barriers in both directions while keeping the level river reaches open',()=>{
  const {state,boat}=launched();
  for(let y=4;y<10;y++)for(let x=0;x<state.world.width;x++)Object.assign(state.world.tiles[y*state.world.width+x],{terrain:'river',riverArt:'banked'});
  expect(sailingPath(state,boat,{x:12.5,y:8.5}).length).toBeGreaterThan(0);
  for(let x=0;x<state.world.width;x++)state.world.tiles[7*state.world.width+x].waterfall='south';
  expect(canSail(state,{x:8.5,y:7.5},boat)).toBe(false);
  expect(sailingPath(state,boat,{x:12.5,y:8.5})).toEqual([]);
  expect(sailingPath(state,boat,{x:12.5,y:5.5}).length).toBeGreaterThan(0);
  boat.y=8.5;
  expect(sailingPath(state,boat,{x:4.5,y:5.5})).toEqual([]);
 });
 it('keyboard steering stays in water, and a distant shore order sails there before disembarking',()=>{
  const {state,captain,boat}=launched();boardBoat(state,boat,captain);boat.facing=-Math.PI/2;
  sailFor(state,captain,1,{...idle,up:true});expect(boat.y).toBeGreaterThanOrEqual(4.2);expect(captain.inside).toBe(true);
  expect(commandSailingMove(state,captain,{x:12.5,y:10.5}).ok).toBe(true);
  expect(captain.inside).toBe(true);expect(captain.y).toBeLessThan(5);
  sailFor(state,captain,8);expect(captain.inside).toBe(false);expect(captain.embarkedOn).toBeUndefined();expect(captain.x).toBe(12.5);expect(captain.y).toBe(10.5);
  expect(boat.sailboat?.passenger).toBeUndefined();expect(boat.y).toBeLessThan(10);expect(state.selected).toBe(captain.id);
  expect(boardBoat(state,boat,captain).ok).toBe(true);
 });
 it('cannot disembark onto inland ground, blocked tiles, cliffs or distant land',()=>{
  const {state,captain,boat}=launched();boardBoat(state,boat,captain);
  expect(disembarkLeader(state,{x:4.5,y:1.5},captain).ok).toBe(false);
  expect(disembarkLeader(state,{x:5.5,y:3.5},captain).ok).toBe(false);
  expect(disembarkLeader(state,{x:4.5,y:10.5},captain).ok).toBe(false);
  expect(captain.embarkedOn).toBe(boat.id);
 });
 it('does not board or disembark diagonally through a blocked corner',()=>{
  const {state,captain,boat}=launched();captain.x=3.5;captain.y=3.5;
  const walls:Building[]=[{id:80,kind:'wall' as const,faction:0,x:4,y:3,hp:100,maxHp:100,capacity:0},
    {id:81,kind:'wall' as const,faction:0,x:3,y:4,hp:100,maxHp:100,capacity:0}];
  entityStore(state).buildings.add(...walls);expect(boardBoat(state,boat,captain).ok).toBe(false);
  entityStore(state).buildings.retain(b=>!walls.includes(b));expect(boardBoat(state,boat,captain).ok).toBe(true);
  entityStore(state).buildings.add(...walls);expect(disembarkLeader(state,{x:3.5,y:3.5},captain).ok).toBe(false);
  expect(captain.embarkedOn).toBe(boat.id);
 });
 it('dock demolition does not destroy its boat; sinking never leaves a hidden stranded passenger',()=>{
  const {state,captain,boat}=launched();boardBoat(state,boat,captain);entityStore(state).buildings.retain(()=>false);
  resolveSailingPassengers(state);expect(boardedBoat(state,captain)).toBe(boat);
  boat.hp=0;resolveSailingPassengers(state);expect(captain.hp).toBeGreaterThan(0);expect(captain.inside).toBe(false);expect(captain.y).toBeLessThan(4);
  const remote=launched();boardBoat(remote.state,remote.boat,remote.captain);remote.boat.y=7.5;remote.captain.y=7.5;remote.boat.hp=0;
  resolveSailingPassengers(remote.state);expect(remote.captain.hp).toBe(0);expect(remote.captain.inside).toBe(false);expect(remote.captain.embarkedOn).toBeUndefined();
 });
 it('existing move commands board and sail for the authenticated faction only',()=>{
  const {state,captain,boat}=launched();expect(commandMove(state,boat.x,boat.y)).toBe(true);expect(captain.embarkedOn).toBe(boat.id);
  const rival=leader(60,1);rival.x=6.5;entityStore(state).units.add(rival);state.factions.push({...state.factions[0],id:1,name:'Guest',relation:'war'});
  state.multiplayer={humanFactionIds:[0,1],inputs:{},controls:{},winner:null};
  expect(applyGameCommand(state,1,{type:'move',x:boat.x,y:boat.y}).ok).toBe(false);expect(rival.embarkedOn).toBeUndefined();
  expect(withPlayerFaction(state,0,()=>commandMove(state,10.5,7.5))).toBe(true);
  sailFor(state,captain,4);expect(captain.x).toBeCloseTo(10.5,1);expect(rival.x).toBe(6.5);
 });
 it('the full simulation keeps the Leader aboard and escorts ashore while directional input moves the boat',()=>{
  const {state,captain,boat}=launched();
  entityStore(state).buildings.add({id:100,kind:'palace',faction:0,x:1,y:0,hp:650,maxHp:650,capacity:0,governorPermissions:{farms:false,housing:false}});
  const escort={...leader(101),kind:'warrior' as const,x:3.5,y:3.5,order:'follow' as const};entityStore(state).units.add(escort);
  boardBoat(state,boat,captain);const old={x:escort.x,y:escort.y};
  updateGame(state,.5,{...idle,up:true});
  expect(boat.y).toBeGreaterThan(4.5);expect(captain.y).toBe(boat.y);expect(captain.inside).toBe(true);expect({x:escort.x,y:escort.y}).toEqual(old);
 });
});

describe('directional boat steering and momentum',()=>{
 function openSea(){
  const result=launched();boardBoat(result.state,result.boat,result.captain);
  const {state,boat,captain}=result;
  const tile=state.world.tiles[4*18];
  state.world={...state.world,width:80,height:60,revision:1,tiles:Array.from({length:80*60},()=>({...tile,terrain:'coast' as const}))};
  boat.x=captain.x=20.5;boat.y=captain.y=20.5;boat.facing=captain.facing=0;
  return result;
 }
 it('accelerates, coasts several tiles on release, then rests without endless drift',()=>{
  const {state,boat,captain}=openSea();
  sailFor(state,captain,.25,{...idle,up:true});
  expect(boat.x-20.5).toBeGreaterThan(.05);expect(boat.x-20.5).toBeLessThan(.2);
  expect(boat.sailboat!.velocity!.x).toBeCloseTo(.65);
  sailFor(state,captain,2,{...idle,up:true});expect(boat.sailboat!.velocity!.x).toBeCloseTo(4.5);
  const release=boat.x;sailFor(state,captain,1);
  expect(boat.x-release).toBeGreaterThan(3);expect(boat.sailboat!.velocity!.x).toBeGreaterThan(2.5);
  sailFor(state,captain,4);const rested=boat.x;
  expect(boat.sailboat!.velocity).toEqual({x:0,y:0});sailFor(state,captain,2);expect(boat.x).toBe(rested);
 });
 it('turns continuously with Q/E, carries momentum through a turn, and strafes without changing heading',()=>{
  const {state,boat,captain}=openSea();sailFor(state,captain,1,{...idle,up:true});
  const start={x:boat.x,y:boat.y};sailFor(state,captain,.4,{...idle,turnRight:true});
  expect(boat.facing).toBeCloseTo(.46);expect(captain.facing).toBe(boat.facing);
  expect(boat.x).toBeGreaterThan(start.x+.5);expect(boat.y).toBe(start.y);
  sailFor(state,captain,.2,{...idle,turnLeft:true});expect(boat.facing).toBeCloseTo(.23);
  const heading=boat.facing;sailFor(state,captain,.2,{...idle,turnLeft:true,turnRight:true});expect(boat.facing).toBeCloseTo(heading);
  boat.sailboat!.velocity={x:0,y:0};boat.facing=0;
  const x=boat.x,y=boat.y;sailFor(state,captain,.5,{...idle,right:true});
  expect(boat.x).toBeCloseTo(x);expect(boat.y).toBeGreaterThan(y+.2);expect(boat.facing).toBe(0);
 });
 it('reverse thrust brakes before backing up and both throttle directions stop faster than coasting',()=>{
  const reverse=openSea(),coast=openSea();
  for(const {state,boat,captain}of[reverse,coast]){boat.sailboat!.velocity={x:4.5,y:0};sailFor(state,captain,.75,state===reverse.state?{...idle,down:true}:idle);}
  expect(reverse.boat.x).toBeGreaterThan(20.5);expect(reverse.boat.x).toBeLessThan(coast.boat.x-.5);
  expect(reverse.boat.sailboat!.velocity!.x).toBeGreaterThan(0);
  sailFor(reverse.state,reverse.captain,1,{...idle,down:true});expect(reverse.boat.sailboat!.velocity!.x).toBeLessThan(0);
  reverse.boat.sailboat!.velocity={x:4.5,y:0};sailFor(reverse.state,reverse.captain,1.1,{...idle,up:true,down:true});
  expect(reverse.boat.sailboat!.velocity).toEqual({x:0,y:0});
 });
 it('sweeps coast momentum against land and bridges even on a long update',()=>{
  for(const barrier of ['land','bridge']as const){
   const {state,boat,captain}=openSea();
   for(let y=0;y<60;y++)if(barrier==='land')state.world.tiles[y*80+23].terrain='grassland';
   else entityStore(state).buildings.add({id:300+y,kind:'bridge',faction:0,x:23,y,hp:100,maxHp:100,capacity:0});
   boat.sailboat!.velocity={x:4.5,y:0};state.time+=2;updateSailingLeader(state,captain,2,idle);
   expect(boat.x).toBeGreaterThan(22);expect(boat.x).toBeLessThanOrEqual(22.8);expect(canSail(state,boat,boat)).toBe(true);
   expect(captain.x).toBe(boat.x);expect(boat.sailboat!.velocity!.x).toBe(0);
  }
 });
 it('autopilots through two sharp bends in a two-tile river without cutting its banks or circling at arrival',()=>{
  const {state,boat,captain}=openSea();
  for(let y=0;y<60;y++)for(let x=0;x<80;x++)state.world.tiles[y*80+x].terrain=
   (x>=10&&x<=35&&y>=10&&y<=11)||(x>=34&&x<=35&&y>=10&&y<=35)||(x>=20&&x<=35&&y>=34&&y<=35)?'river':'grassland';
  boat.x=captain.x=11.5;boat.y=captain.y=10.5;const goal={x:21.5,y:34.5};
  expect(commandSailingMove(state,captain,goal).ok).toBe(true);
  let seconds=0;
  while(boat.destination&&seconds<60){state.time+=.05;updateSailingLeader(state,captain,.05,idle);seconds+=.05;expect(canSail(state,boat,boat)).toBe(true);}
  expect(seconds).toBeLessThan(60);expect(boat.x).toBeCloseTo(goal.x,2);expect(boat.y).toBeCloseTo(goal.y,2);
  const position={x:boat.x,y:boat.y};sailFor(state,captain,3);expect({x:boat.x,y:boat.y}).toEqual(position);
 });
 it('preserves heading and velocity through a saved state, and keeps Q/E independent of retinue orders',()=>{
  const {state,boat,captain}=openSea();sailFor(state,captain,.5,{...idle,up:true,turnRight:true});
  const loaded=JSON.parse(JSON.stringify(state))as GameState,loadedCaptain=loaded.units.find(u=>u.id===captain.id)!;
  const loadedBoat=loaded.units.find(u=>u.id===boat.id)!;
  expect(loadedBoat.sailboat!.velocity).toEqual(boat.sailboat!.velocity);
  const stance=loaded.retinueStance;sailFor(loaded,loadedCaptain,.4,{...idle,turnLeft:true});
  expect(loadedBoat.facing).toBeCloseTo(boat.facing-.46);expect(loaded.retinueStance).toBe(stance);
 });
});
