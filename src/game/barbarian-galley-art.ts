import { runtimeArtUrl } from './runtime-art';
import type { Unit } from './types';
import { drawUnit } from './sprites';
let hull:HTMLImageElement|undefined;
export async function loadBarbarianGalleyArt():Promise<void>{
  const image=new Image();image.src=runtimeArtUrl(`${import.meta.env.BASE_URL}assets/naval/barbarian-galley.png`);await image.decode();
  if(image.naturalWidth!==16||image.naturalHeight!==32)throw new Error('Invalid barbarian galley artwork.');hull=image;
}
export const barbarianGalleyImage=()=>hull;
export const BARBARIAN_GALLEY_BOUNDS={x:0,y:-16,width:32,height:64};
export function drawBarbarianGalley(c:CanvasRenderingContext2D,boat:Unit,archer:Unit|undefined,x:number,y:number,size:number,time:number,color:string,firearm=false):void {
  if(!hull)return;
  c.save();c.imageSmoothingEnabled=false;c.translate(x+size/2,y+size/2);c.rotate(boat.facing+Math.PI/2);
  c.drawImage(hull,-size/2,-size,size,size*2);c.restore();
  if(archer)drawUnit(c,{...archer,inside:false,aboardRowboat:false,moving:false,
    attackTime:Math.max(0,.28-(time-(boat.barbarianGalley?.firedAt??-1000)))},x+size*.15,y-size*.1,size*.7,time,color,undefined,firearm);
}
