import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const before = option('--before'), snapshot = option('--state'), dragFile = option('--drag'), rounds = Number(option('--rounds', '2'));
if (!before || !snapshot || !dragFile) throw new Error('Pass --before frozen source, --state snapshot.json and --drag browser-report.json');
const directory = path.resolve(option('--out', 'scratch/construction-drag'));
await mkdir(directory, { recursive: true });
const engines = {};
for (const [name, root] of [['before', path.resolve(before)], ['after', process.cwd()]]) {
  const outfile = path.join(directory, `${name}.mjs`);
  await build({ stdin: { contents: `export {constructionRoute} from './src/game/construction-route.ts';
export {planConstruction,buildStroke} from './src/game/construction.ts';
export {palaceWalkingDistances,farmCityQuery} from './src/game/farm-travel.ts';
export {territory} from './src/game/borders.ts';
export {entityStore} from './src/game/entity-store.ts';
export {markWorldChanged} from './src/game/world-revisions.ts';
export {installNavigationWasm,navigationWasmStatus} from './src/game/navigation-wasm.ts';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile });
  engines[name] = await import(pathToFileURL(outfile).href);
  await engines[name].installNavigationWasm(await readFile(path.join(root, 'public/wasm/navigation.wasm')));
}
const raw = await readFile(snapshot, 'utf8'), setup = JSON.parse(await readFile(dragFile, 'utf8')).dragSetup;
const samples = {}, expected = new Map(), parity = [], kernels = [];
const record = (name, task, ms) => (((samples[name] ??= {})[task] ??= [])).push(ms);
for (let round = 0; round < rounds; round++) for (const name of round % 2 ? ['after', 'before'] : ['before', 'after']) {
  const engine = engines[name], state = JSON.parse(raw), faction = setup.faction;
  engine.territory(state);
  for (const palace of state.buildings.filter(building => building.kind === 'palace' && building.faction === faction && building.hp > 0 && !building.construction))
    engine.palaceWalkingDistances(state, palace);
  engine.farmCityQuery(state, faction);
  // Ordinary live paving defers farming cost maps in the real simulation.
  const source = state.buildings.find(building => building.kind === 'road' && building.faction === faction);
  engine.entityStore(state).buildings.add({ ...source, id: 10000000, x: 0, y: 0 });
  engine.markWorldChanged(state.world);
  const initial = engine.navigationWasmStatus();
  let route, plan;
  const quotes = [];
  for (let pass = 0; pass < 2; pass++) for (const end of setup.endpoints) {
    state.time += .1; state.factions.find(owner => owner.id === faction).gold += .1;
    state.world.tiles[0].variation += .0001;
    engine.markWorldChanged(state.world, 'appearance', [0]);
    const at = performance.now();
    route = engine.constructionRoute(state, setup.kind ?? 'road', setup.start, end);
    plan = engine.planConstruction(state, 'road', route);
    record(name, pass ? 'repeatEndpoints' : 'changingEndpoints', performance.now() - at);
    quotes.push({ route, plan });
  }
  const at = performance.now(), result = engine.buildStroke(state, 'road', route);
  record(name, 'commit', performance.now() - at);
  const status = engine.navigationWasmStatus();
  kernels.push({ name, round, instances: status.instances - initial.instances, travelMaps: status.travelMaps - initial.travelMaps, nearestMaps: status.nearestMaps - initial.nearestMaps });
  const outcome = { quotes, result, gold: state.factions.map(owner => owner.gold),
    farms: state.buildings.filter(building => building.kind === 'camp').map(building => [building.id, building.x, building.y]),
    fields: state.fields.map(field => [field.id, field.camp, field.x, field.y, field.food]),
    roads: state.buildings.filter(building => building.kind === 'road').map(building => [building.id, building.x, building.y, building.construction]) };
  if (expected.has(round)) { parity.push({ round, equal: isDeepStrictEqual(expected.get(round), outcome) }); expected.delete(round); }
  else expected.set(round, outcome);
  await writeFile(path.join(directory, `${name}-${round}.json`), JSON.stringify(outcome));
}
const stats = values => { const sorted = values.toSorted((a, b) => a - b); return { samples: values.length,
  median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)], mean: values.reduce((a, b) => a + b, 0) / values.length }; };
const timings = Object.fromEntries(Object.entries(samples).map(([name, tasks]) => [name,
  Object.fromEntries(Object.entries(tasks).map(([task, values]) => [task, stats(values)]))]));
const report = { method: 'Recorded browser drag coordinates on the captured384x308 world, alternating frozen/current engines with native navigation. Simulates routine deferred paving, cosmetic changes and changing treasury on every pointer move. Compares every quote and final committed farms/fields/roads/gold.', before, snapshot, dragFile, rounds, timings, kernels, parity };
await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (parity.some(value => !value.equal)) process.exitCode = 1;
