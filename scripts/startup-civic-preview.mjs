import { mkdir } from 'node:fs/promises';

/** Frozen, isolated renderer preview. Never advances or saves the world. */
export async function captureCivicPreview(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  const result = await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { entityStore } = await import('/src/game/entity-store.ts');
    const { civicBuildingProperty } = await import('/src/game/civic-buildings-native.ts');
    const { reliefFootprintAllowed } = await import('/src/game/relief.ts');
    const { buildingWidth, buildingHeight, WATER } = await import('/src/game/types.ts');
    const { selectionSummary } = await import('/src/ui/selection-summary.ts');
    const state = await createScenarioGame('sandbox');
    state.paused = true;
    const time = state.time, palace = state.buildings.find(b => b.kind === 'palace' && b.faction === 0);
    if (!palace) throw new Error('Civic preview needs the procedural sandbox town');
    const occupied = new Set();
    for (const b of state.buildings) for (let dy = -1; dy <= buildingHeight(b); dy++) for (let dx = -1; dx <= buildingWidth(b); dx++)
      occupied.add((b.y + dy) * state.world.width + b.x + dx);
    const candidates = [];
    for (let y = 1; y < state.world.height - 2; y++) for (let x = 1; x < state.world.width - 2; x++) {
      if (!reliefFootprintAllowed(state.world, x, y, 2, 2)) continue;
      const cells = [y * state.world.width + x, y * state.world.width + x + 1, (y + 1) * state.world.width + x, (y + 1) * state.world.width + x + 1];
      if (cells.some(cell => occupied.has(cell) || WATER.has(state.world.tiles[cell].terrain) || state.world.tiles[cell].overlay !== 'none')) continue;
      candidates.push({ x, y, distance: (x-palace.x)**2 + (y-palace.y)**2 });
    }
    candidates.sort((a,b) => a.distance-b.distance || a.y-b.y || a.x-b.x);
    const placed = [];
    for (const kind of ['hospital','apartments','factory','goldMine']) {
      const point = candidates.find(point => ![0,1,state.world.width,state.world.width+1].some(offset => occupied.has(point.y*state.world.width+point.x+offset)));
      if (!point) throw new Error(`No natural terrain available for ${kind} preview`);
      const building = { id: entityStore(state).allocateId(), kind, faction: 0, x: point.x, y: point.y,
        hp: civicBuildingProperty(kind,1), maxHp: civicBuildingProperty(kind,1), capacity: kind === 'apartments' ? civicBuildingProperty(kind,3) : 0 };
      if (kind === 'goldMine') { building.mineCaptureFaction=0; building.mineCaptureProgress=6; building.faction=-1; }
      entityStore(state).buildings.add(building); placed.push(building);
      for (let dy=-1;dy<=2;dy++) for(let dx=-1;dx<=2;dx++) occupied.add((point.y+dy)*state.world.width+point.x+dx);
    }
    const host = document.createElement('div');
    Object.assign(host.style,{position:'fixed',inset:'0',zIndex:'99999',background:'#20261c'});
    host.innerHTML='<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas><aside style="position:absolute;left:24px;top:20px;padding:12px 16px;background:#18221ee8;color:#ffedc3;font:26px \'Pixel Operator\'">Civic buildings · Existing art</aside>';
    document.body.append(host);
    const [canvas,minimap]=host.querySelectorAll('canvas'), renderer=new Renderer(canvas,minimap);
    await renderer.initialize(); setMapRevealed(state,true); renderer.follow=false;
    const xs=[palace.x,...placed.map(b=>b.x)],ys=[palace.y,...placed.map(b=>b.y)];
    const left=Math.min(...xs),right=Math.max(...xs)+2,top=Math.min(...ys),bottom=Math.max(...ys)+2;
    renderer.camera={x:(left+right)/2,y:(top+bottom)/2};
    renderer.zoom=Math.min(2.4,1280/((right-left+6)*32),760/((bottom-top+6)*32));
    renderer.draw(state,0);
    for(const b of placed) {
      const point=renderer.screenPoint({x:b.x+1,y:b.y+2.2});
      const label=document.createElement('div');
      Object.assign(label.style,{position:'absolute',left:`${point.x}px`,top:`${point.y}px`,transform:'translateX(-50%)',padding:'3px 8px',background:'#18221ee8',color:'#ffedc3',font:'22px "Pixel Operator"'});
      label.textContent=b.kind==='goldMine'?'Gold mine':b.kind[0].toUpperCase()+b.kind.slice(1);host.append(label);
    }
    const mine=placed.find(b=>b.kind==='goldMine');state.selected=mine.id;state.selectedType='building';
    const summary=selectionSummary(state),status=document.createElement('div');
    Object.assign(status.style,{position:'absolute',left:'24px',bottom:'24px',padding:'14px 18px',background:'#18221ef0',border:'1px solid #967743',color:'#ffedc3',font:'24px "Pixel Operator"'});
    status.textContent=summary.title;host.append(status);
    window.__civicReview={state,renderer,host,time};
    return {time,after:state.time,kinds:placed.map(b=>b.kind),selection:summary.title};
  });
  if (result.after !== result.time) throw new Error('Civic preview advanced simulation time');
  await mkdir('output/startup',{recursive:true});
  await page.screenshot({path:'output/startup/civic-buildings.png'});
  return result;
}
