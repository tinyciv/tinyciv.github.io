import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run without competing tests/benchmarks. Example:
// node --expose-gc scripts/benchmark-decision-scheduling.mjs --baseline=/tmp/btv-before --out=/tmp/btv-decisions
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = argument('baseline');
if (!baseline) throw new Error('Required: --baseline=/absolute/path/to/source-snapshot');
const roots = { baseline: path.resolve(root, baseline), current: path.resolve(root, argument('current', root)) };
const directory = path.resolve(root, argument('out', 'scratch/decision-scheduling-benchmark'));
const statePath = path.resolve(root, argument('state', 'scratch/2026-10-29-live-performance/optimization/paused-live-state.json'));
const scenes = argument('scenarios', 'settlement,idle-600,combat-600').split(',');
assert(scenes.length > 0 && new Set(scenes).size === scenes.length, 'Choose distinct scenarios.');
for (const scene of scenes) assert(/^(settlement|(idle|combat)-(100|300|600))$/.test(scene), `Unknown scenario: ${scene}`);
const dt = 1 / 60, warmupUpdates = 60, measuredUpdates = 300, rounds = 3;
const input = { up: false, down: false, left: false, right: false };
const names = ['baseline', 'current'], modules = {};
await mkdir(directory, { recursive: true });
for (const name of names) {
  const outfile = path.join(directory, `decision-scheduling-${name}.mjs`);
  await build({
    stdin: { contents: `export { updateGame } from './src/game/simulation.ts';
      export { installNavigationWasm, navigationWasmStatus } from './src/game/navigation-wasm.ts';
      export { createPerformanceScenario, summarizePerformanceState } from './dev/performance/scenarios.ts';
      ${existsSync(path.join(roots[name], 'src/game/courier-routes.ts')) ? "export { courierRouteCacheStats } from './src/game/courier-routes.ts';" : ''}`, resolveDir: roots[name] },
    bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile,
  });
  modules[name] = await import(pathToFileURL(outfile).href);
}
const wasm = await readFile(path.join(roots.current, 'public/wasm/navigation.wasm'));
for (const name of names) await modules[name].installNavigationWasm(wasm);
const savedText = scenes.includes('settlement') ? await readFile(statePath, 'utf8') : undefined;
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => {
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonical(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
};
const gameplayDigest = state => {
  const { fog, ...gameplay } = state; // Fog memory is presentation state.
  return hash(JSON.stringify(canonical(gameplay)));
};
const quantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const outputPath = path.join(directory, 'decision-scheduling-benchmark.json');
const report = {
  methodology: 'Identical initial states; 60 warmup then 300 timed updateGame calls per round, three alternating baseline/current rounds. Settlement runs at 2x; deterministic idle/combat fixtures run at 1x. Same WASM bytes. Cloning, explicit pre-warmup GC, checksums and presentation are outside timings. Exact advancement and deterministic repetitions are required separately for each variant; final baseline/current parity is intentionally not required after changing decision timing or route selection. Optional courier counters include warmup.',
  node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
  roots, statePath: savedText === undefined ? undefined : statePath,
  stateSha256: savedText === undefined ? undefined : hash(savedText), navigationWasmSha256: hash(wasm),
  dt, warmupUpdates, measuredUpdates, rounds, explicitPreWarmupGc: typeof global.gc === 'function',
  scenes: {}, errors: [], pass: false,
};

try {
  for (const scene of scenes) {
    const speed = scene === 'settlement' ? 2 : 1, initial = {}, digests = {}, samples = { baseline: [], current: [] };
    for (const name of names) {
      initial[name] = scene === 'settlement' ? JSON.parse(savedText) : modules[name].createPerformanceScenario(scene).state;
      initial[name].paused = false; initial[name].speed = speed;
      assert(!initial[name].gameOver && !initial[name].palaceCaptures?.length, `${scene}/${name} cannot advance.`);
      digests[name] = gameplayDigest(initial[name]);
    }
    assert.equal(digests.baseline, digests.current, `${scene} initial fixtures differ.`);
    const result = report.scenes[scene] = { speed, initial: modules.baseline.summarizePerformanceState(initial.baseline),
      initialGameplaySha256: digests.baseline, runs: [], deterministic: {} };
    const repeated = {};
    for (let round = 0; round < rounds; round++) {
      const order = round % 2 ? [...names].reverse() : names;
      for (const name of order) {
        const state = structuredClone(initial[name]), module = modules[name];
        const initialHp = new Map(state.units.map(unit => [unit.id, unit.hp]));
        global.gc?.();
        for (let frame = 0; frame < warmupUpdates; frame++) module.updateGame(state, dt, input);
        assert(!state.gameOver, `${scene}/${name} ended during warmup.`);
        assert(Math.abs(state.time - initial[name].time - warmupUpdates * dt * speed) < 1e-6, `${scene}/${name} warmup time drifted.`);
        const timings = new Float64Array(measuredUpdates), startTime = state.time, started = performance.now();
        for (let frame = 0; frame < measuredUpdates; frame++) {
          const before = performance.now();
          module.updateGame(state, dt, input);
          timings[frame] = performance.now() - before;
        }
        const elapsedMs = performance.now() - started;
        assert(!state.gameOver, `${scene}/${name} ended during round ${round + 1}.`);
        assert(Math.abs(state.time - startTime - measuredUpdates * dt * speed) < 1e-6, `${scene}/${name} measured time drifted.`);
        const gameplaySha256 = gameplayDigest(state), final = module.summarizePerformanceState(state);
        const finalHp = new Map(state.units.map(unit => [unit.id, unit.hp]));
        const healthLost = [...initialHp].reduce((sum, [id, hp]) => sum + Math.max(0, hp - (finalHp.get(id) ?? 0)), 0);
        const run = { round: round + 1, name, position: order.indexOf(name) + 1, elapsedMs,
          meanUpdateMs: mean(timings), p50UpdateMs: quantile(timings, .5), p95UpdateMs: quantile(timings, .95),
          gameplaySha256, ...final, healthLost, navigation: module.navigationWasmStatus(), courierRoutes: module.courierRouteCacheStats?.(state) };
        result.runs.push(run); samples[name].push(...timings);
        repeated[name] ??= gameplaySha256;
        result.deterministic[name] = gameplaySha256 === repeated[name];
        await writeFile(outputPath, JSON.stringify(report, null, 2));
        assert(result.deterministic[name], `${scene}/${name} repeated gameplay differs in round ${round + 1}.`);
        console.log(`${scene} ${name} round ${round + 1}: mean ${run.meanUpdateMs.toFixed(3)} ms; p50 ${run.p50UpdateMs.toFixed(3)}; p95 ${run.p95UpdateMs.toFixed(3)}; moving ${final.movingUnits}; fighting ${final.engagedUnits}; HP lost ${healthLost.toFixed(1)}`);
      }
    }
    result.summary = Object.fromEntries(names.map(name => [name, {
      meanUpdateMs: mean(samples[name]), p50UpdateMs: quantile(samples[name], .5), p95UpdateMs: quantile(samples[name], .95),
      medianMeanUpdateMs: quantile(result.runs.filter(run => run.name === name).map(run => run.meanUpdateMs), .5),
    }]));
    result.summary.medianSpeedup = result.summary.baseline.medianMeanUpdateMs / result.summary.current.medianMeanUpdateMs;
    result.summary.timeReductionPercent = (1 - 1 / result.summary.medianSpeedup) * 100;
    console.log(JSON.stringify({ scene, ...result.summary }, null, 2));
  }
  report.pass = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
  console.error(error);
} finally {
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(`Benchmark ${report.pass ? 'PASS' : 'FAIL'}: ${outputPath}`);
}
