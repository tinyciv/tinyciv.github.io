import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// Run without competing benchmarks; --expose-gc makes warmup GC explicit.
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.resolve(root, argument('out', 'scratch/library-simulation-benchmark'));
const baselineRoot = path.resolve(root, argument('baseline', 'scratch/2026-10-30-library-integration/baseline'));
const statePath = path.resolve(root, argument('state', 'scratch/2026-10-29-live-performance/optimization/paused-live-state.json'));
const outputPath = path.join(directory, 'settlement-simulation-benchmark.json');
await mkdir(directory, { recursive: true });
const dt = 1 / 60, speed = 2, warmupUpdates = 60, measuredUpdates = 300, rounds = 3;
const input = { up: false, down: false, left: false, right: false };
const names = ['baseline', 'current'];
const modules = {};
for (const name of names) {
  const outfile = path.join(directory, `simulation-benchmark-${name}.mjs`);
  await build({
    stdin: { contents: "export { updateGame } from './src/game/simulation.ts'; export { installNavigationWasm, navigationWasmStatus } from './src/game/navigation-wasm.ts';",
      resolveDir: name === 'baseline' ? baselineRoot : root },
    bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile,
  });
  modules[name] = await import(pathToFileURL(outfile).href);
}
const wasm = await readFile(path.join(root, 'public/wasm/navigation.wasm'));
for (const name of names) await modules[name].installNavigationWasm(wasm);
const rawState = await readFile(statePath, 'utf8');
const initial = JSON.parse(rawState);
initial.paused = false; initial.speed = speed;
if (initial.gameOver || initial.palaceCaptures?.length) throw new Error('Saved state cannot advance.');

const hash = text => createHash('sha256').update(text).digest('hex');
const canonical = value => {
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonical(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
};
// Match the existing parity check: exclude presentation-only fog memory.
const gameplayDigest = state => {
  const { fog, ...gameplay } = state;
  return hash(JSON.stringify(canonical(gameplay)));
};
const quantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};
const timings = { baseline: [], current: [] };
const report = {
  methodology: 'Fresh identical saved-state clones; 60 warmup then 300 timed updateGame calls; three rounds with alternating baseline/current order. Same WASM navigation backend. Cloning, explicit pre-warmup GC, checksums and all presentation work excluded from timings.',
  node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
  baselineRoot, currentRoot: root, statePath, stateSha256: hash(rawState), navigationWasmSha256: hash(wasm),
  dt, speed, warmupUpdates, measuredUpdates, rounds, explicitPreWarmupGc: typeof global.gc === 'function',
  initial: { time: initial.time, units: initial.units.length, buildings: initial.buildings.length, fields: initial.fields?.length },
  runs: [], parity: true,
};

for (let round = 0; round < rounds; round++) {
  const order = round % 2 ? [...names].reverse() : names;
  const digests = {};
  for (const name of order) {
    const state = structuredClone(initial), module = modules[name];
    global.gc?.();
    for (let frame = 0; frame < warmupUpdates; frame++) module.updateGame(state, dt, input);
    const samples = new Float64Array(measuredUpdates), startTime = state.time;
    const started = performance.now();
    for (let frame = 0; frame < measuredUpdates; frame++) {
      const start = performance.now();
      module.updateGame(state, dt, input);
      samples[frame] = performance.now() - start;
    }
    const elapsedMs = performance.now() - started;
    if (Math.abs(state.time - startTime - measuredUpdates * dt * speed) > 1e-6)
      throw new Error(`${name} stopped advancing during round ${round + 1}.`);
    const digest = gameplayDigest(state);
    digests[name] = digest;
    timings[name].push(elapsedMs);
    const run = { round: round + 1, name, position: order.indexOf(name) + 1, elapsedMs,
      meanUpdateMs: elapsedMs / measuredUpdates, p50UpdateMs: quantile(samples, .5), p95UpdateMs: quantile(samples, .95),
      gameplaySha256: digest, finalTime: state.time, units: state.units.length, buildings: state.buildings.length,
      fields: state.fields?.length, navigation: module.navigationWasmStatus() };
    report.runs.push(run);
    console.log(`${name} round ${round + 1}: ${elapsedMs.toFixed(2)} ms total; ${(elapsedMs / measuredUpdates).toFixed(3)} ms/update; p50 ${run.p50UpdateMs.toFixed(3)}; p95 ${run.p95UpdateMs.toFixed(3)}`);
  }
  const same = digests.baseline === digests.current;
  report.parity &&= same;
  console.log(`Round ${round + 1} final gameplay digest parity: ${same ? 'PASS' : 'FAIL'}`);
}
report.summary = Object.fromEntries(names.map(name => [name, {
  roundTotalMs: timings[name], medianTotalMs: quantile(timings[name], .5),
  medianMeanUpdateMs: quantile(timings[name], .5) / measuredUpdates,
}]));
report.summary.speedup = report.summary.baseline.medianTotalMs / report.summary.current.medianTotalMs;
report.summary.timeReductionPercent = (1 - report.summary.current.medianTotalMs / report.summary.baseline.medianTotalMs) * 100;
report.repeatedGameplayParity = new Set(report.runs.map(run => run.gameplaySha256)).size === 1;
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ summary: report.summary, parity: report.parity, repeatedGameplayParity: report.repeatedGameplayParity, outputPath }, null, 2));
if (!report.parity || !report.repeatedGameplayParity) process.exitCode = 1;
