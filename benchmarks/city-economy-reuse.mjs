import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const baseline = option('--before'), snapshot = option('--state'), output = path.resolve(option('--out', 'scratch/city-economy-reuse'));
if (!baseline || !snapshot) throw Error('Pass --before frozen-source-directory and --state snapshot.json');
await mkdir(output, { recursive: true });
const engines = {};
for (const [name, root] of [['before', path.resolve(baseline)], ['after', process.cwd()]]) {
  const outfile = path.join(output, `${name}.mjs`);
  await build({ stdin: { contents: `export {citySummaries} from './src/game/cities.ts';
export {withCityPlanning} from './src/game/governor.ts';
export {withSimulationReads} from './src/game/simulation-reads.ts';
export {installNavigationWasm} from './src/game/navigation-wasm.ts';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile });
  engines[name] = await import(pathToFileURL(outfile).href);
  await engines[name].installNavigationWasm(await readFile(path.join(root, 'public/wasm/navigation.wasm')));
}
const raw = await readFile(snapshot, 'utf8'), samples = [], expected = new Map();
let comparisons = 0;
for (const mode of ['live', 'scoped']) for (const name of ['before', 'after']) {
  const engine = engines[name], state = JSON.parse(raw);
  const read = () => engine.withSimulationReads(state, () => mode === 'scoped'
    ? engine.withCityPlanning(state, () => engine.citySummaries(state)) : engine.citySummaries(state));
  read(); // Exclude initial topology/index construction.
  const house = state.buildings.find(building => building.kind === 'house' && building.hp > 0 && !building.construction);
  for (let step = 0; step < 24; step++) {
    state.time += 1 / 30;
    if (step % 6 === 0) house.capacity++;
    const start = performance.now(), result = read(), milliseconds = performance.now() - start;
    samples.push({ mode, name, step, milliseconds });
    const values = result.map(({ palace, ...value }) => ({ palace: palace.id, ...value })), key = `${mode}:${step}`;
    if (name === 'before') expected.set(key, values);
    else { if (!isDeepStrictEqual(expected.get(key), values)) throw Error(`Economic mismatch ${key}`); comparisons++; }
  }
}
const timings = {};
for (const mode of ['live', 'scoped']) {
  timings[mode] = {};
  for (const name of ['before', 'after']) {
    const sorted = samples.filter(value => value.mode === mode && value.name === name).map(value => value.milliseconds).sort((a,b) => a-b);
    timings[mode][name] = { meanMs: sorted.reduce((a,b) => a+b, 0)/sorted.length, medianMs: sorted[Math.floor(sorted.length/2)], p95Ms: sorted[Math.floor(sorted.length*.95)] };
  }
}
const report = { method: 'Captured world, native navigation, initial query warmed.24 successive simulation times and4 exact housing capacity edits; live and explicit read-scope queries compared against frozen source. All numeric city outputs must match exactly.', baseline, snapshot, comparisons, timings, samples };
await writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify({ comparisons, timings }));
