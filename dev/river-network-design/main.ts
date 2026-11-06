import { createRiverDesignModel, type RiverDesignModel } from './model';
const $ = <T extends HTMLElement = HTMLElement>(id:string)=>document.querySelector<T>(id)!;
const root = window as unknown as Record<string,any>;
const atlas = new Image(); atlas.src=root.__RIVER_ATLAS__;
const tile=16, canvas=$<HTMLCanvasElement>('#map'), ctx=canvas.getContext('2d')!;
let model:RiverDesignModel, terrain=document.createElement('canvas'), parents:number[][]=[];
let selected=-1, upstream=new Set<number>(), zoom=.7, center={x:48,y:36}, probePath:number[]=[], probeStart=-1,probeEnd=-1;
let ready=false,drag:{x:number;y:number;cx:number;cy:number;distance:number}|null=null;
const settings={seed:'ALDER',rainfall:1,density:1,fordSpacing:8};
const checked=(id:string)=>$<HTMLInputElement>(id).checked;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const point=(cell:number)=>({x:cell%model.width,y:Math.floor(cell/model.width)});
const format=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:1});
function resize(){const r=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
function fit(){const r=canvas.getBoundingClientRect();zoom=Math.min(r.width/(model.width*tile),r.height/(model.height*tile));center={x:model.width/2,y:model.height/2};}
function makeTerrain(){terrain.width=model.width*tile;terrain.height=model.height*tile;const c=terrain.getContext('2d')!;c.imageSmoothingEnabled=false;
  for(let i=0;i<model.elevation.length;i++){const {x,y}=point(i);if(model.seaMask[i]){c.fillStyle='#087f98';c.fillRect(x*tile,y*tile,tile,tile);continue;}
    c.drawImage(atlas,16,16,16,16,x*tile,y*tile,tile,tile);c.fillStyle=`rgba(32,55,42,${clamp(model.elevation[i],0,1)*.21})`;c.fillRect(x*tile,y*tile,tile,tile);
    if(x&&Math.floor(model.elevation[i]*14)!==Math.floor(model.elevation[i-1]*14)){c.fillStyle='#41623a20';c.fillRect(x*tile,y*tile,1,tile);}
  }
}
function regenerate(){model=createRiverDesignModel(settings);parents=Array.from({length:model.receiver.length},()=>[]);for(let i=0;i<model.receiver.length;i++)if(model.receiver[i]>=0)parents[model.receiver[i]].push(i);
  makeTerrain();probePath=[];probeStart=probeEnd=-1;$('#route-status').textContent='Choose a reach, then test how a walker gets from one bank to the other.';
  $('#rainfall-value').textContent=`${settings.rainfall.toFixed(2)}×`;$('#density-value').textContent=`${settings.density.toFixed(2)}×`;$('#ford-spacing-value').textContent=`${settings.fordSpacing} tiles`;
  const d=model.diagnostics;$('#stat-heads').textContent=String(d.heads);$('#stat-junctions').textContent=String(d.confluences);$('#stat-fords').textContent=String(model.crossings.filter(c=>c.kind==='ford').length);
  $('#stat-width').textContent=`${d.maxWidth.toFixed(1)} tiles`;$('#stat-balance').textContent=`${(100*(1-d.massBalanceError/Math.max(1,d.inputFlow))).toFixed(2)}%`;
  $('#ford-note').textContent=`Longest measured gap between tributary fords: ${d.longestFordGap} channel tiles. ${d.fordGaps?`${d.fordGaps} reaches lack a safe crossing and need terrain adjustment or a bridge.`:'Every measured tributary reach has a valid crossing arrangement.'}`;
  select(representative('confluence'));if(checked('#show-routes'))makeProbe();
}
function representative(kind:string):number{const cells=Array.from(model.channel.keys()).filter(i=>model.channel[i]&&!model.seaMask[i]);
  if(kind==='headwaters'){
    const hasOpenBanks=(cell:number)=>{if(model.channel[cell]!==1||model.waterMask[cell])return false;const p=point(cell),next=model.receiver[cell];if(next<0||p.x<3||p.y<3||p.x>=model.width-3||p.y>=model.height-4)return false;
      const r=point(next),horizontal=Math.abs(r.y-p.y)>=Math.abs(r.x-p.x),step=horizontal?1:model.width;
      return [-2,-1,0,1,2].every(offset=>!model.waterMask[cell+offset*step]&&!model.seaMask[cell+offset*step]);};
    const heads:number[]=[];
    for(const source of model.sources){let cell=source.cell;for(let step=0;step<12&&cell>=0&&model.channel[cell]===1;step++,cell=model.receiver[cell])if(hasOpenBanks(cell)){heads.push(cell);break;}}
    return heads[Math.floor(heads.length*.25)]??cells.find(hasOpenBanks)??cells.find(i=>model.channel[i]===1&&!model.waterMask[i])??cells[0];
  }
  if(kind==='tributary'){const fords=model.crossings.filter(c=>c.kind==='ford'&&model.channel[c.cell]===2);if(fords.length)return fords[Math.floor(fords.length*.35)].cell;return cells.find(i=>model.channel[i]===2)??cells[0];}
  if(kind==='main')return cells.filter(i=>model.channel[i]===3).sort((a,b)=>Math.abs(model.widthTiles[a]-3.5)-Math.abs(model.widthTiles[b]-3.5))[0]??cells.at(-1)!;
  return cells.filter(i=>parents[i].filter(p=>model.channel[p]).length>=2).sort((a,b)=>Math.abs(model.flow[a]-model.diagnostics.mouthFlow*.3)-Math.abs(model.flow[b]-model.diagnostics.mouthFlow*.3))[0]??cells[Math.floor(cells.length/2)];
}
function select(cell:number){if(cell<0||!model.channel[cell])return;selected=cell;upstream=new Set([cell]);const queue=[cell];for(let n=0;n<queue.length;n++)for(const p of parents[queue[n]])if(!upstream.has(p)){upstream.add(p);queue.push(p);}
  const kind=model.channel[cell],p=point(cell),width=model.widthTiles[cell];$('#selected-location').textContent=`Reach at ${p.x}, ${p.y}`;
  $('#selected-kind').textContent=kind===1?'Headwater stream':kind===2?'One-tile tributary':'Main river';
  const joining=parents[cell].filter(i=>model.channel[i]);$('#selected-description').textContent=joining.length>1?`${joining.length} upstream channels meet here. Highlighted land and feeders supply this reach.`:'The highlighted catchment and its feeder channels supply this reach.';
  $('#selected-flow').textContent=format(model.flow[cell]);const channelFlow=joining.reduce((s,i)=>s+model.flow[i],0),hillslope=parents[cell].filter(i=>!model.channel[i]).reduce((s,i)=>s+model.flow[i],0),local=model.localRunoff[cell];
  $('#selected-formula').textContent=`${format(channelFlow)} from upstream channels\n+ ${format(hillslope)} from hillslope drainage\n+ ${format(local)} local runoff\n= ${format(model.flow[cell])} outgoing Q`;
  $('#selected-width').textContent=kind===1?`${Math.round(width*16)} / 16 px`:`${width.toFixed(kind===2?0:1)} tile${width===1?'':'s'}`;
  $('#selected-heads').textContent=String(model.sources.filter(s=>upstream.has(s.cell)).length);$('#selected-area').textContent=format(upstream.size);$('#selected-order').textContent=String(model.streamOrder[cell]);
  $('#selected-crossing').textContent=kind===1&&!model.waterMask[cell]?'Crossable ground. The narrow ribbon leaves visible land inside the tile.':kind===1?'This small feeder overlaps a wider channel here. The full water footprint determines whether this particular tile is crossable.':kind===2?'Water blocks ordinary walking. Nearby complete fords connect the opposite banks.':'Broad water is a barrier. A walking route must find a complete ford; a bridge can create a direct crossing.';
  if(checked('#show-routes'))makeProbe();
}
function passable(i:number){return i>=0&&i<model.waterMask.length&&!model.seaMask[i]&&(!model.waterMask[i]||!!model.fordMask[i]);}
function makeProbe(){if(selected<0)return;const p=point(selected),r=point(model.receiver[selected]>=0?model.receiver[selected]:selected),horizontal=Math.abs(r.y-p.y)>=Math.abs(r.x-p.x);const dx=horizontal?1:0,dy=horizontal?0:1;
  const distance=Math.max(2,Math.ceil(model.widthTiles[selected]/2)+1);let a=-1,b=-1;
  for(let n=distance;n<15;n++){const ax=p.x-dx*n,ay=p.y-dy*n,bx=p.x+dx*n,by=p.y+dy*n;if(a<0&&ax>=0&&ay>=0&&ax<model.width&&ay<model.height&&passable(ay*model.width+ax))a=ay*model.width+ax;if(b<0&&bx>=0&&by>=0&&bx<model.width&&by<model.height&&passable(by*model.width+bx))b=by*model.width+bx;if(a>=0&&b>=0)break;}
  probeStart=a;probeEnd=b;probePath=[];if(a<0||b<0){$('#route-status').textContent='This reach has no suitable pair of dry banks for the probe. Select an inland reach.';return;}
  const prev=new Int32Array(model.receiver.length).fill(-1),queue=[a];prev[a]=a;for(let n=0;n<queue.length&&prev[b]<0;n++){const i=queue[n],p=point(i);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=p.x+dx,y=p.y+dy,j=y*model.width+x;if(x<0||y<0||x>=model.width||y>=model.height||prev[j]>=0||!passable(j))continue;prev[j]=i;queue.push(j);}}
  if(prev[b]<0){$('#route-status').textContent='No walking route connects these banks. This crossing needs a bridge.';return;}
  for(let i=b;;i=prev[i]){probePath.push(i);if(i===a)break;}probePath.reverse();
  const streams=probePath.filter(i=>model.channel[i]===1&&!model.waterMask[i]).length,fords=probePath.filter(i=>model.fordMask[i]).length;
  $('#route-status').textContent=`Actual walkable route: ${probePath.length-1} tiles · ${streams} stream tile${streams===1?'':'s'} · ${fords} ford tile${fords===1?'':'s'}. Gold line follows the movement mask.`;
}
function line(c:CanvasRenderingContext2D,i:number,j:number,width:number,color:string){const a=point(i),b=point(j);c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo((a.x+.5)*tile,(a.y+.5)*tile);c.lineTo((b.x+.5)*tile,(b.y+.5)*tile);c.stroke();}
// Round a stream's change of direction inside its own cell, between the
// midpoints of the actual receiver edges. Junctions and endpoints remain
// anchored to their real cells; this never creates a second decorative route.
function streamSegment(c:CanvasRenderingContext2D,i:number,width:number,color:string){
  const next=model.receiver[i];if(next<0)return;
  const p=point(i),q=point(next),incoming=parents[i].filter(parent=>model.channel[parent]===1);
  const previous=incoming.length===1?point(incoming[0]):p;
  const x=(p.x+.5)*tile,y=(p.y+.5)*tile;
  const startX=(previous.x+p.x+1)*tile/2,startY=(previous.y+p.y+1)*tile/2;
  const endX=(p.x+q.x+1)*tile/2,endY=(p.y+q.y+1)*tile/2;
  c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(startX,startY);
  c.quadraticCurveTo(x,y,endX,endY);
  if(model.channel[next]!==1||parents[next].filter(parent=>model.channel[parent]===1).length!==1)
    c.lineTo((q.x+.5)*tile,(q.y+.5)*tile);
  c.stroke();
}
function render(time:number){if(!ready)return;const dpr=devicePixelRatio||1,w=canvas.width/dpr,h=canvas.height/dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#153b3b';ctx.fillRect(0,0,w,h);
  ctx.setTransform(dpr*zoom,0,0,dpr*zoom,dpr*(w/2-center.x*tile*zoom),dpr*(h/2-center.y*tile*zoom));ctx.imageSmoothingEnabled=false;ctx.drawImage(terrain,0,0);ctx.lineCap='round';ctx.lineJoin='round';const network=$<HTMLSelectElement>('#view').value==='network';
  if(network){ctx.fillStyle='#233e3b88';ctx.fillRect(0,0,terrain.width,terrain.height);}
  if(checked('#show-catchment')){ctx.fillStyle=network?'#d3d39822':'#eed6921c';for(const i of upstream){if(model.seaMask[i])continue;const p=point(i);ctx.fillRect(p.x*tile,p.y*tile,tile,tile);}}
  // Streams are actual narrow ribbons on a still-green, fully passable tile.
  for(const layer of [0,1,2])for(let i=0;i<model.channel.length;i++)if(model.channel[i]===1&&model.receiver[i]>=0){const width=model.widthTiles[i]*tile;
    if(layer===0)streamSegment(ctx,i,width+2,'#477962');else if(layer===1)streamSegment(ctx,i,width,network?'#9ce4cb':'#54c7bd');else if(width>=4)streamSegment(ctx,i,Math.max(1,width*.28),'#b3e6cd');}
  // Connect diagonal one-cell water tiles through their corners. These small
  // visual joins stay clear of neighboring dry tile centers used by walking.
  for(const layer of [0,1])for(let i=0;i<model.channel.length;i++)if(model.channel[i]===2&&model.receiver[i]>=0)
    line(ctx,i,model.receiver[i],layer===0?16:14,layer===0?'#78d4b3':network?'#43bfc9':'#19adb5');
  for(let i=0;i<model.waterMask.length;i++)if(model.waterMask[i]&&!model.seaMask[i]){const p=point(i);ctx.fillStyle=network?'#43bfc9':'#19adb5';ctx.fillRect(p.x*tile,p.y*tile,tile,tile);
    for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){const x=p.x+dx,y=p.y+dy,j=y*model.width+x;if(x<0||y<0||x>=model.width||y>=model.height||model.waterMask[j])continue;ctx.fillStyle='#78d4b3';ctx.fillRect(p.x*tile+(dx===1?15:0),p.y*tile+(dy===1?15:0),dx?1:tile,dy?1:tile);}
  }
  for(let i=0;i<model.channel.length;i++)if(model.channel[i]===3&&model.receiver[i]>=0&&!model.seaMask[i])line(ctx,i,model.receiver[i],Math.max(3,(model.widthTiles[i]-1)*tile),network?'#6098df':'#0395ae');
  if(checked('#show-catchment'))for(const i of upstream)if(model.channel[i]&&model.receiver[i]>=0&&i!==selected&&!model.seaMask[i]){
    if(model.channel[i]===1)streamSegment(ctx,i,1.4,'#ffe4a8a0');
    else line(ctx,i,model.receiver[i],model.widthTiles[i]===1?2:1.4,'#ffe4a8a0');}
  if(checked('#show-crossings'))for(let i=0;i<model.fordMask.length;i++)if(model.fordMask[i]){const p=point(i);ctx.fillStyle='#d8c58b';ctx.fillRect(p.x*tile+3,p.y*tile+5,4,3);ctx.fillRect(p.x*tile+9,p.y*tile+9,4,3);ctx.fillStyle='#f0deac';ctx.fillRect(p.x*tile+6,p.y*tile+2,3,3);}
  if(checked('#show-flow'))for(let i=0;i<model.channel.length;i++)if(model.channel[i]&&model.receiver[i]>=0&&i%7===0&&!model.seaMask[i]){const a=point(i),b=point(model.receiver[i]),x=(a.x+.5)*tile,y=(a.y+.5)*tile,angle=Math.atan2(b.y-a.y,b.x-a.x);ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.strokeStyle='#d9fcf2b0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-2,-2);ctx.lineTo(1,0);ctx.lineTo(-2,2);ctx.stroke();ctx.restore();}
  for(const s of model.sources){ctx.strokeStyle='#c7f5cf';ctx.lineWidth=1;ctx.beginPath();ctx.arc((s.x+.5)*tile,(s.y+.5)*tile,3,0,Math.PI*2);ctx.stroke();}
  if(checked('#show-grid')){ctx.strokeStyle='#e5efd62d';ctx.lineWidth=.7/zoom;ctx.beginPath();for(let x=0;x<=model.width;x++){ctx.moveTo(x*tile,0);ctx.lineTo(x*tile,model.height*tile);}for(let y=0;y<=model.height;y++){ctx.moveTo(0,y*tile);ctx.lineTo(model.width*tile,y*tile);}ctx.stroke();}
  if(checked('#show-routes')){if(probePath.length){ctx.strokeStyle='#f8d48d';ctx.lineWidth=2.3/Math.max(.8,zoom);ctx.setLineDash([4,3]);ctx.beginPath();probePath.forEach((i,n)=>{const p=point(i);n?ctx.lineTo((p.x+.5)*tile,(p.y+.5)*tile):ctx.moveTo((p.x+.5)*tile,(p.y+.5)*tile);});ctx.stroke();ctx.setLineDash([]);const t=(time/240)%(probePath.length-1||1),a=point(probePath[Math.floor(t)]),b=point(probePath[Math.min(probePath.length-1,Math.floor(t)+1)]);ctx.fillStyle='#fff7d5';ctx.beginPath();ctx.arc((a.x+.5+(b.x-a.x)*(t%1))*tile,(a.y+.5+(b.y-a.y)*(t%1))*tile,3/Math.max(.7,zoom),0,Math.PI*2);ctx.fill();}
    for(const [i,label]of [[probeStart,'A'],[probeEnd,'B']] as const)if(i>=0){const p=point(i);ctx.fillStyle='#283b25';ctx.fillRect((p.x+.5)*tile-5,(p.y+.5)*tile-5,10,10);ctx.fillStyle='#ffe8a9';ctx.font='8px system-ui';ctx.textAlign='center';ctx.fillText(label,(p.x+.5)*tile,(p.y+.5)*tile+3);}}
  if(selected>=0){const p=point(selected);ctx.strokeStyle='#fff1be';ctx.lineWidth=2/zoom;ctx.strokeRect(p.x*tile-2,p.y*tile-2,tile+4,tile+4);}
  requestAnimationFrame(render);
}
function stages(){for(const [id,kind]of [['#stage-stream',1],['#stage-tributary',2],['#stage-main',3]] as const){const c=$<HTMLCanvasElement>(id).getContext('2d')!;c.imageSmoothingEnabled=false;for(let y=0;y<128;y+=16)for(let x=0;x<256;x+=16)c.drawImage(atlas,16,16,16,16,x,y,16,16);
    const width=kind===1?5:kind===2?16:64,upper=kind===1?120:104,lower=kind===1?152:168;
    // A short, tile-aligned crossing reach sits between unequal bends. Width
    // stays constant while the planform changes, so the three scales compare.
    const path=new Path2D();path.moveTo(upper,-16);path.bezierCurveTo(upper,10,136,8,136,28);path.lineTo(136,72);
    path.bezierCurveTo(136,92,lower,88,lower,108);path.bezierCurveTo(lower,128,lower-16,128,lower-16,144);
    c.lineCap='round';c.lineJoin='round';c.strokeStyle='#4c8262';c.lineWidth=width+4;c.stroke(path);c.strokeStyle='#33b9bb';c.lineWidth=width;c.stroke(path);
    if(kind===3){c.strokeStyle='#0692ae';c.lineWidth=36;c.stroke(path);}c.strokeStyle='#eff2ce33';c.lineWidth=.5;for(let x=0;x<256;x+=16){c.beginPath();c.moveTo(x,0);c.lineTo(x,128);c.stroke();}for(let y=0;y<128;y+=16){c.beginPath();c.moveTo(0,y);c.lineTo(256,y);c.stroke();}
    c.strokeStyle=kind===3?'#e8b480':'#f8e1a2';c.lineWidth=2;c.setLineDash([4,3]);c.beginPath();c.moveTo(50,64);c.lineTo(kind===3?94:206,64);c.stroke();c.setLineDash([]);if(kind===2){for(let n=0;n<3;n++)c.drawImage(atlas,24,423,5,4,129+n*5,61+(n%2)*3,5,4);}if(kind===3){c.strokeStyle='#f5ab7d';c.beginPath();c.moveTo(88,58);c.lineTo(98,70);c.moveTo(98,58);c.lineTo(88,70);c.stroke();}}
}
function screenToWorld(x:number,y:number){const r=canvas.getBoundingClientRect();return{x:center.x+(x-r.left-r.width/2)/(tile*zoom),y:center.y+(y-r.top-r.height/2)/(tile*zoom)};}
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,cx:center.x,cy:center.y,distance:0};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.distance=Math.max(drag.distance,Math.hypot(dx,dy));center={x:drag.cx-dx/(tile*zoom),y:drag.cy-dy/(tile*zoom)};});
canvas.addEventListener('pointerup',e=>{if(drag&&drag.distance<5){const p=screenToWorld(e.clientX,e.clientY);let cell=-1,best=4;for(let i=0;i<model.channel.length;i++)if(model.channel[i]&&!model.seaMask[i]){const q=point(i),d=Math.hypot(q.x+.5-p.x,q.y+.5-p.y);if(d<best){best=d;cell=i;}}if(cell>=0)select(cell);}drag=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();const before=screenToWorld(e.clientX,e.clientY);zoom=clamp(zoom*(e.deltaY<0?1.16:1/1.16),.25,4);const after=screenToWorld(e.clientX,e.clientY);center.x+=before.x-after.x;center.y+=before.y-after.y;},{passive:false});
$('#zoom-in').onclick=()=>{zoom=clamp(zoom*1.4,.25,4);};$('#zoom-out').onclick=()=>{zoom=clamp(zoom/1.4,.25,4);};$('#fit').onclick=fit;
for(const kind of ['headwaters','tributary','confluence','main'])$(`#jump-${kind}`).onclick=()=>{select(representative(kind));const p=point(selected);center={x:p.x+.5,y:p.y+.5};zoom=kind==='headwaters'?2.5:kind==='tributary'?2:1.4;};
$('#probe').onclick=()=>{$<HTMLInputElement>('#show-routes').checked=true;makeProbe();};$('#show-routes').onchange=()=>{if(checked('#show-routes'))makeProbe();};
let updateTimer=0;for(const [selector,key]of [['#rainfall','rainfall'],['#density','density'],['#ford-spacing','fordSpacing']]as const)$<HTMLInputElement>(selector).oninput=()=>{settings[key]=Number($<HTMLInputElement>(selector).value);window.clearTimeout(updateTimer);updateTimer=window.setTimeout(regenerate,90);};
$<HTMLSelectElement>('#seed').onchange=()=>{settings.seed=$<HTMLSelectElement>('#seed').value;regenerate();fit();};
window.addEventListener('resize',()=>{resize();});$('#design-notes').textContent=root.__RIVER_NOTES__;
root.__riverNetworkDesign={get model(){return model},settings,get selectedReachId(){return selected},get selectedCell(){return selected},get upstream(){return [...upstream]},get zoom(){return zoom},get center(){return center},get probePath(){return probePath},select,regenerate,passable};
atlas.onload=()=>{regenerate();resize();fit();stages();ready=true;document.documentElement.dataset.ready='true';requestAnimationFrame(render);};
if(atlas.complete&&atlas.naturalWidth)atlas.onload!(new Event('load'));
