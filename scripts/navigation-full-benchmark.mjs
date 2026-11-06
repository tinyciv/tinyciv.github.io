import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const root = 'scratch/2026-10-26-gameplay-overhaul';
const frozen = await readFile(`${root}/navigation-before.mjs`, 'utf8');
const originalMovement = frozen.slice(frozen.indexOf('function occupiedCells('), frozen.lastIndexOf('\nexport {'))
  .replace('function moveUnit(', 'export function moveUnit(').replace('function updateFriendlyYield(', 'export function updateFriendlyYield(');
for (const phase of ['before', 'after']) await build({
  entryPoints: ['src/game/simulation.ts'], bundle: true, platform: 'node', format: 'esm', outfile: `${root}/full-${phase}.mjs`,
  plugins: phase === 'before' ? [{ name: 'restore-original-navigation', setup(builder) {
    builder.onLoad({ filter: /\/simulation\.ts$/ }, async ({ path }) => {
      let source = await readFile(path, 'utf8');
      const begin = source.indexOf('function occupiedCells('), end = source.indexOf('function losePopulation(', begin);
      source = source.slice(0, begin) + originalMovement + '\nconst acceptedMoveOrders = new WeakMap<Unit, Point>();\n' + source.slice(end);
      return { contents: source, loader: 'ts' };
    });
    builder.onLoad({ filter: /\/pathfinding\.ts$/ }, async ({ path }) => {
      let source = await readFile(path, 'utf8');
      source = source.replace('(routes ?? structures(state).routes).has(ty * state.world.width + tx)', "routes ? routes.has(ty * state.world.width + tx) : state.buildings.some(building => isRoute(building.kind) && buildingReady(building) && building.x === tx && building.y === ty)");
      source = source.replace('structures(state).bridges.has(ty * state.world.width + tx)', "state.buildings.some(building => building.kind === 'bridge' && buildingReady(building) && building.x === tx && building.y === ty)");
      return { contents: source, loader: 'ts' };
    });
  } }] : [],
});
const before = await import(pathToFileURL(`${process.cwd()}/${root}/full-before.mjs`));
const after = await import(pathToFileURL(`${process.cwd()}/${root}/full-after.mjs`));
const { stressScenario } = await import(pathToFileURL(`${process.cwd()}/${root}/stress-runner.mjs`));
function fixture(count) {
  const source = stressScenario('Large procession');
  const units = source.units.slice(0, count); units.forEach(unit => { delete unit.destination; });
  const leader = { ...units[0], id: 10000, kind: 'leader', x: 54.5, y: 20.5, speed: 3.6, order: 'hold', range: 4 };
  const state = { ...source, units: [leader, ...units],
    buildings: [{ id: 11000, kind: 'palace', faction: 0, x: 58, y: 18, hp: 650, maxHp: 650, capacity: 0 }] };
  state.factions = [0, 1].map(id => ({ id, name: `Realm ${id}`, color: '#3988ff', affinity: 100, relation: id ? 'peace' : 'self', food: 500, gold: 0, production: 0, population: 0, growth: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }));
  state.raiderCamps = []; state.marauderPacks = []; state.roamingMaraudersVersion = 1;
  state.fogRaids = { nextAt: Infinity, waves: 0, pressureVersion: 1 };
  return state;
}
function run(driver, count) {
  const state = fixture(count), start = performance.now();
  for (let tick = 0; tick < 300; tick++) driver.updateGame(state, .1, { up: false, down: false, left: false, right: false });
  return { cpuMs: +(performance.now() - start).toFixed(1), simSeconds: +state.time.toFixed(1), units: state.units.filter(unit => unit.hp > 0).length,
    meanX: +(state.units.filter(unit => unit.kind === 'warrior').reduce((sum, unit) => sum + unit.x, 0) / count).toFixed(2), gameOver: state.gameOver };
}
// Warm both full tick implementations, then alternate runs on identical worlds.
run(before, 32); run(after, 32);
const results = [];
for (const count of [128, 256]) {
  const previous = [], current = [];
  for (let repetition = 0; repetition < 3; repetition++) { previous.push(run(before, count)); current.push(run(after, count)); }
  const median = values => values.map(value => value.cpuMs).sort((a, b) => a - b)[1];
  const result = { warriors: count, before: { ...previous[2], cpuMs: median(previous) }, after: { ...current[2], cpuMs: median(current) }, runs: { before: previous, after: current } };
  results.push(result); console.log(JSON.stringify(result));
}
await writeFile(`${root}/full-tick-benchmark.json`, JSON.stringify({ note: 'Full updateGame, 300 × 0.1 s steps; fixed current gameplay/fog/AI modules in both versions. Before restores the frozen pre-change movement/yield code and uncached road/bridge probes. Median of three alternating runs after warmup. No rendering.', results }, null, 2));
