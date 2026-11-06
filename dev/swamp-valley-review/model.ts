import { WATER, type Point, type Tile, type World } from '../../src/game/types';
import { ridgeGroundWalkable } from '../../src/game/ridges';
import { placeValleyVegetation } from './ecology';

export interface ValleyVariant {
  id: string; name: string; description: string; notes: string[];
  /** Relative to the approved production marsh plant's 2.45-tile height. */
  plantScale: number; plantDensity: number;
}
export const VARIANTS: readonly ValleyVariant[] = [
  { id: '1A', name: 'Oxbow fen', description: 'Tight one-tile loops and closely spaced braids curl around narrow reed islands and open meadow strips.',
    notes: ['Tighter bends with five closely spaced branching routes', 'Narrow land strips replace the wide braid interiors', 'Three oxbows sit beside dense reed beds and open meadow'], plantScale: .58, plantDensity: .64 },
  { id: '1B', name: 'Reed islands', description: 'Several one-tile channels wind through dense reed islands, then gather beside open banks.',
    notes: ['Six connected routes wind around dry islands', 'One-tile water lanes disappear into dense reed beds', 'Three curved cutoffs contrast with quieter dry banks'], plantScale: .66, plantDensity: .72 },
  { id: '2A', name: 'Terraced wet meadow', description: 'Thin channels split below grassy ledges, passing through reed coves and broad open meadows.',
    notes: ['Thin branching channels below native grassy ledges', 'Three oxbows and two small pools fill low pockets', 'Open upper meadows contrast with dense reed coves'], plantScale: .52, plantDensity: .58 },
  { id: '2B', name: 'Wooded backwaters', description: 'Narrow river loops weave between wooded patches, open clearings, and curved cutoffs.',
    notes: ['Four connected river routes weave around backwater islands', 'Curved cutoffs sit beside loose woodland groves', 'Rush thickets alternate with open grassy clearings'], plantScale: .61, plantDensity: .61 },
];
export interface ValleyMetrics {
  waterTiles: number; waterCoverage: number; pondCount: number; pondTiles: number;
  marshTiles: number; treeTiles: number; mainSinuosity: number; ridgeTiles: number; ramps: number;
  branchCount: number; oxbowCount: number; compactPondCount: number; oneTileChannelShare: number; narrowBankShare: number; widenedTiles: number;
}
export interface ValleyScene {
  world: World; variant: ValleyVariant; seed: number; metrics: ValleyMetrics; mainChannel: Point[]; ponds: Point[][];
  channelPaths: Point[][]; oxbows: Point[][]; thinChannelCells: Point[]; widenedCells: Point[];
  grassScales: number[]; habitatCounts: Record<string,number>;
}
const WIDTH = 48, HEIGHT = 32;
function hash(x: number, y: number, seed: number): number {
  let n = Math.imul(x + seed * 29, 374761393) ^ Math.imul(y + seed * 71, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
const point = (x: number, y: number): Point => ({ x, y });
const controls: Record<string, [number, number][]> = {
  '1A': [[-3,13],[3,13],[6,8],[12,7],[15,11],[12,15],[11,20],[15,22],[20,20],[21,15],[19,11],[22,7],[28,8],[30,12],[27,16],[27,21],[32,23],[36,20],[37,16],[34,12],[37,9],[42,10],[43,14],[41,18],[43,21],[51,20]],
  '1B': [[11,-3],[17,2],[9,7],[12,11],[22,12],[23,17],[13,22],[17,27],[25,29],[24,35]],
  '2A': [[3,-3],[6,2],[15,3],[21,7],[13,13],[17,19],[26,14],[32,19],[26,24],[33,29],[42,25],[51,32]],
  '2B': [[-3,24],[4,24],[10,18],[8,10],[15,7],[22,10],[23,18],[29,23],[35,20],[35,12],[40,9],[47,12],[52,9]],
};
function curve(raw: readonly [number, number][], seed: number, jitter = .7): Point[] {
  const anchors = raw.map(([x,y], i) => point(x + (i && i < raw.length - 1 ? (hash(i,11,seed) - .5) * jitter * 2 : 0),
    y + (i && i < raw.length - 1 ? (hash(i,17,seed) - .5) * jitter * 2 : 0)));
  const out: Point[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const p0 = anchors[Math.max(0,i-1)], p1 = anchors[i], p2 = anchors[i+1], p3 = anchors[Math.min(anchors.length-1,i+2)];
    const count = Math.max(16, Math.ceil(Math.hypot(p2.x-p1.x,p2.y-p1.y) * 5));
    for (let j = 0; j < count; j++) {
      const t = j / count, t2 = t*t, t3 = t2*t;
      const axis = (a: number,b: number,c: number,d: number) => .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
      out.push(point(axis(p0.x,p1.x,p2.x,p3.x),axis(p0.y,p1.y,p2.y,p3.y)));
    }
  }
  out.push(anchors.at(-1)!); return out;
}
function distanceTo(points: readonly Point[], x: number, y: number): { distance: number; index: number } {
  let distance = Infinity, index = 0;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i].x-x, points[i].y-y);
    if (d < distance) { distance = d; index = i; }
  }
  return { distance, index };
}
const inBounds = (p:Point) => p.x>=0&&p.y>=0&&p.x<WIDTH&&p.y<HEIGHT;
const key = (p:Point) => p.y*WIDTH+p.x;
const cardinal = [[1,0],[-1,0],[0,1],[0,-1]] as const;
function riverSet(world:World):Set<number>{return new Set(world.tiles.flatMap((t,k)=>t.terrain==='river'?[k]:[]));}
function filledSquares(cells:ReadonlySet<number>,p:Point):number{
  let n=0;
  for(const ox of [-1,0])for(const oy of [-1,0]){
    const x=p.x+ox,y=p.y+oy;
    if(x>=0&&y>=0&&x<WIDTH-1&&y<HEIGHT-1&&[y*WIDTH+x,y*WIDTH+x+1,(y+1)*WIDTH+x,(y+1)*WIDTH+x+1].every(k=>cells.has(k)))n++;
  }
  return n;
}
/** Trace one cardinal-connected grid walk, never a distance-field tube.
 * Diagonal samples choose the bridge that avoids washing out a2×2 square. */
function paintNarrowChannel(world:World,samples:Point[],main:boolean):Point[]{
  const occupied=riverSet(world),path:Point[]=[];
  const append=(p:Point)=>{
    if(path.length&&path.at(-1)!.x===p.x&&path.at(-1)!.y===p.y)return;
    path.push({...p});if(inBounds(p))occupied.add(key(p));
  };
  let current=point(Math.floor(samples[0].x),Math.floor(samples[0].y));append(current);
  for(const sample of samples){
    const target=point(Math.floor(sample.x),Math.floor(sample.y));
    while(current.x!==target.x||current.y!==target.y){
      const dx=Math.sign(target.x-current.x),dy=Math.sign(target.y-current.y);
      let next:Point;
      if(dx&&dy){
        const end=point(current.x+dx,current.y+dy);
        const choices=[point(current.x+dx,current.y),point(current.x,current.y+dy)];
        const score=(p:Point)=>{
          const trial=new Set(occupied);if(inBounds(p))trial.add(key(p));if(inBounds(end))trial.add(key(end));
          const squareCost=inBounds(p)?filledSquares(trial,p)+filledSquares(trial,end):0;
          return squareCost*100+distanceTo(samples,p.x+.5,p.y+.5).distance;
        };
        next=score(choices[0])<=score(choices[1])?choices[0]:choices[1];
      }else next=point(current.x+dx,current.y+dy);
      append(next);current=next;
    }
  }
  const cells=path.filter(inBounds);
  for(const p of cells){
    const tile=world.tiles[key(p)];tile.terrain='river';tile.elevation=.08;tile.moisture=1;
    if(main||tile.channel!=='main')tile.channel=main?'main':'tributary';tile.channelWidth=1;tile.flow=main?30:12;
  }
  return cells;
}
function attachCurve(world:World,raw:readonly [number,number][],seed:number,jitter=.45):Point[]{
  const river=world.tiles.flatMap((t,k)=>t.terrain==='river'?[point(k%WIDTH+.5,Math.floor(k/WIDTH)+.5)]:[]);
  const anchors=raw.map(([x,y])=>[x,y] as [number,number]);
  for(const i of [0,anchors.length-1]){
    const [x,y]=anchors[i],nearest=distanceTo(river,x,y);
    if(nearest.distance<5){const p=river[nearest.index];anchors[i]=[p.x,p.y];}
  }
  return curve(anchors,seed,jitter);
}
const branches:Record<string,[number,number][][]>={
  '1A':[
    [[6,8],[8,10],[11,10],[12,12],[10,15],[8,18],[11,20]],
    [[15,22],[17,18],[17,15],[16,12],[19,11]],
    [[22,7],[23,10],[26,10],[27,12],[24,16],[24,19],[27,21]],
    [[27,21],[30,19],[32,20],[34,18],[34,15],[34,12]],
    [[37,9],[38,12],[40,13],[38,16],[39,19],[41,18]],
  ],
  '1B':[
    [[17,2],[23,4],[28,8],[26,12],[31,16],[34,21],[28,24],[27,29],[24,33]],
    [[23,17],[25,18],[27,21],[28,24]],
    [[9,7],[4,10],[6,16],[12,17],[13,22]],
    [[12,11],[16,15],[15,18],[13,22]],
    [[22,12],[24,10],[24,6],[23,4]],
  ],
  '2A':[
    [[13,13],[10,17],[12,21],[17,19]],
    [[21,7],[26,8],[29,10],[26,14]],
    [[26,24],[24,28],[28,30],[33,29]],
  ],
  '2B':[
    [[10,18],[16,19],[19,23],[23,18]],
    [[15,7],[16,3],[22,3],[27,8],[22,10]],
    [[35,20],[41,22],[44,18],[40,9]],
  ],
};
/** Only two short reaches per landscape grow to two tiles across. */
function addQuietPools(world:World,path:Point[],seed:number):Point[]{
  const extra:Point[]=[],candidates=path.map((p,i)=>({p,i,score:hash(p.x,p.y,seed)})).sort((a,b)=>a.score-b.score);
  let pools=0;
  for(const {i} of candidates){
    if(pools>=2||i<3||i>=path.length-3)continue;
    const a=path[i-1],b=path[i],c=path[i+1],dx=b.x-a.x,dy=b.y-a.y;
    if(c.x-b.x!==dx||c.y-b.y!==dy||Math.abs(dx)+Math.abs(dy)!==1)continue;
    if(extra.some(p=>Math.hypot(p.x-b.x,p.y-b.y)<9))continue;
    const side=hash(b.x,b.y,seed+2)>.5?1:-1;
    const additions=[a,b,c].map(p=>point(p.x-dy*side,p.y+dx*side));
    if(additions.some(p=>!inBounds(p)||world.tiles[key(p)].terrain==='river'
      ||cardinal.filter(([ox,oy])=>inBounds(point(p.x+ox,p.y+oy))&&world.tiles[(p.y+oy)*WIDTH+p.x+ox].terrain==='river').length>1))continue;
    for(const p of additions){const t=world.tiles[key(p)];t.terrain='river';t.elevation=.08;t.moisture=1;t.channel='main';t.channelWidth=2;extra.push(p);}
    for(const p of [a,b,c])world.tiles[key(p)].channelWidth=2;
    pools++;
  }
  return extra;
}
function waterDistances(world: World): Float64Array {
  const water = world.tiles.flatMap((t,k) => WATER.has(t.terrain) ? [point(k%WIDTH+.5,Math.floor(k/WIDTH)+.5)] : []);
  return Float64Array.from(world.tiles, (_,k) => distanceTo(water,k%WIDTH+.5,Math.floor(k/WIDTH)+.5).distance);
}
function insidePolygon(x: number, y: number, vertices: readonly [number,number][]): boolean {
  let inside = false;
  for (let i=0,j=vertices.length-1;i<vertices.length;j=i++) {
    const [xi,yi]=vertices[i],[xj,yj]=vertices[j];
    if ((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
function addPond(world: World, desired: Point, count: number, seed: number, oxbowShape = -1): Point[] {
  const distance = waterDistances(world), candidates: Point[] = [];
  for (let dy=-4;dy<=4;dy++) for (let dx=-4;dx<=4;dx++) {
    const x=Math.round(desired.x)+dx,y=Math.round(desired.y)+dy;
    if(x>=3&&y>=3&&x<WIDTH-3&&y<HEIGHT-3)candidates.push(point(x,y));
  }
  candidates.sort((a,b)=>Math.hypot(a.x-desired.x,a.y-desired.y)-Math.hypot(b.x-desired.x,b.y-desired.y));
  for (const center of candidates) {
    let cells: Point[];
    if (oxbowShape>=0) {
      const shapes=[
        [[-1,-2],[0,-2],[1,-2],[-1,-1],[-2,-1],[-2,0],[-2,1],[-1,1],[-1,2],[0,2],[1,2]],
        [[-2,-1],[-2,0],[-2,1],[-1,1],[0,1],[1,1],[1,0],[1,-1]],
        [[-2,-2],[-1,-2],[0,-2],[1,-2],[1,-1],[2,-1],[2,0],[2,1],[1,1],[0,1],[-1,1],[-1,0]],
      ];
      const turns=(seed+oxbowShape)%4;
      cells=shapes[oxbowShape%3].map(([dx,dy])=>{
        for(let i=0;i<turns;i++){const old=dx;dx=-dy;dy=old;}
        return point(center.x+dx,center.y+dy);
      });
    } else {
      const pool: { p: Point; score: number }[] = [];
      // Off-center basins make compact pools instead of symmetric five-tile crosses.
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)pool.push({p:point(center.x+dx,center.y+dy),score:(dx-.35)**2*.72+(dy-.25)**2+hash(dx,dy,seed)*.65});
      pool.sort((a,b)=>a.score-b.score); cells=pool.slice(0,count).map(v=>v.p);
    }
    if(cells.some(p=>distance[p.y*WIDTH+p.x]<2.25||world.tiles[p.y*WIDTH+p.x].ridge))continue;
    for(const p of cells){const t=world.tiles[p.y*WIDTH+p.x];t.terrain='lake';t.elevation=.07;t.moisture=1;t.lakeShape=oxbowShape>=0?'snaky':'compact';}
    return cells;
  }
  return [];
}
function addTerraces(world: World, id: string): void {
  if(id!=='2A')return;
  const distance=waterDistances(world);
  const polygons: [number,number][][]=[[[25,-3],[52,-3],[52,18],[44,17],[42,12],[34,10],[31,6],[24,5]],
    [[-3,14],[4,15],[7,21],[14,24],[16,35],[-3,35]]];
  polygons.forEach((shape,i)=>{
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
      const tile=world.tiles[y*WIDTH+x];
      if(distance[y*WIDTH+x]>=4&&insidePolygon(x+.5,y+.5,shape)){
        tile.ridge=i+1;tile.ridgeTier=1;tile.relief='hills';tile.elevation=.48;
      }
    }
  });
  for(const ridge of [1,2]){
    const candidates=world.tiles.flatMap((t,k)=>t.ridge===ridge?[point(k%WIDTH,Math.floor(k/WIDTH))]:[])
      .sort((a,b)=>Math.hypot(a.x-24,a.y-16)-Math.hypot(b.x-24,b.y-16));
    let found=false;
    for(const p of candidates){for(const direction of ['north','east','south','west'] as const){
      const tile=world.tiles[p.y*WIDTH+p.x];tile.stair=direction;
      if(ridgeGroundWalkable(world,p.x,p.y)){found=true;break;}delete tile.stair;
    }if(found)break;}
  }
}
export function generateValley(id: string, seed = 1): ValleyScene {
  const variant=VARIANTS.find(v=>v.id===id);if(!variant)throw new Error(`Unknown valley design ${id}`);
  seed=Math.floor(seed)>>>0;
  const tiles:Tile[]=Array.from({length:WIDTH*HEIGHT},(_,k)=>({terrain:'grassland',overlay:'none',elevation:.24,
    moisture:.6,temperature:.57,fertility:.7,biome:'temperate',food:2,production:1,gold:0,variation:hash(k%WIDTH,Math.floor(k/WIDTH),seed+5)}));
  const world:World={width:WIDTH,height:HEIGHT,seed:`SWAMP-VALLEY-${id}-${seed}`,tiles,spawns:[],source:'Swamp valley design study',revision:0};
  const main=curve(controls[id],seed+13,id==='1A'?.4:.7),channelPaths=[paintNarrowChannel(world,main,true)];
  for(const [i,raw] of branches[id].entries())channelPaths.push(paintNarrowChannel(world,attachCurve(world,raw,seed+31+i*17,id==='1A'?.22:.45),false));
  const widenedCells=addQuietPools(world,channelPaths[0],seed+113);
  const oxbowSites:Record<string,[number,number][]>={
    '1A':[[27,4],[6,25],[38,26]],'1B':[[38,8],[6,25],[37,27]],
    '2A':[[5,10],[36,21],[18,27]],'2B':[[4,6],[30,4],[39,28]],
  };
  const oxbows=oxbowSites[id].map(([x,y],i)=>addPond(world,point(x,y),0,seed+i*37,i)).filter(cells=>cells.length>0);
  const compactSites:Record<string,[number,number,number][]>={
    '1A':[[4,3,5],[43,4,4]],'1B':[[40,17,4],[3,3,5]],
    '2A':[[38,5,5],[3,26,4]],'2B':[[19,28,4],[44,4,5]],
  };
  const compactPonds=compactSites[id].map(([x,y,n],i)=>addPond(world,point(x,y),n,seed+151+i*19)).filter(cells=>cells.length>0);
  const pondCells=[...oxbows,...compactPonds];
  addTerraces(world,id);
  const ecology=placeValleyVegetation(world,variant,seed),rivers=riverSet(world);
  const thinChannelCells=[...rivers].map(k=>point(k%WIDTH,Math.floor(k/WIDTH))).filter(p=>!filledSquares(rivers,p));
  const isDry=(x:number,y:number)=>x<0||y<0||x>=WIDTH||y>=HEIGHT||!WATER.has(world.tiles[y*WIDTH+x].terrain);
  const narrowBanks=[...rivers].filter(k=>{const x=k%WIDTH,y=Math.floor(k/WIDTH);return isDry(x-1,y)&&isDry(x+1,y)||isDry(x,y-1)&&isDry(x,y+1);}).length;
  const waterTiles=world.tiles.filter(t=>WATER.has(t.terrain)).length;
  const pathLength=main.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-main[i].x,p.y-main[i].y),0);
  const metrics:ValleyMetrics={waterTiles,waterCoverage:waterTiles/(WIDTH*HEIGHT),pondCount:pondCells.length,pondTiles:pondCells.reduce((a,b)=>a+b.length,0),
    marshTiles:world.tiles.filter(t=>t.marsh).length,treeTiles:world.tiles.filter(t=>t.overlay==='forest').length,
    mainSinuosity:pathLength/Math.hypot(main.at(-1)!.x-main[0].x,main.at(-1)!.y-main[0].y),
    ridgeTiles:world.tiles.filter(t=>t.ridge).length,ramps:world.tiles.filter(t=>t.stair).length,
    branchCount:channelPaths.length-1,oxbowCount:oxbows.length,compactPondCount:compactPonds.length,
    oneTileChannelShare:thinChannelCells.length/rivers.size,narrowBankShare:narrowBanks/rivers.size,widenedTiles:widenedCells.length};
  return {world,variant,seed,metrics,mainChannel:main,ponds:pondCells,channelPaths,oxbows,thinChannelCells,widenedCells,...ecology};
}
