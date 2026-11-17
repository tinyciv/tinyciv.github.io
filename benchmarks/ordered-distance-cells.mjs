// Isolate candidate ordering on a real saved-world palace travel field.
// node benchmarks/ordered-distance-cells.mjs --state=path/to/state.json
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const statePath = arg('state');
assert(statePath, 'Required: --state=path/to/state.json');
const out = path.resolve(arg('out', 'scratch/ordered-distance-cells'));
await mkdir(out, { recursive: true });
const bundle = path.join(out, 'engine.mjs');
await build({ stdin: { contents: `export { orderedDistanceCells } from './src/game/ordered-distance-cells.ts';
  export { palaceWalkingDistances } from './src/game/farm-travel.ts';
  export { buildingReady } from './src/game/types.ts';
  export { installNavigationWasm } from './src/game/navigation-wasm.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: bundle });
const engine = await import(pathToFileURL(bundle).href);
await engine.installNavigationWasm(await readFile('public/wasm/navigation.wasm'));
const state = JSON.parse(await readFile(statePath, 'utf8'));
const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === 0 && unit.hp > 0);
assert(leader, 'A living player leader is required.');
const palace = state.buildings.filter(building => building.kind === 'palace' && building.faction === leader.faction && engine.buildingReady(building))
  .sort((a, b) => Math.hypot(a.x - leader.x, a.y - leader.y) - Math.hypot(b.x - leader.x, b.y - leader.y))[0];
assert(palace, 'A completed player palace is required.');
const field = engine.palaceWalkingDistances(state, palace), count = Math.min(256, field.length);
const sorted = distances => Array.from({ length: distances.length }, (_, cell) => cell)
  .sort((a, b) => distances[a] - distances[b] || a - b);
const expected = sorted(field), samples = { sorted: [], lazy: [] };
for (let round = 0; round < 7; round++) for (const mode of round % 2 ? ['lazy', 'sorted'] : ['sorted', 'lazy']) {
  const distances = field.slice(), start = performance.now();
  let result;
  if (mode === 'sorted') result = sorted(distances).slice(0, count);
  else {
    result = [];
    for (const cell of engine.orderedDistanceCells(distances)) { result.push(cell); if (result.length === count) break; }
  }
  const elapsed = performance.now() - start;
  assert.deepEqual(result, expected.slice(0, count));
  if (round) samples[mode].push(elapsed);
  if (!round && mode === 'lazy') assert.deepEqual([...engine.orderedDistanceCells(distances)], expected);
}
const report = {
  methodology: 'Actual nearest player-palace travel field; 256 nearest candidates consumed. Full-sort oracle versus lazy exact heap ordering, six alternating rounds after one warmup. A fresh immutable field is used each round; copying the field and calculating navigation are outside timing. Complete ordering parity is also checked on the actual field. This isolates ordering, not whole construction or FPS.',
  statePath, cpu: os.cpus()[0]?.model, cells: field.length, candidates: count, palace: palace.id, parity: true,
  results: Object.fromEntries(Object.entries(samples).map(([mode, values]) => [mode, {
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    maxMs: Math.max(...values), samplesMs: values,
  }])),
};
await writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
