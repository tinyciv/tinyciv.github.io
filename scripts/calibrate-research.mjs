import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(path.join(tmpdir(),'btv-research-'));
try {
 const bundle=path.join(temp,'game.mjs');
 await build({stdin:{contents:`export { createGame, updateGame, buildAt, validateBuildAt, getLeader } from './src/game/simulation'; export { researchStatus, researchCost, RESEARCH_BRANCHES } from './src/game/research'; export { grantIncome } from './src/game/resource-income'; export { entityStore } from './src/game/entity-store'; export { installNavigationWasm } from './src/game/navigation-wasm';`,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:bundle});
 const {createGame,updateGame,buildAt,validateBuildAt,getLeader,researchStatus,researchCost,RESEARCH_BRANCHES,grantIncome,entityStore,installNavigationWasm}=await import(pathToFileURL(bundle));
 await installNavigationWasm(await readFile(path.join(root,'public/wasm/navigation.wasm')));
 const args=process.argv.slice(2), scenarioArg=args.find(a=>a.startsWith('--kills='));
 const seconds=Number(args.find(a=>a.startsWith('--seconds='))?.split('=')[1]??3600);
 const scenarios=scenarioArg?[Number(scenarioArg.split('=')[1])]:[0,2,4]; const rows=[];
 for(const killsPer30 of scenarios) {
  const width=64,height=64,seed='research-normal-growth';
  const state=createGame({width,height,seed,source:'Research calibration: open grassland',spawns:[{x:32,y:32}],tiles:Array.from({length:width*height},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:3,production:1,gold:0,variation:.5}))},undefined,{banditIntensity:0});
  // Hold combat exposure constant: two basic six-gold warrior bounties per30s
  // in the central scenario. Economic simulation, couriers and city growth are real.
  entityStore(state).units.replace(state.units.filter(u=>u.faction===0)); entityStore(state).buildings.replace(state.buildings.filter(b=>b.faction===0));
  state.factions=state.factions.filter(f=>f.id===0); state.villages=[];state.raiderCamps=[];state.marauderPacks=[];state.fogRaids={nextAt:1e9,waves:0,pressureVersion:1};state.wildlife={herds:[],nextRespawnAt:1e9,sequence:0,targetHerds:0};
  const faction=state.factions[0], snapshots=[];let library,orderedAt,readyAt,finishedAt;let killsGold=0;const input={up:false,down:false,left:false,right:false};
  for(let second=0;second<seconds;second++) {
   if(second===30) {
    const leader=getLeader(state), sites=[]; for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++)sites.push({x:Math.floor(leader.x)+dx,y:Math.floor(leader.y)+dy});
    sites.sort((a,b)=>Math.hypot(a.x-leader.x,a.y-leader.y)-Math.hypot(b.x-leader.x,b.y-leader.y));
    const site=sites.find(p=>validateBuildAt(state,'library',p.x,p.y).ok); if(!site)throw Error('No ordinary library site');
    const placed=buildAt(state,'library',site.x,site.y);if(!placed.ok)throw Error(placed.message);library=state.buildings.find(b=>b.kind==='library');orderedAt=state.time;
   }
   if(second>0&&second%30===0){const gold=killsPer30*6;grantIncome(faction,{gold},state);killsGold+=gold;}
   updateGame(state,1,input);
   if(library&&!library.construction&&readyAt===undefined)readyAt=state.time;
   const status=researchStatus(state,0);if(status.completed&&finishedAt===undefined)finishedAt=state.time;
   if((second+1)%60===0)snapshots.push({seconds:Math.round(state.time),population:faction.population,gold:Math.round(faction.gold),grossGold:Math.round(faction.incomeTotals?.gold??0),lootGold:killsGold,points:Math.round(RESEARCH_BRANCHES.reduce((sum,b)=>sum+(faction.research?.progress[b.id]??0),0)),completed:status.branches.filter(b=>b.complete).length,farms:state.buildings.filter(b=>b.kind==='camp').length});
   if(state.gameOver)throw Error('Unexpected gameover');
   if(finishedAt&&second>=900)break;
  }
  const row={killsPer30,allocation:.25,totalRequired:RESEARCH_BRANCHES.reduce((n,b)=>n+researchCost(faction,b.id),0),libraryOrderedAt:Math.round(orderedAt),libraryReadyAt:Math.round(readyAt??-1),finishedAt:finishedAt?Math.round(finishedAt):null,snapshots}; rows.push(row);console.log(JSON.stringify(row));
 }
 const output=path.join(root,'benchmarks/research-balance.json');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify({costBasis:'Current technology definitions; no fixed completion-time target.',measuredSeconds:seconds,assumptions:'Single normal-start20-person city;64×64 open fertile grassland;starting500food/500gold;1x simulation with real0.1s steps, automatic construction, population growth, farm pickup/decay, upkeep, tax and Science completion effects. Library manually ordered at30s for200gold; real civilians finish it. No irrigation placements, well, expansion, trade, treasures or scholars. Combat held exogenous at0/2/4 defeated basic6gold warriors per30s; all loot uses production grantIncome. No income/production or growth overrides.',rows},null,2)+'\n');
} finally {await rm(temp,{recursive:true,force:true});}
