#!/usr/bin/env node
import { mkdir,readFile,writeFile,rename,copyFile,rm,readdir,open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { bundleEngine,ROOT } from './engine.mjs';
import { parseHarnessArgs,runHarness } from './cli.mjs';
import { inspectMatchPolicies,MATCH_SCENARIOS } from './match.mjs';
import { loadPolicyCatalog,POLICY_SCHEMA } from './policies.mjs';
import { hash,genomeHash,randomSource,propose,DEFAULT_BOUNDS,TEMPLATES,validateBounds,diversePolicy,pairedEvidence } from './search-space.mjs';

const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
async function atomicJSON(file,value){const temp=`${file}.tmp`;await writeFile(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,file);}
async function sources(){const files=(await readdir(fileURLToPath(new URL('.',import.meta.url)))).filter(name=>name.endsWith('.mjs')&&!name.endsWith('.test.mjs')).sort();return Object.fromEntries(await Promise.all(files.map(async name=>[name,hash(await readFile(new URL(name,import.meta.url),'utf8'))])));}
const unique=values=>[...new Set(values)];
const planIdentity=plan=>{const {maxMatches,maxWallSeconds,...fixed}=plan;return hash(fixed);};
class BudgetReached extends Error {}
const countMatches=(policies,stage)=>policies*(policies-1)*stage.seeds*stage.scenarios.length;
function validatePlan(plan){
  const keys=['version','baseline','policyFile','seed','generations','population','jobs','screening','confirmation','archiveSize','maxMatches','maxWallSeconds','promotion','bounds','decisions','featureMutations','proposalDirectory'];
  if(!plan||plan.version!==1||Object.keys(plan).some(k=>!keys.includes(k)))throw new Error('Invalid search plan or unknown field');
  for(const name of ['generations','population','jobs','archiveSize','maxMatches'])if(!Number.isSafeInteger(plan[name])||plan[name]<1)throw new Error(`Search requires positive integer ${name}`);
  if(plan.population<2||plan.archiveSize<2)throw new Error('Use population >= 2 for parameter/logic exploration and archiveSize >= 2 for diversity');
  if(typeof plan.seed!=='string'||!plan.seed.length||!Number.isFinite(plan.maxWallSeconds)||plan.maxWallSeconds<=0)throw new Error('Search requires seed and finite maxWallSeconds');
  for(const stage of ['screening','confirmation']) {
    const config=plan[stage];if(!config||Object.keys(config).some(k=>!['seconds','seeds','scenarios'].includes(k))||!Number.isFinite(config.seconds)||config.seconds<=0||!Number.isSafeInteger(config.seeds)||config.seeds<1
      ||!Array.isArray(config.scenarios)||!config.scenarios.length||config.scenarios.some(s=>!MATCH_SCENARIOS.includes(s))||unique(config.scenarios).length!==config.scenarios.length)throw new Error(`Invalid ${stage} configuration`);
  }
  if(plan.screening.scenarios.some(s=>!plan.confirmation.scenarios.includes(s)))throw new Error('Confirmation must cover all screening scenarios');
  if(!plan.promotion||Object.keys(plan.promotion).some(k=>!['minPositiveSeeds','alpha'].includes(k))||!Number.isSafeInteger(plan.promotion.minPositiveSeeds)||plan.promotion.minPositiveSeeds<1||!Number.isFinite(plan.promotion.alpha)||plan.promotion.alpha<=0||plan.promotion.alpha>.05)throw new Error('Promotion requires minPositiveSeeds >= 1 and 0 < alpha <= .05');
  if(plan.decisions&&(!Array.isArray(plan.decisions)||!plan.decisions.length||plan.decisions.some(k=>!Object.hasOwn(TEMPLATES,k))||unique(plan.decisions).length!==plan.decisions.length))throw new Error('Unsupported automatic logic decision');
  if(plan.featureMutations&&(!Array.isArray(plan.featureMutations)||plan.featureMutations.some(k=>!POLICY_SCHEMA.features.includes(k))))throw new Error('Unknown feature mutation');
}
async function acquireLock(out){
  const file=path.join(out,'search.lock');
  try {const handle=await open(file,'wx');await handle.writeFile(String(process.pid));await handle.close();}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const pid=Number(await readFile(file,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid search.lock; inspect it before removing it');
    try{process.kill(pid,0);throw new Error(`Search already running (PID ${pid})`);}catch(e){if(e.code!=='ESRCH')throw e;}
    await rm(file);return acquireLock(out);
  }
  return ()=>rm(file,{force:true});
}
export async function runSearch(planFile,outDirectory,{resume=false}={}) {
  const raw=await readFile(path.resolve(ROOT,planFile),'utf8'),plan=JSON.parse(raw);validatePlan(plan);
  const out=path.resolve(ROOT,outDirectory);await mkdir(out,{recursive:true});const unlock=await acquireLock(out);
  const stateFile=path.join(out,'state.json'),sourceHashes=await sources(),started=performance.now();let state;
  try {
    if(resume) {
      state=await readJSON(stateFile);
      if(state.planHash!==planIdentity(plan)||hash(state.sources)!==hash(sourceHashes))throw new Error('Search settings or harness changed; start a new output directory (only budget increases are allowed on resume)');
      if(plan.maxMatches<state.plan.maxMatches||plan.maxWallSeconds<state.plan.maxWallSeconds)throw new Error('Resume budgets may only increase');
      state.plan=plan;await atomicJSON(path.join(out,'plan.json'),plan);
    } else {
      if((await readdir(out)).some(name=>name!=='search.lock'))throw new Error('Output directory is not empty; use --resume or a new directory');
      const catalog=loadPolicyCatalog(plan.policyFile,ROOT);
      if(!catalog.available.includes(plan.baseline))throw new Error('Unknown baseline policy');
      const compiled=await bundleEngine();const directory=path.join(out,'engine');await mkdir(directory);
      try{await copyFile(compiled.bundle,path.join(directory,'engine.mjs'));await copyFile(path.join(compiled.directory,'simulation.wasm'),path.join(directory,'simulation.wasm'));}
      finally{await rm(compiled.directory,{recursive:true,force:true});}
      state={version:1,planHash:planIdentity(plan),plan,sources:sourceHashes,artifacts:compiled.artifacts,definitions:catalog.definitions,
        generation:0,incumbent:plan.baseline,archive:[plan.baseline],candidates:{},history:[],pending:null,rng:randomSource(plan.seed).state,
        matches:0,completedStages:{},elapsedSeconds:0,status:'active'};
      await atomicJSON(path.join(out,'plan.json'),plan);await mkdir(path.join(out,'candidates'));await mkdir(path.join(out,'reports'));await atomicJSON(stateFile,state);
    }
    const engine={directory:path.join(out,'engine'),bundle:path.join(out,'engine/engine.mjs'),artifacts:state.artifacts};
    // Verify durable snapshot on every resume, without rebuilding against today's game.
    const digestBytes=async file=>{const {createHash}=await import('node:crypto');return createHash('sha256').update(await readFile(file)).digest('hex');};
    if(await digestBytes(engine.bundle)!==state.artifacts.bundleSha256||await digestBytes(path.join(engine.directory,'simulation.wasm'))!==state.artifacts.wasmSha256)throw new Error('Frozen engine snapshot was modified');
    const runtime=await import(pathToFileURL(engine.bundle).href);
    const catalog=inspectMatchPolicies(runtime,state.definitions),base=catalog.find(p=>p.id===plan.baseline);
    if(!base)throw new Error('Baseline not found in native catalog');
    const baseline={...base,extends:POLICY_SCHEMA.default};
    // Flatten inherited policies so candidates never silently depend on a changing ancestor.
    const definitionFor=id=>id===plan.baseline?baseline:state.candidates[id].definition;
    const bounds=plan.bounds??DEFAULT_BOUNDS;validateBounds(bounds,base);
    const rng=randomSource(plan.seed);rng.state=state.rng;
    let accountedAt=performance.now();
    async function save(){state.elapsedSeconds+=(performance.now()-accountedAt)/1000;accountedAt=performance.now();await atomicJSON(stateFile,state);}
    // Keep the budget clock independent of checkpoint accounting.
    const invocationPrevious=state.elapsedSeconds;
    const budgetElapsed=()=>invocationPrevious+(performance.now()-started)/1000;
    function definitionsFor(ids){return [...state.definitions,...ids.filter(id=>id!==plan.baseline&&!POLICY_SCHEMA.builtins.includes(id)).map(id=>state.candidates[id].definition)];}
    async function evaluate(stage,ids,generation) {
      const name=`generation-${generation}-${stage}`,file=path.join(out,'reports',`${name}.json`),settings=plan[stage];
      const config=parseHarnessArgs(['match',`--policies=${POLICY_SCHEMA.builtins.slice(0,2).join(',')}`,`--seconds=${settings.seconds}`,
        `--seeds=${settings.seeds}`,`--scenarios=${settings.scenarios.join(',')}`,`--jobs=${plan.jobs}`,`--seed=${plan.seed}:${stage}:g${generation}`,`--out=${file}`]);
      config.policies=ids;config.policyDefinitions=definitionsFor(ids);config.policySource={searchPlanHash:state.planHash};
      if(hash(await sources())!==hash(state.sources))throw new Error('Harness source changed during search; stop and start a new study');
      const configHash=hash(config);let report;
      try{report=await readJSON(file);}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
      if(report){if(hash(report.configuration)!==configHash||hash(report.artifacts)!==hash(state.artifacts))throw new Error(`Cached stage mismatch: ${name}`);}
      else {
        if(budgetElapsed()>=plan.maxWallSeconds)throw new BudgetReached('Search wall budget reached');
        if(state.matches+countMatches(ids.length,settings)>plan.maxMatches)throw new BudgetReached('Search match budget exhausted');
        console.error(`SEARCH generation ${generation} ${stage}: ${ids.join(', ')}`);
        report=await runHarness(config,engine);
      }
      if(hash(await sources())!==hash(state.sources))throw new Error('Harness source changed during a stage; results were not selected');
      if(!state.completedStages[name]){state.matches+=report.rows.length;state.completedStages[name]={configHash,matches:report.rows.length};await save();}
      return report;
    }
    try {
    while(state.generation<plan.generations) {
      const generation=state.generation+1;
      if(!state.pending) {
        const maxPolicies=unique([plan.baseline,state.incumbent,...state.archive]).length+plan.population;
        const worst=countMatches(maxPolicies,plan.screening)+countMatches(2,plan.confirmation);
        if(state.matches+worst>plan.maxMatches||budgetElapsed()>=plan.maxWallSeconds){state.status='budget-exhausted';break;}
        const candidates=[],seen=new Set([genomeHash(base),...Object.values(state.candidates).map(c=>c.genomeHash)]);
        const pool=unique([state.incumbent,...state.archive]);
        // Optional human/external proposals are data, read once per generation and
        // snapshotted. They pass the same native validation and evaluation gates.
        let submitted=[];
        if(plan.proposalDirectory){try{const document=await readJSON(path.resolve(ROOT,plan.proposalDirectory,`generation-${generation}.json`));
          if(document.version!==1||!Array.isArray(document.proposals))throw new Error('Invalid proposal file');submitted=document.proposals;
        }catch(error){if(error.code!=='ENOENT')throw error;}}
        const rejections=[];
        for(let attempt=0;candidates.length<plan.population&&attempt<plan.population*40;attempt++) {
          const index=candidates.length,id=`evo-g${generation}-c${index+1}`;
          const parent=definitionFor(pool[Math.floor(rng.next()*pool.length)]),donor=definitionFor(pool[Math.floor(rng.next()*pool.length)]);
          // Alternate parameter-only, new logic, then mixed proposals. Always keep
          // at least one slot for each automatic lane, even with an inbox.
          let proposal;
          if(index>=2&&submitted.length){const external=submitted.shift();
            if(!external||Object.keys(external).some(k=>!['parameters','features','logic','hypothesis'].includes(k))) {rejections.push({reason:'Invalid external proposal fields'});continue;}
            proposal={definition:{id,extends:parent.extends,parameters:{...parent.parameters,...external.parameters},features:{...parent.features,...external.features},logic:{...parent.logic,...external.logic}},parents:[parent.id],lane:'external',hypothesis:external.hypothesis??'External decision proposal'};
          }else proposal=propose(rng,parent,donor,{id,lane:['parameters','logic','mixed'][index%3],bounds,decisions:plan.decisions,featureMutations:plan.featureMutations});
          const candidateHash=genomeHash(proposal.definition);if(seen.has(candidateHash))continue;
          try {inspectMatchPolicies(runtime,[...state.definitions,proposal.definition]);}
          catch(error){rejections.push({definition:proposal.definition,reason:error.message});continue;}
          seen.add(candidateHash);const candidate={...proposal,genomeHash:candidateHash,generation};state.candidates[id]=candidate;candidates.push(id);
          await atomicJSON(path.join(out,'candidates',`${id}.json`),candidate);
        }
        if(candidates.length!==plan.population){await atomicJSON(path.join(out,`generation-${generation}-rejections.json`),rejections);throw new Error('Proposal space exhausted; inspect rejected proposals or expand bounds');}
        state.rng=rng.state;state.pending={generation,candidates,rejections,policies:unique([plan.baseline,state.incumbent,...state.archive,...candidates])};await save();
      }
      const pending=state.pending,screen=await evaluate('screening',pending.policies,generation);
      const faulty=new Set(screen.rows.flatMap(row=>Object.entries(row.logicFaults??{}).filter(([,n])=>n>0).map(([id])=>id)));
      const eligible=screen.standings.table.filter(row=>!faulty.has(row.policy));
      const ranked=eligible.map(row=>row.policy);
      // Retain competitive and behavior-diverse parents even when confirmation ties.
      const diverse=diversePolicy({...screen,standings:{table:eligible}},ranked.slice(0,1));
      const nextArchive=unique([...ranked.slice(0,Math.max(1,plan.archiveSize-1)),diverse].filter(Boolean)).slice(0,plan.archiveSize);
      const challenger=ranked.find(id=>id!==state.incumbent);
      let evidence=null,promoted=false,confirmation=null;
      if(challenger) {
        confirmation=await evaluate('confirmation',[state.incumbent,challenger],generation);
        evidence=pairedEvidence(confirmation,challenger,state.incumbent);
        const faults=confirmation.rows.some(row=>Object.values(row.logicFaults??{}).some(n=>n>0));
        // Alpha spending bounds false promotions across repeated generations.
        const alpha=plan.promotion.alpha/plan.generations;
        promoted=!faults&&evidence.positive>=plan.promotion.minPositiveSeeds&&evidence.positive>evidence.negative
          &&evidence.signTestP<=alpha&&Object.values(evidence.byScenario).every(delta=>delta>=0);
        evidence={...evidence,alpha,faults};
      }
      const previous=state.incumbent;if(promoted)state.incumbent=challenger;
      state.archive=unique([state.incumbent,...nextArchive]).slice(0,plan.archiveSize);
      state.history.push({generation,candidates:pending.candidates,rejections:pending.rejections,previousIncumbent:previous,challenger,promoted,incumbent:state.incumbent,evidence,
        rejectedForLogicFaults:[...faulty],screening:screen.standings,archive:state.archive});
      state.pending=null;state.generation=generation;state.status='active';await save();
      await publish();console.error(`SEARCH generation ${generation} complete; incumbent=${state.incumbent}; promoted=${promoted}`);
    }
    } catch(error) {if(!(error instanceof BudgetReached))throw error;state.status='budget-exhausted';}
    if(state.generation===plan.generations)state.status='complete';await save();await publish();
    return state;
    async function publish(){
      const incumbent=definitionFor(state.incumbent),selected=state.incumbent===plan.baseline?state.definitions:[...state.definitions,incumbent];
      await atomicJSON(path.join(out,'incumbent-policies.json'),{version:1,policies:selected});
      await atomicJSON(path.join(out,'search-summary.json'),{status:state.status,generations:state.generation,matches:state.matches,incumbent:state.incumbent,artifacts:state.artifacts,history:state.history});
      const lines=['# Iterative AI search','',`Status: ${state.status}. Completed ${state.generation}/${plan.generations} generations and ${state.matches} matches.`,
        `Experimental incumbent: **${state.incumbent}**. Live game defaults are unchanged.`,
        '', '| Generation | Challenger | Promoted | Incumbent | Positive / negative / tied seeds |','| --- | --- | --- | --- | --- |',
        ...state.history.map(h=>`| ${h.generation} | ${h.challenger??'none'} | ${h.promoted} | ${h.incumbent} | ${h.evidence?`${h.evidence.positive} / ${h.evidence.negative} / ${h.evidence.tied}`:'—'} |`),'',
        'Victories require actual faction defeat. Each seed plays both sides; timeouts are draws. Promotion requires fresh-seed confirmation, a one-sided sign test with an alpha budget across generations, and no scenario regression. A search can finish without discovering an improvement.',
        '', 'These military fixtures do not establish long-world economic, city expansion or siege quality. Short runs can be entirely draws. Validate exported policies on longer world runs before adopting them.',
        '', 'See `candidates/` for rule trees, parameters, ancestry and hypotheses; `reports/` for raw matches; `state.json` for resumable optimizer state; `incumbent-policies.json` for a harness-ready export. The engine snapshot is frozen across generations and resumes.',''];
      await writeFile(path.join(out,'README.md'),lines.join('\n'));
    }
  } finally {await unlock();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const args=process.argv.slice(2),resume=args.includes('--resume'),positional=args.filter(a=>a!=='--resume');
    if(positional.length!==2)throw new Error('Usage: npm run ai:search -- PLAN.json OUTPUT_DIRECTORY [--resume]');
    await runSearch(...positional,{resume});
  }catch(error){console.error(error.stack??error);process.exitCode=1;}
}
