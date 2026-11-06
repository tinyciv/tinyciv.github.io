import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const page=await browser.newPage();
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>0});
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5186/');
 await page.waitForFunction(()=>window.__game&&document.documentElement.dataset.assets==='ready');
 const state=JSON.parse(readFileSync(process.argv[2]||'scratch/2026-10-29-live-performance/state.json','utf8'));
 state.paused=true;
 await page.evaluate(state=>{window.name='tinyciv-development-handoff:'+JSON.stringify({state,name:'previous-window-name',camera:{x:40,y:30},zoom:1.2,follow:false})},state);
 await page.reload();
 await page.waitForFunction(()=>window.__game&&document.documentElement.dataset.assets==='ready');
 const result=await page.evaluate(()=>({state:__game.state,name:window.name,camera:__game.renderer.camera,zoom:__game.renderer.zoom,follow:__game.renderer.follow}));
 assert.equal(result.name,'previous-window-name');
 assert.deepEqual(result.camera,{x:40,y:30}); assert.equal(result.zoom,1.2);assert.equal(result.follow,false);
 for(const key of ['units','buildings','world','factions','fields','rngState','time','paused'])assert.deepEqual(result.state[key],state[key],key);
 await page.evaluate(state=>{window.name='tinyciv-development-handoff:'+JSON.stringify({state,name:'previous-window-name',keepUntilAcknowledged:true})},state);
 for(let i=0;i<2;i++) {
  await page.reload();await page.waitForFunction(()=>window.__game&&document.documentElement.dataset.assets==='ready');
  const held=await page.evaluate(()=>({name:window.name,time:__game.state.time,units:__game.state.units.length,paused:__game.state.paused}));
  assert(held.name.startsWith('tinyciv-development-handoff:'));assert.equal(held.time,state.time);assert.equal(held.units,state.units.length);assert.equal(held.paused,true);
 }
 console.log('PASS: full live state/camera survive reload; held handoff survives multiple file reloads.');
} finally {await browser.close()}
