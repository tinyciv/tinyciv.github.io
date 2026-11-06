import TinyQueue from 'tinyqueue';
import { dockBerth, dockMoorings, dockShoreCrossingClear, DOCK_DIRECTIONS } from './dock';
import { canTraverseEdge, canWalk, findPath } from './pathfinding';
import { entityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { worldStructureRevision } from './world-revisions';
import { refreshIndexedUnit } from './spatial';
import { refreshFogUnit } from './fog';
import { navigableWaterCell } from './water-navigation';
import { ridgeLevel } from './ridges';
import { createSailingConnectivity } from './sailing-connectivity';
import { createSailingDistance } from './sailing-distance';
import { galleyFootprintCells, galleyHullDistance, type GalleyPose } from './galley-footprint';
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
type SailingWaypoint = Point & { facing?: number };
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to-from),Math.cos(to-from));
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
  if (!ignoreTraffic) for (const unit of state.units) {
    if (unit.hp <= 0 || unit.id === boat?.id || unit.kind !== 'sailboat' && !unit.aboardRiverTrade) continue;
    if (unit.kind === 'sailboat') for (const p of galleyFootprintCells(unit)) traffic.add(key(state, p));
    else traffic.add(key(state, unit));
  }
  const cell = (x: number, y: number): boolean => {
    const tile = tileAt(state.world, x, y);
    return !!tile && navigableWaterCell(state.world, x, y) && (!riverOnly || tile.terrain === 'river')
      && (!riverOnly || !isForbidden(state, x, y, boat?.faction ?? 0))
      && !structures.has(Math.floor(y) * state.world.width + Math.floor(x))
      && !traffic.has(Math.floor(y) * state.world.width + Math.floor(x));
  };
  const galley = !boat || boat.kind === 'sailboat';
  const position = (p: Point, facing = (p as SailingWaypoint).facing ?? boat?.facing ?? 0): boolean => {
    if (!galley) return [[-RADIUS,-RADIUS],[RADIUS,-RADIUS],[-RADIUS,RADIUS],[RADIUS,RADIUS]]
      .every(([dx,dy]) => cell(p.x + dx, p.y + dy));
    const level = ridgeLevel(tileAt(state.world, p.x, p.y));
    return galleyFootprintCells({ ...p, facing }).every(part => cell(part.x, part.y)
      && ridgeLevel(tileAt(state.world, part.x, part.y)) === level);
  };
  const segment = (a: Point, b: Point, facing = boat?.facing ?? 0): boolean => {
    const steps = Math.max(1, Math.ceil(distance(a,b) / .15));
    let previous=a;
    for (let i = 1; i <= steps; i++) {
      const next={x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps};
      if (!position(next, facing) || !canTraverseEdge(state.world,previous,next)) return false;
      previous=next;
    }
    return true;
  };
  const turn = (p: Point, from: number, to: number): boolean => {
    const change = angleDelta(from, to), steps = Math.max(1, Math.ceil(Math.abs(change) / .08));
    for (let i = 1; i <= steps; i++) if (!position(p, from + change * i / steps)) return false;
    return true;
  };
  return { cell, position, segment, turn, connected: createSailingConnectivity(state.world,cell) };
}
export const canSail = (state: GameState, point: SailingWaypoint, boat?: Unit): boolean => sailingNavigation(state, boat).position(point);

const galleySweeps = new Map<string, readonly Point[]>();
/** Geometry is world-independent. Reuse the swept occupied cells for lattice
 * poses instead of repeating capsule intersection math throughout A*. */
function latticeSweep(x: number, y: number, heading: number, dx=0, dy=0, turn=0): readonly Point[] {
  const px=x&1,py=y&1,key=`${px}:${py}:${heading}:${dx}:${dy}:${turn}`,cached=galleySweeps.get(key);
  if (cached) return cached;
  const cells=new Map<string,Point>(),steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/2/.15),Math.ceil(Math.abs(turn)*Math.PI/4/.08));
  for (let i=0;i<=steps;i++) {
    const pose={x:4+px/2+dx/2*i/steps,y:4+py/2+dy/2*i/steps,facing:(heading+turn*i/steps)*Math.PI/4};
    for (const cell of galleyFootprintCells(pose)) cells.set(`${cell.x}:${cell.y}`,{x:cell.x-4,y:cell.y-4});
  }
  const result=[...cells.values()];galleySweeps.set(key,result);return result;
}
// One bounded search covers every possible landing pose. Coarse water
// distances guide island detours; a small priority bias avoids exploring all
// equally short heading combinations before advancing toward the destination.
const MAX_GALLEY_PATH_NODES=12000;
const GALLEY_HEURISTIC_WEIGHT=1.08;

/** Heading-aware navigation for the two-cell hull. Half-cell positions allow
 * centering between two channel rows and turning at an actual clear berth. */
function galleyPath(state: GameState, boat: Unit, goal: SailingWaypoint | readonly SailingWaypoint[], riverOnly: boolean, ignoreTraffic: boolean,
  existingNavigation?: ReturnType<typeof sailingNavigation>, budget={remaining:MAX_GALLEY_PATH_NODES}): SailingWaypoint[] {
  const nav = existingNavigation ?? sailingNavigation(state, boat, riverOnly, ignoreTraffic), gridWidth = state.world.width * 2 + 1;
  const goals:readonly SailingWaypoint[]=Array.isArray(goal)?goal:[goal as SailingWaypoint];
  const targets=goals.map(p=>({x:Math.round(p.x*2)/2,y:Math.round(p.y*2)/2,facing:p.facing}))
    .filter(p=>nav.connected(boat,p));
  if (!targets.length) return [];
  const bounds={left:Math.min(...targets.map(p=>p.x)),right:Math.max(...targets.map(p=>p.x)),
    top:Math.min(...targets.map(p=>p.y)),bottom:Math.max(...targets.map(p=>p.y))};
  const coarseDistance=createSailingDistance(state.world,nav.cell,targets);
  const heuristic=(p:Point):number=>{
    const dx=Math.max(bounds.left-p.x,0,p.x-bounds.right),dy=Math.max(bounds.top-p.y,0,p.y-bounds.bottom);
    return Math.max(Math.max(dx,dy)+(Math.SQRT2-1)*Math.min(dx,dy),coarseDistance(p)-1.5);
  };
  const index = (x: number, y: number, heading: number) => (y * gridWidth + x) * 8 + heading;
  const sweepClear=(x:number,y:number,h:number,dx=0,dy=0,turn=0):boolean=>{
    const originX=Math.floor(x/2),originY=Math.floor(y/2),level=ridgeLevel(tileAt(state.world,x/2,y/2));
    return latticeSweep(x,y,h,dx,dy,turn).every(p=>nav.cell(originX+p.x,originY+p.y)
      && ridgeLevel(tileAt(state.world,originX+p.x,originY+p.y))===level);
  };
  const poseCache = new Map<number, boolean>();
  const clear = (x: number, y: number, heading: number): boolean => {
    if (x < 0 || y < 0 || x > state.world.width * 2 || y > state.world.height * 2) return false;
    const key = index(x, y, heading), cached = poseCache.get(key);
    if (cached !== undefined) return cached;
    const result = sweepClear(x,y,heading); poseCache.set(key, result); return result;
  };
  const targetKeys=new Set<number>();
  for (const target of targets) {
    const requested=target.facing===undefined?undefined:((Math.round(target.facing/(Math.PI/4))%8)+8)%8;
    for(let h=0;h<8;h++) if ((requested===undefined||h===requested)&&clear(target.x*2,target.y*2,h)) targetKeys.add(index(target.x*2,target.y*2,h));
  }
  if (!targetKeys.size) return [];
  const roundedX=Math.round(boat.x*2),roundedY=Math.round(boat.y*2);
  const startCandidates=directions.concat([[0,0]]).map(([dx,dy])=>({x:roundedX+dx,y:roundedY+dy}));
  startCandidates.sort((a,b)=>distance(boat,{x:a.x/2,y:a.y/2})-distance(boat,{x:b.x/2,y:b.y/2}));
  const headings=[0,1,2,3,4,5,6,7].sort((a,b)=>Math.abs(angleDelta(boat.facing,a*Math.PI/4))-Math.abs(angleDelta(boat.facing,b*Math.PI/4)));
  let connection:{x:number;y:number;heading:number}|undefined;
  for (const candidate of startCandidates) {
    const point={x:candidate.x/2,y:candidate.y/2};
    if (!nav.segment(boat,point)) continue;
    const heading=headings.find(h=>clear(candidate.x,candidate.y,h)&&nav.turn(point,boat.facing,h*Math.PI/4));
    if (heading!==undefined) {connection={...candidate,heading};break;}
  }
  if (!connection) return [];
  const {x:sx,y:sy,heading}=connection,start={x:sx/2,y:sy/2};
  type Node = { x: number; y: number; heading: number; cost: number; score: number; key: number };
  const startKey = index(sx, sy, heading), costs = new Map<number,number>([[startKey,0]]), previous = new Map<number,number>();
  const nodes = new Map<number, Node>();
  const first = { x: sx, y: sy, heading, cost: 0, score: heuristic(start)*GALLEY_HEURISTIC_WEIGHT, key: startKey }; nodes.set(startKey, first);
  const queue = new TinyQueue<Node>([first], (a,b) => Math.abs(a.score-b.score)>1e-8 ? a.score-b.score : b.cost-a.cost || a.key-b.key);
  while (queue.length && budget.remaining>0) {
    const node = queue.pop()!; if (node.cost > costs.get(node.key)!) continue;
    budget.remaining--;
    const p = { x: node.x / 2, y: node.y / 2 }, facing = node.heading * Math.PI / 4;
    if (targetKeys.has(node.key)) {
      const path: SailingWaypoint[] = [];
      for (let key = node.key; key !== startKey; key = previous.get(key)!) {
        const step = nodes.get(key)!; path.push({ x: step.x / 2, y: step.y / 2, facing: step.heading * Math.PI / 4 });
      }
      path.reverse();
      const prefix:SailingWaypoint[]=[];
      if (distance(boat,start)>.001) prefix.push({...start,facing:boat.facing});
      if (Math.abs(angleDelta(boat.facing,heading*Math.PI/4))>.001) prefix.push({...start,facing:heading*Math.PI/4});
      path.unshift(...prefix);
      return path.length ? path : [{ ...p, facing }];
    }
    const offer = (x: number, y: number, h: number, extra: number): void => {
      const key = index(x, y, h), cost = node.cost + extra;
      if (cost >= (costs.get(key) ?? Infinity)) return;
      const next = { x, y, heading: h, cost, score: cost + heuristic({ x: x / 2, y: y / 2 })*GALLEY_HEURISTIC_WEIGHT, key };
      costs.set(key, cost); previous.set(key, node.key); nodes.set(key, next); queue.push(next);
    };
    for (const offset of [-1,1]) {
      const h = (node.heading + offset + 8) % 8;
      if (clear(node.x,node.y,h) && sweepClear(node.x,node.y,node.heading,0,0,offset)) offer(node.x,node.y,h,.08);
    }
    for (const [dx,dy] of directions) {
      const x = node.x + dx, y = node.y + dy;
      if (!clear(x,y,node.heading) || !sweepClear(node.x,node.y,node.heading,dx,dy)) continue;
      const length = Math.hypot(dx,dy), alignment = (dx*Math.cos(facing)+dy*Math.sin(facing))/length;
      offer(x,y,node.heading,length*.5*(1+.3*(1-alignment)));
    }
  }
  return [];
}

/** Water-only A*: land, fords, bridge decks, buildings and other boats block navigation. */
export function sailingPath(state: GameState, boat: Unit, goal: Point, riverOnly = false, ignoreTraffic = false): Point[] {
  if (boat.kind === 'sailboat') return galleyPath(state, boat, goal, riverOnly, ignoreTraffic);
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
function canCrossShore(state: GameState, leader: Unit, boat: GalleyPose, shore: Point): boolean {
  if (!shoreAvailable(state,leader,shore) || galleyHullDistance(boat,shore) > 1.01) return false;
  return galleyFootprintCells(boat).some(cell => {
    const water = { x: cell.x + .5, y: cell.y + .5 };
    return distance(water,shore) <= Math.SQRT2 + .01 && dockShoreCrossingClear(state,water,shore);
  });
}
function shoreCells(state: GameState, leader: Unit, boat: Unit): Point[] {
  const cells = new Map<number,Point>();
  for (const part of galleyFootprintCells(boat)) for (const [dx,dy] of directions) {
    const p = { x: part.x + dx + .5, y: part.y + dy + .5 };
    if (canCrossShore(state,leader,boat,p)) cells.set(key(state,p),p);
  }
  return [...cells.values()];
}
function clearOrders(unit: Unit): void { unit.target=undefined; unit.destination=undefined; unit.path=undefined; unit.pathGoal=undefined; unit.repathAt=0; unit.forcedAttack=undefined; unit.attackTime=0; unit.moving=false; }
function refresh(state: GameState, unit: Unit): void { refreshIndexedUnit(state,unit); refreshFogUnit(state,unit); }

export function boardBoat(state: GameState, boat: Unit, leader=ownLeader(state)): SailingResult {
  if (!leader || leader.hp<=0 || leader.embarkedOn!==undefined || boat.kind!=='sailboat' || boat.hp<=0 || boat.faction!==leader.faction || !boat.sailboat)
    return {ok:false,message:'Choose your empty galley.'};
  if (boat.sailboat.passenger!==undefined) return {ok:false,message:'This galley already has a passenger.'};
  if (!canCrossShore(state,leader,boat,leader)) return {ok:false,message:'Move your Leader to the shore beside the galley.'};
  clearOrders(leader); leader.boardingBoat=undefined; leader.embarkedOn=boat.id; leader.inside=true;
  boat.sailboat.passenger=leader.id; boat.sailboat.velocity={x:0,y:0}; clearOrders(boat);
  leader.x=boat.x; leader.y=boat.y; refresh(state,leader); refresh(state,boat);
  state.selected=boat.id; state.selectedType='unit'; state.diplomacy=null;
  return {ok:true,message:'Leader aboard. W/S advance or reverse, A/D strafe, Q/E turn. Release to coast; right-click a shore to land.'};
}

/** A distant boarding order walks to a real, reachable shore beside the boat. */
export function orderBoardBoat(state: GameState, boat: Unit, leader=ownLeader(state)): SailingResult {
  if (!leader || boat.faction!==leader.faction || boat.kind!=='sailboat' || boat.hp<=0 || boat.sailboat?.passenger!==undefined || leader.embarkedOn!==undefined)
    return {ok:false,message:'Choose your empty galley.'};
  if (boardBoat(state,boat,leader).ok) return {ok:true,message:'Leader aboard.'};
  let best: {shore:Point;path:Point[]}|undefined;
  for (const shore of shoreCells(state,leader,boat)) {
    const path=findPath(state,leader,shore,leader.faction,false);
    if (path.length && distance(path[path.length-1],shore)<.1 && (!best || path.length<best.path.length)) best={shore,path};
  }
  if (!best) return {ok:false,message:'No reachable shore beside this galley.'};
  clearOrders(leader); leader.boardingBoat=boat.id; leader.destination=best.shore; leader.path=best.path; leader.pathGoal=best.shore;
  return {ok:true,message:'Moving to board the galley.'};
}
export function completeBoarding(state: GameState, leader: Unit): boolean {
  if (leader.boardingBoat===undefined) return false;
  const boat=state.units.find(u=>u.id===leader.boardingBoat && u.kind==='sailboat');
  if (!boat || boat.hp<=0 || boat.sailboat?.passenger!==undefined) { leader.boardingBoat=undefined; return false; }
  return boardBoat(state,boat,leader).ok;
}

export function disembarkLeader(state: GameState, shore?: Point, leader=ownLeader(state)): SailingResult {
  const boat=boardedBoat(state,leader);
  if (!leader || !boat) return {ok:false,message:'Your Leader is not aboard a galley.'};
  const destination=shore ? center(shore) : shoreCells(state,leader,boat).sort((a,b)=>distance(boat,a)-distance(boat,b))[0];
  if (!destination || !canCrossShore(state,leader,boat,destination)) return {ok:false,message:'Sail beside a clear shore to disembark.'};
  leader.embarkedOn=undefined; leader.inside=false; leader.x=destination.x; leader.y=destination.y; clearOrders(leader);
  boat.sailboat!.passenger=undefined; boat.sailboat!.landing=undefined; boat.sailboat!.velocity={x:0,y:0}; clearOrders(boat);
  refresh(state,leader); refresh(state,boat);
  state.selected=leader.id; state.selectedType='unit'; state.diplomacy=null;
  return {ok:true,message:'Leader ashore. The galley remains available for boarding.'};
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
    let best:{destination:SailingWaypoint;path:Point[]}|undefined;
    const candidates: (SailingWaypoint & { facing: number })[] = [];
    const nav = sailingNavigation(state,boat);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const destination = { x: target.x + dx / 2, y: target.y + dy / 2 };
      if (!nav.cell(destination.x,destination.y)) continue;
      for (let heading = 0; heading < 8; heading++) {
        const pose = { ...destination, facing: heading * Math.PI / 4 };
        if (nav.position(pose) && canCrossShore(state,leader,pose,target)) candidates.push(pose);
      }
    }
    const path=galleyPath(state,boat,candidates,false,false,nav);
    if (path.length) best={destination:path[path.length-1],path};
    if (!best) return {ok:false,message:'No sailing route reaches that shore.'};
    boat.destination=best.destination; boat.path=best.path; boat.sailboat!.landing=target;
  }
  return {ok:true,message:boat.sailboat!.landing?'Sailing to the shore.':'Sailing.'};
}

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
  const nav=sailingNavigation(state,boat),before={x:boat.x,y:boat.y,facing:boat.facing};
  const forward=Number(input.up)-Number(input.down),side=Number(input.right)-Number(input.left);
  const turn=Number(!!input.turnRight)-Number(!!input.turnLeft);
  const thrust=!!(forward||side),braking=!!(input.up&&input.down||input.left&&input.right);
  const manual=thrust||braking||!!(input.turnLeft||input.turnRight);
  if (manual) {clearOrders(boat);sailing.landing=undefined;}
  for (let remaining=dt;remaining>1e-8;) {
    const elapsed=Math.min(.05,remaining);remaining-=elapsed;
    let goal:SailingWaypoint|undefined;
    if (manual) {
      const nextFacing = boat.facing + turn*SAILBOAT_TURN_SPEED*elapsed;
      if (nav.turn(boat,boat.facing,nextFacing)) boat.facing = nextFacing;
    }
    else if (boat.destination) {
      while (boat.path?.length&&distance(boat,boat.path[0])<.035
        && ((boat.path[0] as SailingWaypoint).facing === undefined || Math.abs(angleDelta(boat.facing,(boat.path[0] as SailingWaypoint).facing!)) < .025)) boat.path.shift();
      if (!boat.path?.length&&distance(boat,boat.destination)>.035&&state.time>=(boat.repathAt??0)) {
        boat.path=sailingPath(state,boat,boat.destination);boat.repathAt=state.time+1;
      }
      // Merge only straight runs with the same planned orientation. Keep
      // in-place turn nodes so the stern cannot swing through a river bank.
      while ((boat.path?.length??0)>1) {
        const first=boat.path![0] as SailingWaypoint,next=boat.path![1] as SailingWaypoint;
        if (first.facing !== next.facing || first.facing === undefined || Math.abs(angleDelta(boat.facing,first.facing)) > .025
          || distance(boat,next)>6 || !nav.segment(boat,next,first.facing)) break;
        boat.path!.shift();
      }
      goal=boat.path?.[0] as SailingWaypoint|undefined;
      if (goal) {
        const desiredFacing = goal.facing ?? Math.atan2(goal.y-boat.y,goal.x-boat.x);
        const change=angleDelta(boat.facing,desiredFacing);
        const nextFacing=boat.facing+Math.max(-SAILBOAT_TURN_SPEED*elapsed,Math.min(SAILBOAT_TURN_SPEED*elapsed,change));
        if (nav.turn(boat,boat.facing,nextFacing)) boat.facing=nextFacing;
      }
    }
    boat.facing=Math.atan2(Math.sin(boat.facing),Math.cos(boat.facing));
    let desired:Point={x:0,y:0},acceleration=braking?SAILBOAT_BRAKING:SAILBOAT_COAST_DECELERATION;
    if (thrust) {
      const length=Math.hypot(forward,side);
      desired={x:(Math.cos(boat.facing)*forward-Math.sin(boat.facing)*side)/length*SAILBOAT_SPEED,
        y:(Math.sin(boat.facing)*forward+Math.cos(boat.facing)*side)/length*SAILBOAT_SPEED};
      acceleration=velocity.x*desired.x+velocity.y*desired.y<0?SAILBOAT_BRAKING:SAILBOAT_ACCELERATION;
    } else if (goal && (goal.facing === undefined || Math.abs(angleDelta(boat.facing,goal.facing)) < .025)) {
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
  boat.moving=distance(before,boat)>.001 || Math.abs(angleDelta(before.facing,boat.facing))>.001;
  leader.x=boat.x;leader.y=boat.y;leader.facing=boat.facing;leader.moving=boat.moving;leader.target=undefined;leader.attackTime=0;
  if (boat.destination&&distance(boat,boat.destination)<.035
    && ((boat.destination as SailingWaypoint).facing === undefined || Math.abs(angleDelta(boat.facing,(boat.destination as SailingWaypoint).facing!)) < .025)) {
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
    const launches = dockMoorings(state,dock).flatMap(p => [d,{x:-d.y,y:d.x},{x:d.y,y:-d.x}]
      .map(direction=>({x:p.x+direction.x*.5,y:p.y+direction.y*.5,facing:Math.atan2(direction.y,direction.x)})));
    const position=launches.find(p=>canSail(state,p));
    if (!position) continue;
    const id=Math.max(0,...state.units.map(u=>u.id),...state.buildings.map(b=>b.id))+1;
    entityStore(state).units.add({id,kind:'sailboat',faction:dock.faction,...position,hp:SAILBOAT_HP,maxHp:SAILBOAT_HP,morale:100,
      attack:0,defense:2,speed:SAILBOAT_SPEED,range:0,order:'hold',cooldown:0,lastCombat:-100,moving:false,facing:position.facing,attackTime:0,
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
