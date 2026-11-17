import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const directory = path.resolve(option('--out', 'scratch/builder-entrance-search'));
const snapshot = option('--state'), rounds = Number(option('--rounds', '3'));
if (!snapshot) throw Error('Supply --state with the captured game JSON.');
await mkdir(directory, { recursive: true });
const bundle = path.join(directory, 'engine.mjs');
await build({ stdin: { contents: `export { constructionEdges } from './src/game/builders.ts';
export { findPath, findShortestPathBetween, movementMultiplier, withNavigationFrame, workNavigationState } from './src/game/pathfinding.ts';
export { withSimulationReads } from './src/game/simulation-reads.ts';
export { installNavigationWasm, navigationWasmStatus } from './src/game/navigation-wasm.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', outfile: bundle });
const engine = await import(pathToFileURL(bundle).href);
await engine.installNavigationWasm(Uint8Array.from(await readFile('public/wasm/navigation.wasm')));
const state = JSON.parse(await readFile(snapshot, 'utf8')), rows = [];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cost = (from, route) => {
  let sum = 0;
  for (const point of route) {
    sum += distance(from, point) * (1 / engine.movementMultiplier(state, from.x, from.y)
      + 1 / engine.movementMultiplier(state, point.x, point.y)) / 2;
    from = point;
  }
  return sum;
};
engine.withSimulationReads(state, () => engine.withNavigationFrame(state, () => {
  const navigation = engine.workNavigationState(state, true);
  const cities = state.buildings.filter(building => building.kind === 'palace' && building.hp > 0 && !building.construction
    && state.factions.some(faction => faction.id === building.faction && !faction.defeated));
  const sites = state.buildings.filter(building => building.hp > 0 && building.construction
    && cities.some(city => city.faction === building.faction));
  const cases = cities.flatMap(city => sites.filter(site => site.faction === city.faction).map(site => ({ city, site,
    origins: engine.constructionEdges(navigation, city, true), goals: engine.constructionEdges(navigation, site, true) })));
  // Warm each live navigation layer, excluding topology initialization from
  // the comparison of equivalent route selection algorithms.
  for (const test of cases) engine.findShortestPathBetween(navigation, test.origins, test.goals, test.city.faction, true);
  for (let round = 0; round < rounds; round++) for (const test of cases) {
    const outcomes = {};
    const candidates = test.origins.flatMap(from => test.goals.map(to => ({ from, to, lowerBound: distance(from, to) / 1.5 })))
      .sort((a, b) => a.lowerBound - b.lowerBound);
    for (const method of round % 2 ? ['shared', 'pairs'] : ['pairs', 'shared']) {
      const before = engine.navigationWasmStatus().searches, at = performance.now();
      let result;
      if (method === 'shared') result = engine.findShortestPathBetween(navigation, test.origins, test.goals, test.city.faction, true);
      else for (const candidate of candidates) {
        if (result && candidate.lowerBound > result.cost + 1e-8) break;
        const route = engine.findPath(navigation, candidate.from, candidate.to, test.city.faction, false, undefined, undefined, undefined, false, true);
        if (!route.length && distance(candidate.from, candidate.to) > .12) continue;
        const score = cost(candidate.from, route);
        if (!result || score < result.cost - 1e-8) result = { cost: score };
      }
      rows.push({ round, city: test.city.id, site: test.site.id, method, ms: performance.now() - at,
        searches: engine.navigationWasmStatus().searches - before, cost: result?.cost ?? null });
      outcomes[method] = result?.cost ?? null;
    }
    if (outcomes.pairs !== outcomes.shared && (outcomes.pairs === null || outcomes.shared === null || Math.abs(outcomes.pairs - outcomes.shared) > 1e-7))
      throw Error(`Route-cost mismatch for ${test.city.id} -> ${test.site.id}: ${JSON.stringify(outcomes)}`);
  }
}));
const stats = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
};
const timings = Object.fromEntries(['pairs', 'shared'].map(method => {
  const selected = rows.filter(row => row.method === method);
  return [method, { ms: stats(selected.map(row => row.ms)), searches: stats(selected.map(row => row.searches)) }];
}));
const report = { method: 'Alternating exact weighted entrance/working-side queries on live pending sites, warm navigation, native backend. All origin/target pairs retain original lower-bound pruning. Multi-source search preserves minimum route cost; equal-cost endpoint/path ties may differ deterministically.', snapshot, rounds,
  comparisons: rows.length / 2, parity: true, timings, rows };
await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ comparisons: report.comparisons, parity: report.parity, timings }, null, 2));
