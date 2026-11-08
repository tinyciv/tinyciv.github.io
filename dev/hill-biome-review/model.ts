import { hillShape as shapeProposal, hillFloorConnected as proposedFloorConnected, type HillShape as Shape } from '../../src/world/hill-shapes';
import { generateWorld, terrainYields } from '../../src/world/generator';
import { rebuildIncisedRelief } from '../../src/world/regional-relief';
import { ridgeEdgeAllowed, ridgeGroundWalkable, ridgeIsLedge, ridgeStairAccess, STAIR_UP, type StairDirection } from '../../src/game/ridges';
import { canTraverseEdge, traversable } from '../../src/game/pathfinding';
import { WATER, type Point, type Tile, type World } from '../../src/game/types';
import type { LandformFamily, WorldGenerationStyle } from '../../src/world/options';

export interface HillWorldDefinition { id:string;name:string;seed:string;style:WorldGenerationStyle;family:LandformFamily }
export const REVIEW_WORLDS:readonly HillWorldDefinition[]=[
  {id:'1',name:'Dune & grove country',seed:'DUNE-GROVE-61',style:'fractal',family:'rolling-uplands'},
  {id:'2',name:'Copper valleys',seed:'COPPER-BOUGHS-27',style:'pangaea',family:'dissected-plateau'},
  {id:'3',name:'Sandstone & birch',seed:'SAND-BIRCH-19',style:'pangaea',family:'rolling-uplands'},
];
export interface Bounds {x:number;y:number;width:number;height:number}
export interface HillRecord {id:number;region:'desert'|'forest';cells:number[];ramps:number[];shape:string;bounds:Bounds}
export interface HillMetrics {
  hillCount:number;rampCount:number;accessibleHillShare:number;medianHillArea:number;twoLevelHillCount:number;
  smallestHillArea:number;largestHillArea:number;hillSizeDistribution:Record<string,number>;
  corridorTiles:number;narrowCorridorShare:number;treeTiles:number;dryTiles:number;raisedTiles:number;
  shapeCounts:Record<string,number>;waterPreserved:boolean;
}
export interface HillRegion {id:'desert'|'forest';name:string;bounds:Bounds;focus:Point;metrics:HillMetrics}
export interface HillWorld {world:World;regions:HillRegion[];metrics:HillMetrics;hills:HillRecord[]}
const WIDTH=256,HEIGHT=192;
export const BASE_WORLD_OPTIONS={parameters:{reliefCoverage:.04,mountainShare:.25,hillSize:.7},riverDeltas:false} as const;
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]] as const;
function seedNumber(seed:string):number{let n=2166136261;for(const c of seed)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
function randomStream(seed:number):()=>number{return()=>{seed+=0x6d2b79f5;let n=seed;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return((n^n>>>14)>>>0)/4294967296;};}
function hash(x:number,y:number,seed:number):number{let n=Math.imul(x+seed,374761393)^Math.imul(y+seed*3,668265263);n=Math.imul(n^n>>>13,1274126177);return((n^n>>>16)>>>0)/4294967296;}
function field(x:number,y:number,seed:number,scale:number):number{
  const ax=x/scale,ay=y/scale,ix=Math.floor(ax),iy=Math.floor(ay),fx=ax-ix,fy=ay-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const a=hash(ix,iy,seed),b=hash(ix+1,iy,seed),c=hash(ix,iy+1,seed),d=hash(ix+1,iy+1,seed);
  return(a+(b-a)*sx)*(1-sy)+(c+(d-c)*sx)*sy;
}
function climateAt(world:World,x:number,y:number,seed:number):'desert'|'forest'{
  const divide=world.width*(.46+.055*Math.sin(y*.035+seed%9))+(field(x,y,seed+117,31)-.5)*29;
  return x<divide?'desert':'forest';
}
function boundsFor(world:World,cells:number[]):Bounds{
  const xs=cells.map(k=>k%world.width),ys=cells.map(k=>Math.floor(k/world.width));
  return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs)+1,height:Math.max(...ys)-Math.min(...ys)+1};
}
function clearScenery(tile:Tile):void{
  tile.overlay='none';delete tile.marsh;delete tile.palm;delete tile.treeClass;
  delete tile.resource;delete tile.resourceGroup;delete tile.resourceDeveloped;
}
function paintClimate(world:World,seed:number):Set<number>{
  const protectedRidges=new Set<number>();
  for(let k=0;k<world.tiles.length;k++)if(world.tiles[k].waterfall||world.tiles[k].canyon){
    const x=k%world.width,y=Math.floor(k/world.width);
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const t=world.tiles[(y+dy)*world.width+x+dx];if(t?.ridge)protectedRidges.add(t.ridge);
    }
  }
  for(let y=0;y<world.height;y++)for(let x=0;x<world.width;x++){
    const tile=world.tiles[y*world.width+x];if(WATER.has(tile.terrain)||tile.beach)continue;
    if(tile.ridge&&protectedRidges.has(tile.ridge))continue;
    const climate=climateAt(world,x,y,seed);clearScenery(tile);
    delete tile.ridge;delete tile.ridgeTier;delete tile.stair;delete tile.relief;delete tile.mountainPass;delete tile.beach;
    tile.terrain=climate==='desert'?'desert':'grassland';tile.biome=climate==='desert'?'desert':'temperate';
    tile.moisture=climate==='desert'?.18:.68;tile.temperature=climate==='desert'?.83:.55;
    tile.elevation=Math.min(tile.elevation,.46);Object.assign(tile,terrainYields(tile.terrain,tile.overlay));
  }
  return protectedRidges;
}
function principalGround(world:World):Uint8Array{
  const seen=new Uint8Array(world.tiles.length);let largest:number[]=[];
  for(let start=0;start<world.tiles.length;start++){
    const t=world.tiles[start];if(seen[start]||t.ridge||!traversable(world,start%world.width,Math.floor(start/world.width)))continue;
    const q=[start];seen[start]=1;
    for(let h=0;h<q.length;h++){
      const k=q[h],x=k%world.width,y=Math.floor(k/world.width);
      for(const[dx,dy]of DIRS){const nx=x+dx,ny=y+dy,n=ny*world.width+nx;
        if(nx<0||ny<0||nx>=world.width||ny>=world.height||seen[n]||world.tiles[n].ridge
          ||!traversable(world,nx,ny)||!canTraverseEdge(world,{x,y},{x:nx,y:ny}))continue;
        seen[n]=1;q.push(n);
      }
    }
    if(q.length>largest.length)largest=q;
  }
  const mask=new Uint8Array(world.tiles.length);for(const k of largest)mask[k]=1;return mask;
}
function seedDenseHills(world:World,seed:number):Map<number,string>{
  const {width,height,tiles}=world,random=randomStream(seed+741),mainland=principalGround(world),available=new Uint8Array(tiles.length),reserved=new Uint8Array(tiles.length);
  const candidates:number[]=[];
  for(let y=4;y<height-4;y++)for(let x=4;x<width-4;x++){
    const k=y*width+x,tile=tiles[k];if(!mainland[k]||tile.ridge||WATER.has(tile.terrain))continue;
    let valid=true;
    for(let dy=-3;dy<=3&&valid;dy++)for(let dx=-3;dx<=3;dx++){
      const t=tiles[(y+dy)*width+x+dx];
      if(t.ridge||t.waterfall||t.terrain==='ocean'||t.terrain==='coast'||t.beach
        ||Math.abs(dx)<=2&&Math.abs(dy)<=2&&WATER.has(t.terrain)){valid=false;break;}
    }
    if(valid){available[k]=1;candidates.push(k);}
  }
  candidates.sort((a,b)=>hash(a%width,Math.floor(a/width),seed+5)-hash(b%width,Math.floor(b/width),seed+5));
  const fragments:{cells:number[];kind:'hills'|'mountains'}[]=[],shapeAt=new Map<number,string>();
  const place=(k:number,shape:Shape,kind:'hills'|'mountains'):boolean=>{
    const x=k%width,y=Math.floor(k/width),region=climateAt(world,x,y,seed);
    if(!proposedFloorConnected(shape.points))return false;
    if(shape.points.some(p=>x+p.x<3||y+p.y<3||x+p.x>=width-3||y+p.y>=height-3))return false;
    const cells=shape.points.map(p=>(y+p.y)*width+x+p.x);
    if(cells.some(n=>!available[n]||reserved[n]||climateAt(world,n%width,Math.floor(n/width),seed)!==region))return false;
    if(kind==='mountains'&&cells.some(n=>[...world.spawns,...(world.secondarySpawns??[])].some(p=>Math.hypot(p.x-n%width,p.y-Math.floor(n/width))<7)))return false;
    fragments.push({cells,kind});for(const n of cells)shapeAt.set(n,shape.name);
    for(const n of cells){const nx=n%width,ny=Math.floor(n/width);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)reserved[(ny+dy)*width+nx+dx]=1;}
    return true;
  };
  // Reserve a few broad landmark hills before small knolls consume their room.
  // Their lower terraces use the same one-cell passage reservation as the rest.
  const landmarks:Point[]=[],counts={desert:0,forest:0};
  for(const k of candidates){
    const x=k%width,y=Math.floor(k/width),region=climateAt(world,x,y,seed);
    if(counts[region]>=6||reserved[k]||landmarks.some(p=>Math.hypot(p.x-x,p.y-y)<22))continue;
    if(place(k,shapeProposal(random,true),'mountains')){counts[region]++;landmarks.push({x,y});}
    if(counts.desert>=6&&counts.forest>=6)break;
  }
  for(const k of candidates){
    if(reserved[k])continue;
    // Try alternate orientations and footprints in the same opening. A single
    // failed random contour otherwise leaves broad empty strips between hills.
    for(let attempt=0;attempt<8;attempt++){
      if(place(k,shapeProposal(random),'hills'))break;
    }
  }
  // Let each small shelf occupy nearby spare ground. This follows its original
  // contour, but stops one tile short of its neighbours: the negative space
  // becomes winding passages instead of a wide plain with scattered buttons.
  const owner=new Int32Array(tiles.length),names=fragments.map(f=>shapeAt.get(f.cells[0])!);
  const growth=fragments.map(f=>hash(f.cells[0]%width,Math.floor(f.cells[0]/width),seed+991)<.22?0:2);
  fragments.forEach((fragment,index)=>{for(const cell of fragment.cells)owner[cell]=index+1;});
  for(let round=0;round<2;round++){
    const additions:{cell:number;id:number}[]=[];
    for(const cell of candidates){
      if(owner[cell]||!available[cell])continue;
      const x=cell%width,y=Math.floor(cell/width),near=new Set<number>();
      for(const[dx,dy]of DIRS){const id=owner[(y+dy)*width+x+dx];if(id)near.add(id);}
      if(near.size!==1)continue;
      const id=[...near][0],fragment=fragments[id-1];
      if(round>=growth[id-1])continue;
      if(climateAt(world,x,y,seed)!==climateAt(world,fragment.cells[0]%width,Math.floor(fragment.cells[0]/width),seed))continue;
      additions.push({cell,id});
    }
    for(const{cell,id}of additions){
      const x=cell%width,y=Math.floor(cell/width);let clear=true;
      for(let dy=-1;dy<=1&&clear;dy++)for(let dx=-1;dx<=1;dx++){
        const other=owner[(y+dy)*width+x+dx];if(other&&other!==id){clear=false;break;}
      }
      if(clear&&fragments[id-1].cells.length<320){owner[cell]=id;fragments[id-1].cells.push(cell);shapeAt.set(cell,names[id-1]);}
    }
  }
  // Larger bodies occasionally use the native two-flight relief builder.
  // It constructs and validates both the lower terrace and the upper summit.
  for(const fragment of fragments){
    if(fragment.cells.length>=110&&hash(fragment.cells[0]%width,Math.floor(fragment.cells[0]/width),seed+881)<.7)fragment.kind='mountains';
  }
  rebuildIncisedRelief(world,fragments);
  // Native mountain contours can retain a thin upper crest with no summit
  // floor. These previews promise usable second levels, so rebuild such a
  // body as a single-level hill through the same production ramp builder.
  const groups=new Map<number,number[]>();
  for(const cell of shapeAt.keys()){
    const id=tiles[cell].ridge;if(!id)continue;
    const cells=groups.get(id)??[];cells.push(cell);groups.set(id,cells);
  }
  const flatten:{cells:number[];kind:'hills'}[]=[];
  for(const cells of groups.values()){
    const upper=cells.filter(cell=>tiles[cell].ridgeTier===2);
    if(!upper.length||upper.some(cell=>tiles[cell].stair)&&upper.some(cell=>!tiles[cell].stair&&ridgeGroundWalkable(world,cell%width,Math.floor(cell/width))))continue;
    for(const cell of cells){delete tiles[cell].ridge;delete tiles[cell].ridgeTier;delete tiles[cell].stair;delete tiles[cell].relief;}
    flatten.push({cells,kind:'hills'});
  }
  if(flatten.length)rebuildIncisedRelief(world,flatten);
  for(const cell of shapeAt.keys())if(tiles[cell].ridge){
    tiles[cell].relief='hills';tiles[cell].elevation=tiles[cell].ridgeTier===2?.86:.76;
  }
  return shapeAt;
}
function collectHills(world:World,shapeAt:Map<number,string>,seed:number):HillRecord[]{
  const groups=new Map<number,number[]>();
  for(const[k]of shapeAt){const id=world.tiles[k].ridge;if(id===undefined)continue;const cells=groups.get(id)??[];cells.push(k);groups.set(id,cells);}
  return[...groups].map(([id,cells])=>{const bounds=boundsFor(world,cells);return{id,region:climateAt(world,bounds.x+bounds.width/2,bounds.y+bounds.height/2,seed),cells,
    ramps:cells.filter(k=>!!world.tiles[k].stair),shape:shapeAt.get(cells[0])??'contour',bounds};});
}
function corridorWidth(world:World,x:number,y:number):number{
  const tile=world.tiles[y*world.width+x];if(tile.ridge||WATER.has(tile.terrain))return 0;
  let best=Infinity;
  for(const[dx,dy]of[[1,0],[0,1]]){
    let a=0,b=0,one=0,two=0;
    for(let step=1;step<=6;step++){const t=world.tiles[(y-dy*step)*world.width+x-dx*step];if(t?.ridge){a=step;one=t.ridge;break;}if(!t||WATER.has(t.terrain))break;}
    for(let step=1;step<=6;step++){const t=world.tiles[(y+dy*step)*world.width+x+dx*step];if(t?.ridge){b=step;two=t.ridge;break;}if(!t||WATER.has(t.terrain))break;}
    if(a&&b&&one!==two)best=Math.min(best,a+b-1);
  }
  return Number.isFinite(best)?best:0;
}
function dressWoodland(world:World,seed:number):void{
  for(let y=1;y<world.height-1;y++)for(let x=1;x<world.width-1;x++){
    const tile=world.tiles[y*world.width+x];if(WATER.has(tile.terrain)||tile.waterfall||ridgeIsLedge(world,x,y))continue;
    if(ridgeStairAccess(world,x,y)){clearScenery(tile);continue;}
    if(tile.terrain!=='grassland')continue;
    if(corridorWidth(world,x,y)>0&&corridorWidth(world,x,y)<=3){tile.overlay='none';continue;}
    const patches=field(x,y,seed+238,9),open=field(x,y,seed+471,21),chance=open<.25?.06:.17+patches*.26;
    tile.overlay=hash(x,y,seed+334)<chance?'forest':'none';
    if(tile.overlay==='forest')tile.treeClass=field(x,y,seed+167,25)>.53?'conifer':'temperate';
  }
  const wooded=(cell:number)=>world.tiles[cell]?.overlay==='forest';
  // Perforate the tree patches, including summit groves. Every remaining tree
  // borders real open ground, and no solid2×2 canopy block survives.
  for(let y=1;y<world.height-1;y++)for(let x=1;x<world.width-1;x++){
    const k=y*world.width+x;if(!wooded(k))continue;
    if([k,k+1,k+world.width,k+world.width+1].every(wooded))clearScenery(world.tiles[k]);
  }
  for(let y=1;y<world.height-1;y++)for(let x=1;x<world.width-1;x++){
    const k=y*world.width+x;if(!wooded(k))continue;
    if(!DIRS.some(([dx,dy])=>!wooded((y+dy)*world.width+x+dx)&&traversable(world,x+dx,y+dy)
      &&canTraverseEdge(world,{x,y},{x:x+dx,y:y+dy})))clearScenery(world.tiles[k]);
  }
}
function metricsFor(world:World,hills:HillRecord[],bounds?:Bounds):HillMetrics{
  const within=(x:number,y:number)=>!bounds||x>=bounds.x&&y>=bounds.y&&x<bounds.x+bounds.width&&y<bounds.y+bounds.height;
  const areas=hills.map(h=>h.cells.length).sort((a,b)=>a-b),shapeCounts:Record<string,number>={},hillSizeDistribution={'under25':0,'25to49':0,'50to79':0,'80plus':0};
  for(const hill of hills){shapeCounts[hill.shape]=(shapeCounts[hill.shape]??0)+1;hillSizeDistribution[hill.cells.length<25?'under25':hill.cells.length<50?'25to49':hill.cells.length<80?'50to79':'80plus']++;}
  let corridors=0,narrow=0,treeTiles=0,dryTiles=0,raisedTiles=0;
  for(let y=0;y<world.height;y++)for(let x=0;x<world.width;x++)if(within(x,y)){
    const tile=world.tiles[y*world.width+x];if(WATER.has(tile.terrain))continue;dryTiles++;raisedTiles+=Number(!!tile.ridge);treeTiles+=Number(tile.overlay==='forest');
    const width=corridorWidth(world,x,y);if(width){corridors++;narrow+=Number(width<=3);}
  }
  return{hillCount:hills.length,twoLevelHillCount:hills.filter(h=>h.cells.some(k=>world.tiles[k].ridgeTier===2)).length,rampCount:hills.reduce((n,h)=>n+h.ramps.length,0),accessibleHillShare:hills.filter(h=>h.ramps.some(k=>ridgeGroundWalkable(world,k%world.width,Math.floor(k/world.width)))).length/Math.max(1,hills.length),
    medianHillArea:areas[Math.floor(areas.length/2)]??0,smallestHillArea:areas[0]??0,largestHillArea:areas.at(-1)??0,hillSizeDistribution,corridorTiles:corridors,narrowCorridorShare:narrow/Math.max(1,corridors),treeTiles,dryTiles,raisedTiles,shapeCounts,waterPreserved:true};
}
function findRegion(world:World,hills:HillRecord[],id:'desert'|'forest'):HillRegion{
  const own=hills.filter(h=>h.region===id),width=80,height=70;let best:Bounds={x:Math.floor(world.width/2-width/2),y:Math.floor(world.height/2-height/2),width,height},score=-Infinity;
  for(let y=3;y<=world.height-height-3;y+=4)for(let x=3;x<=world.width-width-3;x+=4){
    const local=own.filter(h=>h.bounds.x>=x&&h.bounds.y>=y&&h.bounds.x+h.bounds.width<=x+width&&h.bounds.y+h.bounds.height<=y+height);
    const value=local.length+local.reduce((n,h)=>n+h.cells.length,0)*.007
      +local.filter(h=>h.cells.some(k=>world.tiles[k].ridgeTier===2)).length*4;
    if(value>score){score=value;best={x,y,width,height};}
  }
  const selected=own.filter(h=>h.bounds.x>=best.x&&h.bounds.y>=best.y&&h.bounds.x+h.bounds.width<=best.x+width&&h.bounds.y+h.bounds.height<=best.y+height);
  let focus:Point={x:best.x+width/2,y:best.y+height/2};
  if(selected.length){const candidate=selected.slice().sort((a,b)=>{
    const n=(h:HillRecord)=>selected.filter(other=>Math.hypot(other.bounds.x-h.bounds.x,other.bounds.y-h.bounds.y)<19).length
      +(h.cells.some(k=>world.tiles[k].ridgeTier===2)?12:0);
    return n(b)-n(a);
  })[0];focus={x:candidate.bounds.x+candidate.bounds.width/2,y:candidate.bounds.y+candidate.bounds.height/2};}
  return{id,name:id==='desert'?'Desert hill labyrinth':'Forest hill labyrinth',bounds:best,focus,metrics:metricsFor(world,selected,best)};
}
export function generateHillWorld(definition:HillWorldDefinition):HillWorld{
  const world=generateWorld(definition.seed,WIDTH,HEIGHT,{...BASE_WORLD_OPTIONS,style:definition.style,landformFamily:definition.family});
  const seed=seedNumber(definition.seed),waterBefore=world.tiles.map(t=>WATER.has(t.terrain)?JSON.stringify(t):'');
  const protectedRidges=paintClimate(world,seed);
  const shapeAt=seedDenseHills(world,seed),hills=collectHills(world,shapeAt,seed);
  // Dense adjacent aprons are harmonized together by the production builder.
  // Restore the intended irregular climate divide after that geometry pass,
  // so a connected apron cannot repaint an entire neighbouring biome.
  for(let y=0;y<world.height;y++)for(let x=0;x<world.width;x++){
    const tile=world.tiles[y*world.width+x];
    if(WATER.has(tile.terrain)||tile.beach||tile.ridge&&protectedRidges.has(tile.ridge))continue;
    const climate=climateAt(world,x,y,seed);
    tile.terrain=climate==='desert'?'desert':'grassland';tile.biome=climate==='desert'?'desert':'temperate';
    Object.assign(tile,terrainYields(tile.terrain,tile.overlay));
  }
  dressWoodland(world,seed);
  const waterPreserved=world.tiles.every((t,i)=>!waterBefore[i]||waterBefore[i]===JSON.stringify(t));
  if(!waterPreserved)throw new Error('Review altered generated water cells.');
  world.source+=' · review-only desert/forest climate and dense small-hill proposals through native relief builder';
  const metrics=metricsFor(world,hills),regions=(['desert','forest'] as const).map(id=>findRegion(world,hills,id));
  return{world,regions,metrics,hills};
}
