import TinyQueue from 'tinyqueue';
import { dockBerth, dockMoorings, dockShoreCrossingClear, DOCK_DIRECTIONS } from './dock';
import { canTraverseEdge, canWalk, findPath } from './pathfinding';
import { entityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { worldStructureRevision } from './world-revisions';
import { refreshIndexedUnit } from './spatial';
import { refreshFogUnit } from './fog';
import { navigableWaterCell } from './water-navigation';
import { isForbidden } from './forbidden-zones';
import { playerFaction } from './player-context';
import { buildingHeight, buildingWidth, buildingReady, distance, tileAt, WATER, type GameState, type InputState, type Point, type Unit } from './types';

export const SAILBOAT_SPEED = 4.5;
export const SAILBOAT_HP = 150;
export const SAILBOAT_ACCELERATION = 2.6;
export const SAILBOAT_BRAKING = 4.5;
export const SAILBOAT_COAST_DECELERATION = 1.4;
export const SAILBOAT_TURN_SPEED = 1.15;
const RADIUS = .2;
const directions = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
type SailingResult = { ok: boolean; message: string };
const key = (state: GameState, p: Point) => Math.floor(p.y) * state.world.width + Math.floor(p.x);
const center = (p: Point): Point => ({ x: Math.floor(p.x) + .5, y: Math.floor(p.y) + .5 });

interface SailingStructures {
  world: GameState['world']; store: ReturnType<typeof entityStore>; membership: number;
  topology: number; structures: number; blocked: ReadonlySet<number>;
}
const sailingStructures = new WeakMap<GameState, SailingStructures>();
function staticSailingBlockers(state: GameState): ReadonlySet<number> {
  const store = entityStore(state), membership = store.buildings.revision;
  const topology = worldStructureRevision(state.world), structures = structureChangeRevision(state);
  const previous = sailingStructures.get(state);
  if (simulationReadsActive(state) && previous?.world === state.world && previous.store === store
    && previous.membership === membership && previous.topology === topology && previous.structures === structures) return previous.blocked;
  const blocked = new Set<number>();
  for (const building of state.buildings) if (building.hp > 0) {
    if (building.kind !== 'irrigation')
      for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++)
        blocked.add((building.y + dy) * state.world.width + building.x + dx);
    if (building.kind === 'dock') blocked.add(key(state, dockBerth(building)));
  }
  sailingStructures.set(state, { world: state.world, store, membership, topology, structures, blocked });
  return blocked;
}

export function sailingNavigation(state: GameState, boat?: Unit, riverOnly = false, ignoreTraffic = false) {
  const structures = staticSailingBlockers(state), traffic = new Set<number>();
  if (!ignoreTraffic) for (const unit of state.units) if ((unit.kind === 'sailboat' || unit.aboardRiverTrade) && unit.hp > 0 && unit.id !== boat?.id) traffic.add(key(state, unit));
  const cell = (x: number, y: number): boolean => {
    const tile = tileAt(state.world, x, y);
    return !!tile && navigableWaterCell(state.world, x, y) && (!riverOnly || tile.terrain === 'river')
      && (!riverOnly || !isForbidden(state, x, y, boat?.faction ?? 0))
      && !structures.has(Math.floor(y) * state.world.width + Math.floor(x))
      && !traffic.has(Math.floor(y) * state.world.width + Math.floor(x));
  };
  const position = (p: Point): boolean => [[-RADIUS,-RADIUS],[RADIUS,-RADIUS],[-RADIUS,RADIUS],[RADIUS,RADIUS]]
    .every(([dx,dy]) => cell(p.x + dx, p.y + dy));
  const segment = (a: Point, b: Point): boolean => {
    const steps = Math.max(1, Math.ceil(distance(a,b) / .15));
    let previous=a;
    for (let i = 1; i <= steps; i++) {
      const next={x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps};
      if (!position(next) || !canTraverseEdge(state.world,previous,next)) return false;
      previous=next;
    }
    return true;
  };
  return { cell, position, segment };
}
export const canSail = (state: GameState, point: Point, boat?: Unit): boolean => sailingNavigation(state, boat).position(point);

/** Water-only A*: land, fords, bridge decks, buildings and other boats block navigation. */
export function sailingPath(state: GameState, boat: Unit, goal: Point, riverOnly = false, ignoreTraffic = false): Point[] {
  const nav = sailingNavigation(state, boat, riverOnly, ignoreTraffic), target = center(goal), start = center(boat);
  if (!nav.position(target) || !nav.position(start)) return [];
  const startKey = key(state,start), targetKey = key(state,target);
  if (startKey === targetKey) return [target];
  type Node = { x: number; y: number; cost: number; score: number; key: number };
  const costs = new Map<number,number>([[startKey,0]]), previous = new Map<number,number>();
  const queue = new TinyQueue<Node>([{...start,cost:0,score:distance(start,target),key:startKey}], (a,b)=>a.score-b.score || a.key-b.key);
  while (queue.length) {
    const node = queue.pop()!;
    if (costs.get(node.key)! < node.cost) continue;
    if (node.key === targetKey) {
      const path: Point[] = [];
      for (let cell = targetKey; cell !== startKey; cell = previous.get(cell)!)
        path.push({x: cell % state.world.width + .5, y: Math.floor(cell/state.world.width)+.5});
      path.reverse();
      // Center first if a direct keyboard move left the hull off the tile center.
      if (path.length && !nav.segment(boat,path[0])) path.unshift(start);
      return path;
    }
    for (const [dx,dy] of directions) {
      const x=node.x+dx,y=node.y+dy;
      if (!nav.cell(x,y) || !canTraverseEdge(state.world,node,{x,y}) || dx && dy && (!nav.cell(node.x+dx,node.y)||!nav.cell(node.x,node.y+dy))) continue;
      const nextKey=key(state,{x,y}), cost=node.cost+(dx && dy?Math.SQRT2:1);
      if (cost >= (costs.get(nextKey)??Infinity)) continue;
      costs.set(nextKey,cost); previous.set(nextKey,node.key);
      queue.push({x,y,cost,score:cost+distance({x,y},target),key:nextKey});
    }
  }
  return [];
}

const ownLeader = (state: GameState, faction=playerFaction(state)) => state.units.find(u=>u.kind==='leader' && u.faction===faction && u.hp>0);
export function boardedBoat(state: GameState, leader = ownLeader(state)): Unit | undefined {
  return leader?.embarkedOn === undefined ? undefined : state.units.find(u=>u.id===leader.embarkedOn && u.kind==='sailboat' && u.hp>0 && u.faction===leader.faction && u.sailboat?.passenger===leader.id);
}
function shoreAvailable(state: GameState, leader: Unit, point: Point): boolean {
  const tile=tileAt(state.world,point.x,point.y);
  return !!tile && !WATER.has(tile.terrain) && canWalk(state,point.x,point.y,leader.faction)
    && !state.units.some(u=>u.id!==leader.id && u.hp>0 && !u.inside && u.kind!=='sailboat' && distance(u,point)<.65);
}
function canCrossShore(state: GameState, leader: Unit, boat: Unit, shore: Point): boolean {
  return distance(boat,shore)<=1.51 && shoreAvailable(state,leader,shore) && dockShoreCrossingClear(state,boat,shore);
}
function shoreCells(state: GameState, leader: Unit, boat: Unit): Point[] {
  return directions.map(([dx,dy])=>({x:Math.floor(boat.x)+dx+.5,y:Math.floor(boat.y)+dy+.5}))
    .filter(p=>canCrossShore(state,leader,boat,p));
}
function clearOrders(unit: Unit): void { unit.target=undefined; unit.destination=undefined; unit.path=undefined; unit.pathGoal=undefined; unit.repathAt=0; unit.forcedAttack=undefined; unit.attackTime=0; unit.moving=false; }
function refresh(state: GameState, unit: Unit): void { refreshIndexedUnit(state,unit); refreshFogUnit(state,unit); }

export function boardBoat(state: GameState, boat: Unit, leader=ownLeader(state)): SailingResult {
  if (!leader || leader.hp<=0 || leader.embarkedOn!==undefined || boat.kind!=='sailboat' || boat.hp<=0 || boat.faction!==leader.faction || !boat.sailboat)
    return {ok:false,message:'Choose your empty rowboat.'};
  if (boat.sailboat.passenger!==undefined) return {ok:false,message:'This rowboat already has a passenger.'};
  if (!canCrossShore(state,leader,boat,leader)) return {ok:false,message:'Move your Leader to the shore beside the rowboat.'};
  clearOrders(leader); leader.boardingBoat=undefined; leader.embarkedOn=boat.id; leader.inside=true;
  boat.sailboat.passenger=leader.id; boat.sailboat.velocity={x:0,y:0}; clearOrders(boat);
  leader.x=boat.x; leader.y=boat.y; refresh(state,leader); refresh(state,boat);
  state.selected=boat.id; state.selectedType='unit'; state.diplomacy=null;
  return {ok:true,message:'Leader aboard. W/S advance or reverse, A/D strafe, Q/E turn. Release to coast; right-click a shore to land.'};
}

/** A distant boarding order walks to a real, reachable shore beside the boat. */
export function orderBoardBoat(state: GameState, boat: Unit, leader=ownLeader(state)): SailingResult {
  if (!leader || boat.faction!==leader.faction || boat.kind!=='sailboat' || boat.hp<=0 || boat.sailboat?.passenger!==undefined || leader.embarkedOn!==undefined)
    return {ok:false,message:'Choose your empty rowboat.'};
  if (boardBoat(state,boat,leader).ok) return {ok:true,message:'Leader aboard.'};
  let best: {shore:Point;path:Point[]}|undefined;
  for (const shore of shoreCells(state,leader,boat)) {
    const path=findPath(state,leader,shore,leader.faction,false);
    if (path.length && distance(path[path.length-1],shore)<.1 && (!best || path.length<best.path.length)) best={shore,path};
  }
  if (!best) return {ok:false,message:'No reachable shore beside this rowboat.'};
  clearOrders(leader); leader.boardingBoat=boat.id; leader.destination=best.shore; leader.path=best.path; leader.pathGoal=best.shore;
  return {ok:true,message:'Moving to board the rowboat.'};
}
export function completeBoarding(state: GameState, leader: Unit): boolean {
  if (leader.boardingBoat===undefined) return false;
  const boat=state.units.find(u=>u.id===leader.boardingBoat && u.kind==='sailboat');
  if (!boat || boat.hp<=0 || boat.sailboat?.passenger!==undefined) { leader.boardingBoat=undefined; return false; }
  return boardBoat(state,boat,leader).ok;
}

export function disembarkLeader(state: GameState, shore?: Point, leader=ownLeader(state)): SailingResult {
  const boat=boardedBoat(state,leader);
  if (!leader || !boat) return {ok:false,message:'Your Leader is not aboard a rowboat.'};
  const destination=shore ? center(shore) : shoreCells(state,leader,boat).sort((a,b)=>distance(boat,a)-distance(boat,b))[0];
  if (!destination || !canCrossShore(state,leader,boat,destination)) return {ok:false,message:'Sail beside a clear shore to disembark.'};
  leader.embarkedOn=undefined; leader.inside=false; leader.x=destination.x; leader.y=destination.y; clearOrders(leader);
  boat.sailboat!.passenger=undefined; boat.sailboat!.landing=undefined; boat.sailboat!.velocity={x:0,y:0}; clearOrders(boat);
  refresh(state,leader); refresh(state,boat);
  state.selected=leader.id; state.selectedType='unit'; state.diplomacy=null;
  return {ok:true,message:'Leader ashore. The rowboat remains available for boarding.'};
}

/** A land click selects that actual bank; the boat must sail to it before landing. */
export function commandSailingMove(state: GameState, leader: Unit, point: Point): SailingResult {
  const boat=boardedBoat(state,leader), tile=tileAt(state.world,point.x,point.y);
  if (!boat || !tile) return {ok:false,message:'Choose water or a clear shore.'};
  const target=center(point); clearOrders(boat); boat.sailboat!.landing=undefined;
  if (WATER.has(tile.terrain)) {
    const path=sailingPath(state,boat,target);
    if (!path.length) return {ok:false,message:'No clear sailing route to that water.'};
    boat.destination=target; boat.path=path;
  } else {
    if (!shoreAvailable(state,leader,target)) return {ok:false,message:'Choose an open, low shore to disembark.'};
    if (disembarkLeader(state,target,leader).ok) return {ok:true,message:'Leader ashore.'};
    let best:{destination:Point;path:Point[]}|undefined;
    for (const [dx,dy] of directions) {
      const destination={x:target.x+dx,y:target.y+dy};
      if (!dockShoreCrossingClear(state,destination,target)) continue;
      const path=sailingPath(state,boat,destination);
      if (path.length && (!best || path.length<best.path.length)) best={destination,path};
    }
    if (!best) return {ok:false,message:'No sailing route reaches that shore.'};
    boat.destination=best.destination; boat.path=best.path; boat.sailboat!.landing=target;
  }
  return {ok:true,message:boat.sailboat!.landing?'Sailing to the shore.':'Sailing.'};
}

const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to-from),Math.cos(to-from));
function approachVelocity(velocity: Point, target: Point, amount: number): void {
  const dx=target.x-velocity.x,dy=target.y-velocity.y,gap=Math.hypot(dx,dy);
  if (gap<=amount) {velocity.x=target.x;velocity.y=target.y;}
  else {velocity.x+=dx/gap*amount;velocity.y+=dy/gap*amount;}
}

/** Directional controls share formation semantics. The hull keeps its heading
 * while strafing and its momentum while turning; reverse thrust brakes before
 * moving astern. Small swept steps prevent drift from skipping a narrow bank. */
export function updateSailingLeader(state: GameState, leader: Unit, dt: number, input: InputState): boolean {
  const boat=boardedBoat(state,leader);
  if (!boat) return false;
  if (!Number.isFinite(dt)||dt<=0) return true;
  const sailing=boat.sailboat!,velocity=sailing.velocity??={x:0,y:0};
  const nav=sailingNavigation(state,boat),before={x:boat.x,y:boat.y};
  const forward=Number(input.up)-Number(input.down),side=Number(input.right)-Number(input.left);
  const turn=Number(!!input.turnRight)-Number(!!input.turnLeft);
  const thrust=!!(forward||side),braking=!!(input.up&&input.down||input.left&&input.right);
  const manual=thrust||braking||!!(input.turnLeft||input.turnRight);
  if (manual) {clearOrders(boat);sailing.landing=undefined;}
  for (let remaining=dt;remaining>1e-8;) {
    const elapsed=Math.min(.05,remaining);remaining-=elapsed;
    let goal:Point|undefined;
    if (manual) boat.facing+=turn*SAILBOAT_TURN_SPEED*elapsed;
    else if (boat.destination) {
      while (boat.path?.length&&distance(boat,boat.path[0])<.035) boat.path.shift();
      if (!boat.path?.length&&distance(boat,boat.destination)>.035&&state.time>=(boat.repathAt??0)) {
        boat.path=sailingPath(state,boat,boat.destination);boat.repathAt=state.time+1;
      }
      // Follow the farthest nearby visible waypoint. Straight reaches retain
      // speed, while bends become genuine braking/turning points.
      while ((boat.path?.length??0)>1&&distance(boat,boat.path![1])<=6&&nav.segment(boat,boat.path![1])) boat.path!.shift();
      goal=boat.path?.[0];
      if (goal&&distance(boat,goal)>.001) {
        const change=angleDelta(boat.facing,Math.atan2(goal.y-boat.y,goal.x-boat.x));
        boat.facing+=Math.max(-SAILBOAT_TURN_SPEED*elapsed,Math.min(SAILBOAT_TURN_SPEED*elapsed,change));
      }
    }
    boat.facing=Math.atan2(Math.sin(boat.facing),Math.cos(boat.facing));
    let desired:Point={x:0,y:0},acceleration=braking?SAILBOAT_BRAKING:SAILBOAT_COAST_DECELERATION;
    if (thrust) {
      const length=Math.hypot(forward,side);
      desired={x:(Math.cos(boat.facing)*forward-Math.sin(boat.facing)*side)/length*SAILBOAT_SPEED,
        y:(Math.sin(boat.facing)*forward+Math.cos(boat.facing)*side)/length*SAILBOAT_SPEED};
      acceleration=velocity.x*desired.x+velocity.y*desired.y<0?SAILBOAT_BRAKING:SAILBOAT_ACCELERATION;
    } else if (goal) {
      const gap=distance(boat,goal),speed=Math.min(SAILBOAT_SPEED,Math.sqrt(2*SAILBOAT_BRAKING*Math.max(0,gap-.02)));
      if (gap>.001) desired={x:(goal.x-boat.x)/gap*speed,y:(goal.y-boat.y)/gap*speed};
      acceleration=SAILBOAT_BRAKING;
    }
    approachVelocity(velocity,desired,acceleration*elapsed);
    const next={x:boat.x+velocity.x*elapsed,y:boat.y+velocity.y*elapsed};
    if (goal) {
      const gx=goal.x-boat.x,gy=goal.y-boat.y,dx=next.x-boat.x,dy=next.y-boat.y,gap=Math.hypot(gx,gy);
      // Finish a waypoint without overshooting or orbiting it. No teleports:
      // the goal must lie on this step's swept segment (within hull tolerance).
      if (gap<.035||gx*dx+gy*dy>=gap*gap&&Math.abs(gx*dy-gy*dx)/Math.max(.001,Math.hypot(dx,dy))<.08) {
        next.x=goal.x;next.y=goal.y;velocity.x=velocity.y=0;
      }
    }
    if (nav.segment(boat,next)) {boat.x=next.x;boat.y=next.y;}
    else {
      // A bank absorbs the colliding component; safe tangential momentum can
      // continue along it. Autopilot retries a fresh route after a collision.
      const horizontal={x:next.x,y:boat.y},vertical={x:boat.x,y:next.y};
      if (nav.segment(boat,horizontal)) {boat.x=horizontal.x;velocity.y=0;}
      else if (nav.segment(boat,vertical)) {boat.y=vertical.y;velocity.x=0;}
      else velocity.x=velocity.y=0;
      if (!manual&&boat.destination) {boat.path=undefined;boat.repathAt=state.time+.3;}
    }
  }
  if (boat.destination&&distance(boat,boat.destination)<.035&&nav.segment(boat,boat.destination)) {
    boat.x=boat.destination.x;boat.y=boat.destination.y;
  }
  boat.moving=distance(before,boat)>.001;
  leader.x=boat.x;leader.y=boat.y;leader.facing=boat.facing;leader.moving=boat.moving;leader.target=undefined;leader.attackTime=0;
  if (boat.destination&&distance(boat,boat.destination)<.035) {
    velocity.x=velocity.y=0;
    if (sailing.landing) disembarkLeader(state,sailing.landing,leader);
    else {boat.destination=undefined;boat.path=undefined;}
  }
  refresh(state,boat);refresh(state,leader);
  return true;
}

/** Launch once after completion. A blocked launch retries without consuming the boat. */
export function updateSailboatLaunches(state: GameState): void {
  for (const dock of state.buildings) {
    if (dock.kind!=='dock' || !buildingReady(dock) || dock.dockBoatLaunched) continue;
    if (state.units.some(u=>u.kind==='sailboat' && u.sailboat?.dock===dock.id)) {dock.dockBoatLaunched=true;continue;}
    const d=DOCK_DIRECTIONS[dock.dockFacing??2];
    const position=dockMoorings(state,dock).find(p=>canSail(state,p));
    if (!position) continue;
    const id=Math.max(0,...state.units.map(u=>u.id),...state.buildings.map(b=>b.id))+1;
    entityStore(state).units.add({id,kind:'sailboat',faction:dock.faction,...position,hp:SAILBOAT_HP,maxHp:SAILBOAT_HP,morale:100,
      attack:0,defense:2,speed:SAILBOAT_SPEED,range:0,order:'hold',cooldown:0,lastCombat:-100,moving:false,facing:Math.atan2(d.y,d.x),attackTime:0,
      sailboat:{dock:dock.id}});
    dock.dockBoatLaunched=true;
  }
}

/** A destroyed boat releases its passenger at an adjacent shore; offshore loss
 * kills the passenger rather than leaving an invisible, stranded Leader. */
export function resolveSailingPassengers(state: GameState): void {
  for (const leader of state.units) if (leader.kind==='leader' && leader.embarkedOn!==undefined) {
    const boat=state.units.find(u=>u.kind==='sailboat' && u.id===leader.embarkedOn);
    if (boat && boat.hp>0 && leader.hp>0 && boat.sailboat?.passenger===leader.id) continue;
    const shore=boat && shoreCells(state,leader,boat)[0];
    leader.embarkedOn=undefined; leader.inside=false; clearOrders(leader);
    if (shore && leader.hp>0) {leader.x=shore.x;leader.y=shore.y;}
    else leader.hp=0;
    if (boat?.sailboat) boat.sailboat.passenger=undefined;
    if (state.selected===boat?.id) {state.selected=leader.hp>0?leader.id:null;state.selectedType=leader.hp>0?'unit':null;}
    refresh(state,leader);
  }
  for (const boat of state.units) if (boat.sailboat?.passenger!==undefined) {
    const leader=state.units.find(u=>u.id===boat.sailboat!.passenger && u.hp>0 && u.embarkedOn===boat.id);
    if (!leader) {boat.sailboat.passenger=undefined;boat.sailboat.landing=undefined;boat.sailboat.velocity={x:0,y:0};clearOrders(boat);}
  }
}
