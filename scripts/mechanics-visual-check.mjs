import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: existsSync(chrome) ? chrome : undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const result = await page.evaluate(async () => {
    const { drawFarm, drawUnit, drawBuilding, drawFoodCrate, drawOverlay } = await import('/src/game/sprites.ts');
    const { loadPunyCharacters } = await import('/src/game/unit-sprites.ts');
    await loadPunyCharacters();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
    const c = canvas.getContext('2d');
    const draw = fn => { c.clearRect(0, 0, 160, 160); fn(c); const pixels = c.getImageData(0, 0, 160, 160).data; let area = 0, greens = 0; for (let p = 0; p < pixels.length; p += 4) { if (pixels[p+3]) area++; if (pixels[p+3] && pixels[p+1] > pixels[p]+10 && pixels[p+1] > pixels[p+2]+10) greens++; } return { area, greens, url: canvas.toDataURL() }; };
    const fallow = draw(c => drawFarm(c, 32, 32, 64, 0, .2, 'none', false));
    const planted = draw(c => drawFarm(c, 32, 32, 64, 0, .2, 'none', true));
    const crate = draw(c => drawFoodCrate(c, 64, 64, 24));
    const base = { ...window.__game.state.units.find(u => u.kind === 'worker'), moving: false, attackTime: 0, inside: false, facing: 0, cargo: 0 };
    const empty = draw(c => drawUnit(c, base, 32, 32, 64, 0, '#3988ff'));
    const loaded = draw(c => drawUnit(c, { ...base, cargo: 10 }, 32, 32, 64, 0, '#3988ff'));
    const hidden = draw(c => drawUnit(c, { ...base, inside: true }, 32, 32, 64, 0, '#3988ff'));
    const b = { id: 1, kind: 'palace', faction: 0, x: 0, y: 0, hp: 100, maxHp: 100, capacity: 0 };
    const palace = draw(c => drawBuilding(c, b, 32, 32, 32, 10, '#3988ff'));
    const site = draw(c => drawBuilding(c, { ...b, construction: { startedAt: 0, duration: 20 } }, 32, 32, 32, 10, '#3988ff'));
    const tower = draw(c => drawBuilding(c, { ...b, kind: 'tower' }, 32, 32, 64, 0, '#3988ff'));
    const ford = draw(c => drawOverlay(c, 'ford', 32, 32, 64, 0, .2));
    return { grainCover: planted.area > fallow.area, fieldDifference: planted.url !== fallow.url, cratePixels: crate.area, workerPixels: empty.area, carryingVisible: loaded.url !== empty.url, hiddenPixels: hidden.area, palacePixels: palace.area, sitePixels: site.area, siteDistinct: palace.url !== site.url, towerPixels: tower.area, fordPixels: ford.area };
  });
  assert.equal(result.grainCover, true); assert.equal(result.fieldDifference, true);
  assert.ok(result.cratePixels > 100); assert.ok(result.workerPixels > 100); assert.equal(result.carryingVisible, true); assert.equal(result.hiddenPixels, 0);
  assert.ok(result.palacePixels > 300); assert.ok(result.sitePixels > 300); assert.equal(result.siteDistinct, true); assert.ok(result.towerPixels > 500);
  assert.ok(result.fordPixels > 100 && result.fordPixels < 64 * 64 / 2, 'Ford stones should remain visible while leaving most of the river cell open');
  console.log('PASS unplanted grass / Miniworld grain, harvest crates / carrying, hidden collectors, construction / palace / tower, ford crossings', result);
  await page.evaluate(() => {
    const { state, renderer } = window.__game;
    state.paused = true; state.time = 10; window.__game.entities(state).buildings.replace([]); state.fields = []; state.fog = undefined;
    for (const t of state.world.tiles) Object.assign(t, { terrain: 'grassland', overlay: 'none', farm: undefined, variation: .2 });
    const add = (kind,x,y,extra={}) => { const b = { id: 1000+state.buildings.length,kind,x,y,faction:0,hp:300,maxHp:300,capacity:kind==='camp'?4:0,...extra }; window.__game.entities(state).buildings.add(b); return b; };
    add('palace',30,28); add('well',25,25); add('tower',37,25); add('house',25,31,{construction:{startedAt:0,duration:20}});
    const camp = add('camp',35,30,{residents:2});
    for (const [i,x,y] of [[0,35,29],[1,36,30],[2,35,31],[3,34,30]]) {
      state.fields.push({id:2000+i,camp:camp.id,faction:0,x,y,planted:i<2,food:i===1?12:0,nextHarvest:30}); state.world.tiles[y*state.world.width+x].farm=0;
    }
    const leader = state.units.find(u=>u.faction===0&&u.kind==='leader');
    const worker = state.units.find(u=>u.faction===0&&u.kind==='worker');
    Object.assign(leader,{x:32.5,y:30.5,moving:false,attackTime:0});
    window.__game.entities(state).units.replace([leader,{...worker,id:3000,x:33.5,y:30.5,moving:true,inside:false,cargo:12,order:'work',facing:Math.PI},{...worker,id:3001,x:32.5,y:27.5,moving:true,inside:false,cargo:0,order:'work',facing:0}]);
    for(let y=22;y<=33;y++) for(let x=39;x<=39;x++) Object.assign(state.world.tiles[y*state.world.width+x],{terrain:'river',overlay:y===29?'ford':'none'});
    state.world.revision=(state.world.revision??0)+1;
    renderer.follow=false; renderer.camera={x:32,y:28};renderer.zoom=2.2;
  });
  await page.waitForTimeout(200);
  await page.mouse.move(1400,100);
  await page.screenshot({ path: 'output/btv-farms-construction.png' });
  assert.deepEqual(errors, []);
  console.log('PASS game fixture screenshot without browser errors');
} finally { await browser.close(); }
