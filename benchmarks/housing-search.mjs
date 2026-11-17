import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const directory = path.resolve(option('--out', 'scratch/housing-search')), before = option('--before'), snapshot = option('--state');
const rounds = Number(option('--rounds', '3'));
await mkdir(directory, { recursive: true });
const after = path.join(directory, 'after.mjs');
await build({ stdin: { contents: `export {planHouseSite} from './src/game/housing.ts';
export {palaceReachability} from './src/game/placement.ts';
export {palaceEnclosures} from './src/game/enclosures.ts';
export {palaceWalkingDistances} from './src/game/farm-travel.ts';
export {withSimulationReads} from './src/game/simulation-reads.ts';
export {buildingWithinBorders} from './src/game/border-placement.ts';
export {territory} from './src/game/borders.ts';
export {denseConstructionFixture as fixture} from './tests/helpers/construction-preview.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', outfile: after });
const engines = { ...(before && { before: await import(pathToFileURL(path.resolve(before)).href) }), after: await import(pathToFileURL(after).href) };
const raw = snapshot ? await readFile(snapshot, 'utf8') : JSON.stringify(engines.after.fixture());
const samples = {}, outcomes = new Map(), parity = [];
for (let round = 0; round < rounds; round++) for (const name of round % 2 ? Object.keys(engines).reverse() : Object.keys(engines)) {
  const engine = engines[name], state = JSON.parse(raw);
  const cities = state.buildings.filter(b => b.kind === 'palace' && b.hp > 0 && !b.construction);
  engine.withSimulationReads(state, () => {
    // Isolate candidate selection from cold terrain/territory/distance loading.
    for (const city of cities) { engine.palaceReachability(state, city); engine.palaceWalkingDistances(state, city); }
    engine.palaceEnclosures(state); const borders = engine.territory(state);
    for (const replaceFarms of [false, true]) for (const palace of cities) {
      const friendly = cities.filter(city => city.faction === palace.faction);
      let candidates = 0;
      const allowed = point => {
        candidates++;
        if (!engine.buildingWithinBorders(state, 'house', point.x, point.y, palace.faction, borders)) return false;
        const d = (point.x - palace.x - .5) ** 2 + (point.y - palace.y - .5) ** 2;
        return !friendly.some(other => {
          const od = (point.x - other.x - .5) ** 2 + (point.y - other.y - .5) ** 2;
          return od < d || od === d && other.id < palace.id;
        });
      };
      const at = performance.now(), plan = engine.planHouseSite(state, palace, () => replaceFarms, allowed), elapsed = performance.now() - at;
      (samples[name] ??= []).push({ palace: palace.id, replaceFarms, ms: elapsed, candidates, found: !!plan });
      const key = `${round}:${palace.id}:${replaceFarms}`;
      if (outcomes.has(key)) parity.push({ key, equal: isDeepStrictEqual(outcomes.get(key), plan) });
      else outcomes.set(key, plan);
    }
  });
}
const stats = values => { const sorted = values.toSorted((a, b) => a - b); return { samples: values.length,
  median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)], mean: values.reduce((a, b) => a + b, 0) / values.length }; };
const report = { method: 'Exact governor house-site queries, alternating frozen/current engines, with warm terrain, city travel and territory caches. Includes enclosure priority, city boundaries, farm relocation and unreachable-site rejection. Reports selection CPU and allowed-predicate calls, not live FPS.',
  cpu: os.cpus()[0].model, snapshot: snapshot ?? 'denseConstructionFixture', rounds,
  bundles: { ...(before && { beforeSha256: createHash('sha256').update(await readFile(before)).digest('hex') }), afterSha256: createHash('sha256').update(await readFile(after)).digest('hex') },
  timings: Object.fromEntries(Object.entries(samples).map(([name, rows]) => [name, { ms: stats(rows.map(row => row.ms)), candidates: stats(rows.map(row => row.candidates)) }])),
  parity, samples };
await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ timings: report.timings, parity: parity.every(check => check.equal), comparisons: parity.length }, null, 2));
if (parity.some(check => !check.equal)) process.exitCode = 1;
