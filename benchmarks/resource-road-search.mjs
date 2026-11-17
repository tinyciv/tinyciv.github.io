// Exact route/goal comparison and CPU timing on captured resource sites.
// --before points to a source checkout; the current checkout is the candidate.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import os from 'node:os';
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = path.resolve(arg('out', 'scratch/resource-road-search'));
const before = arg('before', undefined), rounds = Number(arg('rounds', '3'));
const source = await readFile(arg('state', '/tmp/btv-smooth-2026-11-08/state.json'), 'utf8');
await mkdir(out, { recursive: true });
const engines = {};
for (const [name, root] of Object.entries({ ...(before ? { before: path.resolve(before) } : {}), after: process.cwd() })) {
  const outfile = path.join(out, `${name}.mjs`);
  await build({ stdin: { resolveDir: root, contents: `
    export {planResourceRoad} from './src/game/resource-roads.ts';
    export {withSimulationReads} from './src/game/simulation-reads.ts';` },
    bundle: true, platform: 'node', format: 'esm', outfile });
  engines[name] = await import(pathToFileURL(outfile).href);
}
const samples = {}, outcomes = {}, parity = [];
for (let round = 0; round < rounds; round++) {
  for (const name of round % 2 ? Object.keys(engines).reverse() : Object.keys(engines)) {
    const state = JSON.parse(source), engine = engines[name];
    for (const trusted of [false, true]) for (const site of state.resourceWorkSites ?? []) {
      const start = performance.now();
      const query = () => engine.planResourceRoad(state, site.faction, site.cells, site.resource);
      const journey = trusted ? engine.withSimulationReads(state, query) : query();
      const key = `${trusted ? 'gameplay' : 'public'}:${site.id}`;
      ((samples[name] ??= {})[key] ??= []).push(performance.now() - start);
      outcomes[`${name}:${round}:${key}`] = journey;
    }
  }
}
if (before) for (const key of Object.keys(outcomes).filter(key => key.startsWith('before:'))) {
  const query = key.slice('before:'.length);
  parity.push({ query, equal: isDeepStrictEqual(outcomes[key], outcomes[`after:${query}`]) });
}
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { meanMs: values.reduce((a, b) => a + b, 0) / values.length,
    medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1) };
};
const report = { method: 'Alternating exact resource-road route, endpoint and home comparisons, public and trusted gameplay queries, on all captured resource sites. Cold terrain preparation is included in the first public query.',
  cpu: os.cpus()[0]?.model, node: process.version,
  rounds, timings: Object.fromEntries(Object.entries(samples).map(([name, queries]) =>
    [name, Object.fromEntries(Object.entries(queries).map(([query, values]) => [query, summary(values)]))])), parity };
await writeFile(path.join(out, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (parity.some(check => !check.equal)) process.exitCode = 1;
