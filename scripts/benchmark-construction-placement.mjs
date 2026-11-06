import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const directory = path.resolve(option('--out', 'scratch/construction-placement'));
const beforeFile = option('--before', undefined), rounds = Number(option('--rounds', '4'));
await mkdir(directory, { recursive: true });
const afterFile = path.join(directory, 'after.mjs');
await build({ stdin: { contents: `export {denseConstructionFixture as fixture} from './tests/helpers/construction-preview.ts';
export {constructionRoute} from './src/game/construction-route.ts';
export {constructionLine, planConstruction, buildStroke} from './src/game/construction.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', outfile: afterFile });
const engines = { ...(beforeFile && { before: await import(pathToFileURL(path.resolve(beforeFile)).href) }), after: await import(pathToFileURL(afterFile).href) };
const samples = {}, outcomes = new Map(), parity = [];
const add = (engine, kind, key) => ((samples[engine] ??= {})[kind] ??= {})[key] ??= [];
function outcome(state, plan, result) {
  return { result, plan: {ok:plan.ok,skipped:plan.skipped,cost:plan.cost,tiles:plan.tiles}, gold:state.factions[0].gold,
    farms: state.buildings.filter(b=>b.kind==='camp').map(b=>[b.id,b.x,b.y,b.construction?.paidGold]),
    fields: state.fields.map(f=>[f.camp,f.x,f.y,f.food,f.foodBatches]),
    roads: state.buildings.filter(b=>b.kind==='road').map(b=>[b.x,b.y,b.faction,b.construction?.paidGold]),
    irrigation: state.buildings.filter(b=>b.kind==='irrigation').map(b=>[b.x,b.y,b.faction,b.construction?.paidGold]) };
}
for(let round=0;round<rounds;round++) {
  for(const name of round%2?Object.keys(engines).reverse():Object.keys(engines)) for(const kind of ['road','irrigation']) {
    const engine=engines[name],state=engine.fixture(),start={x:83,y:kind==='road'?69:68},end={x:99,y:start.y};
    let at=performance.now(),route=engine.constructionRoute(state,kind,start,end),plan=engine.planConstruction(state,kind,route);
    add(name,kind,'coldPreview').push(performance.now()-at);
    for(let i=0;i<20;i++) {
      at=performance.now();engine.constructionRoute(state,kind,start,end);engine.planConstruction(state,kind,route);
      add(name,kind,'unchangedPreview').push(performance.now()-at);
    }
    for(let x=91;x<=98;x++) {
      at=performance.now();const route=engine.constructionRoute(state,kind,start,{x,y:start.y});engine.planConstruction(state,kind,route);
      add(name,kind,'changedEndpoint').push(performance.now()-at);
    }
    at=performance.now();const result=engine.buildStroke(state,kind,route);add(name,kind,'commit').push(performance.now()-at);
    const value=outcome(state,plan,result),key=`${round}:${kind}`;
    if(name==='before') outcomes.set(key,value);
    else if(outcomes.has(key)) parity.push({round,kind,equal:isDeepStrictEqual(outcomes.get(key),value)});
    else outcomes.set(`after:${key}`,value);
    if(name==='before'&&outcomes.has(`after:${key}`)) parity.push({round,kind,equal:isDeepStrictEqual(outcomes.get(`after:${key}`),value)});
  }
}
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,medianMs:sorted[Math.floor(values.length/2)],p95Ms:sorted[Math.floor(values.length*.95)]};};
const report={method:'Headless synchronous route+quote and purchase CPU, alternating engines. Each fresh fixture has 1082 buildings, 320 farms in 4x4 parcels, 301 units and 192x144 tiles. Preview spans 17 cells; changed endpoints span 9–16 cells. Quotes/purchases must preserve costs, layouts, crops and food. No rendering, live FPS or WASM.',cpu:os.cpus()[0].model,rounds,
 bundles:{...(beforeFile&&{beforeSha256:createHash('sha256').update(await readFile(beforeFile)).digest('hex')}),afterSha256:createHash('sha256').update(await readFile(afterFile)).digest('hex')},
 timings:Object.fromEntries(Object.entries(samples).map(([engine,kinds])=>[engine,Object.fromEntries(Object.entries(kinds).map(([kind,phases])=>[kind,Object.fromEntries(Object.entries(phases).map(([phase,values])=>[phase,stats(values)]))]))])),parity};
await writeFile(path.join(directory,'comparison.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(parity.some(check=>!check.equal))process.exitCode=1;
