import { WATER, type World } from '../../src/game/types';
import { ridgeIsLedge } from '../../src/game/ridges';
import type { ValleyVariant } from './model';

type Patch = readonly [number, number, number, number];
interface Habitats { reeds: readonly Patch[]; meadow: readonly Patch[]; woods: readonly Patch[] }
const HABITATS: Record<string, Habitats> = {
  '1A': { reeds:[[11,8,9,7],[36,24,10,7],[36,5,8,5]], meadow:[[24,18,9,8],[6,26,8,6]], woods:[[4,3,7,5],[44,28,7,7]] },
  '1B': { reeds:[[13,8,12,8],[28,25,13,8]], meadow:[[37,12,10,7],[7,24,7,5]], woods:[[43,3,6,6],[3,29,6,5]] },
  '2A': { reeds:[[11,9,8,7],[30,24,10,7],[38,11,8,5]], meadow:[[23,13,8,7],[8,27,9,7]], woods:[[39,3,12,7],[4,24,8,9]] },
  '2B': { reeds:[[12,25,9,7],[29,12,10,7]], meadow:[[24,24,8,7],[19,4,9,6]], woods:[[8,6,10,8],[39,24,11,9],[43,4,8,6]] },
};
const clamp = (n:number,a:number,b:number) => Math.max(a,Math.min(b,n));
function hash(x:number,y:number,seed:number):number {let n=Math.imul(x+seed*29,374761393)^Math.imul(y+seed*71,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;}
function field(x:number,y:number,seed:number,size:number):number {
  const ax=x/size,ay=y/size,ix=Math.floor(ax),iy=Math.floor(ay),fx=ax-ix,fy=ay-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const a=hash(ix,iy,seed),b=hash(ix+1,iy,seed),c=hash(ix,iy+1,seed),d=hash(ix+1,iy+1,seed);
  return (a+(b-a)*sx)*(1-sy)+(c+(d-c)*sx)*sy;
}
function patchStrength(patches:readonly Patch[],x:number,y:number,seed:number):number {
  return Math.max(0,...patches.map(([cx,cy,rx,ry],i)=>{
    const dx=2.3*(hash(i,19,seed)-.5),dy=2*(hash(i,31,seed)-.5);
    const distance=((x-cx-dx)/rx)**2+((y-cy-dy)/ry)**2;
    return Math.exp(-distance*1.65);
  }));
}

/** Broad habitat patches determine coverage first; small noise only breaks
 * their margins. Dense reed beds, open meadow and groves remain visibly distinct. */
export function placeValleyVegetation(world:World,variant:ValleyVariant,seed:number):{
  grassScales:number[];habitatCounts:Record<string,number>;
} {
  const {width,height}=world,habitats=HABITATS[variant.id];
  const water=world.tiles.flatMap((t,k)=>WATER.has(t.terrain)?[{x:k%width,y:Math.floor(k/width)}]:[]);
  const grassScales=Array(world.tiles.length).fill(1),habitatCounts:Record<string,number>={reedbed:0,damp:0,meadow:0,woodland:0};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const k=y*width+x,tile=world.tiles[k];
    if(WATER.has(tile.terrain)||tile.stair||ridgeIsLedge(world,x,y))continue;
    delete tile.marsh;tile.overlay='none';
    const distance=Math.min(...water.map(p=>Math.hypot(x-p.x,y-p.y)));
    const wx=x+1.8*Math.sin(y*.28+seed*.3),wy=y+1.4*Math.sin(x*.22-seed*.17);
    const broad=field(wx,wy,seed+441,9),edge=field(x,y,seed+119,2.7);
    const reeds=patchStrength(habitats.reeds,wx,wy,seed+3),meadow=patchStrength(habitats.meadow,wx,wy,seed+7),woods=patchStrength(habitats.woods,wx,wy,seed+17);
    const wetness=Math.max(0,1-distance/7);
    const reedScore=wetness*.52+reeds*1.05+(broad-.5)*.65-meadow*1.1-woods*.23;
    const grove=distance>1.05&&(woods+(broad-.5)*.4> .48||!!tile.ridge&&broad>.48);
    const habitat=grove?'woodland':!tile.ridge&&distance<6&&reedScore>.70?'reedbed':!tile.ridge&&distance<4&&reedScore>.31?'damp':'meadow';
    habitatCounts[habitat]++;
    if(habitat==='woodland'){
      // Even the wooded bank remains a mesh of trees and visible open ground.
      const density=variant.id==='2B'?.44:.29;
      if(hash(x,y,seed+223)<density*(.65+edge*.7)){
        tile.overlay='forest';tile.treeClass=tile.ridge?'conifer':'temperate';
      }
      continue;
    }
    const probability=habitat==='reedbed'?clamp((.83+edge*.14)*variant.plantDensity/.64,.78,.97)
      :habitat==='damp'?.16+edge*.23:distance<5?.012:0;
    if(hash(x,y,seed+92)>=probability)continue;
    tile.marsh=true;tile.biome='wetland';tile.moisture=habitat==='reedbed'?.94:.73;
    // One local plant family dominates a patch; a few mixed tufts soften its edge.
    const dominant=habitat==='reedbed'?(broad>.53?3:1):(edge>.48?2:0);
    const species=hash(x,y,seed+83)<.82?dominant:Math.floor(hash(x,y,seed+67)*4);
    tile.variation=(Math.floor(tile.variation*0x1000000/4)*4+species)/0x1000000;
    grassScales[k]=habitat==='reedbed'?1.03+edge*.12:.72+edge*.13;
  }
  return{grassScales,habitatCounts};
}
