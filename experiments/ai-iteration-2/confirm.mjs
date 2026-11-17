import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseHarnessArgs,runHarness } from '../../tools/simulation-harness/cli.mjs';
import { genomeHash } from '../../tools/simulation-harness/search-space.mjs';
import { analyze } from './analyze.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const study=path.resolve('benchmarks/ai-iteration-2/evolution'),state=await read(path.join(study,'state.json'));
if(state.status!=='complete')throw new Error('Finish the search before independent confirmation');
const last=state.history.at(-1),screen=await read(path.join(study,'reports',`generation-${last.generation}-screening.json`));
const promising=state.history.filter(h=>h.evidence&&!h.evidence.faults&&h.evidence.positive>h.evidence.negative).sort((a,b)=>(b.evidence.positive-b.evidence.negative)-(a.evidence.positive-a.evidence.negative)||a.evidence.signTestP-b.evidence.signTestP);
const selectedId=state.incumbent!=='hard-assault'?state.incumbent:promising[0]?.challenger??screen.standings.table.find(p=>p.policy!=='hard-assault'&&!last.rejectedForLogicFaults.includes(p.policy)).policy;
const chosen=state.candidates[selectedId].definition;
const initial=await read('benchmarks/ai-iteration-2/hypotheses-screening.json');
const field=initial.rows.flatMap(r=>r.policyDefinitions).find(p=>p.id==='field-concentration');
const finalists=genomeHash(field)===genomeHash(chosen)?['field-concentration']:['evolved-assault','field-concentration'];
const definitions=[state.definitions.find(p=>p.id==='hard-assault'),state.definitions.find(p=>p.id==='field-concentration'),
  ...(finalists.includes('evolved-assault')?[{...chosen,id:'evolved-assault'}]:[])];
const policyFile='experiments/ai-iteration-2/finalists.json';
const selection={selectedId,finalists,selectedGenomeHash:genomeHash(chosen),fieldGenomeHash:genomeHash(field),artifacts:state.artifacts,
  screeningGeneration:last.generation,comparisonAlpha:.05/(finalists.length*2),independentSeedFamily:'iteration-2-independent-final',seeds:24,seconds:240,
  protocolSha256:createHash('sha256').update(await readFile('experiments/ai-iteration-2/confirmation-protocol.md')).digest('hex')};
await writeFile('benchmarks/ai-iteration-2/final-selection.json',JSON.stringify(selection,null,2)+'\n',{flag:'wx'});
await writeFile(policyFile,JSON.stringify({version:1,policies:definitions},null,2)+'\n');
const directory=path.join(study,'engine'),bundle=path.join(directory,'engine.mjs');
for(const [file,expected] of [[bundle,state.artifacts.bundleSha256],[path.join(directory,'simulation.wasm'),state.artifacts.wasmSha256]])
  if(createHash('sha256').update(await readFile(file)).digest('hex')!==expected)throw new Error('Frozen artifact changed');
const engine={directory,bundle,artifacts:state.artifacts},policies=['expansionist','hard-assault',...finalists];
const config=parseHarnessArgs(['match',`--policy-file=${policyFile}`,`--policies=${policies.join(',')}`,'--scenarios=field-battle','--seconds=240','--seeds=24','--seed=iteration-2-independent-final','--jobs=4','--out=benchmarks/ai-iteration-2/independent-final.json']);
console.error(`INDEPENDENT CONFIRMATION ${policies.join(', ')}; ${selection.seeds} new seeds; alpha=${selection.comparisonAlpha}`);
await runHarness(config,engine);
const evidence=await analyze(config.out,'benchmarks/ai-iteration-2/independent-evidence.json');
console.error(JSON.stringify(evidence.comparisons.filter(row=>finalists.includes(row.policy)),null,2));
