#!/usr/bin/env node
import { fork } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleEngine, ROOT } from './engine.mjs';
import { WORLD_SCENARIOS } from './world.mjs';
import { AI_SCENARIOS, SCORE, summarizeArmies } from './ai.mjs';
import { POLICY_SCHEMA, loadPolicyCatalog } from './policies.mjs';
import { comparePolicies } from './policy-analysis.mjs';
import { MATCH_SCENARIOS, summarizeMatches } from './match.mjs';

const HELP = `Usage: npm run sim -- [world|ai|match] [options]
       npm run sim -- compare baseline.json candidate.json [--no-ensemble] [--all]

Runs production simulation + Rust/WASM without a browser, renderer or sleeps.
Build the core first with npm run build:wasm after changing Rust code.

  --seconds=N          Simulated duration (world: 900, ai: 90, match: 180)
  --scenarios=a,b      World: default,advanced,bandits,duel
                       AI: open-battle,fortified-assault,outnumbered-defense,musketry-deathmatch
                       Match: field-battle,siege-war (mirrored round robin)
  --seeds=N            Seed count (world: 1, ai: 3)
  --seed=TEXT          Override the base seed; multiple seeds append -1, -2, ...
  --policies=a,b       Named policies (world: expansionist, ai: all available)
  --policy-file=FILE   JSON policy variants extending registered policies
  --fixture-file=FILE  Freeze a Musketry scenario artifact for this run
  --prepared-scenario=musketry-deathmatch  Run the prepared artifact in world mode
  --baseline=ID        Paired AI comparison baseline (default: coordinated)
  --dt=N               Fixed step in seconds, 0 < dt <= 0.1 (default: 0.1)
  --checkpoints=a,b    World sample times (default: 30,120,300,600,900 + final)
  --game-over=POLICY   stop or continue (world: continue, ai: stop)
  --jobs=N             Concurrent isolated processes (default: 1)
  --perturb=N          XOR the world's simulation RNG with a uint32
  --enemy-strength=N   Override world enemy strength
  --retinue-motion     Script a generated-world escort march, then observe rest
  --retinue-count=N    Escort roster for the motion fixture, 12–128 (default: 40)
  --retinue-rest-baseline  Observe the original exact-slot settling behavior
  --out=FILE           Report path (default: benchmarks/simulation-MODE.json)
  --list               List scenarios and policies without running simulation
  --help               Show usage without running simulation

Examples:
  npm run sim -- --scenarios=default --seconds=3600 --out=scratch/long-game.json
  npm run sim -- ai --seconds=90 --seeds=3
  npm run sim -- compare scratch/baseline.json scratch/candidate.json
`;

export function parseHarnessArgs(args) {
  const options = new Map();
  const flags = new Set(['help', 'list', 'retinue-motion', 'retinue-rest-baseline']);
  const allowed = new Set(['seconds', 'scenarios', 'seeds', 'seed', 'policies', 'policy-file', 'baseline', 'dt', 'checkpoints', 'game-over',
    'jobs', 'perturb', 'enemy-strength', 'retinue-count', 'fixture-file', 'prepared-scenario', 'out', ...flags]);
  const mode = args[0] && !args[0].startsWith('--') ? args.shift() : 'world';
  if (!['world', 'ai', 'match'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  for (let i = 0; i < args.length; i++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(args[i]);
    if (!match || !allowed.has(match[1])) throw new Error(`Unknown option: ${args[i]}`);
    const [, name, inline] = match;
    if (options.has(name)) throw new Error(`Duplicate --${name}`);
    if (flags.has(name)) {
      if (inline !== undefined) throw new Error(`--${name} takes no value`);
      options.set(name, true);
    } else {
      const value = inline ?? args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
      options.set(name, value);
    }
  }
  if (options.has('help')) return { help: true };
  const policyCatalog = loadPolicyCatalog(options.get('policy-file'), ROOT);
  if (options.has('list')) return { list: true, policyCatalog };
  const number = (name, fallback, valid) => {
    const value = Number(options.get(name) ?? fallback);
    if (!Number.isFinite(value) || !valid(value)) throw new Error(`Invalid --${name}: ${options.get(name)}`);
    return value;
  };
  const positive = value => value > 0;
  const integer = value => Number.isSafeInteger(value) && value > 0;
  const list = (name, fallback, allowedValues) => {
    const values = String(options.get(name) ?? fallback.join(',')).split(',');
    if (values.some(value => !allowedValues.includes(value)) || new Set(values).size !== values.length)
      throw new Error(`--${name} must contain distinct values from: ${allowedValues.join(',')}`);
    return values;
  };
  const seconds = number('seconds', mode === 'world' ? 900 : mode === 'ai' ? 90 : 180, positive);
  const scenarios = mode === 'world' ? Object.keys(WORLD_SCENARIOS) : mode === 'ai' ? AI_SCENARIOS : MATCH_SCENARIOS;
  const preparedScenario = options.get('prepared-scenario');
  if (preparedScenario && (mode !== 'world' || preparedScenario !== 'musketry-deathmatch'))
    throw new Error('--prepared-scenario requires world mode and musketry-deathmatch');
  const checkpoints = options.has('checkpoints') ? String(options.get('checkpoints')).split(',').map(Number) : [30, 120, 300, 600, 900];
  if (checkpoints.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('--checkpoints requires positive finite times');
  const gameOver = options.get('game-over') ?? (mode === 'world' ? 'continue' : 'stop');
  if (!['stop', 'continue'].includes(gameOver)) throw new Error('--game-over must be stop or continue');
  for (const option of mode === 'ai' ? ['checkpoints', 'perturb', 'enemy-strength'] : ['baseline'])
    if (options.has(option)) throw new Error(`--${option} is not supported in ${mode} mode`);
  const policies = list('policies', mode === 'world' ? [POLICY_SCHEMA.default] : policyCatalog.available, policyCatalog.available);
  if(mode === 'match' && policies.length < 2) throw new Error('Match mode requires at least two policies');
  const baseline = mode === 'ai' ? options.get('baseline') ?? 'coordinated' : null;
  if (baseline && !policyCatalog.available.includes(baseline)) throw new Error(`Unknown baseline policy: ${baseline}`);
  if (baseline && !policies.includes(baseline)) policies.unshift(baseline);
  return { mode, seconds, dt: number('dt', .1, value => value > 0 && value <= .1),
    seeds: number('seeds', mode === 'world' ? 1 : 3, integer), seed: options.get('seed') ?? null,
    scenarios: list('scenarios', preparedScenario ? ['default'] : scenarios, preparedScenario ? ['default'] : scenarios), policies, baseline,
    preparedScenario,
    policyDefinitions: policyCatalog.definitions, policySource: policyCatalog.source,
    fixtureFile: options.has('fixture-file') ? path.resolve(ROOT, String(options.get('fixture-file'))) : undefined,
    checkpoints: [...new Set([...checkpoints.filter(value => value < seconds), seconds])].sort((a, b) => a - b),
    gameOver, jobs: number('jobs', 1, integer),
    perturb: number('perturb', 0, value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff),
    enemyStrength: options.has('enemy-strength') ? number('enemy-strength', 1, positive) : undefined,
    retinueMotion: options.has('retinue-motion'),
    retinueCount: number('retinue-count', 40, value => integer(value) && value >= 12 && value <= 128),
    retinueRestBaseline: options.has('retinue-rest-baseline'),
    out: path.resolve(ROOT, String(options.get('out') ?? `benchmarks/simulation-${mode}.json`)) };
}

function trialsFor(config) {
  const trials = [];
  if(config.mode === 'match') {
    for(const scenario of config.scenarios)for(let seedIndex=1;seedIndex<=config.seeds;seedIndex++) {
      const seed=config.seed===null?`match-${seedIndex}`:`${config.seed}${config.seeds===1?'':`-${seedIndex}`}`;
      for(let a=0;a<config.policies.length;a++)for(let b=a+1;b<config.policies.length;b++)for(const leg of [0,1]) {
        const left=config.policies[leg?b:a],right=config.policies[leg?a:b];
        trials.push({id:`${scenario}:${seedIndex}:${left}-vs-${right}:${leg}`,scenario,seedIndex,seed,left,right,leg});
      }
    }
    return trials;
  }
  for (const scenario of config.scenarios) for (let seedIndex = 1; seedIndex <= config.seeds; seedIndex++) {
    const seed = config.seed === null
      ? config.mode === 'ai' ? `ai-tournament-${seedIndex}` : `${WORLD_SCENARIOS[scenario].seed}${seedIndex === 1 ? '' : `-${seedIndex}`}`
      : `${config.seed}${config.seeds === 1 ? '' : `-${seedIndex}`}`;
    for (const policy of config.policies) {
      const id = `${scenario}${config.seeds === 1 ? '' : `:${seedIndex}`}${config.mode === 'ai' || config.policies.length > 1 ? `:${policy}` : ''}`;
      trials.push({ id, scenario, seedIndex, seed, policy });
    }
  }
  return trials;
}

export async function runHarness(config, engineSnapshot) {
  const started = performance.now();
  const trials = trialsFor(config);
  const compiled = engineSnapshot ?? await bundleEngine(config);
  const buildSeconds = (performance.now() - started) / 1000;
  const children = new Set();
  const results = new Array(trials.length);
  let next = 0, cancelled = false;
  const stop = () => { cancelled = true; for (const child of children) child.kill('SIGTERM'); };
  const interrupted = signal => { stop(); process.exitCode = signal === 'SIGINT' ? 130 : 143; };
  const onInterrupt = () => interrupted('SIGINT');
  const onTerminate = () => interrupted('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  function runChild(trial) {
    return new Promise((resolve, reject) => {
      const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)),
        [JSON.stringify({ bundle: compiled.bundle, fixtures: compiled.fixtures, trial, config })], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      children.add(child);
      let result;
      child.on('message', message => { if (message.type === 'result') result = message.result; });
      child.on('error', reject);
      child.on('close', code => {
        children.delete(child);
        if (code !== 0 || !result) reject(new Error(`Trial ${trial.id} failed (exit ${code})`));
        else resolve(result);
      });
    });
  }
  async function consume() {
    while (!cancelled && next < trials.length) {
      const index = next++;
      try {
        const result = await runChild(trials[index]);
        results[index] = result;
        console.error(`${result.id}: ${result.simulatedSeconds}s simulated / ${result.wallSeconds}s wall = ${result.speedup}x; ${result.stopReason}${config.mode==='match'?`; winner=${result.winner??'draw'}`:''}`);
      } catch (error) { stop(); throw error; }
    }
  }
  try {
    const workers = await Promise.allSettled(Array.from({ length: Math.min(config.jobs, trials.length) }, consume));
    const failure = workers.find(worker => worker.status === 'rejected');
    if (failure) throw failure.reason;
    if (cancelled) throw new Error('Simulation harness interrupted');
    const elapsedSeconds = (performance.now() - started) / 1000;
    const report = { harness: 'tools/simulation-harness/cli.mjs', version: 3, mode: config.mode,
      dt: config.dt, seconds: config.seconds, checkpoints: config.checkpoints, perturbed: config.perturb,
      configuration: config, environment: { node: process.version, cpu: os.cpus()[0]?.model,
        platform: `${os.platform()} ${os.arch()}` }, artifacts: compiled.artifacts,
      timing: { buildSeconds, elapsedSeconds, simulatedSeconds: results.reduce((sum, result) => sum + result.simulatedSeconds, 0) },
      ...(config.mode === 'world' ? { scenarios: Object.fromEntries(results.map(result => [result.id, result])) }
        : config.mode === 'ai' ? { score: SCORE, summary: summarizeArmies(results, config.policies),
          paired: comparePolicies(results, config.policies, config.baseline), rows: results } : {matchRules:{victory:'Authoritative faction-defeated flag',negotiations:'Disabled for the contestant pair; neutral human observer isolated',sides:'Every pair plays both starting sides'},
          standings:summarizeMatches(results,config.policies),rows:results}) };
    await mkdir(path.dirname(config.out), { recursive: true });
    await writeFile(config.out, `${JSON.stringify(report, null, 2)}\n`);
    if (config.mode === 'ai') console.log(JSON.stringify(report.summary, null, 2));
    if (config.mode === 'match') console.log(JSON.stringify(report.standings, null, 2));
    console.error(`Wrote ${path.relative(ROOT, config.out)} in ${elapsedSeconds.toFixed(2)}s (including build and process startup)`);
    return report;
  } finally {
    stop();
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    if(!engineSnapshot)await rm(compiled.directory, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
try {
  if (args[0] === 'compare') {
    const { compare } = await import('./compare.mjs');
    compare(args.slice(1));
  } else {
    const config = parseHarnessArgs(args);
    if (config.help) console.log(HELP);
    else if (config.list) console.log(JSON.stringify({ world: WORLD_SCENARIOS, ai: AI_SCENARIOS, match: MATCH_SCENARIOS, policies: config.policyCatalog.available,
      definitions: config.policyCatalog.definitions, parameters: POLICY_SCHEMA.parameters, features: POLICY_SCHEMA.features }, null, 2));
    else await runHarness(config);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode ||= 1;
}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
