import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const arg=(key,fallback)=>process.argv.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const state=JSON.parse(readFileSync(arg('state','scratch/2026-10-29-live-performance/state.json'),'utf8'));
const url=arg('url','http://127.0.0.1:5186/'), label=arg('label','replay'), seconds=Number(arg('seconds','20'));
const out=arg('out','scratch/2026-10-29-live-performance/optimization');mkdirSync(out,{recursive:true});
const stats=a=>{const b=[...a].sort((a,b)=>a-b);return {mean:a.reduce((s,x)=>s+x,0)/a.length,p50:b[Math.floor(b.length*.5)],p95:b[Math.floor(b.length*.95)],p99:b[Math.floor(b.length*.99)],max:b.at(-1)}};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const page=await browser.newPage({viewport:{width:Number(arg('width','1440')),height:Number(arg('height','900'))},deviceScaleFactor:Number(arg('dpr','1'))});
page.setDefaultTimeout(60_000);
const errors=[];page.on('pageerror',e=>{errors.push(e.stack || String(e));console.error(e.stack || String(e))});
try {
 await page.addInitScript(s=>{window.__snapshot=s;const raf=requestAnimationFrame.bind(window),callbacks=new Map();let id=0;window.__benchRAF={raf,callbacks};window.requestAnimationFrame=cb=>(callbacks.set(++id,cb),id);window.cancelAnimationFrame=id=>callbacks.delete(id);},state);
 await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__game&&document.documentElement.dataset.assets==='ready',null,{polling:50});
 await page.evaluate(async mode=>{const url=performance.getEntriesByType('resource').filter(e=>e.name.includes('/src/game/navigation-wasm.ts')).at(-1)?.name??'/src/game/navigation-wasm.ts';window.__benchNavigation=await import(url);await __benchNavigation.loadNavigationWasm();__benchNavigation.setNavigationWasmEnabled(mode!=='js')},arg('navigation','wasm'));
 await page.evaluate(async()=>{let s=structuredClone(__snapshot);if(__game.replaceState)__game.replaceState(s);else{const live=__game.state;for(const k of Object.keys(live))delete live[k];Object.assign(live,s);s=live}s.paused=true;__game.renderer.center(s);const invoke=now=>{const queue=[...__benchRAF.callbacks.values()];__benchRAF.callbacks.clear();for(const cb of queue)cb(now)};window.__invokeFrame=invoke;for(let i=0;i<2;i++)await new Promise((resolve,reject)=>__benchRAF.raf(now=>{try{invoke(now);resolve()}catch(error){reject(error)}}));s.paused=false;});
 // Fresh browser profiles open the world picker. Close it before measuring
 // ordinary gameplay, after installing the saved state so no world is generated.
 await page.evaluate(()=>{if(document.querySelector('#new-world-form'))document.querySelector('#close-dialog')?.click()});
 if(process.argv.includes('--movement')) await page.evaluate(async()=>{const url=performance.getEntriesByType('resource').filter(e=>e.name.includes('/src/game/movement-profile.ts')).at(-1)?.name??'/src/game/movement-profile.ts';window.__benchMovement=await import(url);__benchMovement.setMovementProfiling(__game.state,true)});
 const session=await page.context().newCDPSession(page);
 if(process.argv.includes('--cpu')){await session.send('Profiler.enable');await session.send('Profiler.start')}
 const result=await page.evaluate(async seconds=>{const frames=[];let current=null;const r=__game.renderer;for(const key of ['draw','prepare','prepareFog','drawMinimap']){const original=r[key];r[key]=function(...args){const a=performance.now();if(key==='draw'&&current)current.sim=a-current.started;try{return original.apply(this,args)}finally{if(current)current[key]=(current[key]||0)+performance.now()-a}}}const navigationStart=__benchNavigation.navigationWasmStatus();const startTime=__game.state.time,start=performance.now();let previous=0;await new Promise((resolve,reject)=>{const pump=now=>{current={started:performance.now(),interval:previous?now-previous:0};previous=now;try{__invokeFrame(now)}catch(error){reject(error);return}current.total=performance.now()-current.started;delete current.started;frames.push(current);current=null;if(performance.now()-start<seconds*1000)__benchRAF.raf(pump);else resolve()};__benchRAF.raf(pump)});return {backend:r.backend??'canvas',renderStats:r.renderStats?{...r.renderStats}:null,navigationStart,frames,elapsed:performance.now()-start,gameSeconds:__game.state.time-startTime,units:__game.state.units.length,buildings:__game.state.buildings.length,fields:__game.state.fields.length,speed:__game.state.speed,gameOver:__game.state.gameOver,viewport:[innerWidth,innerHeight,devicePixelRatio]}},seconds);
 if(process.argv.includes('--cpu')){const {profile}=await session.send('Profiler.stop');writeFileSync(path.join(out,`${label}.cpuprofile`),JSON.stringify(profile));}
 if(process.argv.includes('--movement')) result.movement=await page.evaluate(()=>{const result={...__benchMovement.movementProfile(__game.state)};__benchMovement.setMovementProfiling(__game.state,false);return result});
 const navigation=await page.evaluate(async()=>{return __benchNavigation.navigationWasmStatus()});for(const key of ['searches','unsupported','unavailable'])navigation[key]-=result.navigationStart[key];
 const report={label,url,...result,navigation,metrics:Object.fromEntries(['total','sim','draw','prepare','prepareFog','drawMinimap'].map(k=>[k,stats(result.frames.map(f=>f[k]||0))])),fps:result.frames.length/(result.elapsed/1000),over40:result.frames.filter(f=>f.total>=40).length,errors};writeFileSync(path.join(out,`${label}.json`),JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,frames:undefined},null,2));
 await page.screenshot({path:path.join(out,`${label}.png`)});if(errors.length)process.exitCode=1;
}finally{await browser.close()}
