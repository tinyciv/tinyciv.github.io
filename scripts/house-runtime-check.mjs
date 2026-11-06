import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Ephemeral browser context; does not access any existing browser/save.
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], failed = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('response', response => { if (response.status() >= 400) failed.push({ url: response.url(), status: response.status() }); });
page.on('requestfailed', request => failed.push({ url: request.url(), error: request.failure()?.errorText }));
const report = { checks, errors, failed, screenshots: [], pass: false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = name => { checks.push({ name, pass: true }); console.log('PASS ' + name); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready');
  await page.evaluate(() => { window.__game.state.paused = true; });
  const result = await page.evaluate(async () => {
    const art = await import('/src/game/wooden-building-art.ts'), { drawBuilding } = await import('/src/game/sprites.ts'), { buildingSize } = await import('/src/game/types.ts'), { icon } = await import('/src/ui/icons.ts');
    await art.loadWoodenBuildingArt(); const styles = ['shack','hovel','cottage','villa'], raw = new Map(), sourceBytes = [];
    for (const style of styles) { const url = '/assets/buildings/wooden-set/house-' + style + '.png', image = new Image(); image.src = url; await image.decode(); raw.set(style, image); sourceBytes.push({ style, width: image.naturalWidth, height: image.naturalHeight, bytes: [...new Uint8Array(await (await fetch(url)).arrayBuffer())] }); }
    const create = (w=144,h=144) => { const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').imageSmoothingEnabled=false;return c; };
    const bounds = canvas => { const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let left=canvas.width,top=canvas.height,right=-1,bottom=-1,pixels=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(d[(y*canvas.width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);pixels++;}return{left,top,right,bottom,pixels}; };
    const building = (level) => ({ id: 90000+level, kind:'house', houseLevel:level, houseStyle:'villa', x:2,y:2,faction:0,hp:100,maxHp:100,capacity:8 });
    const houses = styles.map((style,index) => {
      const b=building(index+1),renders=[];
      for(const size of [32,43.2]){
        const actual=create(),ac=actual.getContext('2d'),expected=create(),ec=expected.getContext('2d');
        drawBuilding(ac,b,32,48,size,0,'#3988ff');ec.translate(32,48);ec.scale(size/32,size/32);ec.translate(16,16);ec.scale(.9,.9);ec.translate(-16,-16);ec.drawImage(raw.get(style),0,0,32,32);
        renders.push({size,matches:actual.toDataURL()===expected.toDataURL(),bounds:bounds(actual)});
      }
      return{style,level:index+1,levelStyle:art.houseStyleFor(b),footprint:buildingSize(b),iconMatches:icon('house','#3988ff',style).includes('/house-'+style+'.png'),renders};
    });
    const board=create(1080,620),c=board.getContext('2d');c.fillStyle='#f0ecdf';c.fillRect(0,0,1080,620);c.fillStyle='#233b2d';c.font='18px monospace';c.fillText('REVISED HOUSES / ACTUAL GAME RENDERER',24,34);
    for(const[index,style]of styles.entries()){
      const x=50+index*260;c.fillStyle='#233b2d';c.font='15px monospace';c.fillText('LEVEL '+(index+1)+' / '+style,x,75);
      for(const[size,y,label]of[[32,120,'32 world px'],[43.2,220,'Default1.35x zoom'],[128,365,'4x inspection']]){c.fillStyle='#85a643';c.fillRect(x,y,size,size);drawBuilding(c,building(index+1),x,y,size,0,'#3988ff');c.fillStyle='#233b2d';c.font='12px monospace';c.fillText(label,x,y+size+25);}
    }
    return{sourceBytes,houses,defaultBuildIcon:art.woodenHouseIconUrl(),contactSheet:board.toDataURL()};
  });
  for(const source of result.sourceBytes){assert.deepEqual([source.width,source.height],[32,32]);const native=readFileSync('output/balanced-building-study/native/p32/house-'+source.style+'.png');assert.equal(hash(Buffer.from(source.bytes)),hash(native));assert.equal(hash(readFileSync('public/assets/buildings/wooden-set/house-'+source.style+'.png')),hash(native));source.sha256=hash(native);delete source.bytes;}
  for(const house of result.houses){assert.equal(house.levelStyle,house.style);assert.equal(house.footprint,1);assert.ok(house.iconMatches);for(const render of house.renders){assert.ok(render.matches);assert.ok(render.bounds.pixels>35);assert.ok(render.bounds.left>=32&&render.bounds.right<32+render.size&&render.bounds.top>=48&&render.bounds.bottom<48+render.size);}}
  assert.ok(result.defaultBuildIcon.endsWith('/house-shack.png'));
  writeFileSync('output/btv-revised-house-runtime.png',Buffer.from(result.contactSheet.split(',')[1],'base64'));delete result.contactSheet;report.rendering=result;report.screenshots.push('btv-revised-house-runtime.png');
  check('all four fetched32px house PNGs exactly match latest approved native files');
  check('level1–4 world rendering matches source pixels at32 and43.2px, retaining1×1 bounds and correct default icon');
  report.hud=[];
  for(const[index,style]of['shack','hovel','cottage','villa'].entries()){
    await page.evaluate(index=>{const s=window.__game.state,l=s.units.find(u=>u.faction===0&&u.kind==='leader'),x=Math.floor(l.x),y=Math.floor(l.y);window.__game.entities(s).buildings.replace(s.buildings.filter(b=>b.id<90000));const b={id:90000+index,kind:'house',houseStyle:'villa',houseLevel:index+1,x,y,faction:0,hp:100,maxHp:100,capacity:8};window.__game.entities(s).buildings.add(b);s.selected=b.id;s.selectedType='building';},index);
    await page.waitForFunction(style=>document.querySelector('#portrait img')?.getAttribute('src')?.endsWith('/house-'+style+'.png'),style);
    const portrait=await page.locator('#portrait img').evaluate(image=>({src:image.getAttribute('src'),width:image.naturalWidth,height:image.naturalHeight,complete:image.complete}));assert.deepEqual([portrait.width,portrait.height],[32,32]);assert.ok(portrait.complete);report.hud.push({style,...portrait});
    const file='output/btv-revised-house-hud-'+style+'.png';await page.locator('#portrait').screenshot({path:file});report.screenshots.push(file.replace('output/',''));
  }
  await page.screenshot({path:'output/btv-revised-house-game.png'});report.screenshots.push('btv-revised-house-game.png');
  check('actual HUD selected portraits load correct32px tier art despite stale style hints');
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);check('game startup and art requests complete without missing files or runtime errors');report.pass=true;
}catch(error){report.failure=String(error.stack||error);await page.screenshot({path:'output/btv-revised-house-runtime-failure.png'}).catch(()=>{});throw error;}
finally{writeFileSync('output/btv-revised-house-runtime-report.json',JSON.stringify(report,null,2)+'\n');await context.close();await browser.close();}
