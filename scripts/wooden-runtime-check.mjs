import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// Entirely separate ephemeral browser context: no user game tab or save touched.
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
const page = await context.newPage(), errors = [], failed = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('response', response => { if (response.status() >= 400) failed.push({ url: response.url(), status: response.status() }); });
const report = { checks: [], errors, failed };
const check = name => { report.checks.push({ name, pass: true }); console.log('PASS ' + name); };
mkdirSync('output', { recursive: true });

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready');
  await page.evaluate(() => { window.__game.state.paused = true; });
  const result = await page.evaluate(async () => {
    const art = await import('/src/game/wooden-building-art.ts');
    const { drawBuilding } = await import('/src/game/sprites.ts');
    const { buildingConnections, gateConnections, indexBuildings } = await import('/src/game/renderer.ts');
    const { buildingSize, buildingArtTop } = await import('/src/game/types.ts');
    const { ROAD_HALF_WIDTH } = await import('/src/game/road-sprites.ts');
    const { icon } = await import('/src/ui/icons.ts');
    await art.loadWoodenBuildingArt();
    const names = ['house-shack','house-hovel','house-cottage','house-villa','wooden-tower','gate-ns','gate-ew','covered-well'];
    const raw = new Map(await Promise.all(names.map(async name => { const image = new Image(); image.src = '/assets/buildings/wooden-set/' + name + '.png'; await image.decode(); return [name,image]; })));
    const create = (w=128,h=128) => { const canvas = document.createElement('canvas'); canvas.width=w;canvas.height=h;canvas.getContext('2d').imageSmoothingEnabled=false;return canvas; };
    const bounds = canvas => {const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let left=canvas.width,top=canvas.height,right=-1,bottom=-1,pixels=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(p[(y*canvas.width+x)*4+3]){pixels++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}return{left,top,right,bottom,pixels};};
    const building = (kind,id=0,extra={}) => ({id,kind,x:2,y:2,faction:0,hp:100,maxHp:100,capacity:0,...extra});
    const styles = ['shack','hovel','cottage','villa'];
    const houses = styles.map((style,index) => {
      const direct=create(),dc=direct.getContext('2d'),expected=create(),ec=expected.getContext('2d');
      art.drawWoodenHouse(dc,{id:999,houseStyle:style},16,16,64);ec.drawImage(raw.get('house-'+style),16,16,64,64);
      const directMatches=direct.toDataURL()===expected.toDataURL();
      const game=create(),gc=game.getContext('2d');drawBuilding(gc,building('house',index,{houseLevel:index+1,houseStyle:'villa'}),32,48,32,0,'#3988ff');
      const expectedGame=create(),eg=expectedGame.getContext('2d');eg.translate(32,48);eg.translate(16,16);eg.scale(.9,.9);eg.translate(-16,-16);eg.drawImage(raw.get('house-'+style),0,0,32,32);
      const markup=icon('house','#3988ff',style);
      return{style,directMatches,gameMatches:game.toDataURL()===expectedGame.toDataURL(),bounds:bounds(game),footprint:buildingSize(building('house',index)),stableStyle:art.houseStyleFor({id:index}),explicitStyle:art.houseStyleFor({id:999,houseStyle:style}),levelStyle:art.houseStyleFor({id:999,houseLevel:index+1,houseStyle:'villa'}),iconMatches:markup.includes('/house-'+style+'.png'),image:game.toDataURL()};
    });
    const tower=create(),tc=tower.getContext('2d');drawBuilding(tc,building('woodenTower'),48,64,32,0,'#3988ff');
    const expectedTower=create(),etc=expectedTower.getContext('2d');etc.translate(48,64);etc.translate(16,16);etc.scale(.9,.9);etc.translate(-16,-16);etc.drawImage(raw.get('wooden-tower'),0,-24,32,56);
    const towerResult={matches:tower.toDataURL()===expectedTower.toDataURL(),bounds:bounds(tower),footprint:buildingSize(building('woodenTower')),artTop:buildingArtTop(building('woodenTower'))};
    const wellFrames=[];
    for(let frame=0;frame<6;frame++){
      const actual=create(64,64),a=actual.getContext('2d'),expected=create(64,64),e=expected.getContext('2d');art.drawCoveredWell(a,0,0,64,frame/8);e.drawImage(raw.get('covered-well'),frame*64,0,64,64,0,0,64,64);
      const game=create(),g=game.getContext('2d');drawBuilding(g,building('well'),32,48,32,frame/8,'#3988ff');
      wellFrames.push({frame,matches:actual.toDataURL()===expected.toDataURL(),image:actual.toDataURL(),gameImage:game.toDataURL(),gamePixels:bounds(game).pixels});
    }
    const loop=create(64,64);art.drawCoveredWell(loop.getContext('2d'),0,0,64,6/8);
    const directions=['north','east','south','west'],offsets=[[0,-1],[1,0],[0,1],[-1,0]],low=16-Math.ceil(ROAD_HALF_WIDTH+1),high=32-low;
    const gates=[5,10,3,15].map(mask=>{
      const gate=building('palisade',300),road=building('road',301),pieces=[gate,road,...offsets.map(([dx,dy],i)=>building('palisade',310+i,{x:2+dx,y:2+dy})),...offsets.filter((_,bit)=>mask&(1<<bit)).map(([dx,dy],i)=>building('road',320+i,{x:2+dx,y:2+dy}))];
      const index=indexBuildings(pieces),links=buildingConnections(gate,index),passage=gateConnections(gate,index);
      const canvas=create(32,32),c=canvas.getContext('2d');drawBuilding(c,gate,0,0,32,0,'#3988ff',links,passage);const forward=canvas.toDataURL(),p=c.getImageData(0,0,32,32).data;
      let blocked=0,visible=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++){const center=x>=low&&x<high&&y>=low&&y<high,ns=x>=low&&x<high&&((mask&1&&y<low)||(mask&4&&y>=high)),ew=y>=low&&y<high&&((mask&8&&x<low)||(mask&2&&x>=high));if(p[(y*32+x)*4+3]){visible++;if(center||ns||ew)blocked++;}}
      const reverse=indexBuildings([...pieces].reverse());c.clearRect(0,0,32,32);drawBuilding(c,gate,0,0,32,0,'#3988ff',buildingConnections(gate,reverse),gateConnections(gate,reverse));
      const composite=create(32,32),cc=composite.getContext('2d');cc.fillStyle='#85a643';cc.fillRect(0,0,32,32);drawBuilding(cc,road,0,0,32,0,'#3988ff',passage);const before=cc.getImageData(0,0,32,32).data;drawBuilding(cc,gate,0,0,32,0,'#3988ff',links,passage);const after=cc.getImageData(0,0,32,32).data;let changedPassage=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++){const center=x>=low&&x<high&&y>=low&&y<high,ns=x>=low&&x<high&&((mask&1&&y<low)||(mask&4&&y>=high)),ew=y>=low&&y<high&&((mask&8&&x<low)||(mask&2&&x>=high));if((center||ns||ew)&&[0,1,2,3].some(ch=>before[(y*32+x)*4+ch]!==after[(y*32+x)*4+ch]))changedPassage++;}
      return{mask,blocked,visible,changedPassage,orderIndependent:canvas.toDataURL()===forward};
    });
    const gallery=create(1024,850),g=gallery.getContext('2d');g.fillStyle='#eee8d7';g.fillRect(0,0,1024,850);g.fillStyle='#233b2d';g.font='18px monospace';g.fillText('BTV / WOODEN ART IN THE GAME RENDERER',24,35);
    styles.forEach((style,index)=>{g.fillStyle='#85a643';g.fillRect(35+index*246,80,128,128);drawBuilding(g,building('house',index),35+index*246,80,128,0,'#3988ff');g.fillStyle='#233b2d';g.font='15px monospace';g.fillText(style,35+index*246,235);});
    g.fillStyle='#233b2d';g.fillText('WOODEN TOWER',35,280);drawBuilding(g,building('woodenTower'),35,370,96,0,'#3988ff');g.fillText('COVERED WELL / SIX FRAMES',210,280);for(let frame=0;frame<6;frame++){art.drawCoveredWell(g,210+frame*130,320,96,frame/8);g.fillStyle='#233b2d';g.fillText('frame '+frame,210+frame*130,450);}
    gates.forEach(({mask},index)=>{const links=Object.fromEntries(directions.map((side,bit)=>[side,!!(mask&(1<<bit))])),walls={north:true,east:true,south:true,west:true};g.fillStyle='#85a643';g.fillRect(35+index*246,550,128,128);drawBuilding(g,building('road'),35+index*246,550,128,0,'#3988ff',links);drawBuilding(g,building('palisade'),35+index*246,550,128,0,'#3988ff',walls,links);g.fillStyle='#233b2d';g.fillText(['N–S gate','E–W gate','corner gate','crossing gate'][index],35+index*246,710);});
    return{sources:[...raw].map(([id,image])=>({id,width:image.naturalWidth,height:image.naturalHeight})),houses,tower:towerResult,well:{frames:wellFrames,loops:loop.toDataURL()===wellFrames[0].image},gates,contactSheet:gallery.toDataURL()};
  });
  assert.equal(result.sources.length,8);
  for(const house of result.houses){assert.ok(house.directMatches);assert.ok(house.gameMatches);assert.equal(house.footprint,1);assert.equal(house.stableStyle,house.style);assert.equal(house.explicitStyle,house.style);assert.equal(house.levelStyle,house.style);assert.ok(house.iconMatches);assert.ok(house.bounds.pixels>50);delete house.image;}
  assert.equal(result.tower.matches,true);assert.equal(result.tower.footprint,1);assert.ok(result.tower.bounds.top>=44&&result.tower.bounds.top<64);assert.ok(result.tower.bounds.bottom<96);assert.ok(result.tower.bounds.left>=48&&result.tower.bounds.right<80);
  assert.equal(result.well.frames.length,6);assert.ok(result.well.frames.every(frame=>frame.matches&&frame.gamePixels>50));assert.equal(new Set(result.well.frames.map(frame=>frame.image)).size,6);assert.equal(new Set(result.well.frames.map(frame=>frame.gameImage)).size,6);assert.ok(result.well.loops);for(const frame of result.well.frames){delete frame.image;delete frame.gameImage;}
  for(const gate of result.gates){assert.equal(gate.blocked,0);assert.equal(gate.changedPassage,0);assert.ok(gate.visible>20);assert.ok(gate.orderIndependent);}
  writeFileSync('output/btv-wooden-runtime.png',Buffer.from(result.contactSheet.split(',')[1],'base64'));delete result.contactSheet;report.rendering=result;
  check('all eight native files load and exact source pixels reach the game renderer');
  check('four house styles retain one-cell footprints; tower overhang stays inside existing bounds; well has six distinct looping frames');
  check('palisade masks5/10/3/15 leave road pixels exact and remain independent of placement order');

  for(const [index,style] of ['shack','hovel','cottage','villa'].entries()){
    await page.evaluate(({index,style})=>{const s=window.__game.state,l=s.units.find(u=>u.faction===0&&u.kind==='leader');const b={id:90000+index,kind:'house',houseStyle:'villa',houseLevel:index+1,x:Math.floor(l.x),y:Math.floor(l.y),faction:0,hp:100,maxHp:100,capacity:8};window.__game.entities(s).buildings.replace(s.buildings.filter(b=>b.id<90000));window.__game.entities(s).buildings.add(b);s.selected=b.id;s.selectedType='building';}, {index,style});
    await page.waitForFunction(style=>document.querySelector('#portrait img')?.getAttribute('src')?.endsWith('/house-'+style+'.png'),style);
  }
  check('selected-house HUD portraits show each actual level1–4 style, overriding stale art hints');
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);report.pass=true;
}catch(error){report.pass=false;report.failure=String(error.stack||error);await page.screenshot({path:'output/btv-wooden-runtime-failure.png'}).catch(()=>{});throw error;
}finally{writeFileSync('output/btv-wooden-runtime-report.json',JSON.stringify(report,null,2)+'\n');await context.close();await browser.close();}
