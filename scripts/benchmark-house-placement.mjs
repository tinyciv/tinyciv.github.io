import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const directory=path.resolve(option('--out','scratch/house-placement')),before=option('--before'),snapshot=option('--state'),rounds=Number(option('--rounds','6'));
await mkdir(directory,{recursive:true});const after=path.join(directory,'after.mjs');
await build({stdin:{contents:`export {denseConstructionFixture as fixture} from './tests/helpers/construction-preview.ts';
export {buildAt,validateBuildAt} from './src/game/simulation.ts';
export {planConstruction} from './src/game/construction.ts';
export {citySummaries} from './src/game/cities.ts';
export {ensureBuilders} from './src/game/builders.ts';
export {ensureCollectors,synchronizeFarms} from './src/game/farms.ts';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:after});
const engines={...(before&&{before:await import(pathToFileURL(path.resolve(before)).href)}),after:await import(pathToFileURL(after).href)};
const raw=snapshot?await readFile(snapshot,'utf8'):undefined;
function fixture(engine){const state=raw?JSON.parse(raw):engine.fixture();const palace=state.buildings.find(b=>b.kind==='palace'&&b.faction===0&&b.hp>0&&!b.construction);const leader=state.units.find(u=>u.kind==='leader'&&u.faction===0&&u.hp>0);leader.x=palace.x+1;leader.y=palace.y+1;state.gameOver=false;state.fog=undefined;state.factions[0].gold=100000;state.factions[0].food=1000;return state;}
const first=fixture(engines.after),palace=first.buildings.find(b=>b.kind==='palace'&&b.faction===0),targets={};
for(let d=2;d<=8;d++)for(let y=palace.y-d;y<=palace.y+d;y++)for(let x=palace.x-d;x<=palace.x+d;x++){
 const tile=first.world.tiles[y*first.world.width+x];if(!tile||tile.overlay!=='none')continue;
 const kind=first.buildings.some(b=>b.kind==='camp'&&b.hp>0&&!b.construction&&b.x===x&&b.y===y)?'farm':'empty';
 if(targets[kind]||kind==='empty'&&first.buildings.some(b=>b.hp>0&&b.x===x&&b.y===y))continue;
 if(engines.after.validateBuildAt(first,'house',x,y).ok)targets[kind]={x,y};
}
if(!targets.empty||!targets.farm)throw new Error('Fixture needs valid empty and farm-replacement house sites');
const samples={},outcomes=new Map(),parity=[];
const add=(engine,kind,phase,value)=>(((samples[engine]??={})[kind]??={})[phase]??=[]).push(value);
function outcome(state,plan,result){return {plan,result,gold:state.factions[0].gold,buildings:state.buildings.map(b=>[b.id,b.kind,b.faction,b.x,b.y,b.capacity,b.redevelopedFarm,b.construction?.paidGold]),fields:state.fields?.map(f=>[f.camp,f.faction,f.x,f.y,f.food,f.foodBatches])};}
for(let round=0;round<rounds;round++)for(const name of round%2?Object.keys(engines).reverse():Object.keys(engines))for(const [kind,point]of Object.entries(targets)){
 const engine=engines[name],state=fixture(engine);
 // The running game's previous HUD and worker update have already populated
 // ordinary city/navigation caches; exclude replay loading from click time.
 engine.synchronizeFarms(state);engine.citySummaries(state);engine.ensureBuilders(state);engine.ensureCollectors(state);
 let at=performance.now(),plan=engine.planConstruction(state,'house',[point]);add(name,kind,'firstPreviewMs',performance.now()-at);
 if(!plan.ok)throw new Error(JSON.stringify({kind,point,plan}));
 for(let i=0;i<20;i++){state.time+=.03;at=performance.now();engine.planConstruction(state,'house',[point]);add(name,kind,'repeatPreviewMs',performance.now()-at);}
 at=performance.now();const result=engine.buildAt(state,'house',point.x,point.y);add(name,kind,'commitMs',performance.now()-at);
 if(!result.ok)throw new Error(JSON.stringify({kind,point,result}));
 const key=`${round}:${kind}`,value=outcome(state,plan,result);if(outcomes.has(key))parity.push({round,kind,equal:isDeepStrictEqual(value,outcomes.get(key))});else outcomes.set(key,value);
}
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],mean:values.reduce((a,b)=>a+b,0)/values.length};};
const report={method:'Synchronous house preview/order CPU after one HUD city-summary and worker pass; alternating frozen/current engines. Includes actual farm relocation, derived yields and worker reconciliation. No rendering or live FPS. Fresh state per purchase.',cpu:os.cpus()[0].model,rounds,fixture:{snapshot:snapshot??'denseConstructionFixture',size:[first.world.width,first.world.height],population:first.factions[0].population,buildings:first.buildings.length,units:first.units.length,fields:first.fields?.length,targets},bundles:{...(before&&{beforeSha256:createHash('sha256').update(await readFile(before)).digest('hex')}),afterSha256:createHash('sha256').update(await readFile(after)).digest('hex')},timings:Object.fromEntries(Object.entries(samples).map(([name,kinds])=>[name,Object.fromEntries(Object.entries(kinds).map(([kind,phases])=>[kind,Object.fromEntries(Object.entries(phases).map(([phase,values])=>[phase,stats(values)]))]))])),parity};
await writeFile(path.join(directory,'comparison.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(parity.some(p=>!p.equal))process.exitCode=1;
