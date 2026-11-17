// Execute production simulation and prove the stress fixtures do real work.
// Run serially, without a browser benchmark competing for CPU.
// node benchmarks/validate-scaling-fixtures.mjs --out=scratch/frame-stress
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const option = process.argv.find(value => value.startsWith('--out='));
const directory = path.resolve(option?.slice(6) ?? 'scratch/frame-stress');
const bundle = path.join(directory, 'validation-engine.mjs');
await build({ stdin: { contents: `export { updateGame } from './src/game/simulation.ts';
  export { installNavigationWasm } from './src/game/navigation-wasm.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: bundle });
const engine = await import(pathToFileURL(bundle).href);
await engine.installNavigationWasm(await readFile('public/wasm/navigation.wasm'));
const report = { scenarioValidation: {} }, input = { up: false, down: false, left: false, right: false };
for (const name of ['hold-5000', 'move-1000-long', 'workers-2000']) {
  const state = JSON.parse(await readFile(path.join(directory, 'fixtures', `${name}.json`), 'utf8'));
  const initial = new Map(state.units.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
  const seenMoving = new Set(), seenCargo = new Set();
  let maxOutsideWorkers = 0, maxCollectors = 0, maxBuilderWorking = 0;
  const initialTime = state.time, steps = name === 'workers-2000' ? 360 : 180;
  for (let step = 0; step < steps; step++) {
    engine.updateGame(state, 1 / 30, input);
    for (const unit of state.units) {
      const old = initial.get(unit.id);
      if (old && Math.hypot(unit.x - old.x, unit.y - old.y) > .1) seenMoving.add(unit.id);
      if (unit.collector && (unit.cargo ?? 0) > 0) seenCargo.add(unit.id);
    }
    const outside = state.units.filter(unit => unit.hp > 0 && !unit.inside);
    maxOutsideWorkers = Math.max(maxOutsideWorkers, outside.filter(unit => unit.kind === 'worker').length);
    maxCollectors = Math.max(maxCollectors, outside.filter(unit => unit.collector).length);
    maxBuilderWorking = Math.max(maxBuilderWorking, outside.filter(unit => unit.builder && unit.buildPhase === 'working').length);
  }
  const alive = state.units.filter(unit => unit.hp > 0);
  const activeSoldiers = alive.filter(unit => !unit.inside && (unit.kind === 'warrior' || unit.kind === 'leader')).length;
  const result = { gameSeconds: state.time - initialTime, totalUnits: state.units.length, activeSoldiers,
    totalWorkers: alive.filter(unit => unit.kind === 'worker').length,
    collectors: alive.filter(unit => unit.collector).length, builders: alive.filter(unit => unit.builder).length,
    maxOutsideWorkers, maxCollectors, maxBuilderWorking, everMoved: seenMoving.size,
    collectorsCarriedFood: seenCargo.size,
    foodDelivered: state.buildings.reduce((sum, building) => sum + (building.foodDelivered ?? 0), 0),
    activeConstruction: state.buildings.filter(building => building.construction && !building.construction.waitingForBuilder).length,
    remainingReturnOrders: state.units.filter(unit => unit.attackReturn).length, gameOver: state.gameOver };
  assert(!state.gameOver);
  assert(Math.abs(result.gameSeconds - steps / 30) < 1e-6);
  if (name === 'hold-5000') {
    assert.equal(activeSoldiers, 5000);
    assert.equal(seenMoving.size, 0);
  } else if (name === 'move-1000-long') {
    assert.equal(activeSoldiers, 1000);
    assert(seenMoving.size >= 950);
    assert(result.remainingReturnOrders >= 950);
  } else {
    assert.equal(result.totalWorkers, 2000);
    assert.equal(result.collectors, 1000);
    assert.equal(result.builders, 1000);
    assert(result.maxBuilderWorking >= 950);
    assert(result.maxCollectors >= 500);
    assert(result.collectorsCarriedFood >= 500);
    assert(result.foodDelivered > 100);
    assert(result.activeConstruction >= 950);
  }
  report.scenarioValidation[name] = result;
  await writeFile(path.join(directory, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(name, JSON.stringify(result));
}
