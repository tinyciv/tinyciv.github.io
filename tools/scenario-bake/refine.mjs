import {build}from'esbuild';
import {mkdir,readFile,writeFile,copyFile}from'node:fs/promises';
import {fileURLToPath,pathToFileURL}from'node:url';
import path from'node:path';
import {gzipSync,gunzipSync}from'node:zlib';
import {createHash}from'node:crypto';
import {writeFileSync}from'node:fs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const agriculture=process.argv.includes('--irrigation');
const layout=process.argv.includes('--layout');
const streetsOnly=process.argv.includes('--streets');
const diplomacyOnly=process.argv.includes('--diplomacy');
if(diplomacyOnly&&(agriculture||layout||streetsOnly))throw new Error('Run diplomacy finalization separately from layout or agriculture changes.');
const dir=path.join(root,'scratch/scenario-bake',`${Date.now()}-${diplomacyOnly?'diplomacy':layout?'layout':agriculture?'irrigation':'navigation'}`);await mkdir(dir,{recursive:true});
const bundle=path.join(dir,'engine.mjs');
await build({stdin:{resolveDir:root,loader:'ts',contents:`export{finalizeScenarioDiplomacy}from'./tools/scenario-bake/diplomacy';export{polishScenarioLayout}from'./tools/scenario-bake/layout';export{assertPreparedTownRoadRings,repairPreparedStreets}from'./tools/scenario-bake/streets';export{auditScenarioAccess}from'./src/game/scenario-access-native';export{irrigatePreparedScenario}from'./tools/scenario-bake/agriculture';export{finalizePreparedScenario}from'./tools/scenario-bake/finalize';export{parseGameSave,serializeGameSave}from'./src/game/game-save';export{migrateGame}from'./src/game/simulation';export{recordPreparedSettlements}from'./tools/scenario-bake/settlements';export{positionScenarioFleet}from'./src/game/warships-native';`},bundle:true,platform:'node',target:'node22',format:'esm',outfile:bundle,define:{'import.meta.env.BASE_URL':'"/"'}});
await copyFile(path.join(root,'public/wasm/simulation.wasm'),path.join(dir,'simulation.wasm'));
const engine=await import(pathToFileURL(bundle));
const hashes={refinementBundleSha256:createHash('sha256').update(await readFile(bundle)).digest('hex'),refinementWasmSha256:createHash('sha256').update(await readFile(path.join(dir,'simulation.wasm'))).digest('hex')};
const requested=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
const resume=process.argv.find(arg=>arg.startsWith('--resume='))?.slice(9);
if(resume&&requested.length!==1)throw new Error('Resume irrigation for exactly one named scenario.');
if(resume&&diplomacyOnly)throw new Error('Diplomacy finalization uses the stored start directly.');
const scenarios=['tutorial','island-deathmatch','sandbox','musketry-deathmatch','no-mans-land','age-of-exploration'];
for(const id of requested.length?requested:streetsOnly||diplomacyOnly?scenarios:['no-mans-land','age-of-exploration']){
 if(!scenarios.includes(id))throw new Error('Unknown scenario '+id);
 const file=path.join(root,'public/scenarios',id+'.json.gz'),source=path.join(root,'public/scenarios',id+'-source.json');
 const previous=await readFile(file);await writeFile(path.join(dir,id+'-before.json.gz'),previous);
 const original=engine.parseGameSave(gunzipSync(previous).toString());
 const beforeFarming={orchards:original.buildings.filter(b=>b.orchard).length,
   ditches:original.buildings.filter(b=>b.kind==='irrigation'&&b.hp>0).length,time:original.time};
 // Relationship-only repairs import the native snapshot directly. General
 // world migration can repair terrain/structures and is outside this mode.
 const state=diplomacyOnly?original:engine.migrateGame(resume?engine.parseGameSave(gunzipSync(await readFile(resume)).toString()):original);
 if(diplomacyOnly)engine.finalizeScenarioDiplomacy(state);
 if(resume){
   state.scenarioPreparing=original.scenarioPreparing;state.banditIntensity=original.banditIntensity;
   for(const faction of state.factions){const stock=original.factions.find(f=>f.id===faction.id);if(stock)Object.assign(faction,{gold:stock.gold,food:stock.food,relation:stock.relation});}
   for(const palace of state.buildings.filter(b=>b.kind==='palace'))palace.governorPermissions=original.buildings.find(b=>b.id===palace.id)?.governorPermissions;
 }
 const farming=agriculture?await engine.irrigatePreparedScenario(state,value=>{
   writeFileSync(path.join(dir,id+'-irrigation-checkpoint.json.gz'),gzipSync(engine.serializeGameSave(state,false),{level:1}));
   console.log(JSON.stringify({scenario:id,...value}));
 }):undefined;
 const streets=layout?await engine.polishScenarioLayout(state,value=>{
   writeFileSync(path.join(dir,id+'-layout-checkpoint.json.gz'),gzipSync(engine.serializeGameSave(state,false),{level:1}));
   console.log(JSON.stringify({scenario:id,...value}));
 }):undefined;
 const streetRepair=streetsOnly?engine.repairPreparedStreets(state,value=>console.log(JSON.stringify({scenario:id,...value}))):undefined;
 if(farming)Object.assign(farming,{orchardsRemoved:beforeFarming.orchards-farming.orchards,
   ditchesOrdered:farming.completedDitches-beforeFarming.ditches,simulatedSeconds:state.time-beforeFarming.time});
 const access=streetsOnly||diplomacyOnly?engine.auditScenarioAccess(state,state.units.filter(u=>u.kind==='leader'&&u.hp>0)):engine.finalizePreparedScenario(state);
 const fleet=id==='age-of-exploration'&&!diplomacyOnly?engine.positionScenarioFleet(state):undefined;
 if(!streetsOnly)engine.assertPreparedTownRoadRings(state);
 const cities=engine.recordPreparedSettlements(state);
 const bytes=gzipSync(engine.serializeGameSave(state,false),{level:9});
 const diplomacy=diplomacyOnly?{relationships:state.diplomacyState.relationships.map(({a,b,contact,war})=>({a,b,contact,war}))}:undefined;
 const manifest={...JSON.parse(await readFile(source,'utf8')),simulatedSeconds:state.time,bytes:bytes.length,cities,access,...(fleet?{fleet}:{}),...(diplomacy?{diplomacy}:{}),...(farming?{agriculture:farming}:{}),...(streets?{layout:streets,agriculture:streets.agriculture}:{}),...(streetRepair?{streets:streetRepair}:{}),...hashes};
 await writeFile(file,bytes);await writeFile(source,JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({saved:id,bytes:bytes.length,cities,access,...(farming?{agriculture:farming}:{})}));
}
