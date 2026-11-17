import { palaceEnclosures, type PalaceEnclosure } from './enclosures';
import { constructionEdges } from './builders';
import { entityStore } from './entity-store';
import { canWalk } from './pathfinding';
import { nearbyUnits } from './spatial';
import { buildingReady, distance, type Building, type GameState, type Point, type Unit } from './types';

export const WALL_ENTRY_SECONDS = 3;
export const WALL_GUARD_RANGE = 5;
interface Walk { cells: Set<number>; walls: Map<number, Building>; neighbors: Map<number, number[]>; gates: Building[] }
const walks = new WeakMap<PalaceEnclosure, Walk>();
function cityWalk(state: GameState, city: Building): Walk | undefined {
  const region = palaceEnclosures(state, true).regions.find(r => r.faction === city.faction && r.palaces.includes(city.id));
  if (!region) return;
  const cached = walks.get(region); if (cached) return cached;
  const cells = new Set(region.cells), walls = new Map<number, Building>(), byCell = new Map<number, Building>();
  for (const wall of state.buildings) if (buildingReady(wall) && wall.faction === city.faction && (wall.kind === 'wall' || wall.kind === 'palisade')) {
    const cell = wall.y * state.world.width + wall.x;
    if (![0,-1,1,-state.world.width,state.world.width].some(d => cells.has(cell+d))) continue;
    // A mixed wooden/stone enclosure does not qualify for a stone wall walk.
    if (wall.kind === 'palisade') return;
    walls.set(wall.id,wall); byCell.set(cell,wall);
  }
  const neighbors = new Map<number,number[]>(), gates: Building[] = [];
  for (const wall of walls.values()) {
    neighbors.set(wall.id, [-1,1,-state.world.width,state.world.width].map(d=>byCell.get(wall.y*state.world.width+wall.x+d))
      .filter((b): b is Building => !!b && distance(b,wall)===1).map(b=>b.id));
    if (state.buildings.some(b=>b.kind==='road' && buildingReady(b) && b.x===wall.x && b.y===wall.y)) gates.push(wall);
  }
  const walk={cells,walls,neighbors,gates};walks.set(region,walk);return walk;
}
const center=(b:Building):Point=>({x:b.x+.5,y:b.y+.5});
/** Ground approach uses ordinary navigation. On the parapet only adjacent
 * stone tiles are traversed; a destroyed support kills its occupant. */
export function updateWallPatrol(state:GameState, unit:Unit, city:Building, post:Building, dt:number,
 move:(state:GameState,unit:Unit,goal:Point,dt:number)=>void,
 shoot:(unit:Unit,target:Unit)=>void, hostile:(a:number,b:number)=>boolean):boolean {
  let patrol=unit.wallPatrol;
  if (patrol?.wall !== undefined) {
    const wall=entityStore(state).buildings.get(patrol.wall);
    if (!wall || !buildingReady(wall) || wall.faction!==unit.faction) {unit.hp=0;unit.inside=false;return true;}
  }
  const walk=cityWalk(state,city);
  if (!patrol) {
    if (!post.guardPost?.funded || !walk?.gates.length || unit.id%2) return false;
    if (!walk.cells.has(post.y*state.world.width+post.x)
      && ![...walk.walls.values()].some(wall=>wall.x===post.x&&wall.y===post.y)) return false;
    const gate=walk.gates.reduce((a,b)=>distance(unit,a)<distance(unit,b)?a:b);
    if (unit.inside) {
      const exit=constructionEdges(state,post,true).find(p=>canWalk(state,p.x,p.y,unit.faction));
      if (!exit)return false;
      unit.x=exit.x;unit.y=exit.y;unit.inside=false;
    }
    patrol=unit.wallPatrol={gate:gate.id};unit.target=undefined;unit.path=undefined;unit.pathGoal=undefined;
  }
  const gate=entityStore(state).buildings.get(patrol.gate);
  if (patrol.wall===undefined) {
    if (!gate || !buildingReady(gate) || !walk?.walls.has(gate.id)) {unit.wallPatrol=undefined;unit.inside=false;return false;}
    if (patrol.enteringUntil===undefined) {
      if(distance(unit,center(gate))>.2){move(state,unit,center(gate),dt);return true;}
      patrol.enteringUntil=state.time+WALL_ENTRY_SECONDS;unit.inside=true;unit.moving=false;return true;
    }
    if(state.time<patrol.enteringUntil)return true;
    patrol.wall=gate.id;unit.inside=false;unit.x=gate.x+.5;unit.y=gate.y+.5;unit.range=WALL_GUARD_RANGE;
  }
  unit.moving=false;
  const enemy=nearbyUnits(state,unit,WALL_GUARD_RANGE).filter(u=>u.hp>0&&!u.inside&&hostile(unit.faction,u.faction)&&distance(unit,u)<=WALL_GUARD_RANGE)
    .sort((a,b)=>distance(a,unit)-distance(b,unit)||a.id-b.id)[0];
  if(enemy){shoot(unit,enemy);return true;}
  if (!walk) return true;
  if(patrol.nextWall===undefined){
    const links=walk.neighbors.get(patrol.wall!)??[];
    patrol.nextWall=links.find(id=>id!==patrol.previousWall)??links[0];
    patrol.previousWall=patrol.wall;
  }
  const next=walk.walls.get(patrol.nextWall??-1);
  if(!next||!buildingReady(next)){patrol.nextWall=undefined;return true;}
  const goal=center(next),gap=distance(unit,goal),step=Math.min(gap,unit.speed*dt);
  if(gap){unit.x+=(goal.x-unit.x)*step/gap;unit.y+=(goal.y-unit.y)*step/gap;unit.facing=Math.atan2(goal.y-unit.y,goal.x-unit.x);unit.moving=step>0;}
  // Support follows the actual tile under the guard, including mid-step hits.
  const support=[walk.walls.get(patrol.wall!),next].find(b=>b&&Math.floor(unit.x)===b.x&&Math.floor(unit.y)===b.y);
  if(support)patrol.wall=support.id;
  if(gap<=step+.001){patrol.wall=next.id;patrol.nextWall=undefined;}
  return true;
}
