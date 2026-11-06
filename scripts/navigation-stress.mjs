import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const root = 'scratch/2026-10-26-gameplay-overhaul';
const phase = process.argv[2] ?? 'after';
if (phase !== 'before') await build({ stdin: { contents: `export { moveUnit, updateFriendlyYield } from './src/game/simulation'; export { beginNavigationFrame, endNavigationFrame } from './src/game/pathfinding'; export { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from './src/game/spatial';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: `${root}/navigation-${phase}.mjs` });
await build({ entryPoints: ['dev/navigation-lab/stress.ts'], bundle: true, platform: 'node', format: 'esm', outfile: `${root}/stress-runner.mjs` });
const driver = await import(pathToFileURL(`${process.cwd()}/${root}/navigation-${phase}.mjs`));
const { STRESS_SCENARIOS, runStress } = await import(pathToFileURL(`${process.cwd()}/${root}/stress-runner.mjs`));
const results = [];
for (const scenario of STRESS_SCENARIOS) {
  const runs = Array.from({ length: 3 }, (_, run) => runStress(scenario, driver, 60, run === 2));
  const result = runs[2]; result.cpuMs = runs.map(run => run.cpuMs).sort((a, b) => a - b)[1];
  results.push(result);
  console.log(JSON.stringify({ ...result, layout: undefined, frames: undefined, stuck: result.stuck.length }));
}
await writeFile(`${root}/navigation-${phase}.json`, JSON.stringify(results));
