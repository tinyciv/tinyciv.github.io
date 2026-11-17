import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const baseline = option('--before'), snapshot = option('--state'), output = path.resolve(option('--out', 'scratch/territory-footprints'));
if (!baseline || !snapshot) throw new Error('Pass --before frozen-source-directory and --state snapshot.json');
await mkdir(output, { recursive: true });
const engines = {};
for (const [name, root] of [['before', path.resolve(baseline)], ['after', process.cwd()]]) {
  const outfile = path.join(output, `${name}.mjs`);
  await build({ stdin: { contents: `export {territory} from './src/game/borders.ts';
export {entityStore} from './src/game/entity-store.ts';
export {markWorldChanged} from './src/game/world-revisions.ts';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile });
  engines[name] = await import(pathToFileURL(outfile).href);
}
const raw = await readFile(snapshot, 'utf8'), samples = { before: [], after: [] }, expected = new Map(), parity = [];
const view = result => ({ owners: result.owners, sources: result.sourceIds, alternates: result.alternateOwners,
  alternateSources: result.alternateSourceIds, radii: [...result.sourceRadii], edges: result.edges, paths: result.paths });
for (let round = 0; round < 3; round++) for (const name of round % 2 ? ['after', 'before'] : ['before', 'after']) {
  const engine = engines[name], state = JSON.parse(raw);
  engine.territory(state);
  const house = state.buildings.find(building => building.kind === 'house' && building.hp > 0 && !building.construction);
  let nextId = Math.max(...state.buildings.map(building => building.id)) + 1;
  const mutations = [
    () => engine.entityStore(state).buildings.add({ ...house, id: nextId++, x: house.x + 1 }),
    () => engine.entityStore(state).buildings.add({ ...house, id: nextId++, y: house.y + 1 }),
    () => { const cell = house.y * state.world.width + house.x + 2;
      state.world.tiles[cell].overlay = state.world.tiles[cell].overlay === 'forest' ? 'none' : 'forest';
      engine.markWorldChanged(state.world, 'sight', [cell]); },
    () => engine.entityStore(state).buildings.add({ ...house, id: nextId++, x: house.x - 1 }),
    () => { state.buildings.find(building => building.id === nextId - 1).faction = state.factions.find(faction => faction.id >= 0 && faction.id !== house.faction).id; },
    () => engine.entityStore(state).buildings.retain(building => building.id !== nextId - 2),
  ];
  for (let step = 0; step < mutations.length; step++) {
    mutations[step]();
    const start = performance.now(), result = engine.territory(state), milliseconds = performance.now() - start;
    samples[name].push({ round, step, milliseconds });
    const key = `${round}:${step}`, previous = expected.get(key), current = view(result);
    if (previous) parity.push({ round, step, equal: isDeepStrictEqual(previous, current) });
    else expected.set(key, current);
  }
}
const stats = values => {
  const sorted = values.map(value => value.milliseconds).sort((a, b) => a - b);
  return { samples: sorted.length, meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)] };
};
const report = { method: 'Alternating frozen/current engines on the captured world after warming initial territory. Six successive house addition, local cover, ownership and removal edits per round. Exact owners, source/alternate winners, radii, edges and rounded paths compared after every mutation. No rendering or approximation.',
  snapshot, baseline, cpu: os.cpus()[0].model, timings: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, stats(values)])), parity, samples };
await writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ timings: report.timings, comparisons: parity.length, allEqual: parity.every(value => value.equal) }));
