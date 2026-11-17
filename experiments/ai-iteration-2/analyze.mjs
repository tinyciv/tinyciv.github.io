import { readFile,writeFile } from 'node:fs/promises';
import { pairedEvidence } from '../../tools/simulation-harness/search-space.mjs';
export async function analyze(file,output){
  const report=JSON.parse(await readFile(file,'utf8')),ids=new Set();
  const expected=report.configuration.policies.length*(report.configuration.policies.length-1)*report.configuration.seeds*report.configuration.scenarios.length;
  if(report.rows.length!==expected)throw new Error('Incomplete round robin');
  for(const row of report.rows){
    if(ids.has(row.id))throw new Error('Duplicate trial');ids.add(row.id);
    if(row.winner!==null){const loser=row.factions.find(f=>f.policy!==row.winner),winner=row.factions.find(f=>f.policy===row.winner);
      if(!loser?.defeated||winner?.defeated||row.stopReason!=='faction-defeated')throw new Error('Invalid victory');}
    else if(row.stopReason==='duration'&&row.factions.some(f=>f.defeated))throw new Error('Defeated faction in timeout draw');
    if(Object.values(row.logicFaults??{}).some(n=>n>0))throw new Error(`Logic fault in ${row.id}`);
  }
  const controls=['expansionist','hard-assault'].filter(id=>report.configuration.policies.includes(id));
  const comparisons=report.configuration.policies.flatMap(policy=>controls.filter(control=>control!==policy).map(control=>{
    const rows=report.rows.filter(row=>[row.left,row.right].includes(policy)&&[row.left,row.right].includes(control));
    return {policy,control,matches:rows.length,wins:rows.filter(r=>r.winner===policy).length,draws:rows.filter(r=>r.winner===null).length,
      losses:rows.filter(r=>r.winner===control).length,...pairedEvidence({rows},policy,control)};
  }));
  const result={file,artifacts:report.artifacts,matches:report.rows.length,standings:report.standings,comparisons,
    diagnostics:{faults:0,wallSeconds:report.timing.elapsedSeconds,simulatedSeconds:report.timing.simulatedSeconds,
      fortressMatches:report.rows.filter(r=>r.scenario==='siege-war').length,
      fortressDefeats:report.rows.filter(r=>r.scenario==='siege-war'&&r.winner!==null).length,
      finalSiegeEngines:report.rows.flatMap(r=>r.factions).reduce((n,f)=>n+f.siegeEngines,0)}};
  if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[2]){const result=await analyze(process.argv[2],process.argv[3]);console.log(JSON.stringify({matches:result.matches,table:result.standings.table,comparisons:result.comparisons},null,2));}
