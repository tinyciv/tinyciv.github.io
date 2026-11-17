import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const snapshot = option('--state'), before = option('--before'), directory = path.resolve(option('--out', 'scratch/resource-road-cursor'));
const rounds = Number(option('--rounds', '2'));
if (!snapshot || !before) throw Error('Supply --state and --before source directory.');
await mkdir(directory, { recursive: true });
const engines = {};
for (const [name, root] of [['before', path.resolve(before)], ['after', process.cwd()]]) {
  const file = path.join(directory, `${name}.mjs`);
  await build({ stdin: { contents: `export * from './src/game/resource-roads.ts';
export {withSimulationReads} from './src/game/simulation-reads.ts';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: file });
  engines[name] = await import(pathToFileURL(file).href);
}
const raw = await readFile(snapshot, 'utf8'), states = { before: JSON.parse(raw), after: JSON.parse(raw) };
const cases = states.before.resourceWorkSites.flatMap(site => engines.before.resourceRoadOrigins(states.before, site.faction, site.cells)
  .map(city => ({ site: site.id, city: city.id })));
// Warm topology and the reusable workspace before timing steady searches.
for (const [name, engine] of Object.entries(engines)) engine.withSimulationReads(states[name], () => {
  for (const pair of cases) {
    const site = states[name].resourceWorkSites.find(site => site.id === pair.site), city = states[name].buildings.find(city => city.id === pair.city);
    engine.resourceRoadJourney(states[name], city, site.cells, site.resource);
  }
});
const rows = [], parity = [];
for (let round = 0; round < rounds; round++) for (const pair of cases) {
  const outcomes = {};
  for (const name of round % 2 ? ['after', 'before'] : ['before', 'after']) {
    const engine = engines[name], state = states[name], site = state.resourceWorkSites.find(site => site.id === pair.site), city = state.buildings.find(city => city.id === pair.city);
    if (name === 'before') {
      const at = performance.now();
      outcomes[name] = engine.withSimulationReads(state, () => engine.resourceRoadJourney(state, city, site.cells, site.resource));
      rows.push({ round, ...pair, method: name, ms: performance.now() - at, found: !!outcomes[name] });
    } else {
      const cursor = engine.createResourceRoadCursor(state, city, site.cells, site.resource);
      let result, turn = 0;
      do {
        const at = performance.now();
        result = engine.withSimulationReads(state, () => cursor.advance(1024, 64, 'unchanged'));
        rows.push({ round, ...pair, method: name, turn: turn++, ms: performance.now() - at,
          pops: result.expansions, validations: result.validations, done: result.done });
        if (turn > 1000) throw Error('Cursor did not finish.');
      } while (!result.done);
      cursor.cancel(); outcomes[name] = result.journey;
    }
  }
  parity.push({ round, ...pair, equal: isDeepStrictEqual(outcomes.before, outcomes.after) });
}
const stats = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
};
const timings = Object.fromEntries(['before', 'after'].map(method => [method, stats(rows.filter(row => row.method === method).map(row => row.ms))]));
const report = { method: 'Warm actual-world resource origins. Frozen synchronous searches versus1024-pop/64-network-check cursor turns; alternated order. Exact journey/corridor equality under static state. Cursor initialization included; site/territory context outside the road routine excluded.',
  snapshot, before, rounds, comparisons: parity.length, parity: parity.every(row => row.equal), timings, rows };
await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ comparisons: report.comparisons, parity: report.parity, timings }, null, 2));
if (!report.parity) process.exitCode = 1;
