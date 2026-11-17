import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { analyze } from './analyze.mjs';
import { pairedEvidence } from '../../tools/simulation-harness/search-space.mjs';
const root='benchmarks/ai-iteration-2',read=async file=>JSON.parse(await readFile(`${root}/${file}`,'utf8'));
const selection=await read('final-selection.json'),search=await read('evolution/state.json');
if(selection.protocolSha256!==createHash('sha256').update(await readFile('experiments/ai-iteration-2/confirmation-protocol.md')).digest('hex'))throw new Error('Confirmation protocol changed');
const field=await analyze(`${root}/independent-final.json`,`${root}/independent-evidence.json`);
const fortified=await analyze(`${root}/fortified-transfer.json`,`${root}/fortified-evidence.json`);
const transfer=await read('transfer-ai.json'),worldBase=await read('world-expansionist.json'),worldCandidate=await read('world-evolved-assault.json');
const final=await read('independent-final.json'),reports=[final,await read('fortified-transfer.json'),transfer,worldBase,worldCandidate];
for(const report of reports)if(JSON.stringify(report.artifacts)!==JSON.stringify(search.artifacts))throw new Error('Different engine in transfer/confirmation report');
const exportedHash=createHash('sha256').update(await readFile('experiments/ai-iteration-2/finalists.json')).digest('hex');
for(const report of reports)if(report.configuration.policySource?.sha256&&report.configuration.policySource.sha256!==exportedHash)throw new Error('Exported finalists differ from evaluated policies');
for(const h of search.history)for(const stage of ['screening','confirmation'])reports.push(await read(`evolution/reports/generation-${h.generation}-${stage}.json`));
for(const report of reports)if(JSON.stringify(report.artifacts)!==JSON.stringify(search.artifacts))throw new Error('Different engine in search report');
const seedSets=reports.filter(r=>r.mode==='match').map(r=>new Set(r.rows.map(row=>row.seed)));
for(let i=0;i<seedSets.length;i++)for(let j=i+1;j<seedSets.length;j++)for(const seed of seedSets[i])if(seedSets[j].has(seed))throw new Error('Seed family reused between stages');
for(const [name,expected] of Object.entries(search.sources))if(createHash('sha256').update(await readFile(`tools/simulation-harness/${name}`)).digest('hex')!==expected)throw new Error('Harness source drift');
function worldSummary(report){const row=Object.values(report.scenarios)[0],last=row.checkpoints.at(-1),rivals=last.factions.filter(f=>f.id>0&&!f.village);
  return {policy:row.policy,seed:row.seed,initialStateHash:row.initialStateHash,simulatedSeconds:row.simulatedSeconds,stopReason:row.stopReason,wallSeconds:row.wallSeconds,
    rivals:rivals.map(f=>({id:f.id,defeated:f.defeated,population:f.population,cities:f.buildings.ready.palace??0,forts:f.buildings.ready.fort??0,
      siegeEngines:(f.buildings.ready.ballista??0)+(f.buildings.ready.siegeCannon??0),territory:f.territoryCells,kills:f.kills,gold:f.gold})),totals:last.totals};}
const worlds=[worldSummary(worldBase),worldSummary(worldCandidate)];
if(worlds[0].initialStateHash!==worlds[1].initialStateHash)throw new Error('Unmatched generated world');
const direct=field.comparisons.filter(row=>selection.finalists.includes(row.policy)).map(row=>({...row,alpha:selection.comparisonAlpha,
  confirmedImprovement:row.positive>row.negative&&row.signTestP<=selection.comparisonAlpha}));
const ablationRows=final.rows.filter(r=>[r.left,r.right].includes('evolved-assault')&&[r.left,r.right].includes('field-concentration'));
const recoveryAblation={wins:ablationRows.filter(r=>r.winner==='evolved-assault').length,draws:ablationRows.filter(r=>r.winner===null).length,losses:ablationRows.filter(r=>r.winner==='field-concentration').length,...pairedEvidence({rows:ablationRows},'evolved-assault','field-concentration')};
const scout=await read('hypotheses-screening.json');
const matchCount=reports.filter(r=>r.mode==='match').reduce((n,r)=>n+r.rows.length,0)+scout.rows.length;
const result={artifacts:search.artifacts,initialExplorationArtifacts:scout.artifacts,matchedEngineForSearchConfirmationTransfer:true,
  uniqueSeedFamilies:true,totalMatches:matchCount,fixedOpponentRuns:transfer.rows.length,generatedWorldRuns:worlds.length,
  search:{generations:search.generation,matches:search.matches,promotions:search.history.filter(h=>h.promoted).length},
  independent:{seeds:selection.seeds,seconds:selection.seconds,comparisons:direct,standings:field.standings,recoveryAblation},
  fortified:fortified.diagnostics,transfer:{summary:transfer.summary,paired:transfer.paired},worlds,
  limits:['The initial 60-match hypothesis screen used an earlier engine and is not pooled with later evidence.',
    'The final comparison is controlled field combat; the fortified check and fixed-opponent scenarios are transfer diagnostics.',
    'Both starting sides are grouped by seed; four final candidate/control comparisons use alpha 0.0125 each.',
    'Generated-world results cover one paired map, and must not be treated as a population-wide economic or conquest result.',
    'The live default was not changed.']};
await writeFile(`${root}/study-evidence.json`,JSON.stringify(result,null,2)+'\n');
const table=field.standings.table,lines=['# AI iteration 2 results','',
  `Completed ${matchCount} direct policy matches, ${transfer.rows.length} fixed-opponent runs, and ${worlds.length} generated-world runs on one paired map. The iterative search explored three generations with nine automatic or submitted candidates.`,
  '', '## Independent field-combat confirmation','',
  `The four policies played a complete mirrored round robin on ${selection.seeds} new seeds, ${selection.seconds} seconds per match. Timeouts remain draws; wins require authoritative faction defeat.`,
  '', '| Policy | Wins | Draws | Losses | Points |','| --- | ---: | ---: | ---: | ---: |',...table.map(r=>`| ${r.policy} | ${r.wins} | ${r.draws} | ${r.losses} | ${r.points} |`),'',
  '| Candidate | Control | Wins / draws / losses | Positive / negative / tied seeds | Sign-test p | Passes corrected threshold |',
  '| --- | --- | --- | --- | ---: | --- |',...direct.map(r=>`| ${r.policy} | ${r.control} | ${r.wins} / ${r.draws} / ${r.losses} | ${r.positive} / ${r.negative} / ${r.tied} | ${r.signTestP.toPrecision(4)} | ${r.confirmedImprovement} |`),'',
  `Both legs count as one observation per seed. The Bonferroni threshold is ${selection.comparisonAlpha}, covering both finalists against both controls. Finalists and rules were fixed before this final seed family was run.`,
  '', `The recovery-rule ablation is inconclusive: evolved-assault versus field-concentration was ${recoveryAblation.wins} wins, ${recoveryAblation.draws} draws and ${recoveryAblation.losses} losses. Although evolved-assault ranked slightly higher across the full opponent pool, this does not establish that its recovery rule improves on the simpler army-concentration change.`,
  '', '## What changed','',
  '`field-concentration` extends the earlier hard-assault contender and assigns zero healthy soldiers to the standing home garrison. Wounded or unavailable troops still stay out of the field escort through the existing planner. It trades home defense for a larger local army.',
  '', '`evolved-assault` adds a conditional recovery rule: Leader HP at least 70%, morale at least 60, and observed enemy power no greater than 1.1 times friendly power. It can resume fighting before returning within six tiles of home. The inherited hard-assault default required 90% HP, 75 morale, power ratio at most 0.6, and proximity to home. It retains formations and the ordinary planning cadence, commands, research, payment, and combat rules.',
  '', 'The initial screen rejected smaller formation thresholds and the more protective patient-pressure combination. The first evolutionary screening leader regressed on confirmation and was rejected. The recovery proposal led the later search but did not pass its per-generation promotion gate. It was exported for the separate independent comparison above.',
  '', '## Transfer checks','',
  `Fortified matches: ${fortified.diagnostics.fortressMatches}; actual defeats: ${fortified.diagnostics.fortressDefeats}; final siege engines summed over contestants: ${fortified.diagnostics.finalSiegeEngines}. This does not establish a siege-conquest improvement.`,
  '', '| Policy | Fixed-opponent runs | Leader survival | Mean kills | Mean diagnostic score |',
  '| --- | ---: | ---: | ---: | ---: |',...transfer.summary.map(r=>`| ${r.policy} | ${r.runs} | ${r.survivalRate} | ${r.meanKills} | ${r.meanScore} |`),'',
  'The fixed-opponent score weights survival, retinue HP, kills and palace damage. It is a diagnostic, separate from the authoritative match-victory rule.',
  '', '## Generated-world case study','',
  'One default map was replayed with the same initial-state hash, with the selected policy assigned to every nonhuman rival. This is a paired case study of a generated world, not head-to-head self-play or a statistical claim about economic strength.',
  '', '| Policy | Simulated seconds | Stop reason | Rival population | Ready cities | Ready forts | Ready siege engines | Rival territory |',
  '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |',...worlds.map(w=>`| ${w.policy} | ${w.simulatedSeconds} | ${w.stopReason} | ${w.rivals.reduce((n,r)=>n+r.population,0).toFixed(2)} | ${w.rivals.reduce((n,r)=>n+r.cities,0)} | ${w.rivals.reduce((n,r)=>n+r.forts,0)} | ${w.rivals.reduce((n,r)=>n+r.siegeEngines,0)} | ${w.rivals.reduce((n,r)=>n+r.territory,0)} |`),'',
  '## Reproduce and inspect','',
  'Definitions and commands: [experiment directory](../../experiments/ai-iteration-2/README.md). The [finalists file](../../experiments/ai-iteration-2/finalists.json) is usable directly with `--policy-file` and `--policies=evolved-assault` or `--policies=field-concentration`.',
  '', 'Reports: [independent raw matches](independent-final.json), [direct comparisons](independent-evidence.json), [evolution](evolution/README.md), [fixed opponents](transfer-ai.json), [fortified matches](fortified-transfer.json), [baseline world](world-expansionist.json), [candidate world](world-evolved-assault.json), [combined evidence](study-evidence.json).',
  '',...result.limits.map(note=>`- ${note}`),''];
await writeFile(`${root}/README.md`,lines.join('\n'));
console.log(JSON.stringify({totalMatches:result.totalMatches,comparisons:direct,worlds},null,2));
