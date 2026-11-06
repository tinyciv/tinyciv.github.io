import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = process.argv[2] ?? 'scratch/2026-10-30-slim-mountains/landscape-after.json';
const bundlePath = resolve(output.replace(/\.json$/, '.snapshot.mjs'));
await mkdir(dirname(bundlePath), { recursive: true });
const bundle = await build({ stdin: { contents: `
  export { generateWorld } from './src/world/generator.ts';
  export { landscapeMetrics } from './dev/world-generation-lab/metrics.ts';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { generateWorld, landscapeMetrics } = await import(pathToFileURL(bundlePath).href);
const samples = [];
for (const seed of ['CROWN', 'NEW-HORIZONS', 'BTV-world-modes-review'])
  for (const style of ['continents', 'pangaea', 'fractal']) samples.push(landscapeMetrics(generateWorld(seed, undefined, undefined, { style })));
const means = {};
for (const key of Object.keys(samples[0]).filter(key => typeof samples[0][key] === 'number'))
  means[key] = samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
await writeFile(output, JSON.stringify({ means, samples }, null, 2));
console.log(JSON.stringify({ output, means }, null, 2));
