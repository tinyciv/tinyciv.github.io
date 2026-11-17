#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleEngine, ROOT } from './engine.mjs';
import { parseHarnessArgs, runHarness } from './cli.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function harnessManifest() {
  const names=['engine','runner','worker','cli','world','ai','match','policies','policy-analysis','experiment'];
  return Object.fromEntries(await Promise.all(names.map(async name=>[`${name}.mjs`,digest(await readFile(new URL(`./${name}.mjs`,import.meta.url)))])));
}
export async function runExperiment(planFile,outDirectory) {
  const raw=await readFile(path.resolve(ROOT,planFile),'utf8'),plan=JSON.parse(raw);
  if(plan.version!==1||!Array.isArray(plan.policies)||plan.policies.length<2||!plan.policies.includes(plan.baseline)
    ||!plan.screening||!plan.validation||plan.screening.seed===plan.validation.seed)
    throw new Error('Experiment requires policies including the baseline and distinct screening/validation seed families.');
  const out=path.resolve(ROOT,outDirectory);await mkdir(out,{recursive:true});
  const configFor=(stage,policies,file)=>parseHarnessArgs(['match',`--policy-file=${plan.policyFile}`,
    `--policies=${policies.join(',')}`,`--scenarios=${stage.scenarios.join(',')}`,`--seconds=${stage.seconds}`,
    `--seeds=${stage.seeds}`,`--seed=${stage.seed}`,`--jobs=${plan.jobs??2}`,`--out=${path.join(out,file)}`]);
  const screenConfig=configFor(plan.screening,plan.policies,'screening.json');
  const validationTemplate=configFor(plan.validation,plan.policies,'validation.json');
  // The same literal policy definitions and compiled engine serve both stages.
  validationTemplate.policyDefinitions=screenConfig.policyDefinitions;
  validationTemplate.policySource=screenConfig.policySource;
  const sources=await harnessManifest(),started=performance.now(),engine=await bundleEngine();
  await writeFile(path.join(out,'plan.json'),JSON.stringify({plan,planSha256:digest(raw),sources,
    artifacts:engine.artifacts,selection:'Advance every policy tied at or above second place, retaining the live baseline.'},null,2)+'\n');
  const checkSources=async()=>{
    if(JSON.stringify(await harnessManifest())!==JSON.stringify(sources))throw new Error('Harness source changed during the experiment; stages were not combined.');
  };
  try {
    console.error(`SCREENING ${plan.policies.length} policies, ${plan.screening.seeds} seeds per scenario, both sides`);
    const screening=await runHarness(screenConfig,engine);await checkSources();
    const cutoff=screening.standings.table[1].points;
    const qualifiers=plan.policies.filter(policy=>policy===plan.baseline
      ||screening.standings.table.find(row=>row.policy===policy).points>=cutoff);
    console.error(`VALIDATION on fresh seeds: ${qualifiers.join(', ')}`);
    const validation=await runHarness({...validationTemplate,policies:qualifiers},engine);await checkSources();
    if(JSON.stringify(screening.artifacts)!==JSON.stringify(validation.artifacts))throw new Error('Engine artifacts differed between stages.');
    const result={plan,qualifiers,artifacts:engine.artifacts,sources,
      screening:screening.standings,validation:validation.standings,
      champion:validation.standings.uniqueLeader,totalMatches:screening.rows.length+validation.rows.length,
      elapsedSeconds:(performance.now()-started)/1000,
      limits:['Controlled military fixtures with neutral observer and negotiations disabled; not a full generated-world campaign balance study.',
        'Mirrored legs share seeds and are correlated; raw match counts are not independent sample counts.',
        'Timeouts are draws. Ranking uses actual faction defeat, not damage or an invented timeout winner.']};
    await writeFile(path.join(out,'experiment.json'),JSON.stringify(result,null,2)+'\n');
    const table=result.validation.table;
    const markdown=[`# AI tournament: ${path.basename(out)}`,'',
      `Champion on held-out seeds: **${result.champion??'no unique winner'}**.`,
      `Completed ${result.totalMatches} matches, including both starting sides for every pair/scenario/seed.`,
      '', '| Policy | Wins | Draws | Losses | Points |','| --- | ---: | ---: | ---: | ---: |',
      ...table.map(row=>`| ${row.policy} | ${row.wins} | ${row.draws} | ${row.losses} | ${row.points} |`),'',
      `Screening: ${plan.screening.seeds} seeds × ${plan.screening.scenarios.join(', ')}, ${plan.screening.seconds}s limit.`,
      `Validation: ${plan.validation.seeds} fresh seeds × ${plan.validation.scenarios.join(', ')}, ${plan.validation.seconds}s limit.`,
      '','The same frozen engine and WASM snapshot was used in both stages. Full resolved policy definitions, fixture hashes, raw outcomes, timings and artifact hashes are in the JSON reports.',
      '',...result.limits.map(note=>`- ${note}`),'',
      'This experiment does not change the live default policy.','',
      'Reports: [screening](screening.json), [validation](validation.json), [combined analysis](experiment.json), [reproducibility plan](plan.json).',''];
    await writeFile(path.join(out,'README.md'),markdown.join('\n'));
    console.error(`Experiment finished: ${result.champion??'no unique champion'}; ${result.totalMatches} matches.`);
    return result;
  }finally{await rm(engine.directory,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==4)throw new Error('Usage: node tools/simulation-harness/experiment.mjs PLAN.json OUTPUT_DIRECTORY');
    await runExperiment(process.argv[2],process.argv[3]);
  }catch(error){console.error(error.stack??error);process.exitCode=1;}
}
