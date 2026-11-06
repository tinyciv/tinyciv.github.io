import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'scratch/2026-11-01-rival-development');
await mkdir(out,{recursive:true});
const report=[],modules={};
for(const version of ['baseline','current']){
 const outfile=path.join(out,`simulation-${version}.mjs`);
 await build({stdin:{contents:"export {createGame,updateGame} from './src/game/simulation.ts';export {entityStore} from './src/game/entity-store.ts';export{cityDevelopmentNeeds}from'./src/game/governor.ts';",resolveDir:root},bundle:true,platform:'node',format:'esm',outfile,
 plugins:version==='baseline'?[{name:'prior-ai-only',setup(b){b.onLoad({filter:/src\/game\/faction-(development|defense)\.ts$/},async args=>({contents:await readFile(path.join(out,'baseline',path.basename(args.path)),'utf8'),loader:'ts',resolveDir:path.dirname(args.path)}));}}]:[]});
 modules[version]=await import(pathToFileURL(outfile).href);
}
for(const version of ['baseline','current']){
 const m=modules[version];
 for(const cities of [1,2]){
  const width=84,height=60,world={width,height,seed:'rival-development',source:'controlled economic benchmark',spawns:[{x:12,y:30},{x:62,y:30}],
   ...(cities===2?{secondarySpawns:[{x:62,y:12}]}:{}),tiles:Array.from({length:width*height},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:3,production:1,gold:0,variation:.5}))};
  const s=m.createGame(world);s.raiderCamps=[];s.marauderPacks=[];s.fogRaids={nextAt:1e9,waves:0};
  m.entityStore(s).units.replace(s.units.filter(u=>u.faction>=0&&u.villageId===undefined));m.entityStore(s).buildings.replace(s.buildings.filter(b=>b.faction>=0&&b.villageId===undefined));s.factions=s.factions.filter(f=>f.villageId===undefined);s.villages=[];
  for(const f of s.factions){f.nextRaid=1e9;f.nextRetinueAt=1e9;}s.factions[1].relation='peace';s.buildings.find(b=>b.kind==='palace'&&b.faction===0).governorPermissions={farms:false,housing:false};
  const row={version,cities,first:{},snapshots:[]};const started=performance.now();
  for(let second=1;second<=600;second++){
   m.updateGame(s,1,{up:false,down:false,left:false,right:false});
   const own=s.buildings.filter(b=>b.faction===1),f=s.factions[1];
   for(const k of ['library','palisade','wall','woodenTower','guardPost'])if(!row.first[k]&&own.some(b=>b.kind===k&&!b.construction))row.first[k]=second;
   for(const [k,v]of Object.entries(f.research?.levels??{}))if(v&&!row.first[`tech:${k}`])row.first[`tech:${k}`]=second;
   if(second%120===0)row.snapshots.push({time:s.time,population:f.population,gold:f.gold,food:f.food,buildings:Object.fromEntries([...new Set(own.map(b=>b.kind))].map(k=>[k,own.filter(b=>b.kind===k&&!b.construction).length])),pending:own.filter(b=>b.construction).length,techs:Object.keys(f.research?.levels??{}),foodCapacity:own.filter(b=>b.kind==='palace').map(b=>m.cityDevelopmentNeeds(s,b).foodCapacity)});
   if(s.gameOver)throw Error(`Unexpected gameover at${s.time}`);
  }
  row.elapsedMs=performance.now()-started;report.push(row);console.log(JSON.stringify(row));
 }
}
await writeFile(path.join(out,'comparison.json'),JSON.stringify(report,null,2));
