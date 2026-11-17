import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const ids=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
if(!ids.length)ids.push('tutorial','island-deathmatch','sandbox','musketry-deathmatch','no-mans-land','age-of-exploration');
for(const id of ids)if(!['tutorial','island-deathmatch','sandbox','musketry-deathmatch','no-mans-land','age-of-exploration'].includes(id))throw new Error('Unknown scenario '+id);
const dir=path.join(root,'scratch/scenario-bake',`${Date.now()}-${ids.join('-')}`);
await mkdir(dir,{recursive:true});await mkdir(path.join(root,'public/scenarios'),{recursive:true});
const bundle=path.join(dir,'engine.mjs');
await build({stdin:{contents:`export {prepareScenario} from './tools/scenario-bake/prepare.ts';export {scenarioAgricultureSummary} from './tools/scenario-bake/agriculture.ts';export {serializeGameSave,parseGameSave} from './src/game/game-save.ts';export {citySummaries} from './src/game/cities.ts';export {factionHasDevelopedResource} from './src/game/resource-development.ts';export {validateBuildAt,migrateGame} from './src/game/simulation.ts';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',target:'node22',format:'esm',outfile:bundle,define:{'import.meta.env.BASE_URL':'"/"'}});
await copyFile(path.join(root,'public/wasm/simulation.wasm'),path.join(dir,'simulation.wasm'));
const engine=await import(pathToFileURL(bundle));
const hashes={bundleSha256:createHash('sha256').update(await readFile(bundle)).digest('hex'),wasmSha256:createHash('sha256').update(await readFile(path.join(dir,'simulation.wasm'))).digest('hex')};
for(const id of ids){
 const started=performance.now();let last=0,lastCheckpoint=0,current;
 const checkpoint=()=>{if(current)writeFileSync(path.join(dir,id+'-checkpoint.json.gz'),gzipSync(engine.serializeGameSave(current,false),{level:1}));};
 const interrupt=()=>{checkpoint();process.exit(130);};process.once('SIGINT',interrupt);
 const resumeFile=process.argv.find(arg=>arg.startsWith('--resume='))?.slice(9);
 const resume=resumeFile?engine.migrateGame(engine.parseGameSave(gunzipSync(await readFile(resumeFile)).toString('utf8'))):undefined;
 console.log('Preparing '+id);
 const state=await engine.prepareScenario(id,(_fraction,state)=>{
  current=state;
  if(state.time-lastCheckpoint>=300){checkpoint();lastCheckpoint=state.time;}
  if(performance.now()-last<15000)return;last=performance.now();
  const cities=engine.citySummaries(state).map(c=>({name:c.palace.cityName,pop:c.population,housing:c.housing,food:Math.round(c.food)}));
  console.log(JSON.stringify({scenario:id,seconds:Math.round(state.time),wallSeconds:Math.round((performance.now()-started)/1000),factions:state.factions.map(f=>({id:f.id,gold:Math.round(f.gold)})),cities}));
 },id==='sandbox'?'prepared-2026-11-16:19':'prepared-2026-11-16',resume).catch(error=>{checkpoint();throw error;});
 process.removeListener('SIGINT',interrupt);
 const data=engine.serializeGameSave(state,false),bytes=gzipSync(data,{level:9});
 const cities=engine.citySummaries(state).map(c=>({id:c.palace.id,faction:c.palace.faction,x:c.palace.x,y:c.palace.y,population:c.population,housing:c.housing,food:c.food}));
 const resources=Object.fromEntries(['clay','copper','iron','gold','stone','salt','olives','fish'].map(resource=>[resource,state.world.tiles.filter(tile=>tile.resource===resource).length]));
 const balance=id==='musketry-deathmatch'?{war:state.diplomacyState?.relationships.some(pair=>pair.a===0&&pair.b===1&&pair.war),sides:[0,1].map(side=>{const tiles=state.world.tiles.filter((_,cell)=>Number(cell%state.world.width>=state.world.width/2)===side);return {side,dry:tiles.filter(tile=>!['ocean','coast','river','lake'].includes(tile.terrain)).length,resources:Object.fromEntries(['clay','copper','iron','gold','stone','salt','olives','fish'].map(resource=>[resource,tiles.filter(tile=>tile.resource===resource).length]))};}),factions:state.factions.map(f=>({id:f.id,gold:f.gold,food:f.food,population:f.population,technologies:Object.keys(f.research?.levels??{}).filter(id=>f.research.levels[id]>0).length,musketmen:state.units.filter(u=>u.faction===f.id&&u.kind==='musketman').length,cannons:state.units.filter(u=>u.faction===f.id&&u.kind==='fieldCannon').length}))}:undefined;
 const manifest={id,balance,seed:state.world.seed,width:state.world.width,height:state.world.height,simulatedSeconds:state.time,wallSeconds:(performance.now()-started)/1000,bytes:bytes.length,cities,resources,whales:state.fishing?.whales.length??0,agriculture:engine.scenarioAgricultureSummary(state),iron:state.factions.map(f=>({faction:f.id,developed:engine.factionHasDevelopedResource(state,f.id,'iron')})),...hashes};
 await writeFile(path.join(root,'public/scenarios',id+'.json.gz'),bytes);
 await writeFile(path.join(root,'public/scenarios',id+'-source.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({saved:id,...manifest}));
}

execFileSync('python3',[path.join(root,'tools/scenario-bake/maps.py'),...ids],{stdio:'inherit'});
