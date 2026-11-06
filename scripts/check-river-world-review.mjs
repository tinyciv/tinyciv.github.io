import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const output = 'scratch/2026-10-31-rivers-without-creeks';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
const checks = [], errors = [], network = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
const waitDraw = async () => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.waitForTimeout(120); };
const waitWorld = async () => { await page.waitForFunction(() => !!window.__riverWorldReview.world && document.querySelector('#view-loading').hidden, null, { timeout: 30000 }); await waitDraw(); };
const canvasData = () => page.locator('#detail').evaluate(canvas => canvas.toDataURL());
try {
  await page.goto(pathToFileURL(resolve('output/river-world-review.html')).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30000 });
  const records = await page.evaluate(() => window.__riverWorldReview.records.map(({ compressedWorld, previews, ...record }) => record));
  check('six frozen worlds open directly from disk', records.length === 6 && await page.locator('.sample').count() === 6);
  check('two seeds compare three terrain families', new Set(records.map(r => r.seed)).size === 2 && new Set(records.map(r => r.family)).size === 3);
  check('worlds share the same landscape settings', records.every(r => r.style === 'fractal') && new Set(records.map(r => JSON.stringify(r.parameters))).size === 1);
  check('each world contains small and large rivers', records.every(r => r.summary.tributaryTiles > 0 && r.summary.mainTiles > 0), records.map(r => ({ id:r.id, tributary:r.summary.tributaryTiles, main:r.summary.mainTiles })));
  check('creek controls and metrics are removed', await page.locator('#find-headwater').count() === 0 && records.every(r => !('streamTiles' in r.summary) && !('headwaters' in r.summary)));
  check('gallery includes genuine channel cuts and ledged canyon walls', records.some(r => r.summary.canyonTiles > 0 && r.summary.canyonLedges > 0 && r.summary.features.canyon.length > 0), records.map(r => ({ id:r.id, floors:r.summary.canyonTiles, walls:r.summary.canyonLedges })));
  check('forest mesh remains open', records.every(r => r.summary.adjacentOpenGround === 1 && r.summary.solidTwoByTwo === 0));
  await page.screenshot({ path: `${output}/review-desktop.png`, fullPage: true });
  const terrain = await page.locator('.sample canvas').first().evaluate(c => c.toDataURL());
  await page.locator('#overview-mode').selectOption('network'); await waitDraw();
  const networkImage = await page.locator('.sample canvas').first().evaluate(c => c.toDataURL());
  await page.screenshot({ path: `${output}/review-networks.png`, fullPage: true });
  await page.locator('#overview-mode').selectOption('height'); await waitDraw();
  check('terrain, waterways and height views differ', new Set([terrain,networkImage,await page.locator('.sample canvas').first().evaluate(c => c.toDataURL())]).size === 3);
  await page.locator('#overview-mode').selectOption('terrain');
  for (const record of records) {
    await page.locator(`[data-id="${record.id}"] .feature-jump`).click(); await waitWorld();
    const info = await page.evaluate(() => {
      const a = window.__riverWorldReview, w=a.world, f=a.focus, cell=Math.floor(f.y)*w.width+Math.floor(f.x), t=w.tiles[cell];
      const counts={tributary:0,main:0};w.tiles.forEach(t=>{if(t.channel in counts)counts[t.channel]++;});
      return { seed:w.seed, family:w.landformFamily, parameters:w.generationParameters, tiles:w.tiles.length, width:w.width, height:w.height, focus:{terrain:t.terrain,canyon:t.canyon,channel:t.channel}, counts, native:document.querySelector('#view-tag').textContent.includes('Native terrain'), fordTiles:w.tiles.filter(t=>t.overlay==='ford').length, creeks:w.tiles.filter(t=>t.channel==='stream').length, dryChannels:w.tiles.filter(t=>t.channel&&!['river','lake','coast','ocean'].includes(t.terrain)).length };
    });
    check(`${record.id} opens the exact generated snapshot`, info.seed===record.seed && info.family===record.family && JSON.stringify(info.parameters)===JSON.stringify(record.parameters) && info.tiles===record.width*record.height, info);
    check(`${record.id} feature focus shows actual generated terrain in native artwork`, info.native && (record.summary.features.canyon.length ? info.focus.canyon==='floor' && info.focus.terrain==='river' : info.focus.channel==='main'), info.focus);
    check(`${record.id} contains no creeks and river metrics match the world`, info.creeks===0 && info.dryChannels===0 && info.counts.tributary===record.summary.tributaryTiles && info.counts.main===record.summary.mainTiles && info.fordTiles===record.summary.fordTiles, info.counts);
    await page.screenshot({ path:`${output}/canyon-${record.id}-${record.family}.png` });
    await page.locator('#fit').click(); await waitDraw();
    await page.screenshot({ path:`${output}/world-${record.id}-${record.family}.png` });
    await page.locator('#close').click();
  }
  await page.locator('[data-id="2A"] .feature-jump').click(); await waitWorld();
  for (const [button,kind] of [['tributary','tributary'],['main','main']]) {
    await page.locator(`#find-${button}`).click(); await waitDraw();
    check(`${button} focus selects its actual channel class`,await page.evaluate(kind=>{const a=window.__riverWorldReview,w=a.world,f=a.focus;const t=w.tiles[Math.floor(f.y)*w.width+Math.floor(f.x)];return t.channel===kind&&t.terrain==='river';},kind));
    await page.screenshot({ path:`${output}/detail-${button}.png` });
  }
  if (await page.locator('#find-canyon').isEnabled()) await page.locator('#find-canyon').click();
  else await page.locator('#find-main').click();
  await waitDraw();
  const beforeGrid=await canvasData();await page.locator('#show-grid').check();await waitDraw();check('grid exposes native tile scale',beforeGrid!==await canvasData());await page.locator('#show-grid').uncheck();
  const beforeZoom=await page.evaluate(()=>window.__riverWorldReview.zoom);await page.locator('#zoom-in').click();await waitDraw();check('zoom control changes map scale',await page.evaluate(()=>window.__riverWorldReview.zoom)>beforeZoom);
  await page.locator('#native-scale').click();await waitDraw();check('native scale selects an exact tile scale',await page.evaluate(()=>[16,32].includes(window.__riverWorldReview.zoom)));
  const box=await page.locator('#detail').boundingBox(),beforePan=await page.evaluate(()=>({...window.__riverWorldReview.center}));
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+75,box.y+box.height/2+30,{steps:4});await page.mouse.up();await waitDraw();
  check('drag pans the native map',await page.evaluate(before=>Math.hypot(window.__riverWorldReview.center.x-before.x,window.__riverWorldReview.center.y-before.y)>1,beforePan));
  await page.locator('#detail-mode').selectOption('network');await waitDraw();check('detail diagnostic mode synchronizes gallery',await page.locator('#overview-mode').inputValue()==='network');await page.locator('#detail-mode').selectOption('terrain');
  const download=page.waitForEvent('download');await page.locator('#download').click();const exported=JSON.parse(await readFile(await(await download).path(),'utf8'));check('settings export retains exact seed and family',exported.seed===records.find(r=>r.id==='2A').seed&&exported.landformFamily===records.find(r=>r.id==='2A').family);
  await page.keyboard.press('Escape');check('escape closes inspector',!(await page.locator('#inspector').evaluate(d=>d.open)));
  await page.locator('[data-id="1A"] .favorite-button').click();const shortlist=page.waitForEvent('download');await page.locator('#download-shortlist').click();const favorites=JSON.parse(await readFile(await(await shortlist).path(),'utf8'));check('favorites export preserves selected world',favorites.some(r=>r.id==='1A'&&r.seed===records[0].seed));
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));check('mobile gallery has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${output}/review-mobile.png`,fullPage:true});
  await page.locator('[data-id="2A"] .feature-jump').click();await waitWorld();check('mobile inspector fits the screen',await page.locator('#inspector').evaluate(d=>d.getBoundingClientRect().right<=innerWidth&&d.scrollWidth<=d.clientWidth));await page.screenshot({path:`${output}/review-mobile-detail.png`});
  check('standalone makes no network requests',network.length===0,network);check('no browser runtime errors',errors.length===0,errors);
} finally {
  await writeFile(`${output}/review-checks.json`,JSON.stringify({checks,errors,network},null,2));console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,total:checks.length,errors,network},null,2));await browser.close();
}
