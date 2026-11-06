/** Compact review plans. Coordinates are native 16px cells; tents occupy one
 * cell and open south. Gate axes describe passage through the stockade. */
export interface CampLayout {
  id:string; name:string; subtitle:string; description:string;
  width:number; height:number; tierCount:number; previousWidth:number; previousHeight:number;
  walls:{x:number;y:number;tier:number}[];
  gates:{x:number;y:number;tier:number;axis:'ns'|'ew'}[];
  towers:{x:number;y:number;tier:number}[];
  tents:{x:number;y:number;tier:number}[];
  signs:{x:number;y:number}[]; paths:{x:number;y:number}[];
  zones:{x:number;y:number;width:number;height:number;label:string}[];
}
type XY=readonly[number,number];
type Plan=Omit<CampLayout,'walls'|'signs'|'paths'>&{rings:{tier:number;points:XY[]}[];partitions?:{tier:number;from:XY;to:XY}[]};
const key=(x:number,y:number):string=>`${x},${y}`;
const steps=[[0,-1],[-1,0],[1,0],[0,1]] as const;
const rectangle=(x:number,y:number,r:number,b:number):XY[]=>[[x,y],[r,y],[r,b],[x,b]];
const tents=(tier:number,cells:XY[]):CampLayout['tents']=>cells.map(([x,y])=>({x,y,tier}));
const towers=(tier:number,cells:XY[]):CampLayout['towers']=>cells.map(([x,y])=>({x,y,tier}));
const gate=(x:number,y:number,tier:number,axis:'ns'|'ew'):CampLayout['gates'][number]=>({x,y,tier,axis});

const PLANS:Plan[]=[
  {
    id:'1A',name:'Thornhook Hold',subtitle:'Tight double bailey',width:21,height:21,previousWidth:39,previousHeight:35,tierCount:2,
    description:'Close tent rows fill the outer yard. An offset inner stockade creates a short dogleg from the south gate to the guarded eastern court.',
    rings:[{tier:1,points:[[2,2],[17,2],[17,6],[19,6],[19,18],[12,18],[12,19],[2,19]]},{tier:2,points:rectangle(11,5,17,13)}],
    gates:[gate(7,19,1,'ns'),gate(11,10,2,'ew')],
    towers:[...towers(1,[[2,2],[17,2],[19,6],[19,18],[2,19]]),...towers(2,[[11,5],[17,13]])],
    tents:[...tents(1,[[4,4],[6,4],[8,4],[4,7],[6,7],[8,7],[4,10],[6,10],[8,10],[4,13],[6,13],[8,13],[4,16],[8,16],[13,15],[15,15],[17,15]]),...tents(2,[[13,7],[15,7],[13,10],[15,10]])],
    zones:[{x:3,y:3,width:7,height:12,label:'Company rows'},{x:12,y:6,width:4,height:6,label:'Inner court'}],
  },
  {
    id:'1B',name:'The Three Rings',subtitle:'Three compact stockades',width:23,height:23,previousWidth:42,previousHeight:40,tierCount:3,
    description:'Three closely spaced rings share narrow circulation lanes. Alternating gates protect a small final enclosure without broad empty courtyards.',
    rings:[{tier:1,points:[[3,2],[19,2],[19,3],[20,3],[20,19],[19,19],[19,20],[3,20],[3,19],[2,19],[2,3],[3,3]]},{tier:2,points:rectangle(5,5,17,17)},{tier:3,points:rectangle(8,8,14,14)}],
    gates:[gate(11,20,1,'ns'),gate(5,11,2,'ew'),gate(11,14,3,'ns')],
    towers:[...towers(1,[[3,2],[19,2],[20,19],[2,19]]),...towers(2,[[5,5],[17,17]]),...towers(3,[[8,8],[14,14]])],
    tents:[...tents(1,[[6,3],[9,3],[12,3],[15,3],[6,18],[9,18],[14,18],[17,18],[3,7],[3,13],[19,7],[19,13]]),...tents(2,[[7,6],[11,6],[15,6],[6,9],[6,13],[16,9],[16,13],[9,15],[13,15]]),...tents(3,[[10,10],[12,10],[10,12]])],
    zones:[{x:3,y:4,width:2,height:13,label:'Outer lane'},{x:6,y:6,width:11,height:2,label:'Guard lane'},{x:9,y:9,width:5,height:5,label:'Final enclosure'}],
  },
  {
    id:'2A',name:'Split-Banner Camp',subtitle:'Paired clan courts',width:25,height:19,previousWidth:46,previousHeight:33,tierCount:2,
    description:'Two small tent compounds sit behind a shared perimeter and a gated dividing wall. Short lanes connect the clans through a watched southern passage.',
    rings:[{tier:1,points:[[2,3],[10,3],[10,2],[22,2],[22,15],[14,15],[14,17],[2,17]]},{tier:2,points:rectangle(5,6,10,13)},{tier:2,points:rectangle(15,5,20,12)}],
    partitions:[{tier:1,from:[12,2],to:[12,17]}],
    gates:[gate(7,17,1,'ns'),gate(12,14,1,'ew'),gate(7,13,2,'ns'),gate(15,9,2,'ew')],
    towers:[...towers(1,[[2,3],[22,2],[22,15],[2,17]]),...towers(2,[[5,6],[10,6],[15,5],[20,5]])],
    tents:[...tents(2,[[6,7],[8,7],[6,10],[8,10],[16,6],[18,6],[16,10],[18,10]]),...tents(1,[[3,5],[3,8],[3,11],[4,15],[9,15],[14,3],[17,3],[20,3],[15,13],[18,13],[21,13]])],
    zones:[{x:6,y:7,width:4,height:5,label:'West clan'},{x:16,y:6,width:4,height:5,label:'East clan'},{x:3,y:14,width:9,height:3,label:'Shared approach'}],
  },
  {
    id:'2B',name:'Crooked Fang Redoubt',subtitle:'Stepped inner palisade',width:23,height:21,previousWidth:41,previousHeight:39,tierCount:2,
    description:'An angular inner wall follows the edge of tightly grouped tents. Its projecting corners overlook the short western entry and the southern circulation lane.',
    rings:[{tier:1,points:[[3,2],[18,2],[18,5],[20,5],[20,17],[16,17],[16,19],[4,19],[4,16],[2,16],[2,5],[3,5]]},{tier:2,points:[[10,6],[16,6],[16,10],[18,10],[18,15],[12,15],[12,13],[8,13],[8,9],[10,9]]}],
    gates:[gate(2,11,1,'ew'),gate(8,11,2,'ew')],
    towers:[...towers(1,[[3,2],[18,2],[20,5],[20,17],[4,19]]),...towers(2,[[10,6],[18,15]])],
    tents:[...tents(1,[[4,4],[6,4],[8,4],[4,7],[6,7],[4,10],[6,10],[4,13],[6,13],[6,16],[9,16],[12,17],[14,17],[12,3],[15,3],[17,6]]),...tents(2,[[11,7],[13,7],[11,10],[14,11],[16,12]])],
    zones:[{x:3,y:6,width:4,height:9,label:'Outer rows'},{x:11,y:7,width:6,height:7,label:'Inner redoubt'}],
  },
  {
    id:'3A',name:'The Long Gate',subtitle:'Three short defended courts',width:19,height:25,previousWidth:34,previousHeight:47,tierCount:3,
    description:'Three short courts sit in sequence behind a projecting entrance. Offset crosswall gates create a zigzag approach between close tent rows and paired watchtowers.',
    rings:[{tier:1,points:[[2,2],[16,2],[16,20],[12,20],[12,23],[6,23],[6,20],[2,20]]}],
    partitions:[{tier:2,from:[2,15],to:[16,15]},{tier:3,from:[2,9],to:[16,9]}],
    gates:[gate(9,23,1,'ns'),gate(5,15,2,'ns'),gate(13,9,3,'ns')],
    towers:[...towers(1,[[2,2],[16,2],[2,20],[16,20]]),...towers(2,[[3,15],[15,15]]),...towers(3,[[4,9],[15,9]])],
    tents:[...tents(1,[[4,17],[7,17],[10,17],[13,17]]),...tents(2,[[4,10],[7,10],[10,10],[14,10],[4,13],[8,13],[12,13]]),...tents(3,[[4,3],[7,3],[10,3],[13,3],[4,6],[7,6],[10,6],[13,6]])],
    zones:[{x:3,y:16,width:12,height:4,label:'Entrance court'},{x:3,y:10,width:12,height:5,label:'Middle court'},{x:3,y:3,width:12,height:5,label:'Final court'}],
  },
  {
    id:'3B',name:'Blackroot Warcamp',subtitle:'Three tight interlocking wards',width:19,height:19,previousWidth:46,previousHeight:43,tierCount:3,
    description:'Three irregular stockades wrap close tent rows and short, narrow roads. Every wall is one tile thick, with open ground separating the tiers. Staggered gates lead from the western entrance to the southern ward and the eastern inner gate.',
    rings:[{tier:1,points:[[3,1],[11,1],[11,2],[16,2],[16,5],[17,5],[17,12],[16,12],[16,16],[13,16],[13,17],[3,17],[3,14],[1,14],[1,7],[3,7]]},{tier:2,points:[[5,5],[10,5],[10,4],[14,4],[14,13],[12,13],[12,15],[5,15],[5,12],[3,12],[3,9],[5,9]]},{tier:3,points:[[7,7],[11,7],[11,11],[7,11]]}],
    gates:[gate(1,10,1,'ew'),gate(5,14,2,'ew'),gate(11,9,3,'ew')],
    towers:[...towers(1,[[3,1],[16,2],[17,5],[16,16],[3,17]]),...towers(2,[[5,5],[12,15]]),...towers(3,[[7,7]])],
    tents:[...tents(1,[[4,2],[6,2],[8,2],[15,9],[14,14]]),...tents(2,[[6,6],[12,5],[12,8],[12,11],[9,12],[6,13],[8,13],[10,13],[4,10]]),...tents(3,[[8,8],[9,8],[10,8]])],
    zones:[{x:4,y:2,width:6,height:3,label:'Outer rows'},{x:6,y:12,width:6,height:3,label:'Second ward'},{x:8,y:8,width:3,height:3,label:'Inner ward'}],
  },

];

function walk(width:number,height:number,blocked:Set<string>,start:XY):Map<string,string|null>{
  const parent=new Map<string,string|null>([[key(...start),null]]),queue:XY[]=[start];
  for(let i=0;i<queue.length;i++)for(const[dx,dy]of steps){
    const[x,y]=[queue[i][0]+dx,queue[i][1]+dy],k=key(x,y);
    if(x<0||y<0||x>=width||y>=height||blocked.has(k)||parent.has(k))continue;
    parent.set(k,key(...queue[i]));queue.push([x,y]);
  }return parent;
}
function make(plan:Plan):CampLayout{
  const{rings,partitions,...layout}=plan,walls=new Map<string,CampLayout['walls'][number]>();
  const segment=(a:XY,b:XY,tier:number):void=>{
    if(a[0]!==b[0]&&a[1]!==b[1])throw new Error(`${plan.id}: diagonal wall`);
    const dx=Math.sign(b[0]-a[0]),dy=Math.sign(b[1]-a[1]),length=Math.abs(b[0]-a[0])+Math.abs(b[1]-a[1]);
    for(let i=0;i<=length;i++){const x=a[0]+i*dx,y=a[1]+i*dy,k=key(x,y);if(!walls.has(k))walls.set(k,{x,y,tier});}
  };
  for(const ring of rings)for(let i=0;i<ring.points.length;i++)segment(ring.points[i],ring.points[(i+1)%ring.points.length],ring.tier);
  for(const part of partitions??[])segment(part.from,part.to,part.tier);
  for(const gate of layout.gates)if(!walls.delete(key(gate.x,gate.y)))throw new Error(`${plan.id}: gate misses wall`);
  const blocked=new Set(walls.keys()),gateKeys=new Set(layout.gates.map(g=>key(g.x,g.y)));
  for(const tent of layout.tents){const k=key(tent.x,tent.y);if(blocked.has(k)||gateKeys.has(k))throw new Error(`${plan.id}: tent overlap ${k}`);blocked.add(k);}
  const parent=walk(layout.width,layout.height,blocked,[Math.floor(layout.width/2),layout.height-1]),pathKeys=new Set<string>();
  const connect=(x:number,y:number):void=>{let k:string|null=key(x,y);if(!parent.has(k))throw new Error(`${plan.id}: unreachable door or gate ${k}`);while(k){pathKeys.add(k);k=parent.get(k)!;}};
  for(const gate of layout.gates)connect(gate.x,gate.y);
  for(const tent of layout.tents)connect(tent.x,tent.y+1);
  const signs:CampLayout['signs']=[];
  for(const gate of layout.gates){
    const candidates=gate.axis==='ns'?[[1,-1],[-1,-1],[1,1],[-1,1],[2,-1],[-2,-1]]:[[1,-1],[1,1],[-1,-1],[-1,1],[1,-2],[1,2]];
    for(const[dx,dy]of candidates){const x=gate.x+dx,y=gate.y+dy,k=key(x,y);if(x<1||y<1||x>=layout.width-1||y>=layout.height-1||blocked.has(k)||pathKeys.has(k)||gateKeys.has(k))continue;signs.push({x,y});blocked.add(k);break;}
  }
  return{...layout,walls:[...walls.values()],signs,paths:[...pathKeys].map(k=>{const[x,y]=k.split(',').map(Number);return{x,y};})};
}
export const CAMP_LAYOUTS:CampLayout[]=PLANS.map(make);

export function validateCampLayout(layout:CampLayout):{valid:boolean;issues:string[];tentGateDepths:number[]}{
  const issues:string[]=[],blocked=new Set(layout.walls.map(w=>key(w.x,w.y))),gateKeys=new Set(layout.gates.map(g=>key(g.x,g.y)));
  if(blocked.size!==layout.walls.length)issues.push('Duplicate wall cell');
  const defenses=new Map([...layout.walls,...layout.gates].map(p=>[key(p.x,p.y),p.tier]));
  for(const p of [...layout.walls,...layout.gates]){
    if([[1,0],[0,1],[1,1]].every(([dx,dy])=>defenses.has(key(p.x+dx,p.y+dy))))issues.push(`Double-thick wall block at ${p.x},${p.y}`);
    if(layout.id==='3B')for(const[dx,dy]of [[1,0],[0,1]]){
      const neighbor=defenses.get(key(p.x+dx,p.y+dy));
      if(neighbor!==undefined&&neighbor!==p.tier)issues.push(`Touching defensive tiers at ${p.x},${p.y}`);
    }
  }
  const inBounds=(x:number,y:number):boolean=>x>=0&&y>=0&&x<layout.width&&y<layout.height;
  for(const item of [...layout.walls,...layout.gates,...layout.towers,...layout.tents,...layout.signs,...layout.paths])if(!inBounds(item.x,item.y))issues.push(`Out of bounds at ${item.x},${item.y}`);
  for(const tower of layout.towers)if(!blocked.has(key(tower.x,tower.y))||gateKeys.has(key(tower.x,tower.y)))issues.push(`Tower off wall at ${tower.x},${tower.y}`);
  for(const item of [...layout.tents,...layout.signs]){const k=key(item.x,item.y);if(blocked.has(k)||gateKeys.has(k))issues.push(`Overlap at ${k}`);blocked.add(k);}
  const distances=new Map<string,number>(),queue:{x:number;y:number;cost:number}[]=[];
  for(let x=0;x<layout.width;x++)queue.push({x,y:0,cost:0},{x,y:layout.height-1,cost:0});
  for(let y=1;y<layout.height-1;y++)queue.push({x:0,y,cost:0},{x:layout.width-1,y,cost:0});
  while(queue.length){queue.sort((a,b)=>b.cost-a.cost);const p=queue.pop()!,k=key(p.x,p.y);if(distances.has(k)&&distances.get(k)!<=p.cost)continue;distances.set(k,p.cost);
    for(const[dx,dy]of steps){const x=p.x+dx,y=p.y+dy,n=key(x,y),cost=p.cost+Number(gateKeys.has(n));if(inBounds(x,y)&&!blocked.has(n)&&(!distances.has(n)||distances.get(n)!>cost))queue.push({x,y,cost});}
  }
  const tentGateDepths=layout.tents.map(tent=>distances.get(key(tent.x,tent.y+1))??Infinity);
  tentGateDepths.forEach((depth,i)=>{if(!Number.isFinite(depth)||depth<layout.tents[i].tier)issues.push(`Tent ${i}: expected tier ${layout.tents[i].tier}, gate depth ${depth}`);});
  for(const path of layout.paths)if(blocked.has(key(path.x,path.y)))issues.push(`Road crosses obstacle at ${path.x},${path.y}`);
  if(layout.width>25||layout.height>25||layout.width*layout.height>layout.previousWidth*layout.previousHeight*.35)issues.push('Camp footprint is not compact enough');
  return{valid:issues.length===0,issues,tentGateDepths};
}
