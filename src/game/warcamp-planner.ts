import { type World, type Point, type CampSize, WATER } from './types';
export type { CampSize } from './types';
import { traversable, canTraverseEdge } from './pathfinding';
import { ridgeFootprintAllowed } from './ridges';

export interface CampSizeProfile {
  readonly tierCount:number;
  readonly minTents:number;
  readonly maxTents:number;
  readonly minTowers:number;
  readonly towersPerTier:readonly number[];
}
/** Shared physical capacity targets; production uses these to balance encounters. */
export const CAMP_SIZE_PROFILES = {
  small:{tierCount:2,minTents:3,maxTents:5,minTowers:5,towersPerTier:[4,1]},
  medium:{tierCount:3,minTents:6,maxTents:9,minTowers:6,towersPerTier:[4,1,1]},
  large:{tierCount:4,minTents:10,maxTents:18,minTowers:7,towersPerTier:[4,1,1,1]},
} as const satisfies Readonly<Record<CampSize,CampSizeProfile>>;

/** Pure, bounded terrain-aware layout planner. No state mutation or artwork dependency. */
export interface CampLayout {
  id:string; size:CampSize; name:string; subtitle:string; description:string;
  width:number; height:number; tierCount:number; previousWidth:number; previousHeight:number;
  walls:{x:number;y:number;tier:number}[];
  gates:{x:number;y:number;tier:number;axis:'ns'|'ew'}[];
  towers:{x:number;y:number;tier:number}[];
  tents:{x:number;y:number;tier:number}[];
  /** Tier 1 is the stone keep; other enclosures are independent palisade posts. */
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
  access?:Float64Array;
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
  metrics:{candidateCount:number;wallTiles:number;tentCount:number;tierCount:number;naturalBarrierTiles?:number};
}
const DIRS=[[-1,0],[0,-1],[1,0],[0,1]] as const;
const ALL_DIRS=[...DIRS,[-1,-1],[1,-1],[1,1],[-1,1]];
const id=(w:World,p:Point)=>p.y*w.width+p.x;
const point=(w:World,k:number):Point=>({x:k%w.width,y:Math.floor(k/w.width)});
const inside=(w:World,x:number,y:number)=>x>=0&&y>=0&&x<w.width&&y<w.height;
const noise=(x:number,y:number,s:number)=>{let n=Math.imul(x+s*131,374761393)^Math.imul(y+719,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
export function isBuildable(w:World,x:number,y:number,options=optionsOf(w)):boolean {
  const t=w.tiles[y*w.width+x];
  return inside(w,x,y)&&!!t&&!options?.blocked?.has(y*w.width+x)&&!options?.obstacles?.has(y*w.width+x)
    &&!WATER.has(t.terrain)&&traversable(w,x,y)&&ridgeFootprintAllowed(w,x,y)
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
  // The outer cell is a terrain halo: ridge predicates need real neighbors
  // beyond the access perimeter, or a cropped flat plateau becomes a cliff.
  const inset=(w as PlanningWorld).campSeedInset??0,l=inset,r=w.width-1-inset,t=inset,b=w.height-1-inset,a:number[]=[];
  for(let x=l;x<=r;x++)a.push(t*w.width+x,b*w.width+x);
  for(let y=t+1;y<b;y++)a.push(y*w.width+l,y*w.width+r);
  const access=optionsOf(w)?.access;return access?a.filter(k=>Number.isFinite(access[k])):a;
}
interface Enclosure { center:Point; cells:Point[]; gate:CampLayout['gates'][number]; tier:number }
/** A 5×5 perimeter leaves a true 3×3 court. Each outpost is independent,
 * so tents and patrol roads remain scattered on the open ground between them. */
function enclosure(w:World,c:Point,tier:number,occupied:Set<number>,seed:number):Enclosure|null {
  for(let y=c.y-2;y<=c.y+2;y++)for(let x=c.x-2;x<=c.x+2;x++)
    if(!isBuildable(w,x,y)||occupied.has(y*w.width+x))return null;
  const cells:Point[]=[];
  for(let y=c.y-2;y<=c.y+2;y++)for(let x=c.x-2;x<=c.x+2;x++)
    if(Math.abs(x-c.x)===2||Math.abs(y-c.y)===2)cells.push({x,y});
  const sides=[{x:c.x,y:c.y+2,axis:'ns' as const},{x:c.x+2,y:c.y,axis:'ew' as const},
    {x:c.x,y:c.y-2,axis:'ns' as const},{x:c.x-2,y:c.y,axis:'ew' as const}];
  const gate=sides.sort((a,b)=>noise(a.x,a.y,seed)-noise(b.x,b.y,seed)).find(g=>{
    const dx=Math.sign(g.x-c.x),dy=Math.sign(g.y-c.y);
    return isBuildable(w,g.x+dx,g.y+dy)&&!occupied.has((g.y+dy)*w.width+g.x+dx);
  });
  return gate?{center:c,cells,gate:{...gate,tier},tier}:null;
}
function assemble(w:World,c:Point,seed:number,candidateCount:number,size:CampSize,variant:number):AdaptiveCampPlan|null {
  const profile=CAMP_SIZE_PROFILES[size],reserved=new Set<number>(),enclosures:Enclosure[]=[];
  const reserve=(e:Enclosure)=>{
    enclosures.push(e);
    // A full cell of open ground separates every pair of defensive rings.
    for(let y=e.center.y-3;y<=e.center.y+3;y++)for(let x=e.center.x-3;x<=e.center.x+3;x++)reserved.add(y*w.width+x);
  };
  const core=enclosure(w,c,1,reserved,seed+variant);if(!core)return null;reserve(core);
  const posts:Point[]=[];
  for(let dy=-8;dy<=8;dy++)for(let dx=-8;dx<=8;dx++)
    if(Math.max(Math.abs(dx),Math.abs(dy))>=6&&Math.hypot(dx,dy)<=10)posts.push({x:c.x+dx,y:c.y+dy});
  posts.sort((a,b)=>noise(a.x,a.y,seed+variant*31)-noise(b.x,b.y,seed+variant*31));
  for(const point of posts){
    if(enclosures.length>=profile.tierCount)break;
    const post=enclosure(w,point,enclosures.length+1,reserved,seed);if(post)reserve(post);
  }
  if(enclosures.length!==profile.tierCount)return null;
  const gates=enclosures.map(e=>e.gate),gateKeys=new Set(gates.map(g=>id(w,g)));
  const walls=enclosures.flatMap(e=>e.cells.filter(p=>!gateKeys.has(id(w,p))).map(p=>({...p,tier:e.tier})));
  const towers:CampLayout['towers']=[...[-1,1].flatMap(dy=>[-1,1].map(dx=>({x:c.x+dx,y:c.y+dy,tier:1}))),
    ...enclosures.slice(1).map(e=>({...e.center,tier:e.tier}))];
  const blocked=new Set([...walls,...towers].map(p=>id(w,p))),starts=border(w),access=flood(w,blocked,starts);
  if(gates.some(g=>!access.parent.has(id(w,g)))||!access.parent.has(id(w,c)))return null;
  const route=new Set<number>();
  const connect=(parents:Map<number,number|null>,k:number)=>{while(parents.has(k)){route.add(k);const n=parents.get(k);if(n==null)break;k=n;}};
  for(const g of gates)connect(access.parent,id(w,g));connect(access.parent,id(w,c));
  const footprint=enclosures.flatMap(e=>e.cells),xs=footprint.map(p=>p.x),ys=footprint.map(p=>p.y);
  const left=Math.min(...xs)-2,right=Math.max(...xs)+2,top=Math.min(...ys)-2,bottom=Math.max(...ys)+2;
  const candidates:Point[]=[];
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
    if(enclosures.some(e=>Math.abs(x-e.center.x)<=2&&Math.abs(y-e.center.y)<=2))continue;
    const k=y*w.width+x;if(isBuildable(w,x,y)&&!route.has(k))candidates.push({x,y});
  }
  // Scatter clusters among outposts instead of filling a gridded tent ward.
  candidates.sort((a,b)=>noise(a.x,a.y,seed)-noise(b.x,b.y,seed));
  const tents:CampLayout['tents']=[];
  for(const p of candidates){
    if(tents.length>=profile.maxTents)break;
    const k=id(w,p),door=k+w.width;
    if(!isBuildable(w,p.x,p.y+1)||blocked.has(door)||gateKeys.has(door)||tents.some(t=>Math.abs(t.x-p.x)+Math.abs(t.y-p.y)<3))continue;
    blocked.add(k);const walk=flood(w,blocked,starts);
    if(!walk.parent.has(door)||!walk.parent.has(id(w,c))||gates.some(g=>!walk.parent.has(id(w,g)))||tents.some(t=>!walk.parent.has(id(w,t)+w.width))){blocked.delete(k);continue;}
    tents.push({...p,tier:0});
  }
  if(tents.length<profile.minTents)return null;
  route.clear();const final=flood(w,blocked,[id(w,c)]);
  for(const g of gates)connect(final.parent,id(w,g));for(const t of tents)connect(final.parent,id(w,t)+w.width);
  // One short public approach joins the open camp road network to outside land.
  const entrance=flood(w,blocked,starts);connect(entrance.parent,id(w,gates[0]));
  const all=[...walls,...gates,...towers,...tents],bounds={x:Math.min(...all.map(p=>p.x)),y:Math.min(...all.map(p=>p.y)),width:0,height:0};
  bounds.width=Math.max(...all.map(p=>p.x))-bounds.x+1;bounds.height=Math.max(...all.map(p=>p.y))-bounds.y+1;
  const layout:CampLayout={id:'adaptive',size,name:`${size[0].toUpperCase()+size.slice(1)} Marauder Camp`,subtitle:'Fortified refuge and scattered outposts',description:'',
    width:w.width,height:w.height,tierCount:profile.tierCount,previousWidth:25,previousHeight:25,walls,gates,towers,tents,refuge:{...c},signs:[],
    paths:[...route].map(k=>point(w,k)).filter(p=>isBuildable(w,p.x,p.y)&&!blocked.has(id(w,p))&&p.x>=bounds.x-2&&p.x<bounds.x+bounds.width+2&&p.y>=bounds.y-2&&p.y<bounds.y+bounds.height+2),zones:[]};
  const plan:AdaptiveCampPlan={layout,status:'placed',reason:'A stone refuge, separate palisade watchposts and scattered tents fit the existing ground.',bounds,checks:{valid:true,issues:[]},
    adjustments:['The inner stone ring encloses a 3×3 court with four corner towers.',`${profile.tierCount-1} independent palisade outposts protect the tent camp.`,`Only occupied plots are cleared; terrain is never filled or moved.`],
    metrics:{candidateCount,wallTiles:walls.length,tentCount:tents.length,tierCount:profile.tierCount,naturalBarrierTiles:0}};
  plan.checks=validateLocalPlan(w,plan);return plan.checks.valid?plan:null;
}
function validateLocalPlan(w:World,plan:AdaptiveCampPlan):{valid:boolean;issues:string[]}{
  if(!plan.layout)return{valid:plan.status==='rejected',issues:[]};
  const l=plan.layout,profile=CAMP_SIZE_PROFILES[l.size],issues:string[]=[];
  const walls=new Set(l.walls.map(p=>id(w,p))),gates=new Set(l.gates.map(p=>id(w,p))),defenses=new Set([...walls,...gates]);
  if(l.gates.length!==profile.tierCount||l.towers.length!==profile.minTowers)issues.push('Incorrect outpost capacity');
  if(l.tents.length<profile.minTents||l.tents.length>profile.maxTents)issues.push('Incorrect tent capacity');
  if(l.towers.filter(p=>p.tier===1).length!==4||l.towers.filter(p=>p.tier===1).some(p=>Math.abs(p.x-l.refuge.x)!==1||Math.abs(p.y-l.refuge.y)!==1))issues.push('Invalid core corner towers');
  const core=[...l.walls,...l.gates].filter(p=>p.tier===1);
  if(core.length!==16||core.some(p=>Math.max(Math.abs(p.x-l.refuge.x),Math.abs(p.y-l.refuge.y))!==2))issues.push('Core does not enclose exactly 3×3');
  for(const p of [...l.walls,...l.gates,...l.tents,...l.towers,...l.signs,...l.paths])if(!isBuildable(w,p.x,p.y))issues.push('Unbuildable structure');
  for(const k of defenses){if([1,w.width,w.width+1].every(offset=>defenses.has(k+offset)))issues.push('Double-thick wall');if(DIRS.filter(([dx,dy])=>defenses.has(k+dy*w.width+dx)).length>3)issues.push('Four-way wall junction');}
  const solids=[...l.walls,...l.tents,...l.towers].map(p=>id(w,p));
  if(new Set(solids).size!==solids.length||solids.some(k=>gates.has(k)))issues.push('Overlapping structures');
  const blocked=new Set(solids),friendly=flood(w,blocked,[id(w,l.refuge)],true),hostile=flood(w,new Set([...blocked,...gates]),border(w),true);
  for(const p of [...l.gates,...l.tents.map(t=>({...t,y:t.y+1}))])if(!friendly.parent.has(id(w,p)))issues.push('Unreachable gate or tent door');
  if(hostile.parent.has(id(w,l.refuge)))issues.push('Hostile bypass into refuge');
  if(!flood(w,blocked,border(w),true).parent.has(id(w,l.refuge)))issues.push('No strategic approach');
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
  return{layout:null,status:'rejected',reason:`No safe ${size} camp fit found.`,adjustments:[`Tested ${count} bounded layouts without changing terrain.`],bounds:null,checks:{valid:true,issues:[]},metrics:{candidateCount:count,wallTiles:0,tentCount:0,tierCount:0}};
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
    layout:l?{...l,width,height,walls:l.walls.map(shift),gates:l.gates.map(shift),towers:l.towers.map(shift),
      tents:l.tents.map(shift),refuge:shift(l.refuge),signs:l.signs.map(shift),paths:l.paths.map(shift),zones:l.zones.map(shift)}:null};
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
