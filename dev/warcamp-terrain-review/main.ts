import { buildReview } from './model';
import { rasterTerrain } from '../../src/game/terrain';
import { rasterDirtRoad } from '../../src/game/road-sprites';
import { recolorPunyBuildingPixels } from '../../src/game/puny-building-art';
import type { PunyPixels } from '../../src/game/puny-world';

type ReviewCase = ReturnType<typeof buildReview>[number];
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const payload = window as unknown as { MARAUDER_ASSETS: Record<string, string> };
const images: Record<string, HTMLImageElement> = {};
const canvas = $<HTMLCanvasElement>('#scene');
const state = { index: 0, seed: 1, terrainOnly: false, grid: false, tiers: false, zoom: 'fit' };
const colors = ['#e9bc68', '#8dd2c4', '#e8a18d'];
const grounds = new Map<string, HTMLCanvasElement>(), sprites = new Map<string, HTMLCanvasElement>();
let atlas: PunyPixels;
let cases: ReviewCase[] = [];
const key = (x: number, y: number) => `${x},${y}`;
function ctx(target: HTMLCanvasElement) { const c = target.getContext('2d')!; c.imageSmoothingEnabled = false; return c; }
function pixels(width: number, height: number, data: Uint8ClampedArray): HTMLCanvasElement {
  const target = document.createElement('canvas'); target.width = width; target.height = height;
  const c = ctx(target), raster = c.createImageData(width, height); raster.data.set(data); c.putImageData(raster, 0, 0); return target;
}
function crop(c: CanvasRenderingContext2D, sheet: string, source: readonly number[], x: number, y: number, w = source[2] * 2, h = source[3] * 2) {
  c.drawImage(images[sheet], source[0], source[1], source[2], source[3], Math.round(x), Math.round(y), w, h);
}
function building(c: CanvasRenderingContext2D, source: readonly [number, number, number, number], x: number, y: number) {
  const id = source.join(','); let image = sprites.get(id);
  if (!image) { const recolored = recolorPunyBuildingPixels(atlas, source, '#8e6950'); image = pixels(recolored.width, recolored.height, recolored.data); sprites.set(id, image); }
  c.drawImage(image, x, y, source[2] * 2, source[3] * 2);
}
const stockade = {
  horizontal: [32, 48, 16, 16], vertical: [0, 16, 16, 16],
  nw: [16, 0, 16, 16], ne: [48, 0, 16, 16], sw: [16, 32, 16, 16], se: [48, 32, 16, 16],
} as const;
function wall(c: CanvasRenderingContext2D, x: number, y: number, cells: Set<string>) {
  // The entire wall, including any junction overlay, stays in one map cell.
  c.save(); c.beginPath(); c.rect(x * 32, y * 32, 32, 32); c.clip();
  const n = cells.has(key(x, y - 1)), e = cells.has(key(x + 1, y)), s = cells.has(key(x, y + 1)), w = cells.has(key(x - 1, y));
  const mask = Number(n) + Number(e) * 2 + Number(s) * 4 + Number(w) * 8;
  const source = mask === 6 ? stockade.nw : mask === 12 ? stockade.ne : mask === 3 ? stockade.sw : mask === 9 ? stockade.se
    : mask === 5 || mask === 1 || mask === 4 ? stockade.vertical : stockade.horizontal;
  crop(c, 'palisades', source, x * 32, y * 32);
  if (n && s && (e || w)) {
    c.save(); c.beginPath(); c.rect(x * 32, y * 32, 16, 32); c.clip();
    crop(c, 'palisades', stockade.vertical, x * 32, y * 32); c.restore();
  }
  c.restore();
}
function tower(c: CanvasRenderingContext2D, x: number, y: number, tier: number, i: number) {
  // Mix the complete native timber lookout with the game's platform-and-post
  // watchtower. Both retain a one-cell ground footprint and original pixels.
  if ((tier + i) % 3 === 0) crop(c, 'lookouts', [i % 2 ? 48 : 0, 0, 16, 32], x * 32, y * 32 - 32);
  else {
    crop(c, 'world', [352, 432, 4, 16], x * 32 + 4, y * 32, 8, 32);
    crop(c, 'world', [352, 432, 4, 16], x * 32 + 20, y * 32, 8, 32);
    building(c, [112, 432, 16, 16], x * 32, y * 32 - 24);
  }
}

function terrain(item: ReviewCase): HTMLCanvasElement {
  let target = grounds.get(item.id); if (target) return target;
  const raster = rasterTerrain(item.world, undefined, atlas), native = pixels(raster.width, raster.height, raster.pixels);
  target = document.createElement('canvas'); target.width = item.world.width * 32; target.height = item.world.height * 32;
  ctx(target).drawImage(native, 0, 0, target.width, target.height);
  grounds.set(item.id, target); return target;
}
function roads(c: CanvasRenderingContext2D, item: ReviewCase) {
  const points = item.plan.layout?.paths ?? [], keys = new Set(points.map(point => key(point.x, point.y)));
  for (const p of points) {
    const links = { north: keys.has(key(p.x,p.y-1)), east: keys.has(key(p.x+1,p.y)), south: keys.has(key(p.x,p.y+1)), west: keys.has(key(p.x-1,p.y)) };
    const id = `road:${Number(links.north)+2*Number(links.east)+4*Number(links.south)+8*Number(links.west)}`;
    let art = sprites.get(id); if (!art) { art = pixels(32,32,rasterDirtRoad(links,atlas)); sprites.set(id,art); }
    c.drawImage(art,p.x*32,p.y*32);
  }
}
function scene(target: HTMLCanvasElement, item: ReviewCase) {
  target.width = item.world.width * 32; target.height = item.world.height * 32;
  const c = ctx(target); c.drawImage(terrain(item),0,0);
  const layout = state.terrainOnly ? null : item.plan.layout;
  if (layout) roads(c,item);
  const draw: {depth:number; order:number; run:()=>void}[] = [];
  for (let y=0;y<item.world.height;y++) for (let x=0;x<item.world.width;x++) {
    const tile=item.world.tiles[y*item.world.width+x];
    if (tile.overlay==='forest'||tile.overlay==='jungle') {
      const variant=Math.floor(tile.variation*65536), column=variant%4===0?17:8, row=7+(variant>>>3)%3;
      draw.push({depth:y+15/16,order:0,run:()=>crop(c,'world',[column*16,row*16,16,16],x*32,y*32-6)});
    }
  }
  if (layout) {
    const cells=new Set([...layout.walls,...layout.gates].map(p=>key(p.x,p.y)));
    for (const p of layout.walls) draw.push({depth:p.y+.9,order:1,run:()=>wall(c,p.x,p.y,cells)});
    for (const p of layout.gates) draw.push({depth:p.y+.9,order:1,run:()=>crop(c,'palisades',[144,p.axis==='ns'?0:16,16,16],p.x*32,p.y*32)});
    for (const [i,p] of layout.towers.entries()) draw.push({depth:p.y+.95,order:2,run:()=>tower(c,p.x,p.y,p.tier,i)});
    for (const p of layout.tents) draw.push({depth:p.y+.95,order:1,run:()=>building(c,[64,416,16,16],p.x*32,p.y*32)});
    for (const [i,p] of layout.signs.entries()) draw.push({depth:p.y+15/16,order:1,run:()=>crop(c,'world',[112+i%3*16,480,16,16],p.x*32,p.y*32)});
  }
  draw.sort((a,b)=>a.depth-b.depth||a.order-b.order); for(const item of draw)item.run();
  if (layout&&state.tiers) {
    for(const p of [...layout.walls,...layout.gates]) {c.fillStyle=colors[p.tier-1]+'77';c.fillRect(p.x*32,p.y*32,32,32);}
    for(const p of layout.gates){c.strokeStyle='#fff8db';c.lineWidth=3;c.setLineDash([4,4]);c.strokeRect(p.x*32+3,p.y*32+3,26,26);c.setLineDash([]);}
  }
  if (state.grid) {
    c.strokeStyle='#15221b80';c.lineWidth=1;c.beginPath();
    for(let x=0;x<=item.world.width;x++){c.moveTo(x*32+.5,0);c.lineTo(x*32+.5,target.height);}
    for(let y=0;y<=item.world.height;y++){c.moveTo(0,y*32+.5);c.lineTo(target.width,y*32+.5);}c.stroke();
  }
  Object.assign(target.dataset,{id:item.id,terrainOnly:String(state.terrainOnly),grid:String(state.grid),seed:String(state.seed)});
}
function sizeCanvas() {
  const scale=state.zoom==='fit'?Math.min(canvas.parentElement!.clientWidth/canvas.width,700/canvas.height,1):Number(state.zoom)/2;
  canvas.style.width=`${Math.floor(canvas.width*scale)}px`;canvas.style.height=`${Math.floor(canvas.height*scale)}px`;
}
function render() {
  const item=cases[state.index], plan=item.plan;scene(canvas,item);sizeCanvas();
  $('#case-name').textContent=item.name;$('#description').textContent=item.description;$('#reason').textContent=plan.reason;
  $('#status').textContent=plan.status==='placed'?'Camp placed':'Site rejected';$('#status').dataset.status=plan.status;
  $('#seed').textContent=String(state.seed);
  const bounds=plan.bounds;
  $('#stats').innerHTML=[[bounds?`${bounds.width} × ${bounds.height}`:'—','camp footprint'],[String(plan.metrics.tentCount),'tents'],[String(plan.metrics.tierCount),'defensive tiers'],[String(plan.metrics.wallTiles),'wall tiles']]
    .map(([value,label])=>`<div><b>${value}</b><span>${label}</span></div>`).join('');
  $('#adjustments').replaceChildren(...plan.adjustments.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('#check-note').textContent=plan.status==='rejected'?'No forced placement on unsuitable terrain.':plan.checks.valid?'Access and wall-width checks passed.':plan.checks.issues.join(' · ');
  document.querySelectorAll<HTMLButtonElement>('#case-tabs button').forEach((button,i)=>button.setAttribute('aria-pressed',String(i===state.index)));
  $('#canvas-note').textContent=`${item.world.width} × ${item.world.height} landscape · ${state.terrainOnly?'Terrain only':'Terrain + camp'} · Seed ${state.seed}`;
  const save=$<HTMLAnchorElement>('#save');save.href=canvas.toDataURL();save.download=`terrain-warcamp-${item.id}-${state.seed}.png`;
}
function select(index:number) {state.index=Math.max(0,Math.min(cases.length-1,index));render();}
function regenerate(seed=state.seed+1) {
  state.seed=Number.isFinite(seed)?Math.max(0,Math.floor(seed)):1;
  cases=buildReview(state.seed);grounds.clear();state.index=Math.min(state.index,cases.length-1);
  $('#case-tabs').replaceChildren(...cases.map((item,index)=>{const button=document.createElement('button');button.dataset.index=String(index);button.textContent=item.name;button.onclick=()=>select(index);return button;}));
  render();
}
$('#terrain-only').onchange=event=>{state.terrainOnly=(event.target as HTMLInputElement).checked;render();};
for(const option of ['grid','tiers'] as const)$<HTMLInputElement>(`#${option}`).onchange=event=>{state[option]=(event.target as HTMLInputElement).checked;render();};
$('#zoom').onchange=event=>{state.zoom=(event.target as HTMLSelectElement).value;sizeCanvas();};
$('#regenerate').onclick=()=>regenerate();window.addEventListener('resize',sizeCanvas);
async function main() {
  await Promise.all(Object.entries(payload.MARAUDER_ASSETS).map(async([name,url])=>{const image=new Image();image.src=url;await image.decode();images[name]=image;}));
  const source=document.createElement('canvas');source.width=images.world.width;source.height=images.world.height;const c=ctx(source);c.drawImage(images.world,0,0);
  atlas={width:source.width,height:source.height,data:c.getImageData(0,0,source.width,source.height).data};
  regenerate(1);
  (window as any).__terrainCampReview={get cases(){return cases;},select,regenerate,state,render};
  document.documentElement.dataset.ready='true';$('#loading').hidden=true;
}
main().catch(error=>{$('#loading').textContent=`Could not open review: ${String(error)}`;console.error(error);});
