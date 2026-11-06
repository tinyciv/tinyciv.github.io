import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run without concurrent tests or profiles:
// node --expose-gc scripts/benchmark-farm-refresh.mjs --baseline=/tmp/btv-before --out=/tmp/btv-farm-refresh
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const before = argument('baseline');
if (!before) throw new Error('Required: --baseline=/absolute/path/to/pre-change-source');
const roots = { baseline: path.resolve(root, before), current: path.resolve(root, argument('current', root)) };
const directory = path.resolve(root, argument('out', 'scratch/farm-refresh-benchmark'));
await mkdir(directory, { recursive: true });
const names = ['baseline', 'current'], modules = {}, bundles = {};
const rounds = 3, roadEdits = 40, palaceCount = 11, warmupCalls = 20, dt = 1 / 60;
for (const name of names) {
  const counter = `__btvFarmRefresh_${name}`, outfile = path.join(directory, `farm-refresh-${name}.mjs`);
  let instrumented = 0;
  await build({
    stdin: { contents: `export { citySummaries } from './src/game/cities.ts';
      export { entityStore } from './src/game/entity-store.ts';
      globalThis.${counter} = 0;
      export const mapBuilds = () => globalThis.${counter};`, resolveDir: roots[name] },
    bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile,
    plugins: [{ name: 'count-travel-maps-only-in-benchmark', setup(builder) {
      builder.onLoad({ filter: /[/\\]src[/\\]game[/\\]pathfinding\.ts$/ }, async args => {
        const original = await readFile(args.path, 'utf8');
        const signature = /export function travelTimeMapFrom\([^\n]+\): Float32Array \{/g;
        assert.equal([...original.matchAll(signature)].length, 1, `Cannot instrument ${args.path}`);
        instrumented++;
        return { contents: original.replace(signature, match => `${match}\n  globalThis.${counter}++;`), loader: 'ts' };
      });
    } }],
  });
  assert.equal(instrumented, 1, `${name} must instrument exactly one navigation module.`);
  bundles[name] = createHash('sha256').update(await readFile(outfile)).digest('hex');
  modules[name] = await import(pathToFileURL(outfile).href);
}

/** Self-contained controlled settlement: one 150-person city with 94 farms,
 * plus ten peaceful empty cities so a global invalidation requests eleven maps.
 * Every city belongs to a distinct faction; roads cannot change farm ownership. */
function fixture() {
  const width = 194, height = 153;
  const state = { world: { width, height, revision: 1, seed: 'farm-refresh-audit', source: 'benchmark', spawns: [],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none',
      elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [], units: [], fields: [], factions: [], time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    gameOver: false, victory: false, seed: 'farm-refresh-audit', rngState: 1 };
  for (let id = 0; id < palaceCount; id++) {
    state.factions.push({ id, name: `Realm ${id}`, color: '#3988ff', affinity: 100, relation: id ? 'peace' : 'self',
      food: 500, gold: 0, production: 0, population: id ? 0 : 150, defeated: false,
      yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity });
    state.buildings.push({ id: id + 1, kind: 'palace', faction: id, hp: 650, maxHp: 650, capacity: 4,
      x: id ? 100 + (id - 1) % 5 * 12 : 35, y: id ? 20 + Math.floor((id - 1) / 5) * 35 : 35,
      governorPermissions: { farms: false, housing: false } });
  }
  for (let i = 0; i < 25; i++) state.buildings.push({ id: 100 + i, kind: 'house', faction: 0,
    x: 26 + i % 5 * 2, y: 42 + Math.floor(i / 5) * 2, hp: 200, maxHp: 200, capacity: 6, residents: 6, houseLevel: 2 });
  for (let i = 0; i < Math.ceil(150 / 1.6); i++) {
    const camp = { id: 1000 + i, kind: 'camp', faction: 0, x: 4 + i % 12 * 2, y: 4 + Math.floor(i / 12) * 2,
      hp: 100, maxHp: 100, capacity: 0 };
    state.buildings.push(camp);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) state.fields.push({
      id: (camp.y + dy) * width + camp.x + dx + 1, camp: camp.id, faction: 0,
      x: camp.x + dx, y: camp.y + dy, planted: true, food: 0, nextHarvest: 30 });
  }
  return state;
}
const summarize = cities => cities.map(({ palace, name, population, housing, food, gold }) =>
  ({ palace: palace.id, name, population, housing, food, gold }));
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b), at = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: at(.5), p95Ms: at(.95), p99Ms: at(.99), maxMs: sorted.at(-1) };
};
const initial = fixture(), report = {
  methodology: 'Three alternating baseline/current rounds with fresh identical clones. Twenty warm summary calls prime caches. Then forty distant ordinary roads are added one per 1/60 game second, incrementing the world revision each time. Only citySummaries calls are timed; mutation, cloning, initial maps and checks are excluded. Benchmark-only esbuild instrumentation counts actual travelTimeMapFrom executions. No rendering, movement, save I/O, or full-game FPS is measured.',
  roots, bundles, node: process.version, cpu: os.cpus()[0]?.model, explicitGc: typeof global.gc === 'function',
  rounds, warmupCalls, roadEdits, dt,
  initial: { population: 150, palaces: palaceCount, factions: initial.factions.length,
    farms: initial.buildings.filter(b => b.kind === 'camp').length, fields: initial.fields.length,
    buildings: initial.buildings.length, world: [initial.world.width, initial.world.height] }, runs: [], errors: [], pass: false,
};
const output = path.join(directory, 'farm-refresh-benchmark.json');
try {
  let expected;
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? [...names].reverse() : names;
    for (const name of order) {
      const state = structuredClone(initial), game = modules[name];
      global.gc?.();
      const beforeWarmup = game.mapBuilds();
      for (let call = 0; call < warmupCalls; call++) {
        const summary = summarize(game.citySummaries(state)); expected ??= summary;
        assert.deepEqual(summary, expected, `${name} initial summaries differ.`);
      }
      const warmupMaps = game.mapBuilds() - beforeWarmup, samples = [], before = game.mapBuilds();
      for (let edit = 0; edit < roadEdits; edit++) {
        state.time += dt;
        const x = 150 + edit % 20, y = 120 + Math.floor(edit / 20);
        assert(!state.buildings.some(b => b.x === x && b.y === y));
        game.entityStore(state).buildings.add({ id: 10000 + edit, kind: 'road', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
        state.world.revision++;
        const maps = game.mapBuilds(), start = performance.now(), cities = game.citySummaries(state), ms = performance.now() - start;
        samples.push({ edit: edit + 1, gameTime: state.time, ms, mapRebuilds: game.mapBuilds() - maps });
        assert.deepEqual(summarize(cities), expected, `${name} road ${edit + 1} changed unrelated city results.`);
      }
      const mapRebuilds = game.mapBuilds() - before;
      assert.equal(warmupMaps, palaceCount);
      assert.equal(mapRebuilds, name === 'baseline' ? roadEdits * palaceCount : roadEdits / 20 * palaceCount);
      const run = { round: round + 1, name, position: order.indexOf(name) + 1, warmupMaps, mapRebuilds,
        ...stats(samples.map(sample => sample.ms)), samples };
      report.runs.push(run); await writeFile(output, JSON.stringify(report, null, 2));
      console.log(`${name} round ${round + 1}: ${mapRebuilds} maps; mean ${run.meanMs.toFixed(3)} ms; p95 ${run.p95Ms.toFixed(3)} ms; max ${run.maxMs.toFixed(3)} ms`);
    }
  }
  report.summary = Object.fromEntries(names.map(name => [name, { ...stats(report.runs.filter(run => run.name === name).flatMap(run => run.samples.map(sample => sample.ms))),
    totalMapRebuilds: report.runs.filter(run => run.name === name).reduce((sum, run) => sum + run.mapRebuilds, 0) }]));
  report.summary.mapRebuildReductionFactor = report.summary.baseline.totalMapRebuilds / report.summary.current.totalMapRebuilds;
  report.summary.meanCallSpeedup = report.summary.baseline.meanMs / report.summary.current.meanMs;
  report.limitations = ['This isolates repeated farm-planning invalidation, not overall simulation or FPS.',
    'Coalescing reduces rebuild frequency; the frames which rebuild eleven maps can still be slow. Inspect p95 and maximum as well as mean.'];
  report.pass = true;
} catch (error) { report.errors.push(error.stack ?? String(error)); process.exitCode = 1; console.error(error); }
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Benchmark ${report.pass ? 'PASS' : 'FAIL'}: ${output}`);
