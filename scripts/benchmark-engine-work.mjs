import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';
import path from 'node:path';

// A captured world exercises all cities, villages and research prerequisites.
// Run serially with other benchmarks idle; timing is diagnostic, parity is exact.
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const directory = path.resolve(option('--out', 'scratch/engine-work'));
const snapshot = option('--snapshot', 'scratch/2026-11-04-levy-optimization/btv-levy-live-state.json');
const beforePath = option('--before', 'scratch/2026-11-04-engine-redesign/before.mjs');
const candidate = option('--candidate', undefined);
const steps = Number(option('--steps', '360')), warm = Number(option('--warm', '30'));
const rounds = Number(option('--rounds', '2'));
await mkdir(directory, { recursive: true });
const afterPath = candidate ? path.resolve(candidate) : path.join(directory, 'after.mjs');
if (!candidate) await build({ stdin: { contents: `export {updateGame} from './src/game/simulation.ts'; export {installNavigationWasm} from './src/game/navigation-wasm.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', outfile: afterPath, sourcemap: 'external' });
const engines = { before: await import(pathToFileURL(path.resolve(beforePath)).href), after: await import(pathToFileURL(afterPath).href) };
const wasm = await readFile('public/wasm/navigation.wasm');
for (const engine of Object.values(engines)) await engine.installNavigationWasm(wasm);
const raw = await readFile(snapshot, 'utf8'), input = { up: false, down: false, left: false, right: false };
const initial = () => { const state = JSON.parse(raw); state.paused = false; return state; };
const samples = { before: [], after: [] }, checkpoints = new Map();
function differences(a, b, key = '$', result = []) {
  if (isDeepStrictEqual(a, b) || result.length >= 12) return result;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const property of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[property], b[property], `${key}.${property}`, result);
  } else result.push({ key, before: a, after: b });
  return result;
}
const parity = [];
for (let round = 0; round < rounds; round++) {
  for (const name of round % 2 ? ['after', 'before'] : ['before', 'after']) {
    const state = initial(), engine = engines[name];
    for (let step = 1; step <= warm + steps; step++) {
      const start = performance.now(); engine.updateGame(state, 1 / 30, input);
      if (step > warm) samples[name].push(performance.now() - start);
      if (round === 0 && (step === 1 || step === warm || step === warm + steps || step % 120 === 0)) {
        const value = JSON.parse(JSON.stringify(state));
        if (name === 'before') checkpoints.set(step, value);
        else parity.push({ step, equal: isDeepStrictEqual(checkpoints.get(step), value), differences: differences(checkpoints.get(step), value) });
      }
      if (step % 30 === 0) await new Promise(resolve => setImmediate(resolve));
    }
  }
}
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
};
const report = { method: 'Simulation-only, navigation WASM enabled, alternating isolated replay order. Wall-clock CPU timings include normal GC, no profiler. Full serialized-state parity includes fog. No rendering/HUD or live FPS measurement.',
  cpu: os.cpus()[0].model, candidate: candidate ?? 'current source', snapshotSha256: createHash('sha256').update(raw).digest('hex'), warm, steps, rounds,
  initial: { units: initial().units.length, buildings: initial().buildings.length, fields: initial().fields.length },
  updateMs: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, stats(values)])), parity };
report.speedup = report.updateMs.before.mean / report.updateMs.after.mean;
await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (parity.some(check => !check.equal)) process.exitCode = 1;
