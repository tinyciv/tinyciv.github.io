import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// Run serially, without concurrent tests or profiles. Paths may change when a
// shared destination search chooses an equally short route; regression tests
// cover geometry and economy rules, while this records resulting world totals.
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!arg('baseline')) throw new Error('Required: --baseline=/path/to/pre-change-source');
const roots = { baseline: path.resolve(arg('baseline')), current: path.resolve(arg('current', root)) };
const statePath = path.resolve(arg('state', 'scratch/2026-10-31-courier-optimization/live-final.json'));
const out = path.resolve(arg('out', 'scratch/2026-10-31-navigation-round2'));
const rounds = Number(arg('rounds', '3')), frames = Number(arg('frames', '900')), warmup = Number(arg('warmup', '60'));
const dt = Number(arg('dt', String(1 / 30))), speed = Number(arg('speed', '2'));
if (![rounds, frames].every(n => Number.isInteger(n) && n > 0) || !Number.isInteger(warmup) || warmup < 0
  || !Number.isFinite(dt) || dt <= 0 || !Number.isFinite(speed) || speed <= 0) throw new Error('Invalid benchmark counts or timestep.');
await mkdir(out, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const raw = await readFile(statePath), initial = JSON.parse(raw);
initial.paused = false; initial.speed = speed;
if (initial.gameOver || initial.palaceCaptures?.length) throw new Error('Fixture cannot advance.');
const modules = {}, artifacts = {};
for (const [name, directory] of Object.entries(roots)) {
  const outfile = path.join(out, `${name}-simulation.mjs`);
  await build({ stdin: { contents: `export { updateGame } from './src/game/simulation.ts';
    export { installNavigationWasm, navigationWasmStatus } from './src/game/navigation-wasm.ts';
    export { courierRouteCacheStats } from './src/game/courier-routes.ts';
    ${name === 'current' ? "export { cityOwnershipStats } from './src/game/city-ownership.ts'; export { cityPlanningStats } from './src/game/governor.ts';" : ''}`, resolveDir: directory },
    bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile });
  const wasm = await readFile(path.join(directory, 'public/wasm/navigation.wasm'));
  artifacts[name] = { bundleSha256: hash(await readFile(outfile)), wasmSha256: hash(wasm) };
  modules[name] = await import(pathToFileURL(outfile).href);
  await modules[name].installNavigationWasm(wasm);
}
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b), percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1) };
};
const totals = state => ({ time: state.time, units: state.units.length, buildings: state.buildings.length, fields: state.fields.length,
  factions: state.factions.map(({ id, population, food, gold, defeated }) => ({ id, population, food, gold, defeated })) });
const delta = (after, before) => Object.fromEntries(Object.keys(after).map(key => [key, typeof after[key] === 'number' && typeof before[key] === 'number' ? after[key] - before[key] : after[key]]));
const report = { methodology: 'Identical saved-state clones, alternating baseline/current order, warmup excluded. Fixed timestep, WASM enabled. Simulation only; excludes rendering. Route selection can differ, so world totals are recorded instead of claiming exact trajectory parity.',
  environment: { node: process.version, cpu: os.cpus()[0]?.model, platform: `${os.platform()} ${os.arch()}`, gc: typeof global.gc === 'function' },
  roots, statePath, stateSha256: hash(raw), artifacts, rounds, frames, warmup, dt, speed, initial: totals(initial), runs: [], pass: false };
const input = { up: false, down: false, left: false, right: false };
for (let round = 0; round < rounds; round++) {
  const order = round % 2 ? ['current', 'baseline'] : ['baseline', 'current'];
  for (const name of order) {
    const state = structuredClone(initial), module = modules[name];
    global.gc?.();
    for (let i = 0; i < warmup; i++) module.updateGame(state, dt, input);
    const start = state.time, navigationBefore = module.navigationWasmStatus(), routesBefore = module.courierRouteCacheStats(state), samples = [];
    for (let i = 0; i < frames; i++) {
      const before = performance.now(); module.updateGame(state, dt, input); samples.push(performance.now() - before);
    }
    if (Math.abs(state.time - start - frames * dt * speed) > 1e-6) throw new Error(`${name} did not advance all measured updates.`);
    if (state.units.some(unit => !Number.isFinite(unit.x) || !Number.isFinite(unit.y))) throw new Error(`${name} produced an invalid unit position.`);
    const run = { round: round + 1, name, order: order.indexOf(name) + 1, updateMs: stats(samples), final: totals(state),
      navigationDelta: delta(module.navigationWasmStatus(), navigationBefore), routesBefore, routesAfter: module.courierRouteCacheStats(state),
      cityOwnership: module.cityOwnershipStats?.(state), cityPlanning: module.cityPlanningStats?.(state), samples };
    report.runs.push(run);
    console.log(`${name} ${round + 1}: ${run.updateMs.mean.toFixed(3)} ms/update; p95 ${run.updateMs.p95.toFixed(3)}; ${state.units.length} units`);
    await writeFile(path.join(out, 'simulation.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
report.summary = Object.fromEntries(['baseline', 'current'].map(name => {
  const runs = report.runs.filter(run => run.name === name);
  return [name, { medianMeanMs: stats(runs.map(run => run.updateMs.mean)).p50, pooledUpdateMs: stats(runs.flatMap(run => run.samples)) }];
}));
report.summary.speedup = report.summary.baseline.medianMeanMs / report.summary.current.medianMeanMs;
report.summary.timeReductionPercent = (1 - 1 / report.summary.speedup) * 100;
report.pass = true;
await writeFile(path.join(out, 'simulation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary, null, 2));
