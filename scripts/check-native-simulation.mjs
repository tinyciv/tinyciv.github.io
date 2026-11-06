import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const arg=(key,fallback)=>process.argv.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const snapshot=JSON.parse(readFileSync(arg('state','scratch/2026-10-29-live-performance/optimization/paused-live-state.json'),'utf8'));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{}});
 await page.goto(arg('url','http://127.0.0.1:5186/'),{waitUntil:'networkidle'});
 const result=await page.evaluate(async ({snapshot,steps})=>{
  const loaded=(name)=>performance.getEntriesByType('resource').filter(e=>e.name.includes(`/src/game/${name}.ts`)).at(-1)?.name??`/src/game/${name}.ts`;
  const {updateGame}=await import(loaded('simulation'));const nav=await import(loaded('navigation-wasm'));await nav.loadNavigationWasm();
  const results=[];
  for(const backend of ['js','wasm']){
   nav.setNavigationWasmEnabled(backend==='wasm');const searchesBefore=nav.navigationWasmStatus().searches;const state=structuredClone(snapshot);state.paused=false;const frames=[];
   for(let i=0;i<steps;i++){const start=performance.now();updateGame(state,.1,{up:false,down:false,left:false,right:false});frames.push(performance.now()-start)}
   const json=JSON.stringify(state),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json)))).map(v=>v.toString(16).padStart(2,'0')).join('');
   const sorted=[...frames].sort((a,b)=>a-b);results.push({backend,steps,nativeSearches:nav.navigationWasmStatus().searches-searchesBefore,gameTime:state.time,units:state.units.length,buildings:state.buildings.length,rng:state.rngState,digest,mean:frames.reduce((a,b)=>a+b,0)/frames.length,p95:sorted[Math.floor(frames.length*.95)],frames});
  }
  return {results,navigation:nav.navigationWasmStatus()};
 },{snapshot,steps:Number(arg('steps','300'))});
 assert.deepEqual(errors,[]);assert.equal(result.results[0].nativeSearches,0,'JS control must not invoke the native backend');assert.ok(result.results[1].nativeSearches>0,'native backend must actually run');assert.equal(result.results[0].digest,result.results[1].digest,'entire serialized simulation must match after fixed steps');
 const out=arg('out','scratch/2026-10-29-city-combat-expansion');mkdirSync(out,{recursive:true});writeFileSync(`${out}/native-simulation-parity.json`,JSON.stringify({...result,errors},null,2));
 console.log(JSON.stringify({...result,results:result.results.map(r=>({...r,frames:undefined})),errors},null,2));
}finally{await browser.close()}
