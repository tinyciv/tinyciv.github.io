import { rasterTerrain } from '../../src/game/terrain';
import { ridgeIsLedge, STAIR_UP } from '../../src/game/ridges';
import { vegetationVariant, vegetationArtBounds } from '../../src/game/vegetation-art';
import { WATER, type World } from '../../src/game/types';
import type { PunyPixels } from '../../src/game/puny-world';

type RegionId = 'desert' | 'forest';
interface Region { id: RegionId; name: string; bounds: {x:number;y:number;width:number;height:number}; focus:{x:number;y:number}; metrics:Record<string,number> }
interface Scene { world:World; regions:Region[]; metrics:Record<string,unknown>; hills:{id:number;region:RegionId;cells:number[];ramps:unknown[];shape:string}[] }
interface RecordData {id:string;name:string;seed:string;style:string;family:string;compressedScene:string}
const $ = <T extends HTMLElement>(id:string) => document.getElementById(id)! as T;
const payload = window as unknown as {HILL_REVIEW_DATA:RecordData[];HILL_REVIEW_ASSETS:Record<string,string>};
const records = payload.HILL_REVIEW_DATA, scenes = new Map<number,Scene>();
const images:Record<string,HTMLImageElement> = {};
const state = {world:0,region:'desert' as RegionId,trees:true,ramps:false,grid:false,whole:false,zoom:24,cx:128,cy:96};
const map = $<HTMLCanvasElement>('map'), mini = $<HTMLCanvasElement>('minimap');
let scene:Scene, ground:HTMLCanvasElement, painted:HTMLCanvasElement;
let atlas:PunyPixels, desert:PunyPixels, salt:PunyPixels, loadToken=0, queued=false;
let view={width:1,height:1,left:0,top:0};
const pointers=new Map<number,{x:number;y:number}>();
let drag:{x:number;y:number;cx:number;cy:number}|undefined;
let pinch:{distance:number;zoom:number;x:number;y:number}|undefined;
let tierIndex=0;
const context=(canvas:HTMLCanvasElement)=>{const c=canvas.getContext('2d')!;c.imageSmoothingEnabled=false;return c;};
function imagePixels(image:HTMLImageElement):PunyPixels {const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=context(c);ctx.drawImage(image,0,0);return {width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};}
async function unpack(index:number):Promise<Scene> {
  const found=scenes.get(index);if(found)return found;
  const bytes=Uint8Array.from(atob(records[index].compressedScene),c=>c.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const value=JSON.parse(await new Response(stream).text()) as Scene;scenes.set(index,value);return value;
}
function buildMap(world:World):void {
  if(ground){ground.width=1;ground.height=1;painted.width=1;painted.height=1;}
  const raster=rasterTerrain(world,undefined,atlas,desert,salt);
  ground=document.createElement('canvas');ground.width=raster.width;ground.height=raster.height;
  const c=context(ground),data=c.createImageData(raster.width,raster.height);data.data.set(raster.pixels);c.putImageData(data,0,0);
  painted=document.createElement('canvas');painted.width=ground.width;painted.height=ground.height;
  const pc=context(painted);pc.drawImage(ground,0,0);
  for(let y=0;y<world.height;y++)for(let x=0;x<world.width;x++){
    const tile=world.tiles[y*world.width+x];if(WATER.has(tile.terrain)||tile.stair||ridgeIsLedge(world,x,y))continue;
    const sprite=vegetationVariant(tile);if(!sprite)continue;
    const bounds=vegetationArtBounds(tile,16);
    pc.drawImage(images[sprite.sheet],sprite.x,sprite.y,sprite.width,sprite.height,
      Math.round(x*16+bounds.x),Math.round(y*16+bounds.y),bounds.width,bounds.height);
  }
  mini.width=world.width*2;mini.height=world.height*2;
}
function fitZoom():number {return scene?Math.min(view.width/scene.world.width,view.height/scene.world.height):1;}
function clampCamera():void {
  if(!scene)return;const world=scene.world;
  state.zoom=Math.max(fitZoom(),Math.min(64,state.zoom));
  const hw=view.width/state.zoom/2,hh=view.height/state.zoom/2;
  state.cx=hw>=world.width/2?world.width/2:Math.max(hw,Math.min(world.width-hw,state.cx));
  state.cy=hh>=world.height/2?world.height/2:Math.max(hh,Math.min(world.height-hh,state.cy));
  view.left=state.cx-hw;view.top=state.cy-hh;
}
function queueRender():void {if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;render();});}
function drawMini():void {
  const c=context(mini);c.drawImage(state.trees?painted:ground,0,0,mini.width,mini.height);
  for(const region of scene.regions){const b=region.bounds;c.strokeStyle=region.id==='desert'?'#ffe6a5':'#ceefaa';c.lineWidth=2;c.strokeRect(b.x*2,b.y*2,b.width*2,b.height*2);c.font='bold 22px "Pixel Operator"';c.fillStyle='#14251f';c.fillRect(b.x*2,b.y*2,21,23);c.fillStyle=c.strokeStyle;c.fillText(region.id==='desert'?'A':'B',b.x*2+5,b.y*2+18);}
  c.lineWidth=4;c.strokeStyle='#17261f';c.strokeRect(view.left*2,view.top*2,view.width/state.zoom*2,view.height/state.zoom*2);
  c.lineWidth=2;c.strokeStyle='#ffffff';c.strokeRect(view.left*2,view.top*2,view.width/state.zoom*2,view.height/state.zoom*2);
}
function render():void {
  if(!scene||!ground)return;
  clampCamera();const c=context(map),z=state.zoom;c.fillStyle='#153b37';c.fillRect(0,0,view.width,view.height);
  c.drawImage(state.trees?painted:ground,Math.round(-view.left*z),Math.round(-view.top*z),scene.world.width*z,scene.world.height*z);
  const left=Math.max(0,Math.floor(view.left)),right=Math.min(scene.world.width,Math.ceil(view.left+view.width/z));
  const top=Math.max(0,Math.floor(view.top)),bottom=Math.min(scene.world.height,Math.ceil(view.top+view.height/z));
  if(state.grid&&z>=12){c.strokeStyle='#10241844';c.lineWidth=1;c.beginPath();for(let x=left;x<=right;x++){const px=Math.round((x-view.left)*z)+.5;c.moveTo(px,0);c.lineTo(px,view.height);}for(let y=top;y<=bottom;y++){const py=Math.round((y-view.top)*z)+.5;c.moveTo(0,py);c.lineTo(view.width,py);}c.stroke();}
  if(state.ramps){
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
      const stair=scene.world.tiles[y*scene.world.width+x].stair;if(!stair)continue;const p=STAIR_UP[stair],px=(x+.5-view.left)*z,py=(y+.5-view.top)*z;
      c.fillStyle='#ffe1a1';c.strokeStyle='#3b321a';c.lineWidth=2;
      if(z<12){c.fillRect(px-2,py-2,4,4);continue;}
      c.save();c.translate(px,py);c.rotate(Math.atan2(p.y,p.x));
      c.beginPath();c.moveTo(z*.33,0);c.lineTo(-z*.2,-z*.22);c.lineTo(-z*.12,0);c.lineTo(-z*.2,z*.22);c.closePath();c.stroke();c.fill();c.restore();
    }
  }
  if(state.whole){for(const region of scene.regions){const b=region.bounds,px=(b.x-view.left)*z,py=(b.y-view.top)*z;c.strokeStyle=region.id==='desert'?'#f0d28d':'#cee6a6';c.lineWidth=2;c.strokeRect(px,py,b.width*z,b.height*z);const label=region.id==='desert'?'A · Desert hills':'B · Forest hills';c.font='bold 21px "Pixel Operator"';const tw=c.measureText(label).width;c.fillStyle='#17271fed';c.fillRect(px,py-27,tw+14,27);c.fillStyle=c.strokeStyle;c.fillText(label,px+7,py-7);}}
  $('zoom-value').textContent=`${Math.round(z)}px`;
  map.dataset.world=String(state.world);map.dataset.region=state.region;map.dataset.zoom=String(z);map.dataset.whole=String(state.whole);
  drawMini();
}
function updateInfo():void {
  if(!scene)return;const region=scene.regions.find(r=>r.id===state.region)!;
  const m=(state.whole?scene.metrics:region.metrics) as Record<string,number>;
  $('hill-count').textContent=String(m.hillCount??'—');$('ramp-count').textContent=String(m.rampCount??'—');
  $('ramp-share').textContent=m.accessibleHillShare===undefined?'—':`${Math.round(m.accessibleHillShare*100)}%`;
  $('hill-area').textContent=m.medianHillArea===undefined?'—':String(Math.round(m.medianHillArea));
  $('tier-summary').textContent=`${m.twoLevelHillCount} two-level hills · ${m.smallestHillArea}–${m.largestHillArea} tiles per hill`;
  $<HTMLButtonElement>('tiered').disabled=!scene.hills.some(h=>h.region===state.region&&h.cells.some(k=>scene.world.tiles[k].ridgeTier===2));
  $('title').textContent=state.whole?`${records[state.world].name} / Whole world`:`${state.region==='desert'?'A':'B'} · ${region.name}`;
  $('subtitle').textContent=`${records[state.world].seed} · ${scene.world.width} × ${scene.world.height} tiles`;
  $('region-description').textContent=state.whole
    ?'Two hill biomes across one generated world. Explore the sandstone shelves and open woodland, with the original rivers and beaches running between them.'
    :state.region==='desert'
    ?'Low sandstone shelves, hooked ridges and little buttes. Narrow dry passages weave around the hills; ramps open routes across their tops.'
    :'Small wooded hills separated by winding green passages. Patches of trees alternate with open summits, clearings and clear ramp landings.';
  for(const id of ['desert','forest'])$(id).setAttribute('aria-pressed',String(!state.whole&&state.region===id));
  $('whole').setAttribute('aria-pressed',String(state.whole));
  $('trees').textContent=state.trees?'Lift trees':'Restore trees';$('trees').setAttribute('aria-pressed',String(!state.trees));
  $('ramps').textContent=state.ramps?'Hide ramps':'Show ramps';$('ramps').setAttribute('aria-pressed',String(state.ramps));
  $('grid').setAttribute('aria-pressed',String(state.grid));
}
function focusRegion(id:RegionId):void {
  if(!scene)return;const region=scene.regions.find(r=>r.id===id)!;state.region=id;state.whole=false;
  state.cx=region.focus.x;state.cy=region.focus.y;state.zoom=view.width<600?16:24;
  updateInfo();render();
}
function fitWorld():void {if(!scene)return;state.whole=true;state.cx=scene.world.width/2;state.cy=scene.world.height/2;state.zoom=fitZoom();updateInfo();render();}
function focusTwoLevelHill():void {
  if(!scene)return;
  const hills=scene.hills.filter(h=>h.region===state.region&&h.cells.some(k=>scene.world.tiles[k].ridgeTier===2));
  if(!hills.length)return;
  const hill=hills[tierIndex++%hills.length],xs=hill.cells.map(k=>k%scene.world.width),ys=hill.cells.map(k=>Math.floor(k/scene.world.width));
  const left=Math.min(...xs),right=Math.max(...xs)+1,top=Math.min(...ys),bottom=Math.max(...ys)+1;
  state.whole=false;state.cx=(left+right)/2;state.cy=(top+bottom)/2;
  state.zoom=Math.min(24,view.width/(right-left+10),view.height/(bottom-top+10));updateInfo();render();
}
function setZoom(value:number,x=view.width/2,y=view.height/2):void {
  if(!scene)return;
  const wx=view.left+x/state.zoom,wy=view.top+y/state.zoom;
  state.zoom=Math.max(fitZoom(),Math.min(64,value));state.cx=wx+(view.width/2-x)/state.zoom;state.cy=wy+(view.height/2-y)/state.zoom;
  state.whole=state.zoom<=fitZoom()+.01;updateInfo();render();
}
async function selectWorld(index:number):Promise<void> {
  const token=++loadToken;const loading=$('loading');loading.hidden=false;loading.style.display='grid';loading.textContent='Opening the atlas…';
  const incoming=await unpack(index);if(token!==loadToken)return;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  scene=incoming;state.world=index;$<HTMLSelectElement>('world').value=String(index);buildMap(scene.world);
  focusRegion(state.region);loading.style.display='none';document.documentElement.dataset.ready='true';
}
function resize():void {const rect=map.parentElement!.getBoundingClientRect();view.width=Math.max(1,Math.round(rect.width));view.height=Math.max(1,Math.round(rect.height));map.width=view.width;map.height=view.height;if(state.whole&&scene)state.zoom=fitZoom();queueRender();}
function local(event:{clientX:number;clientY:number}){const b=map.getBoundingClientRect();return{x:event.clientX-b.left,y:event.clientY-b.top};}
function inspect(x:number,y:number):void {if(!scene)return;const tx=Math.floor(view.left+x/state.zoom),ty=Math.floor(view.top+y/state.zoom);if(tx<0||ty<0||tx>=scene.world.width||ty>=scene.world.height)return;const tile=scene.world.tiles[ty*scene.world.width+tx];$('coords').textContent=`${tx}, ${ty} · ${tile.terrain}${tile.stair?` · ${tile.stair} ramp`:tile.ridge?ridgeIsLedge(scene.world,tx,ty)?' · ledge':' · hilltop':' · low ground'}${tile.overlay==='forest'?' · woodland':''}`;}
map.addEventListener('pointerdown',event=>{if(!scene)return;map.setPointerCapture(event.pointerId);const point=local(event);pointers.set(event.pointerId,point);map.classList.add('dragging');if(pointers.size===1)drag={...point,cx:state.cx,cy:state.cy};else if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:state.zoom,x:(a.x+b.x)/2,y:(a.y+b.y)/2};drag=undefined;}});
map.addEventListener('pointermove',event=>{const p=local(event);inspect(p.x,p.y);if(!pointers.has(event.pointerId))return;pointers.set(event.pointerId,p);if(pinch&&pointers.size===2){const [a,b]=[...pointers.values()];setZoom(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),pinch.x,pinch.y);}else if(drag){state.cx=drag.cx-(p.x-drag.x)/state.zoom;state.cy=drag.cy-(p.y-drag.y)/state.zoom;queueRender();}});
function endPointer(event:PointerEvent):void {pointers.delete(event.pointerId);pinch=undefined;if(pointers.size===1){const p=[...pointers.values()][0];drag={...p,cx:state.cx,cy:state.cy};}else{drag=undefined;map.classList.remove('dragging');}}
map.addEventListener('pointerup',endPointer);map.addEventListener('pointercancel',endPointer);
map.addEventListener('wheel',event=>{event.preventDefault();const p=local(event);setZoom(state.zoom*Math.exp(-event.deltaY*.002),p.x,p.y);},{passive:false});
map.addEventListener('dblclick',event=>{const p=local(event);setZoom(Math.max(24,state.zoom*1.6),p.x,p.y);});
map.addEventListener('keydown',event=>{const move:Record<string,[number,number]>={ArrowLeft:[-6,0],ArrowRight:[6,0],ArrowUp:[0,-6],ArrowDown:[0,6]};if(move[event.key]){event.preventDefault();state.cx+=move[event.key][0];state.cy+=move[event.key][1];render();}else if(event.key==='+'||event.key==='='){event.preventDefault();setZoom(state.zoom*1.5);}else if(event.key==='-'){event.preventDefault();setZoom(state.zoom/1.5);}});
mini.onclick=event=>{if(!scene)return;const rect=mini.getBoundingClientRect();state.cx=(event.clientX-rect.left)/rect.width*scene.world.width;state.cy=(event.clientY-rect.top)/rect.height*scene.world.height;if(state.whole)state.zoom=24;state.whole=false;updateInfo();render();};
mini.onkeydown=event=>{if(event.key==='Enter'){focusRegion(state.region);map.focus();}};
$('desert').onclick=()=>focusRegion('desert');$('forest').onclick=()=>focusRegion('forest');$('whole').onclick=fitWorld;
$('tiered').onclick=focusTwoLevelHill;
$('trees').onclick=()=>{state.trees=!state.trees;updateInfo();render();};$('ramps').onclick=()=>{state.ramps=!state.ramps;updateInfo();render();};$('grid').onclick=()=>{state.grid=!state.grid;updateInfo();render();};
$('zoom-in').onclick=()=>setZoom(state.zoom*1.5);$('zoom-out').onclick=()=>setZoom(state.zoom/1.5);$('native').onclick=()=>setZoom(32);
$('world').onchange=()=>void selectWorld(Number($<HTMLSelectElement>('world').value));
$('export').onclick=()=>{if(!scene)return;map.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`hill-biomes-${records[state.world].id}-${state.whole?'world':state.region}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});};
Object.assign(window,{__hillReview:{records,state,selectWorld,focusRegion,focusTwoLevelHill,fitWorld,setZoom,render,get scene(){return scene;},get view(){return view;}}});
new ResizeObserver(resize).observe(map.parentElement!);resize();
try{
  await Promise.all(Object.entries(payload.HILL_REVIEW_ASSETS).map(async([id,uri])=>{const image=new Image();image.src=uri;await image.decode();images[id]=image;}));
  await document.fonts.ready;
  atlas=imagePixels(images.world);desert=imagePixels(images.desert);salt=imagePixels(images.salt);
  records.forEach((record,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${index+1} · ${record.name}`;$('world').append(option);});
  await selectWorld(0);
}catch(error){$('loading').textContent=`Could not open this review: ${String(error)}`;console.error(error);}
