import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const before = option('--before'), snapshot = option('--state'), rounds = Number(option('--rounds', '3'));
if (!before || !snapshot) throw new Error('Pass --before frozen-source-directory and --state snapshot.json');
const directory = path.resolve(option('--out', 'scratch/farm-enclosure-refresh'));
await mkdir(directory, { recursive: true });
const engines = {};
for (const [name, root] of [['before', path.resolve(before)], ['after', process.cwd()]]) {
  const outfile = path.join(directory, `${name}.mjs`);
  await build({ stdin: { contents: `export {palaceEnclosures} from './src/game/enclosures.ts';
export {terrainNavigationEdges,invalidateNavigation} from './src/game/pathfinding.ts';
export {farmCityQuery,farmTravelRevision} from './src/game/farm-travel.ts';
export {withSimulationReads} from './src/game/simulation-reads.ts';
export {markWorldChanged} from './src/game/world-revisions.ts';
export {installNavigationWasm,navigationWasmStatus} from './src/game/navigation-wasm.ts';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile });
  engines[name] = await import(pathToFileURL(outfile).href);
  await engines[name].installNavigationWasm(await readFile(path.join(root, 'public/wasm/navigation.wasm')));
}
const raw = await readFile(snapshot, 'utf8'), samples = {}, results = new Map(), parity = [];
const record = (name, task, elapsed) => ((samples[name] ??= {})[task] ??= []).push(elapsed);
const compare = (name, key, value) => {
  if (results.has(key)) parity.push({ key, equal: isDeepStrictEqual(results.get(key), value) });
  else results.set(key, value);
};
for (let round = 0; round < rounds; round++) for (const name of round % 2 ? ['after', 'before'] : ['before', 'after']) {
  const engine = engines[name], state = JSON.parse(raw);
  engine.withSimulationReads(state, () => {
    engine.terrainNavigationEdges(state.world);
    const walls = state.buildings.filter(building => ['wall', 'palisade'].includes(building.kind) && building.hp > 0 && !building.construction);
    const selected = [0, .25, .5, .75].map(fraction => walls[Math.floor(walls.length * fraction)]).filter(Boolean);
    for (let edit = 0; edit < selected.length * 2 + 1; edit++) {
      if (edit) {
        const wall = selected[Math.floor((edit - 1) / 2)];
        if (edit % 2) { wall.benchmarkOriginalHp = wall.hp; wall.hp = 0; }
        else { wall.hp = wall.benchmarkOriginalHp; delete wall.benchmarkOriginalHp; }
        engine.invalidateNavigation(state);
      }
      const at = performance.now(), result = engine.palaceEnclosures(state, true);
      record(name, 'enclosureRebuildMs', performance.now() - at);
      compare(name, `${round}:enclosure:${edit}`, { regions: result.regions, cells: result.cells });
    }
    const farms = state.buildings.filter(building => building.kind === 'camp' && building.hp > 0);
    const factions = [...new Set(farms.map(farm => farm.faction))];
    const ownership = () => {
      const queries = new Map(factions.map(faction => [faction, engine.farmCityQuery(state, faction)]));
      return farms.map(farm => [farm.id, queries.get(farm.faction)(farm)?.id]);
    };
    ownership();
    for (let edit = 0; edit < 3; edit++) {
      const cell = farms[edit] ? farms[edit].y * state.world.width + farms[edit].x : edit;
      state.world.tiles[cell].variation += .0001;
      engine.markWorldChanged(state.world, 'appearance', [cell]);
      const at = performance.now(), owners = ownership();
      record(name, 'cosmeticFarmRefreshMs', performance.now() - at);
      compare(name, `${round}:farm:${edit}`, owners);
    }
  });
}
const statistics = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return { samples: values.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)],
    mean: values.reduce((sum, value) => sum + value, 0) / values.length };
};
const timings = Object.fromEntries(Object.entries(samples).map(([name, tasks]) => [name,
  Object.fromEntries(Object.entries(tasks).map(([task, values]) => [task, statistics(values)]))]));
const report = { method: 'Alternating frozen/current engines on the captured state, with native navigation and warm terrain. Compares exact enclosure cells after four wall breaches/restorations and exact farm-city assignments after cosmetic tile changes.',
  before: path.resolve(before), snapshot: path.resolve(snapshot), rounds, timings, parity, samples };
await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ timings, parity: parity.every(check => check.equal), comparisons: parity.length }, null, 2));
if (parity.some(check => !check.equal)) process.exitCode = 1;
