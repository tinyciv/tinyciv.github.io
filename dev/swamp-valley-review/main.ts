import { rasterTerrain } from '../../src/game/terrain';
import { ridgeIsLedge } from '../../src/game/ridges';
import { vegetationVariant } from '../../src/game/vegetation-art';
import { WATER } from '../../src/game/types';
import type { PunyPixels } from '../../src/game/puny-world';
import { VARIANTS, generateValley } from './model';

const $ = <T extends HTMLElement>(id:string) => document.getElementById(id)! as T;
const payload = (window as unknown as {SWAMP_VALLEY_ASSETS:Record<string,string>}).SWAMP_VALLEY_ASSETS;
const images:Record<string,HTMLImageElement> = {};
const scenes = new Map<string,ReturnType<typeof generateValley>>();
const terrainCache = new WeakMap<object,HTMLCanvasElement>();
let atlas:PunyPixels, desert:PunyPixels;
const state = {selected:VARIANTS[0].id, height:1, density:1, plants:true, zoom:'fit'};
const canvas = $<HTMLCanvasElement>('landscape');
const ctx = (target:HTMLCanvasElement) => {const c=target.getContext('2d',{willReadFrequently:true})!;c.imageSmoothingEnabled=false;return c;};
function pixels(image:HTMLImageElement):PunyPixels {const t=document.createElement('canvas');t.width=image.width;t.height=image.height;const c=ctx(t);c.drawImage(image,0,0);return{width:t.width,height:t.height,data:c.getImageData(0,0,t.width,t.height).data};}
function hash(x:number,y:number,seed:number):number {let n=Math.imul(x+71+seed*17,374761393)^Math.imul(y+139,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;}
function sceneFor(id:string){let scene=scenes.get(id);if(!scene){scene=generateValley(id,1);scenes.set(id,scene);}return scene;}
function ground(scene:ReturnType<typeof generateValley>):HTMLCanvasElement {
  let target=terrainCache.get(scene.world);if(target)return target;
  const raster=rasterTerrain(scene.world,undefined,atlas,desert);target=document.createElement('canvas');target.width=raster.width;target.height=raster.height;
  const c=ctx(target),data=c.createImageData(raster.width,raster.height);data.data.set(raster.pixels);c.putImageData(data,0,0);terrainCache.set(scene.world,target);return target;
}
function paint(target:HTMLCanvasElement,scene:ReturnType<typeof generateValley>,controls=true):number {
  const {world,variant,seed}=scene,size=32;target.width=world.width*size;target.height=world.height*size;
  const c=ctx(target);c.drawImage(ground(scene),0,0,target.width,target.height);let count=0;
  const density=controls?state.density:1,scale=variant.plantScale*(controls?state.height:1),show=controls?state.plants:true;
  for(let y=0;y<world.height;y++)for(let x=0;x<world.width;x++){
    const tile=world.tiles[y*world.width+x];
    if(WATER.has(tile.terrain)||tile.stair||ridgeIsLedge(world,x,y))continue;
    const neighboringMarsh=!tile.marsh&&tile.overlay!=='forest'&&tile.overlay!=='jungle'&&density>1
      &&[[0,-1],[1,0],[0,1],[-1,0]].some(([dx,dy])=>x+dx>=0&&y+dy>=0&&x+dx<world.width&&y+dy<world.height&&world.tiles[(y+dy)*world.width+x+dx]?.marsh)
      &&hash(x,y,seed+907)<(density-1)*.65;
    if(tile.marsh||neighboringMarsh){
      if(!show||density<1&&hash(x,y,seed+907)>density)continue;
      const variantIndex=Math.floor(tile.variation*0x1000000)%4,image=images[`plant${variantIndex}`];
      const localScale=scene.grassScales[y*world.width+x]??1;
      const jitter=(.94+hash(x,y,seed+301)*.12)*localScale,w=Math.round(size*2*scale*jitter),h=Math.round(size*2.45*scale*jitter);
      const bottom=Math.round((y+15/16)*size);c.drawImage(image,Math.round((x+.5)*size-w/2),bottom-h,w,h);count++;
    }else{
      const sprite=vegetationVariant(tile);if(!sprite)continue;
      const h=size*sprite.height/16;c.drawImage(images.vegetation,sprite.x,sprite.y,sprite.width,sprite.height,x*size,(y+1)*size-h,size,h);
    }
  }
  return count;
}
function fitCanvas():void {
  const scene=scenes.get(state.selected);if(!scene)return;
  const nativeWidth=scene.world.width*16;
  const maxHeight=parseFloat(getComputedStyle($('viewport')).maxHeight);
  const scale=state.zoom==='fit'?Math.min(2,$('viewport').clientWidth/nativeWidth,maxHeight/(scene.world.height*16)):Number(state.zoom);
  canvas.style.width=`${nativeWidth*scale}px`;canvas.style.height=`${scene.world.height*16*scale}px`;
}
function card(id:string):void {
  const button=document.querySelector<HTMLButtonElement>(`.card[data-id="${id}"]`)!;
  paint(button.querySelector('canvas')!,sceneFor(id),false);
}
function render():void {
  const scene=sceneFor(state.selected),{variant,metrics}=scene;
  const count=paint(canvas,scene);fitCanvas();
  $('title').textContent=`${variant.id} · ${variant.name}`;$('description').textContent=variant.description;
  $('notes').replaceChildren(...variant.notes.map(note=>{const p=document.createElement('p');p.textContent=note;return p;}));
  $('facts').textContent=`${metrics.oxbowCount} oxbows · ${metrics.compactPondCount} small pools · ${Math.round(metrics.waterCoverage*100)}% water · ${state.plants?`${count} grass clumps · ${(variant.plantScale*state.height*2.45*.72).toFixed(1)}–${(variant.plantScale*state.height*2.45*1.15).toFixed(1)} tiles tall`:'Tall grass lifted'} · Layout ${scene.seed}`;
  $('plants').textContent=state.plants?'Lift tall grass':'Restore tall grass';$('plants').setAttribute('aria-pressed',String(!state.plants));
  const link=$<HTMLAnchorElement>('export');link.href=canvas.toDataURL();link.download=`swamp-valley-${variant.id}-layout-${scene.seed}${state.plants?'':'-ground'}.png`;
  for(const button of document.querySelectorAll<HTMLButtonElement>('.card'))button.setAttribute('aria-pressed',String(button.dataset.id===state.selected));
  canvas.dataset.variant=state.selected;canvas.dataset.seed=String(scene.seed);canvas.dataset.plants=String(state.plants);
  $('status').textContent=`Oxbow fen refined · Tighter loops and narrow strips between its braided channels`;
}
function select(id:string):void {state.selected=id;state.height=1;state.density=1;state.plants=true;$<HTMLSelectElement>('height').value='1';$<HTMLSelectElement>('density').value='1';render();}
$('plants').onclick=()=>{state.plants=!state.plants;render();};
$('height').onchange=()=>{state.height=Number($<HTMLSelectElement>('height').value);render();};
$('density').onchange=()=>{state.density=Number($<HTMLSelectElement>('density').value);render();};
$('zoom').onchange=()=>{state.zoom=$<HTMLSelectElement>('zoom').value;fitCanvas();};
$('regenerate').onclick=()=>{const old=sceneFor(state.selected);scenes.set(state.selected,generateValley(state.selected,old.seed+1));card(state.selected);render();};
new ResizeObserver(fitCanvas).observe($('viewport'));
Object.assign(window,{__swampValleys:{state,scenes,variants:VARIANTS,select,render,paint,generateValley}});
try {
  await Promise.all(Object.entries(payload).map(async([id,uri])=>{const image=new Image();image.src=uri;await image.decode();images[id]=image;}));
  atlas=pixels(images.world);desert=pixels(images.desert);
  for(const variant of VARIANTS){
    const button=document.createElement('button');button.className='card';button.type='button';button.dataset.id=variant.id;button.setAttribute('aria-label',`${variant.id}: ${variant.name}`);
    const header=document.createElement('header'),h=document.createElement('h3'),code=document.createElement('span');code.className='code';code.textContent=variant.id;h.append(code,document.createTextNode(variant.name));header.append(h);
    const preview=document.createElement('canvas');preview.setAttribute('aria-label',`${variant.name} overview`);const p=document.createElement('p');p.textContent=variant.description;
    button.append(header,preview,p);button.onclick=()=>select(variant.id);$('gallery').append(button);card(variant.id);
  }
  render();$('loading').remove();document.documentElement.dataset.ready='true';
}catch(error){$('loading').textContent=`Unable to open landscape study: ${String(error)}`;console.error(error);}
