import { buildingSize, type World, type Point, type CampSize, WATER } from './types';
export type { CampSize } from './types';
import { traversable, canTraverseEdge } from './pathfinding';
import { reliefFootprintAllowed } from './relief';
import { completesTileSquare } from './network-placement';

export interface CampSizeProfile {
  readonly minTents:number;
  readonly maxTents:number;
  readonly minTowers:number;
}
/** Shared physical capacity targets; production uses these to balance encounters. */
export const CAMP_SIZE_PROFILES = {
  small:{minTents:3,maxTents:5,minTowers:5},
  medium:{minTents:6,maxTents:9,minTowers:6},
  large:{minTents:10,maxTents:18,minTowers:7},
} as const satisfies Readonly<Record<CampSize,CampSizeProfile>>;

/** Pure, bounded terrain-aware layout planner. No state mutation or artwork dependency. */
export interface CampLayout {
  id:string; size:CampSize; name:string; subtitle:string; description:string;
  width:number; height:number; previousWidth:number; previousHeight:number;
  walls:Point[];
  gate:Point;
  towers:(Point & { core:boolean })[];
  tents:Point[];
  /** Northwest tile of the lair, centered in the stone ring. */
  lair:Point;
  /** Open ground inside the stone gate where returning commanders regroup. */
  refuge:Point;
  signs:Point[]; paths:Point[];
  zones:{x:number;y:number;width:number;height:number;label:string}[];
}
export interface CampPlanningOptions {
  /** Requested encounter scale. Geometry and capacity remain consistent with it. */
  size?:CampSize;
  /** Existing plots, reservations, and unseen-site restrictions. World-linear indices. */
  blocked?:ReadonlySet<number>;
  /** Solid existing structures; these additionally block traversal. World-linear indices. */
  obstacles?:ReadonlySet<number>;
  /** Global strategic reachability. Only finite values on the local border seed access. */
  access?: Float32Array | Float64Array;
  /** False permits clearing only occupied forest/jungle plots after a plan is accepted. */
  preserveTrees?:boolean;
}
interface SearchBounds { x:number;y:number;width:number;height:number }
interface PlanningWorld extends World { campOptions?:CampPlanningOptions; campSeedInset?:number }
const optionsOf=(w:World):CampPlanningOptions|undefined=>(w as PlanningWorld).campOptions;

export interface AdaptiveCampPlan {
  layout: CampLayout|null; status:'placed'|'rejected'; reason:string; adjustments:string[];
  /** The bounded global window used to validate a production plan. */
  searchBounds?:SearchBounds;
  bounds:{x:number;y:number;width:number;height:number}|null;
  checks:{valid:boolean;issues:string[]};
  metrics:{candidateCount:number;wallTiles:number;tentCount:number;naturalBarrierTiles?:number};
}
const DIRS=[[-1,0],[0,-1],[1,0],[0,1]] as const;
const ALL_DIRS=[...DIRS,[-1,-1],[1,-1],[1,1],[-1,1]];
const LAIR_SIZE = buildingSize({ kind: 'barbarianLair' });
const LAIR_OFFSET = Math.floor(LAIR_SIZE / 2);
const CORE_WALL_RADIUS = LAIR_OFFSET + 3;
const CORE_TOWER_OFFSET = CORE_WALL_RADIUS - 1;

export function campLairCells(lair: Point): Point[] {
  return Array.from({ length: LAIR_SIZE ** 2 }, (_, cell) => ({
    x: lair.x + cell % LAIR_SIZE,
    y: lair.y + Math.floor(cell / LAIR_SIZE),
  }));
}

const id=(w:World,p:Point)=>p.y*w.width+p.x;
const point=(w:World,k:number):Point=>({x:k%w.width,y:Math.floor(k/w.width)});
const inside=(w:World,x:number,y:number)=>x>=0&&y>=0&&x<w.width&&y<w.height;
const noise=(x:number,y:number,s:number)=>{let n=Math.imul(x+s*131,374761393)^Math.imul(y+719,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
export function isBuildable(w:World,x:number,y:number,options=optionsOf(w)):boolean {
  const t=w.tiles[y*w.width+x];
  return inside(w,x,y)&&!!t&&!options?.blocked?.has(y*w.width+x)&&!options?.obstacles?.has(y*w.width+x)
    &&!WATER.has(t.terrain)&&traversable(w,x,y)&&reliefFootprintAllowed(w,x,y)
    &&(options?.preserveTrees===false||t.overlay!=='forest'&&t.overlay!=='jungle');
}
/** Multi-source terrain flood; roads use cardinal steps, hostile probes include diagonals. */
function flood(w:World,blocked:Set<number>,starts:number[],diagonal=false) {
  const dist=new Map<number,number>(),parent=new Map<number,number|null>(),q:number[]=[],obstacles=optionsOf(w)?.obstacles;
  for(const k of starts){const p=point(w,k);if(!blocked.has(k)&&!obstacles?.has(k)&&traversable(w,p.x,p.y)){dist.set(k,0);parent.set(k,null);q.push(k);}}
  for(let h=0;h<q.length;h++){
    const k=q[h],p=point(w,k),d=dist.get(k)!;
    for(const [dx,dy]of diagonal?ALL_DIRS:DIRS){const x=p.x+dx,y=p.y+dy,n=y*w.width+x;
      if(!inside(w,x,y)||blocked.has(n)||obstacles?.has(n)||!traversable(w,x,y)||!canTraverseEdge(w,p,{x,y}))continue;
      const next=d+1;
      if(!dist.has(n)||next<dist.get(n)!){dist.set(n,next);parent.set(n,k);q.push(n);}
    }
  }return{dist,parent};
}
function border(w:World):number[]{
  // The outer cell is a terrain halo: terrain edge predicates need real neighbors
  // beyond the access perimeter, or a cropped flat plateau becomes a cliff.
  const inset=(w as PlanningWorld).campSeedInset??0,l=inset,r=w.width-1-inset,t=inset,b=w.height-1-inset,a:number[]=[];
  for(let x=l;x<=r;x++)a.push(t*w.width+x,b*w.width+x);
  for(let y=t+1;y<b;y++)a.push(y*w.width+l,y*w.width+r);
  const access=optionsOf(w)?.access;return access?a.filter(k=>Number.isFinite(access[k])):a;
}

/** Work back from a destination until it joins a route. Terrain like fords
 * stays open between road segments. */
function joinCampTrail(world: World, walkable: ReadonlyMap<number, number | null>, roadable: ReadonlySet<number>,
  routes: Set<number>, roads: Set<number>, destination: number): void {
  const { width, height } = world;
  const roadAt = (cell: number) => roads.has(cell);
  if (routes.has(destination) || !walkable.has(destination)) return;

  const towardsDestination = new Map<number, number | null>([[destination, null]]);
  const queue = [destination];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], from = point(world, cell);
    for (const [dx, dy] of DIRS) {
      const x = from.x + dx, y = from.y + dy, next = y * width + x;
      if (!inside(world, x, y) || !walkable.has(next) || towardsDestination.has(next)
        || !canTraverseEdge(world, from, { x, y })) continue;
      if (routes.has(next)) {
        for (let step: number | null = cell; step !== null; step = towardsDestination.get(step) ?? null) {
          routes.add(step);
          const p = point(world, step);
          if (roadable.has(step) && !completesTileSquare(width, height, p.x, p.y, roadAt)) roads.add(step);
        }
        return;
      }
      towardsDestination.set(next, cell);
      queue.push(next);
    }
  }
}

function campTrails(world: World, bounds: SearchBounds, blocked: Set<number>, outside: Map<number, number | null>,
  gate: number, refuge: number, destinations: number[]): Point[] {
  // A ford or detour may lead outside the area where we lay road tiles.
  const walkable = flood(world, blocked, [gate]).parent;
  const withinCamp = ({ x, y }: Point) => x >= bounds.x - 2 && x < bounds.x + bounds.width + 2
    && y >= bounds.y - 2 && y < bounds.y + bounds.height + 2;
  const roadable = new Set<number>();
  for (let y = bounds.y - 2; y < bounds.y + bounds.height + 2; y++) {
    for (let x = bounds.x - 2; x < bounds.x + bounds.width + 2; x++) {
      const cell = y * world.width + x;
      if (walkable.has(cell) && isBuildable(world, x, y)) roadable.add(cell);
    }
  }
  // Lead from the gate toward the edge of the camp along its existing
  // strategic approach. Then branch to the more distant buildings first.
  let approach = gate;
  for (let next = outside.get(approach); next != null && withinCamp(point(world, next)); next = outside.get(approach)) approach = next;
  const gatePoint = point(world, gate);
  const distanceToGate = (cell: number) => {
    const { x, y } = point(world, cell);
    return Math.abs(x - gatePoint.x) + Math.abs(y - gatePoint.y);
  };
  destinations.sort((a, b) => distanceToGate(b) - distanceToGate(a) || a - b);
  // Camp sizes cap the number of searches at three towers and eighteen tents,
  // plus the two gate approaches. Each search only visits the local site.
  const routes = new Set([gate]), roads = new Set([gate]);
  for (const destination of [refuge, approach, ...destinations]) joinCampTrail(world, walkable, roadable, routes, roads, destination);
  return [...roads].map(cell => point(world, cell));
}
/** The stone ring gives the lair an open aisle inside the corner towers. */
function stoneEnclosure(w:World,c:Point,seed:number):{cells:Point[];gate:Point}|null {
  const radius = CORE_WALL_RADIUS;
  for(let y=c.y-radius;y<=c.y+radius;y++)for(let x=c.x-radius;x<=c.x+radius;x++)
    if(!isBuildable(w,x,y))return null;
  const cells:Point[]=[];
  for(let y=c.y-radius;y<=c.y+radius;y++)for(let x=c.x-radius;x<=c.x+radius;x++)
    if(Math.abs(x-c.x)===radius||Math.abs(y-c.y)===radius)cells.push({x,y});
  const sides=[{x:c.x,y:c.y+radius},{x:c.x+radius,y:c.y},{x:c.x,y:c.y-radius},{x:c.x-radius,y:c.y}];
  const gate=sides.sort((a,b)=>noise(a.x,a.y,seed)-noise(b.x,b.y,seed)).find(g=>{
    const dx=Math.sign(g.x-c.x),dy=Math.sign(g.y-c.y);
    return isBuildable(w,g.x+dx,g.y+dy);
  });
  return gate ? {cells,gate} : null;
}
function assemble(w:World,c:Point,seed:number,candidateCount:number,size:CampSize,variant:number):AdaptiveCampPlan|null {
  const profile = CAMP_SIZE_PROFILES[size];
  const core = stoneEnclosure(w, c, seed + variant);
  if (!core) return null;
  const gate = core.gate, gateKey = id(w, gate);
  const walls = core.cells.filter(p => id(w, p) !== gateKey);
  const lair = { x: c.x - LAIR_OFFSET, y: c.y - LAIR_OFFSET };
  if (!reliefFootprintAllowed(w, lair.x, lair.y, LAIR_SIZE)) return null;
  const refuge = {
    x: c.x + Math.sign(core.gate.x - c.x) * (LAIR_OFFSET + 1),
    y: c.y + Math.sign(core.gate.y - c.y) * (LAIR_OFFSET + 1),
  };
  const refugeKey = id(w, refuge);
  const corners = [-CORE_TOWER_OFFSET, CORE_TOWER_OFFSET];
  const towers: CampLayout['towers'] = corners.flatMap(dy => corners.map(dx => ({ x:c.x+dx, y:c.y+dy, core:true })));
  const blocked = new Set([...walls, ...towers, ...campLairCells(lair)].map(p => id(w, p)));
  const starts = border(w), access = flood(w, blocked, starts);
  if (!access.parent.has(refugeKey)) return null;
  const route = new Set<number>();
  const connect = (parents: Map<number,number|null>, start: number) => {
    for (let k: number | null = start; k !== null && parents.has(k); k = parents.get(k) ?? null) route.add(k);
  };
  connect(access.parent, refugeKey);

  // A watchtower occupies one plot. Reserve its approach and keep towers
  // dispersed without requiring a separate clearing for a perimeter wall.
  const posts:Point[]=[];
  const minPostDistance = CORE_WALL_RADIUS + 4;
  const maxPostDistance = minPostDistance + 2;
  for(let dy=-maxPostDistance;dy<=maxPostDistance;dy++)for(let dx=-maxPostDistance;dx<=maxPostDistance;dx++)
    if(Math.max(Math.abs(dx),Math.abs(dy))>=minPostDistance&&Math.hypot(dx,dy)<=maxPostDistance+2)posts.push({x:c.x+dx,y:c.y+dy});
  posts.sort((a,b)=>noise(a.x,a.y,seed+variant*31)-noise(b.x,b.y,seed+variant*31));
  const outposts: Point[] = [], approaches: number[] = [];
  let local = flood(w, blocked, [refugeKey]);
  for (const post of posts) {
    const key = id(w, post);
    if (!isBuildable(w, post.x, post.y) || route.has(key)
      || outposts.some(other => Math.max(Math.abs(post.x - other.x), Math.abs(post.y - other.y)) < 6)) continue;
    const approach = local.parent.get(key);
    if (approach == null) continue;
    const door = point(w, approach);
    if (!isBuildable(w, door.x, door.y)) continue;
    connect(local.parent, approach);
    outposts.push(post);
    approaches.push(approach);
    towers.push({ ...post, core:false });
    blocked.add(key);
    if (towers.length === profile.minTowers) break;
    local = flood(w, blocked, [refugeKey]);
  }
  if (towers.length !== profile.minTowers) return null;
  const footprint=[...core.cells,...outposts],xs=footprint.map(p=>p.x),ys=footprint.map(p=>p.y);
  const left=Math.min(...xs)-2,right=Math.max(...xs)+2,top=Math.min(...ys)-2,bottom=Math.max(...ys)+2;
  const candidates:Point[]=[];
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
    if(Math.max(Math.abs(x-c.x),Math.abs(y-c.y))<=CORE_WALL_RADIUS)continue;
    const k=y*w.width+x;if(isBuildable(w,x,y)&&!blocked.has(k)&&!route.has(k))candidates.push({x,y});
  }
  // Scatter clusters among outposts instead of filling a gridded tent ward.
  candidates.sort((a,b)=>noise(a.x,a.y,seed)-noise(b.x,b.y,seed));
  const tents:CampLayout['tents']=[];
  for(const p of candidates){
    if(tents.length>=profile.maxTents)break;
    const k=id(w,p),door=k+w.width;
    if(!isBuildable(w,p.x,p.y+1)||blocked.has(door)||door===gateKey||tents.some(t=>Math.abs(t.x-p.x)+Math.abs(t.y-p.y)<3))continue;
    blocked.add(k);const walk=flood(w,blocked,starts);
    if(!walk.parent.has(door)||!walk.parent.has(refugeKey)||tents.some(t=>!walk.parent.has(id(w,t)+w.width))){blocked.delete(k);continue;}
    tents.push(p);
  }
  if(tents.length<profile.minTents)return null;
  const all=[...walls,gate,...towers,...tents],bounds={x:Math.min(...all.map(p=>p.x)),y:Math.min(...all.map(p=>p.y)),width:0,height:0};
  bounds.width=Math.max(...all.map(p=>p.x))-bounds.x+1;bounds.height=Math.max(...all.map(p=>p.y))-bounds.y+1;
  const entrance = flood(w, blocked, starts);
  const paths = campTrails(w, bounds, blocked, entrance.parent, gateKey, refugeKey,
    [...approaches, ...tents.map(tent => id(w, tent) + w.width)]);
  const layout:CampLayout={id:'adaptive',size,name:`${size[0].toUpperCase()+size.slice(1)} Marauder Camp`,subtitle:'Fortified refuge and scattered outposts',description:'',
    width:w.width,height:w.height,previousWidth:25,previousHeight:25,walls,gate,towers,tents,lair,refuge,signs:[],paths,zones:[]};
  const plan:AdaptiveCampPlan={layout,status:'placed',reason:'A stone refuge, freestanding watchtowers and scattered tents fit the existing ground.',bounds,checks:{valid:true,issues:[]},
    adjustments:['A 9×9 stone ring surrounds the 3×3 lair, a walking aisle and four corner towers.',`${outposts.length} freestanding watchtowers protect the tent camp.`,'Only occupied plots are cleared; terrain is never filled or moved.'],
    metrics:{candidateCount,wallTiles:walls.length,tentCount:tents.length,naturalBarrierTiles:0}};
  plan.checks=validateLocalPlan(w,plan);return plan.checks.valid?plan:null;
}
function validateLocalPlan(w:World,plan:AdaptiveCampPlan):{valid:boolean;issues:string[]}{
  if(!plan.layout)return{valid:plan.status==='rejected',issues:[]};
  const l=plan.layout,profile=CAMP_SIZE_PROFILES[l.size],issues:string[]=[];
  const gateKey = id(w, l.gate), defenses = new Set([...l.walls.map(p => id(w, p)), gateKey]);
  const center = { x: l.lair.x + LAIR_OFFSET, y: l.lair.y + LAIR_OFFSET };
  const lair = campLairCells(l.lair);
  if(l.towers.length!==profile.minTowers)issues.push('Incorrect tower count');
  if(l.tents.length<profile.minTents||l.tents.length>profile.maxTents)issues.push('Incorrect tent capacity');
  const coreTowers = l.towers.filter(p => p.core);
  if(coreTowers.length!==4||coreTowers.some(p=>Math.abs(p.x-center.x)!==CORE_TOWER_OFFSET||Math.abs(p.y-center.y)!==CORE_TOWER_OFFSET))issues.push('Invalid core corner towers');
  const core=[...l.walls,l.gate];
  if(core.length!==CORE_WALL_RADIUS*8||core.some(p=>Math.max(Math.abs(p.x-center.x),Math.abs(p.y-center.y))!==CORE_WALL_RADIUS))issues.push('Invalid stone ring around lair');
  if (!reliefFootprintAllowed(w, l.lair.x, l.lair.y, LAIR_SIZE)) issues.push('Unbuildable lair footprint');
  for(const p of [...core,...l.tents,...l.towers,...lair,...l.signs,...l.paths])if(!isBuildable(w,p.x,p.y))issues.push('Unbuildable structure');
  for(const k of defenses){if([1,w.width,w.width+1].every(offset=>defenses.has(k+offset)))issues.push('Double-thick wall');if(DIRS.filter(([dx,dy])=>defenses.has(k+dy*w.width+dx)).length>3)issues.push('Four-way wall junction');}
  const solids=[...l.walls,...l.tents,...l.towers,...lair].map(p=>id(w,p));
  if(new Set(solids).size!==solids.length||solids.includes(gateKey))issues.push('Overlapping structures');
  const blocked=new Set(solids),friendly=flood(w,blocked,[id(w,l.refuge)]),hostile=flood(w,new Set([...blocked,gateKey]),border(w),true);
  const aisleRadius = LAIR_OFFSET + 1;
  for (let dy = -aisleRadius; dy <= aisleRadius; dy++) for (let dx = -aisleRadius; dx <= aisleRadius; dx++)
    if (Math.max(Math.abs(dx), Math.abs(dy)) === aisleRadius && !friendly.parent.has(id(w, { x: center.x + dx, y: center.y + dy })))
      issues.push('Blocked aisle around lair');
  for(const p of [l.gate,...l.tents.map(t=>({...t,y:t.y+1}))])if(!friendly.parent.has(id(w,p)))issues.push('Unreachable gate or tent door');
  for (const tower of l.towers) if (!tower.core && !DIRS.some(([dx, dy]) => {
    const x = tower.x + dx, y = tower.y + dy, cell = y * w.width + x;
    return inside(w, x, y) && friendly.parent.has(cell) && hostile.parent.has(cell);
  })) issues.push('Unreachable freestanding tower');
  if(hostile.parent.has(id(w,l.refuge)))issues.push('Hostile bypass into refuge');
  if(!flood(w,blocked,border(w),true).parent.has(id(w,l.refuge)))issues.push('No strategic approach');
  const roads = new Set(l.paths.map(p => id(w, p)));
  if (!roads.has(gateKey)) issues.push('Missing gate trail');
  const roadAt = (cell: number) => roads.has(cell);
  if (l.paths.some(p => completesTileSquare(w.width, w.height, p.x, p.y, roadAt))) issues.push('Roads fill a 2×2 square');
  for(const p of l.paths)if(blocked.has(id(w,p))||!friendly.parent.has(id(w,p)))issues.push('Invalid road');
  return{valid:issues.length===0,issues:[...new Set(issues)]};
}
function planLocalCamp(world:World,anchor:Point,seed=1):AdaptiveCampPlan{
  let count=0;const candidates:Point[]=[];
  for(let dy=-4;dy<=4;dy+=2)for(let dx=-4;dx<=4;dx+=2)candidates.push({x:anchor.x+dx,y:anchor.y+dy});
  candidates.sort((a,b)=>(Math.abs(a.x-anchor.x)+Math.abs(a.y-anchor.y)+noise(a.x,a.y,seed))-(Math.abs(b.x-anchor.x)+Math.abs(b.y-anchor.y)+noise(b.x,b.y,seed)));
  const size=optionsOf(world)?.size??'large';
  for(const c of candidates)for(let variant=0;variant<6;variant++){
    count++;if(c.x<4||c.y<4||c.x>=world.width-4||c.y>=world.height-4)continue;
    const placed=assemble(world,c,seed,count,size,variant);if(placed)return placed;
  }
  return{layout:null,status:'rejected',reason:`No safe ${size} camp fit found.`,adjustments:[`Tested ${count} bounded layouts without changing terrain.`],bounds:null,checks:{valid:true,issues:[]},metrics:{candidateCount:count,wallTiles:0,tentCount:0}};
}

/** Copy only a small window and remap masks; tile records are shared read-only. */
function cropWindow(world:World,bounds:SearchBounds,options?:CampPlanningOptions):PlanningWorld {
  const tiles:World['tiles']=[],blocked=new Set<number>(),obstacles=new Set<number>();
  const access=options?.access?new Float64Array(bounds.width*bounds.height).fill(Infinity):undefined;
  for(let y=0;y<bounds.height;y++)for(let x=0;x<bounds.width;x++){
    const global=(bounds.y+y)*world.width+bounds.x+x,local=y*bounds.width+x;
    tiles.push(world.tiles[global]);
    if(options?.blocked?.has(global))blocked.add(local);
    if(options?.obstacles?.has(global))obstacles.add(local);
    if(access)access[local]=options!.access![global]??Infinity;
  }
  return{...world,width:bounds.width,height:bounds.height,tiles,campSeedInset:1,campOptions:{blocked,obstacles,access,preserveTrees:options?.preserveTrees,size:options?.size}};
}
function translatePlan(plan:AdaptiveCampPlan,dx:number,dy:number,width:number,height:number):AdaptiveCampPlan {
  const shift=<T extends Point>(p:T):T=>({...p,x:p.x+dx,y:p.y+dy});
  const l=plan.layout;
  return{...plan,bounds:plan.bounds?{...plan.bounds,x:plan.bounds.x+dx,y:plan.bounds.y+dy}:null,
    layout:l?{...l,width,height,walls:l.walls.map(shift),gate:shift(l.gate),towers:l.towers.map(shift),
      tents:l.tents.map(shift),lair:shift(l.lair),refuge:shift(l.refuge),signs:l.signs.map(shift),paths:l.paths.map(shift),zones:l.zones.map(shift)}:null};
}
/** Production options enable a maximum 31×31 search; returned coordinates are global. */
export function planCamp(world:World,anchor:Point,seed=1,options?:CampPlanningOptions):AdaptiveCampPlan {
  if(!options)return planLocalCamp(world,{x:Math.floor(anchor.x),y:Math.floor(anchor.y)},seed);
  const x=Math.max(0,Math.floor(anchor.x)-15),y=Math.max(0,Math.floor(anchor.y)-15);
  const bounds={x,y,width:Math.min(world.width,x+31)-x,height:Math.min(world.height,y+31)-y};
  const local=cropWindow(world,bounds,options),plan=planLocalCamp(local,{x:Math.floor(anchor.x)-x,y:Math.floor(anchor.y)-y},seed);
  return{...translatePlan(plan,x,y,world.width,world.height),searchBounds:bounds};
}
/** Use the same reservations and strategic access supplied when creating the plan. */
export function validatePlan(world:World,plan:AdaptiveCampPlan,options?:CampPlanningOptions):{valid:boolean;issues:string[]} {
  if(plan.searchBounds){const b=plan.searchBounds;return validateLocalPlan(cropWindow(world,b,options),translatePlan(plan,-b.x,-b.y,b.width,b.height));}
  return validateLocalPlan({...world,campOptions:options} as PlanningWorld,plan);
}
