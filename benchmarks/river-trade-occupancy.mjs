// Compare unchanged scalar dock checks with the planner's occupancy snapshot.
// Run serially: node benchmarks/river-trade-occupancy.mjs --state=path/to/state.json
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const statePath = arg('state');
assert(statePath, 'Required: --state=path/to/state.json');
const directory = path.resolve(arg('out', 'scratch/river-trade-occupancy'));
await mkdir(directory, { recursive: true });
const bundle = path.join(directory, 'dock.mjs');
await build({ stdin: { contents: `export { createDockShoreCrossingQuery, dockShoreCrossingClear } from './src/game/dock.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: bundle });
const { createDockShoreCrossingQuery, dockShoreCrossingClear } = await import(pathToFileURL(bundle).href);
const state = JSON.parse(await readFile(statePath, 'utf8')), { width, height, tiles } = state.world;
const waterKinds = new Set(['river', 'lake', 'ocean', 'coast']), candidates = [];
for (let cell = 0; cell < tiles.length && candidates.length < 4096; cell++) {
  if (tiles[cell].terrain !== 'river') continue;
  const x = cell % width, y = Math.floor(cell / width);
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const sx = x + dx, sy = y + dy;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height || waterKinds.has(tiles[sy * width + sx].terrain)) continue;
    candidates.push([{ x: x + .5, y: y + .5 }, { x: sx + .5, y: sy + .5 }]);
    if (candidates.length === 4096) break;
  }
}
assert(candidates.length > 0, 'The supplied world needs river-bank candidates.');
const samples = { scalar: [], snapshot: [] };
const evaluate = mode => {
  const start = performance.now();
  // Include construction of the snapshot in the measured batch.
  const query = mode === 'snapshot' ? createDockShoreCrossingQuery(state)
    : (water, shore) => dockShoreCrossingClear(state, water, shore);
  const result = candidates.map(([water, shore]) => query(water, shore));
  return { result, elapsed: performance.now() - start };
};
const oracle = evaluate('scalar').result;
assert.deepEqual(evaluate('snapshot').result, oracle);
for (let round = 0; round < 5; round++) for (const mode of round % 2 ? ['snapshot', 'scalar'] : ['scalar', 'snapshot']) {
  const measured = evaluate(mode);
  assert.deepEqual(measured.result, oracle);
  samples[mode].push(measured.elapsed);
}
const report = { methodology: 'Actual saved-world river banks, up to 4096 candidates. Same unchanged scalar crossing function is the oracle. Five alternating-order batches per mode after one warmup; snapshot construction included. This isolates shore occupancy, not complete trade planning or FPS.',
  cpu: os.cpus()[0]?.model, statePath, buildings: state.buildings.length, candidates: candidates.length,
  clearCandidates: oracle.filter(Boolean).length, parity: true,
  results: Object.fromEntries(Object.entries(samples).map(([mode, times]) => [mode,
    { meanMs: times.reduce((sum, value) => sum + value, 0) / times.length, maxMs: Math.max(...times), samplesMs: times }])) };
await writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
