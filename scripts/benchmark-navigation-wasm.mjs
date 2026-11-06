import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] } });
try {
  const nav = await server.ssrLoadModule('/src/game/pathfinding.ts');
  const wasm = await server.ssrLoadModule('/src/game/navigation-wasm.ts');
  await wasm.installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/navigation.wasm')));
  const state = JSON.parse(readFileSync('scratch/2026-10-29-live-performance/optimization/paused-live-state.json', 'utf8'));
  const units = state.units.filter(u => u.hp > 0 && !u.inside);
  const requests = units.filter(u => u.pathGoal || u.destination).slice(0, 250).map(u => ({ from: {x:u.x,y:u.y}, to:u.pathGoal??u.destination, faction:u.faction }));
  const blockers = new Set(units.map(u=>Math.floor(u.y)*state.world.width+Math.floor(u.x)));
  const durations = {js:[],wasm:[]}; let sum = 0;
  for (let round=0;round<8;round++) for(const backend of round%2?['wasm','js']:['js','wasm']) {
    wasm.setNavigationWasmEnabled(backend==='wasm');
    const start=performance.now();
    nav.withNavigationFrame(state,()=>{for(const r of requests) sum += nav.findPath(state,r.from,r.to,r.faction,true,blockers).length;});
    if(round>1)durations[backend].push(performance.now()-start);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
  console.log(JSON.stringify({requests:requests.length,js:durations.js,wasm:durations.wasm,jsMedian:median(durations.js),wasmMedian:median(durations.wasm),speedup:median(durations.js)/median(durations.wasm),sum,status:wasm.navigationWasmStatus()},null,2));
} finally {await server.close();}
