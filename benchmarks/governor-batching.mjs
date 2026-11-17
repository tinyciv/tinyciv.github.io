import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const before = option('--before'), snapshot = option('--state'), rounds = Number(option('--rounds', '3'));
if (!before || !snapshot) throw new Error('Pass --before frozen-source-directory and --state snapshot.json');
const directory = path.resolve(option('--out', 'scratch/governor-batching'));
await mkdir(directory, { recursive: true });
const engines = {};
for (const [name, root] of [['before', path.resolve(before)], ['after', process.cwd()]]) {
  const outfile = path.join(directory, `${name}.mjs`);
  await build({ stdin: { contents: `export {benchmarkGovernorPass} from './src/game/simulation.ts';
export {palaceWalkingDistances,farmCityQuery} from './src/game/farm-travel.ts';
export {withSimulationReads} from './src/game/simulation-reads.ts';
export {installNavigationWasm} from './src/game/navigation-wasm.ts';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile,
    plugins: [{ name: 'actual-planning-callback', setup(builder) {
      builder.onLoad({ filter: /\/src\/game\/simulation\.ts$/ }, async ({ path: file }) => {
        const source = await readFile(file, 'utf8');
        const callback = source.match(/  runRecurringWork\(state, 'faction-development', dt, \(\) => \{\n([\s\S]*?)^  \}\);/m)?.[1];
        if (!callback) throw new Error(`Cannot find production governor callback in ${file}`);
        return { contents: `${source}\nexport function benchmarkGovernorPass(state: GameState): void { withSimulationReads(state, () => {\n${callback}\n}); }`, loader: 'ts' };
      });
    } }] });
  engines[name] = await import(pathToFileURL(outfile).href);
  await engines[name].installNavigationWasm(await readFile(path.join(root, 'public/wasm/navigation.wasm')));
}
const raw = await readFile(snapshot, 'utf8'), samples = {}, expected = new Map(), parity = [];
for (let round = 0; round < rounds; round++) for (const mode of ['no-op', 'fully-due']) {
  for (const name of round % 2 ? ['after', 'before'] : ['before', 'after']) {
    const engine = engines[name], state = JSON.parse(raw);
    for (const faction of state.factions) { faction.gold = mode === 'no-op' ? 0 : 10000; faction.food = 10000; }
    for (const palace of state.buildings.filter(building => building.kind === 'palace' && building.hp > 0 && !building.construction)) {
      palace.governorNextPlanAt = 0;
      palace.governorPermissions = { farms: mode !== 'no-op', housing: mode !== 'no-op' };
      if (mode !== 'no-op') palace.automaticHouseCredit = 2;
    }
    engine.withSimulationReads(state, () => {
      for (const palace of state.buildings.filter(building => building.kind === 'palace' && building.hp > 0 && !building.construction)) {
        engine.palaceWalkingDistances(state, palace); engine.farmCityQuery(state, palace.faction);
      }
    });
    const count = state.buildings.length, at = performance.now();
    engine.benchmarkGovernorPass(state);
    const elapsed = performance.now() - at;
    (((samples[name] ??= {})[mode] ??= [])).push(elapsed);
    const key = `${round}:${mode}`, result = JSON.parse(JSON.stringify(state));
    if (expected.has(key)) {
      parity.push({ key, equal: isDeepStrictEqual(expected.get(key), result), addedBuildings: state.buildings.length - count });
      expected.delete(key);
    } else expected.set(key, result);
    if (args.includes('--states')) await writeFile(path.join(directory, `${name}-${round}-${mode}.json`), JSON.stringify(result));
  }
}
const statistics = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return { samples: values.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)],
    mean: values.reduce((sum, value) => sum + value, 0) / values.length };
};
const timings = Object.fromEntries(Object.entries(samples).map(([name, modes]) => [name,
  Object.fromEntries(Object.entries(modes).map(([mode, values]) => [mode, statistics(values)]))]));
const report = { method: 'Runs the actual faction-development callback extracted unchanged from each source, with warm travel maps. Alternates engines and verifies the complete serialized resulting state for no-op and fully due/rich governor plans.',
  before: path.resolve(before), snapshot: path.resolve(snapshot), rounds, timings, parity, samples };
await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ timings, parity: parity.every(check => check.equal), comparisons: parity.length, outcomes: parity }, null, 2));
if (parity.some(check => !check.equal)) process.exitCode = 1;
