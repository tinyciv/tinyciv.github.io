// Prepare the existing dense combat scene for the production frame replay.
// No updateGame steps run here. Keep the replay below 15 game seconds.
// node benchmarks/combat-fixture.mjs --out=scratch/2026-11-08-stress
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const option = process.argv.find(value => value.startsWith('--out='));
const directory = path.resolve(option?.slice(6) ?? 'scratch/frame-stress');
const fixtures = path.join(directory, 'fixtures'), bundle = path.join(directory, 'combat-fixture-engine.mjs');
await mkdir(fixtures, { recursive: true });
await build({ stdin: { contents: "export {createPerformanceScenario} from './dev/performance/scenarios.ts';", resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: bundle });
const { createPerformanceScenario } = await import(pathToFileURL(bundle).href);
const scene = createPerformanceScenario('combat-600');
const soldiers = scene.state.units.filter(unit => unit.kind === 'warrior' || unit.kind === 'leader');
assert.equal(soldiers.length, 600);
assert.equal(scene.state.time, 0);
assert.equal(soldiers.filter(unit => unit.faction === 0).length, 300);
assert.equal(soldiers.filter(unit => unit.faction === 1).length, 300);
const write = (name, value) => writeFile(path.join(fixtures, `${name}.json`), JSON.stringify(value));
await write('combat-600', scene.state);
await write('combat-600-viewport', { width: 1440, height: 900, dpr: 1.5, camera: scene.camera, zoom: scene.zoom });
await write('combat-600-metadata', scene.metadata);
console.log(JSON.stringify({ prepared: true, simulationExecuted: false, fixture: 'combat-600',
  totalUnits: scene.state.units.length, combatants: soldiers.length,
  initialTotalUnitHp: scene.state.units.reduce((sum, unit) => sum + unit.hp, 0),
  suggestedReplaySeconds: 12, ...scene.metadata }, null, 2));
