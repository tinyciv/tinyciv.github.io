import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run serially, without competing tests/profiles:
// node --expose-gc scripts/benchmark-harvest-cadence.mjs --baseline=/tmp/btv-before --out=/tmp/btv-harvest
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = argument('baseline');
if (!baseline) throw new Error('Required: --baseline=/absolute/path/to/pre-change-source');
const roots = { baseline: path.resolve(root, baseline), current: path.resolve(root, argument('current', root)) };
const directory = path.resolve(root, argument('out', 'scratch/harvest-cadence-benchmark'));
const dt = .1, warmupSeconds = Number(argument('warmup', '180')), measuredSeconds = Number(argument('seconds', '600'));
const rounds = Number(argument('rounds', '1'));
assert(warmupSeconds >= 120 && measuredSeconds >= 300 && measuredSeconds % 60 === 0, 'Use >=120s warmup and >=300s measurement in whole 60s cycles.');
assert(Number.isInteger(rounds) && rounds > 0);
const scenarios = { small: { population: 20, farms: 15 }, large: { population: 160, farms: 150 } };
const selected = argument('scenarios', 'small,large').split(',');
assert(selected.length && selected.every(name => scenarios[name]) && new Set(selected).size === selected.length);
const names = ['baseline', 'current'], modules = {}, bundles = {}, hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(directory, { recursive: true });
for (const name of names) {
  const counter = `__btvHarvestPathCalls_${name}`, outfile = path.join(directory, `harvest-cadence-${name}.mjs`);
  let counted = 0, trafficLocked = 0;
  await build({
    stdin: { contents: `export { updateGame } from './src/game/simulation.ts';
      export { synchronizeFarms, ensureCollectors, FIELD_HARVEST_SECONDS, FIELD_HARVEST_FOOD, FIELD_SPOIL_SECONDS } from './src/game/farms.ts';
      export { installNavigationWasm, navigationWasmStatus } from './src/game/navigation-wasm.ts';
      globalThis.${counter} = 0; export const pathCalls = () => globalThis.${counter};`, resolveDir: roots[name] },
    bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile,
    plugins: [{ name: 'isolated-harvest-measurement', setup(builder) {
      builder.onLoad({ filter: /[/\\]src[/\\]game[/\\](pathfinding|traffic)\.ts$/ }, async args => {
        const original = await readFile(args.path, 'utf8'), navigation = args.path.endsWith('pathfinding.ts');
        const signature = navigation ? /export function findPath\([^\n]+\): Point\[\] \{/g
          : /export function recordTraffic\([^\n]+\): boolean \{/g;
        assert.equal([...original.matchAll(signature)].length, 1, `Cannot instrument ${args.path}`);
        if (navigation) counted++; else trafficLocked++;
        return { contents: original.replace(signature, match => `${match}\n  ${navigation ? `globalThis.${counter}++;` : 'return false; // Benchmark: keep the initial road network fixed.'}`), loader: 'ts' };
      });
    } }],
  });
  assert.equal(counted, 1); assert.equal(trafficLocked, 1);
  bundles[name] = hash(await readFile(outfile));
  modules[name] = await import(pathToFileURL(outfile).href);
}
const wasm = await readFile(path.join(roots.current, 'public/wasm/navigation.wasm'));
for (const name of names) await modules[name].installNavigationWasm(wasm);

/** Same open grassland and four-tile city core as the physical food calibration.
 * Population/housing/roads stay fixed; real courier trips and expiry stay active. */
function fixture({ population, farms }) {
  const width = 64, height = 64, seed = 'harvest-cadence';
  const palace = { id: 1, kind: 'palace', faction: 0, x: 31, y: 31, hp: 650, maxHp: 650,
    capacity: 0, populationGrowth: -10000, governorPermissions: { farms: false, housing: false } };
  const state = {
    world: { width, height, revision: 1, seed, source: 'Controlled harvest cadence fixture', spawns: [],
      tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [palace], units: [{ id: 2, kind: 'leader', faction: 0, x: 59.5, y: 59.5, hp: 100, maxHp: 100,
      morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0,
      lastCombat: -60, moving: false, facing: 0, attackTime: 0 }], fields: [],
    factions: [{ id: 0, name: 'Test', color: '#f43', affinity: 100, relation: 'self', food: 1e6, gold: 0,
      production: 0, population, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed, rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, enemyPressureVersion: 1,
    fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], nextRespawnAt: 1e9, sequence: 0, targetHerds: 0 },
  };
  const sites = [];
  for (let y = 2; y < 62; y += 2) for (let x = 2; x < 62; x += 2) {
    const radius = Math.hypot(x + 1 - 32, y + 1 - 32);
    if (radius >= 4 && radius <= 25) sites.push({ x, y, radius });
  }
  sites.sort((a, b) => a.radius - b.radius || a.y - b.y || a.x - b.x);
  for (const { x, y } of sites.slice(0, farms)) state.buildings.push({ id: state.buildings.length + 10,
    kind: 'camp', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
  for (let y = 30; y <= 33; y++) for (let x = 30; x <= 33; x++) if (x === 30 || x === 33 || y === 30 || y === 33)
    state.buildings.push({ id: state.buildings.length + 1000, kind: 'road', faction: 0, x, y, hp: 60, maxHp: 60, capacity: 0 });
  return state;
}
const input = { up: false, down: false, left: false, right: false };
const output = path.join(directory, 'harvest-cadence-benchmark.json');
const report = {
  methodology: 'Same fixed grassland fixtures, palace road ring and WASM bytes. Each variant initializes its own normal staggered harvest schedule, then runs 180 warmup seconds by default and 600 measured seconds at dt 0.1. Farms, housing and population are fixed; large food reserve prevents starvation and a negative birth accumulator prevents births. Expansion, raids and wildlife are absent. Benchmark-only recordTraffic bypass locks the road network; harvest, expiry, dispatch, movement, collision, pickup, delivery and farm inactivity use production code. Every findPath entry is counted, including JavaScript/native requests, failures and recursive fallbacks. These are pathfinder API calls, not just WASM searches. Per-step outside/moving counts measure simulated courier activity, not viewport-visible sprites or FPS. Wall time includes instrumentation and is diagnostic only.',
  roots, bundles, node: process.version, cpu: os.cpus()[0]?.model, navigationWasmSha256: hash(wasm),
  dt, warmupSeconds, measuredSeconds, rounds, explicitPreWarmupGc: typeof global.gc === 'function',
  scenes: {}, errors: [], pass: false,
};
try {
  for (const scene of selected) {
    const config = scenarios[scene], initial = fixture(config), record = report.scenes[scene] = { ...config, initialFixtureSha256: hash(JSON.stringify(initial)), runs: [] };
    for (let round = 0; round < rounds; round++) for (const name of round % 2 ? [...names].reverse() : names) {
      const game = modules[name], state = structuredClone(initial);
      game.synchronizeFarms(state); game.ensureCollectors(state);
      const schedule = [...new Map(state.fields.map(field => [field.camp, field.nextHarvest])).entries()]
        .map(([camp, nextHarvest]) => ({ camp, nextHarvest }));
      const starting = { harvestSeconds: game.FIELD_HARVEST_SECONDS, foodPerTilePerHarvest: game.FIELD_HARVEST_FOOD,
        spoilSeconds: game.FIELD_SPOIL_SECONDS, population: state.factions[0].population, farms: config.farms,
        fields: state.fields.length, buildings: state.buildings.length, collectors: state.units.filter(unit => unit.collector).length,
        roads: state.buildings.filter(building => building.kind === 'road').length, housing: 0, harvestSchedule: schedule };
      global.gc?.();
      for (let step = 0; step < Math.round(warmupSeconds / dt); step++) game.updateGame(state, dt, input);
      const startedAt = state.time, firstFood = state.buildings[0].foodDelivered ?? 0, firstPaths = game.pathCalls(), nativeBefore = game.navigationWasmStatus();
      const previousInside = new Map(state.units.filter(unit => unit.collector).map(unit => [unit.id, !!unit.inside]));
      let outsideSum = 0, movingSum = 0, maxOutside = 0, departures = 0;
      const started = performance.now(), updates = Math.round(measuredSeconds / dt);
      for (let step = 0; step < updates; step++) {
        game.updateGame(state, dt, input);
        let outside = 0, moving = 0;
        for (const unit of state.units) if (unit.collector && unit.hp > 0) {
          if (!unit.inside) { outside++; if (unit.moving) moving++; if (previousInside.get(unit.id) !== false) departures++; }
          previousInside.set(unit.id, !!unit.inside);
        }
        outsideSum += outside; movingSum += moving; maxOutside = Math.max(maxOutside, outside);
      }
      const wallMs = performance.now() - started, elapsed = state.time - startedAt, delivered = (state.buildings[0].foodDelivered ?? 0) - firstFood;
      assert(!state.gameOver && Math.abs(elapsed - measuredSeconds) < 1e-6 && Math.abs(startedAt - warmupSeconds) < 1e-6, 'Simulation time must advance exactly.');
      assert.equal(state.factions[0].population, config.population, 'Population changed.');
      assert.equal(state.buildings.filter(building => building.kind === 'camp').length, config.farms, 'Farm membership changed.');
      assert.equal(state.buildings.length, starting.buildings, 'The fixed building network changed.');
      assert.equal(state.units.filter(unit => unit.collector).length, starting.collectors, 'Collector membership changed.');
      const native = game.navigationWasmStatus();
      for (const key of ['searches', 'unsupported', 'unavailable']) native[key] -= nativeBefore[key];
      const result = { name, round: round + 1, initial: starting, measuredGameSeconds: elapsed,
        averageOutsideCollectors: outsideSum / updates, averageMovingCollectors: movingSum / updates, maxOutsideCollectors: maxOutside,
        departures, deliveredFood: delivered, deliveredPer30: delivered / elapsed * 30,
        pathfinderCalls: game.pathCalls() - firstPaths, native, wallMs,
        final: { time: state.time, population: state.factions[0].population, units: state.units.length, fields: state.fields.length,
          fallowFarms: state.buildings.filter(building => building.kind === 'camp' && building.farmFallow).length } };
      record.runs.push(result); await writeFile(output, JSON.stringify(report, null, 2));
      console.log(`${scene}/${name} round ${round + 1}: outside ${result.averageOutsideCollectors.toFixed(2)}, moving ${result.averageMovingCollectors.toFixed(2)}, departures ${departures}, path calls ${result.pathfinderCalls}, food/30s ${result.deliveredPer30.toFixed(3)}`);
    }
    const average = (name, key) => { const runs = record.runs.filter(run => run.name === name); return runs.reduce((sum, run) => sum + run[key], 0) / runs.length; };
    record.summary = Object.fromEntries(['averageOutsideCollectors', 'averageMovingCollectors', 'departures', 'pathfinderCalls', 'deliveredPer30'].map(key => {
      const before = average('baseline', key), after = average('current', key);
      return [key, { baseline: before, current: after, currentToBaseline: before ? after / before : null }];
    }));
    console.log(JSON.stringify({ scene, ...record.summary }, null, 2));
  }
  report.pass = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error)); process.exitCode = 1; console.error(error);
} finally {
  await writeFile(output, JSON.stringify(report, null, 2)); console.log(`Benchmark ${report.pass ? 'PASS' : 'FAIL'}: ${output}`);
}
