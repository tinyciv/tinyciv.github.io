import {rustEngine} from './rust-engine';
import {tileAt,type Tile,type World,type Point} from './types';
import {resourceBlocksGround} from './resource-terrain';
import {forestBlocksConstruction} from './geography';

const policies=Uint8Array.from([0,1,2,3],kind=>rustEngine.relief_policy(kind));
const construction=Uint8Array.from({length:16},(_,i)=>rustEngine.relief_construction_allowed(i%8,Math.floor(i/8)));
const edges=Uint8Array.from({length:32},(_,mask)=>rustEngine.relief_edge_policy(mask));
const height=Uint8Array.from({length:9},(_,i)=>rustEngine.relief_height_advantage(Math.floor(i/3),i%3));
export const rockFootprint = (tile: Tile | undefined): boolean =>
  tile?.rockHost !== undefined || tile?.rockFormation !== undefined || tile?.rockRelief !== undefined;
export const reliefFlags=(tile:Tile|undefined):number=>{
  if(!tile)return 0;
  if (rockFootprint(tile)) return policies[3];
  const policy=policies[tile.relief==='mountains'?2:tile.relief==='hills'?1:0];
  return tile.reliefFlags??policy;
};
export const reliefLevel=(tile:Tile|undefined):number=>tile?.reliefLevel??(tile?.relief==='mountains'?2:tile?.relief==='hills'?1:0);
export const reliefHasHeightAdvantage=(a:Tile|undefined,b:Tile|undefined):boolean=>!!height[Math.min(2,reliefLevel(a))*3+Math.min(2,reliefLevel(b))];
export const reliefAllowsTrees=(tile:Tile):boolean=>!!(reliefFlags(tile)&4);
export const reliefGroundWalkable=(world:World,x:number,y:number):boolean=>!!(reliefFlags(tileAt(world,x,y))&1);
export const reliefBuildable=(tile:Tile|undefined):boolean=>!forestBlocksConstruction(tile)&&!!(reliefFlags(tile)&2);
export function reliefFootprintAllowed(world:World,x:number,y:number,width=1,height=width,wall=false):boolean{
  for(let dy=0;dy<height;dy++)for(let dx=0;dx<width;dx++){
    const xx=x+dx,yy=y+dy,tile=tileAt(world,xx,yy);
    if(!tile||tile.waterfall
      ||resourceBlocksGround(tile)||!construction[Number(wall)*8+reliefFlags(tile)])return false;
  }
  return true;
}
export function reliefEdgeAllowed(world:World,from:Point,to:Point,saltAccess?:ReadonlySet<number>|true):boolean{
  const x=Math.floor(from.x),y=Math.floor(from.y),nx=Math.floor(to.x),ny=Math.floor(to.y),diagonal=x!==nx&&y!==ny;
  const walk=(xx:number,yy:number)=>{
    const tile=tileAt(world,xx,yy);
    return Number(!!tile&&!tile.waterfall&&!resourceBlocksGround(tile,saltAccess===true||!!saltAccess?.has(yy*world.width+xx))&&reliefGroundWalkable(world,xx,yy));
  };
  return !!edges[walk(x,y)|(walk(nx,ny)<<1)|(walk(nx,y)<<2)|(walk(x,ny)<<3)|(Number(diagonal)<<4)];
}
