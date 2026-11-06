import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Run serially, without competing tests or benchmarks. The frozen baseline must
// export updateGame and installNavigationWasm. --prepare writes fixtures/bundles
// without importing either engine or advancing any simulation.
// node --expose-gc scripts/benchmark-unit-scaling.mjs \
//   --baseline=scratch/2026-11-04-engine-redesign/before.mjs
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = arg('baseline');
assert(baseline, 'Required: --baseline=path/to/frozen-engine.mjs');
const baselinePath = path.resolve(root, baseline);
const directory = path.resolve(root, arg('out', 'scratch/2026-11-04-engine-redesign/scaling'));
const scenarios = arg('scenarios', 'hold-1000,hold-3000,hold-5000,move-1000').split(',');
assert(scenarios.length && new Set(scenarios).size === scenarios.length);
for (const scenario of scenarios) assert(/^(hold-(1000|3000|5000)|move-1000)$/.test(scenario), `Unknown scenario ${scenario}`);
const warmupUpdates = Number(arg('warmup', '30')), measuredUpdates = Number(arg('updates', '60'));
const rounds = Number(arg('rounds', '1')), dt = 1 / 60;
for (const count of [warmupUpdates, measuredUpdates, rounds]) assert(Number.isInteger(count) && count > 0);
assert((warmupUpdates + measuredUpdates) * dt < 10, 'Keep this fixture below ten simulated seconds.');
const input = { up: false, down: false, left: false, right: false };
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => {
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonical(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
};
const gameplay = state => {
  const { fog, ...rest } = state; // Fog exploration is presentation memory.
  return canonical(rest);
};
const firstDifference = (a, b, at = '$') => {
  if (Object.is(a, b)) return undefined;
  if (typeof a !== typeof b || !a || !b || typeof a !== 'object') return { path: at, baseline: a, current: b };
  const keysA = Object.keys(a), keysB = Object.keys(b);
  if (JSON.stringify(keysA) !== JSON.stringify(keysB)) return { path: at, baselineKeys: keysA, currentKeys: keysB };
  for (const key of keysA) {
    const found = firstDifference(a[key], b[key], `${at}.${key}`);
    if (found) return found;
  }
};
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const quantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};

function fixture(scenario) {
  const count = Number(scenario.split('-')[1]), moving = scenario.startsWith('move-');
  const width = 224, height = 160, seed = `active-unit-scaling:${scenario}`;
  const factions = [0, 1].map(id => ({ id, name: id ? 'Remote settlement' : 'Player army',
    color: id ? '#e45454' : '#3988ff', affinity: id ? 0 : 100, relation: id ? 'peace' : 'self',
    food: 5000, gold: 0, production: 0, population: 0, culture: 0,
    yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }));
  const buildings = [0, 1].map(id => ({ id: id + 1, kind: 'palace', x: id ? 215 : 3, y: 3,
    faction: id, hp: 650, maxHp: 650, armor: 2, capacity: 0, unhousedResidents: 0, populationGrowth: 0,
    governorPermissions: { farms: false, housing: false }, governorNextPlanAt: 1e9 }));
  const makeUnit = (id, kind, faction, x, y) => ({ id, kind, faction, x, y,
    hp: 100, maxHp: 100, morale: 100, attack: kind === 'leader' ? 25 : 17.5,
    defense: kind === 'leader' ? 5 : 4, speed: kind === 'leader' ? 3.6 : 3.96,
    range: kind === 'leader' ? 4 : 1.1, order: 'hold', retinueStance: 'hold', cooldown: 0,
    lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 });
  const units = [makeUnit(3, 'leader', 0, 5.5, 7.5), makeUnit(4, 'leader', 1, 217.5, 7.5)];
  for (let i = 0; i < count - 2; i++) {
    const unit = makeUnit(i + 5, 'warrior', 0, 12.5 + i % 100 * 2, 28.5 + Math.floor(i / 100) * 2);
    // This is the normal gameplay return leg following a forced attack. It
    // exercises production movement, occupancy and routing without making a
    // single enormous formation converge onto its leader's position.
    if (moving) unit.attackReturn = { x: unit.x + 8, y: unit.y };
    units.push(unit);
  }
  return {
    world: { width, height, seed, source: 'Synthetic distributed active-unit scaling fixture', revision: 1,
      spawns: buildings.map(({ x, y }) => ({ x, y })),
      tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: 'grassland', overlay: 'none',
        elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: ((i * 37 + 17) % 997) / 997 })) },
    units, buildings, factions, fields: [], time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], bloodEffects: [], projectiles: [], selected: 3, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed, rngState: 12345,
    retinueStance: 'hold', movementMode: 'travel', marauderPacks: [], raiderCamps: [],
    roamingMaraudersVersion: 1, enemyPressureVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, treasures: [], treeClearings: [],
  };
}

function summarize(state, initial) {
  const initialById = new Map(initial.units.map(unit => [unit.id, unit]));
  const soldiers = state.units.filter(unit => unit.kind === 'warrior' || unit.kind === 'leader');
  const activeSoldiers = soldiers.filter(unit => unit.hp > 0 && !unit.inside);
  const movers = activeSoldiers.filter(unit => initialById.get(unit.id)?.attackReturn);
  const displacements = movers.map(unit => {
    const origin = initialById.get(unit.id);
    return Math.hypot(unit.x - origin.x, unit.y - origin.y);
  });
  const changed = activeSoldiers.filter(unit => {
    const origin = initialById.get(unit.id);
    return origin && Math.hypot(unit.x - origin.x, unit.y - origin.y) > .05;
  });
  return { time: state.time, tick: state.tick, gameOver: state.gameOver,
    totalUnits: state.units.length, activeSoldiers: activeSoldiers.length,
    livingLeaders: activeSoldiers.filter(unit => unit.kind === 'leader').length,
    livingPalaces: state.buildings.filter(building => building.kind === 'palace' && building.hp > 0).length,
    soldiersMovedFromInitial: changed.length, finalMovingSoldiers: activeSoldiers.filter(unit => unit.moving).length,
    remainingReturnOrders: movers.filter(unit => unit.attackReturn).length,
    returnMovers: movers.length, meanReturnDisplacement: displacements.length ? mean(displacements) : 0,
    minimumReturnDisplacement: displacements.length ? Math.min(...displacements) : 0,
    maximumReturnDisplacement: displacements.length ? Math.max(...displacements) : 0,
    totalSoldierHp: soldiers.reduce((sum, unit) => sum + unit.hp, 0) };
}

await mkdir(path.join(directory, 'fixtures'), { recursive: true });
const currentPath = path.join(directory, 'current.mjs');
await build({ stdin: { contents: `export { updateGame } from './src/game/simulation.ts';
  export { installNavigationWasm } from './src/game/navigation-wasm.ts';`, resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: currentPath });
const fixtures = {};
for (const scenario of scenarios) {
  const state = fixture(scenario), json = JSON.stringify(state), file = path.join(directory, 'fixtures', `${scenario}.json`);
  assert.equal(state.units.length, Number(scenario.split('-')[1]));
  assert(state.units.every(unit => unit.hp > 0 && !unit.inside && (unit.kind === 'warrior' || unit.kind === 'leader')));
  assert.equal(new Set(state.units.map(unit => `${unit.x},${unit.y}`)).size, state.units.length);
  assert(state.units.every(unit => unit.x > 0 && unit.y > 0 && unit.x < state.world.width && unit.y < state.world.height
    && (!unit.attackReturn || unit.attackReturn.x < state.world.width)));
  await writeFile(file, json);
  fixtures[scenario] = { json, file, sha256: hash(json) };
}
if (process.argv.includes('--prepare')) {
  console.log(JSON.stringify({ prepared: true, engineExecuted: false, currentPath, baselinePath,
    fixtures: Object.fromEntries(Object.entries(fixtures).map(([key, { json, ...value }]) => [key, value])) }, null, 2));
  process.exit(0);
}

const names = ['baseline', 'current'], modules = {};
modules.baseline = await import(pathToFileURL(baselinePath).href);
modules.current = await import(pathToFileURL(currentPath).href);
const wasm = await readFile(path.join(root, 'public/wasm/navigation.wasm'));
for (const name of names) await modules[name].installNavigationWasm(wasm);
const reportPath = path.join(directory, 'unit-scaling-benchmark.json');
const report = {
  methodology: 'Identical serialized fixture per engine. Real updateGame; no production systems patched or skipped. All requested units remain live outside soldiers; two living leaders and palaces prevent false game completion. Warmup and checksum work are excluded from timed calls. Same WASM bytes; engines alternate first position across scenarios and rounds. Exact game-time advancement, retained active population, real movement, and final gameplay parity are checked.',
  limitations: [
    'Synthetic distributed armies on one fixed 224×160 open map, not a representative city or battle.',
    'No rendering, browser UI or GPU cost; update milliseconds cannot be presented as measured FPS.',
    'Peaceful hold soldiers remain on the ordinary active-unit path, including sensing, morale and collision bookkeeping.',
    'Movement scene uses 998 simultaneous normal attack-return legs, eight tiles east on a two-tile-spaced grid; it is not dense combat, congested chokepoint or formation stress.',
    'Two empty settlements, no farms or other buildings, zero civilian population/gold, and future recruitment/raid clocks keep population fixed during the short sample.',
    'One short round is a scaling diagnostic. Repeated rounds and longer diverse scenarios are required for a general performance claim.',
  ],
  node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
  baselinePath, currentPath, baselineSha256: hash(await readFile(baselinePath)), currentSha256: hash(await readFile(currentPath)),
  navigationWasmSha256: hash(wasm), dt, warmupUpdates, measuredUpdates, rounds,
  explicitPreWarmupGc: typeof global.gc === 'function', scenarios: {}, pass: false, errors: [],
};
try {
  for (let sceneIndex = 0; sceneIndex < scenarios.length; sceneIndex++) {
    const scenario = scenarios[sceneIndex], item = fixtures[scenario], initial = JSON.parse(item.json);
    const expectedCount = initial.units.length, result = report.scenarios[scenario] = {
      snapshot: item.file, initialSha256: item.sha256, initial: summarize(initial, initial), runs: [], parity: [],
    };
    const samples = { baseline: [], current: [] }, previousHashes = {};
    for (let round = 0; round < rounds; round++) {
      const order = (sceneIndex + round) % 2 ? [...names].reverse() : names, outcomes = {};
      for (const name of order) {
        const state = JSON.parse(item.json), module = modules[name];
        global.gc?.();
        for (let i = 0; i < warmupUpdates; i++) module.updateGame(state, dt, input);
        const warm = summarize(state, initial);
        assert(!state.gameOver, `${scenario}/${name} ended during warmup.`);
        assert.equal(warm.activeSoldiers, expectedCount, `${scenario}/${name} retired soldiers during warmup.`);
        assert(Math.abs(state.time - initial.time - warmupUpdates * dt) < 1e-6, `${scenario}/${name} failed warmup advancement.`);
        const times = new Float64Array(measuredUpdates), startTime = state.time;
        for (let i = 0; i < measuredUpdates; i++) {
          const started = performance.now();
          module.updateGame(state, dt, input);
          times[i] = performance.now() - started;
        }
        const final = summarize(state, initial);
        assert(!state.gameOver && final.livingLeaders === 2 && final.livingPalaces === 2, `${scenario}/${name} did not remain active.`);
        assert.equal(final.activeSoldiers, expectedCount, `${scenario}/${name} retired soldiers.`);
        assert.equal(final.totalUnits, expectedCount, `${scenario}/${name} changed fixture population.`);
        assert(Math.abs(state.time - startTime - measuredUpdates * dt) < 1e-6, `${scenario}/${name} failed measured advancement.`);
        if (scenario.startsWith('move-')) {
          assert(final.soldiersMovedFromInitial >= .95 * (expectedCount - 2), `${scenario}/${name} did not actually move its army.`);
          assert(final.meanReturnDisplacement > warm.meanReturnDisplacement + .5, `${scenario}/${name} stopped moving before the timed sample.`);
        } else assert.equal(final.soldiersMovedFromInitial, 0, `${scenario}/${name} hold fixture moved.`);
        outcomes[name] = gameplay(state);
        const gameplaySha256 = hash(JSON.stringify(outcomes[name]));
        assert(!previousHashes[name] || previousHashes[name] === gameplaySha256, `${scenario}/${name} is nondeterministic across rounds.`);
        previousHashes[name] = gameplaySha256;
        const run = { name, round: round + 1, position: order.indexOf(name) + 1,
          meanUpdateMs: mean(times), p50UpdateMs: quantile(times, .5), p95UpdateMs: quantile(times, .95), maxUpdateMs: Math.max(...times),
          gameplaySha256, warmup: warm, final };
        result.runs.push(run); samples[name].push(...times);
        await writeFile(reportPath, JSON.stringify(report, null, 2));
        console.log(`${scenario} ${name}: mean ${run.meanUpdateMs.toFixed(3)} ms; p95 ${run.p95UpdateMs.toFixed(3)}; active ${final.activeSoldiers}; moved ${final.soldiersMovedFromInitial}; time ${final.time.toFixed(3)}`);
      }
      const difference = firstDifference(outcomes.baseline, outcomes.current);
      result.parity.push({ round: round + 1, pass: difference === undefined, firstDifference: difference });
      if (difference) report.errors.push({ scenario, round: round + 1, parityDifference: difference });
    }
    result.summary = Object.fromEntries(names.map(name => [name, {
      meanUpdateMs: mean(samples[name]), p50UpdateMs: quantile(samples[name], .5), p95UpdateMs: quantile(samples[name], .95),
    }]));
    result.summary.speedup = result.summary.baseline.meanUpdateMs / result.summary.current.meanUpdateMs;
    result.summary.timeReductionPercent = (1 - 1 / result.summary.speedup) * 100;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }
  report.pass = report.errors.length === 0;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  console.error(error);
} finally {
  if (!report.pass) process.exitCode = 1;
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Benchmark ${report.pass ? 'PASS' : 'FAIL'}: ${reportPath}`);
}
