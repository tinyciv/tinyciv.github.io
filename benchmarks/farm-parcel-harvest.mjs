// Headless collection fixture; no rendering, AI, or interactive game startup.
// node benchmarks/farm-parcel-harvest.mjs [--baseline=/path/to/old/farms.ts] [--baseline-pickups=/path/to/old/farm-pickup-routes.ts] [--out=/path/to/result.json]
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..');
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const temporary = await mkdtemp(join(tmpdir(), 'btv-parcel-harvest-'));
const fixture = `
import { FIELD_SPOIL_SECONDS, ensureCollectors, synchronizeFarms, updateScheduledHarvests, beginCollectorFrame, endCollectorFrame, updateCollector } from './src/game/farms';
import { withSimulationReads } from './src/game/simulation-reads';
import { entityStore } from './src/game/entity-store';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from './src/game/spatial';
import { beginNavigationFrame, endNavigationFrame } from './src/game/pathfinding';
import { courierRouteCacheStats } from './src/game/courier-routes';
import { prepareCourierUpdates, settleCourier } from './src/game/courier-sleep';
import { moveUnit } from './src/game/simulation';
export { FIELD_SPOIL_SECONDS };
export function run(deadline = 600) {
  const width = 64, height = 48, points = [];
  for (let block = 0; block < 16; block++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++)
    points.push({ x: 9 + block % 4 * 5 + x, y: 12 + Math.floor(block / 4) * 5 + y });
  const state = { world: { width, height, seed: 'parcel-benchmark', source: 'fixture', spawns: [],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', x: 3, y: 20, faction: 0, hp: 650, maxHp: 650, capacity: 1000 },
      ...points.map((point, i) => ({ id: i + 2, kind: 'camp', ...point, faction: 0, hp: 100, maxHp: 100, capacity: 0 }))],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self',
      food: 20, gold: 20, production: 0, population: 100, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'parcel-benchmark', rngState: 1 };
  synchronizeFarms(state); ensureCollectors(state);
  for (const field of state.fields) Object.assign(field, { nextHarvest: 1e6, food: 1, expiresAt: deadline, foodBatches: [{ amount: 1, expiresAt: deadline }] });
  let peakVisible = 0, visibleWorkerSeconds = 0, pickups = 0, departures = 0, walkedTiles = 0, movementCalls = 0;
  const move = (...args) => {
    const unit = args[1], x = unit.x, y = unit.y;
    movementCalls++; moveUnit(...args); walkedTiles += Math.hypot(unit.x - x, unit.y - y);
  };
  const started = performance.now();
  for (let step = 0; step < 2400; step++) {
    state.time = step / 20;
    withSimulationReads(state, () => {
      if (step % 7 === 0) { updateScheduledHarvests(state); ensureCollectors(state); prepareCourierUpdates(state); }
      beginCollectorFrame(state); beginUnitFrame(state); beginNavigationFrame(state);
      try {
        for (const unit of [...entityStore(state).units.query('active')]) if (unit.collector) {
          const before = unit.cargo ?? 0, inside = unit.inside;
          updateCollector(state, unit, .05, move);
          pickups += Number((unit.cargo ?? 0) > before); departures += Number(inside && !unit.inside);
          settleCourier(state, unit); refreshIndexedUnit(state, unit);
        }
      } finally { endNavigationFrame(state); endUnitFrame(state); endCollectorFrame(state); }
    });
    const visible = state.units.filter(unit => unit.collector && !unit.inside).length;
    peakVisible = Math.max(peakVisible, visible); visibleWorkerSeconds += visible * .05;
  }
  return { plots: state.fields.length, parcels: 16, deadline, delivered: state.buildings[0].foodDelivered ?? 0,
    peakVisible, visibleWorkerSeconds: Math.round(visibleWorkerSeconds * 100) / 100,
    pickups, departures, walkedTiles: Math.round(walkedTiles * 100) / 100, movementCalls,
    routeSearches: courierRouteCacheStats(state).searches, cpuMs: performance.now() - started };
}
`;
try {
  const variants = option('baseline') ? ['before', 'after'] : ['after'];
  const results = {};
  for (const variant of variants) {
    const outfile = join(temporary, `${variant}.mjs`);
    const plugins = variant === 'before' ? [{ name: 'prior-farm-source', setup(builder) {
      builder.onLoad({ filter: /\/src\/game\/farms\.ts$/ }, async () => ({ contents: await readFile(option('baseline'), 'utf8'), loader: 'ts', resolveDir: join(root, 'src/game') }));
      builder.onResolve({ filter: /^\.\/farm-pickup-routes$/ }, () => ({ path: resolve(option('baseline-pickups') ?? join(dirname(option('baseline')), 'farm-pickup-routes.ts')), namespace: 'prior-pickups' }));
      builder.onLoad({ filter: /.*/, namespace: 'prior-pickups' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'ts', resolveDir: join(root, 'src/game') }));
    } }] : [];
    await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: 'parcel-harvest-fixture.ts', loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'esm', plugins, logLevel: 'silent' });
    const { run, FIELD_SPOIL_SECONDS } = await import(pathToFileURL(outfile).href);
    run();
    const samples = Array.from({ length: 3 }, () => run());
    const median = [...samples].sort((a, b) => a.cpuMs - b.cpuMs)[1];
    results[variant] = { ...median, cpuMs: Math.round(median.cpuMs * 100) / 100,
      cpuSamplesMs: samples.map(sample => Math.round(sample.cpuMs * 100) / 100) };
    results[`${variant}ThirtySecondWindow`] = run(30);
    results[`${variant}DefaultWindow`] = run(FIELD_SPOIL_SECONDS);
  }
  const sourcePaths = ['src/game/farms.ts', 'src/game/farm-parcels.ts', 'src/game/farm-dispatch.ts', 'src/game/wheat-fields.ts', 'src/game/courier-sleep.ts'];
  const sources = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(join(root, path))).digest('hex')])));
  if (option('baseline')) sources.baselineFarms = createHash('sha256').update(await readFile(option('baseline'))).digest('hex');
  const output = { sources, fixture: '256 tiles in 16 connected parcels; 120 simulated seconds; fixed dt=.05',
    scope: 'Prior farms.ts vs current collector with the same supporting systems; headless collection only. Long-deadline comparison isolates sweep/cap cost; 30-second samples show queue/spoilage behavior. CPU timings are diagnostic, not FPS.', results };
  if (option('out')) await writeFile(option('out'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
