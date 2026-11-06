import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const folder = 'scratch/2026-11-01-delta-worlds';
await mkdir(folder, { recursive: true }); await mkdir('output', { recursive: true });
const reuse = process.argv.includes('--reuse-worlds');
const model = await build({ stdin: { contents: "export { generateWorld } from './src/world/generator.ts'; export { REVIEW_WORLDS } from './dev/delta-world-review/model.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const modelPath = resolve(`${folder}/review-generator.snapshot.mjs`); await writeFile(modelPath, model.outputFiles[0].text);
const { generateWorld, REVIEW_WORLDS } = await import(pathToFileURL(modelPath).href);
const records = [], metrics = [];
for (const definition of REVIEW_WORLDS) {
  const start = performance.now(), options = { style: definition.style, landformFamily: definition.family };
  const world = reuse ? JSON.parse(gunzipSync(await readFile(`${folder}/${definition.id}.world.json.gz`)).toString()) : generateWorld(definition.seed, undefined, undefined, options);
  const before = reuse ? JSON.parse(gunzipSync(await readFile(`${folder}/${definition.id}.before.json.gz`)).toString()) : generateWorld(definition.seed, undefined, undefined, { ...options, riverDeltas: false });
  const generationMs = Math.round(performance.now() - start);
  const zipped = gzipSync(JSON.stringify(world), { level: 9 }), beforeZipped = gzipSync(JSON.stringify(before), { level: 9 });
  if (!reuse) { await writeFile(`${folder}/${definition.id}.world.json.gz`, zipped); await writeFile(`${folder}/${definition.id}.before.json.gz`, beforeZipped); }
  const record = { ...definition, width: world.width, height: world.height, generationMs, deltaCount: world.riverDeltas?.length ?? 0, marshTiles: world.tiles.filter(tile => tile.marsh).length, compressedWorld: zipped.toString('base64'), compressedBefore: beforeZipped.toString('base64') };
  records.push(record);
  metrics.push({ ...definition, width: world.width, height: world.height, generationMs, deltaCount: record.deltaCount, marshTiles: record.marshTiles, deltas: world.riverDeltas ?? [] });
  console.log(`${definition.id} ${definition.seed}: ${record.deltaCount} deltas, ${record.marshTiles} dry marsh tiles, ${generationMs}ms including comparison`);
}
const files = { world: 'public/assets/puny-world/overworld.png', desert: 'public/assets/puny-world/desert-ledges.png', vegetation: 'public/assets/vegetation/medieval-nature.png', ...Object.fromEntries(['2A', '2B', '2C', '2D'].map((id, i) => [`plant${i}`, `public/assets/vegetation/marsh/${id}.png`])) };
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([id, path]) => [id, `data:image/png;base64,${(await readFile(path)).toString('base64')}`])));
const ui = await build({ entryPoints: ['dev/delta-world-review/main.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', minify: true, define: { 'import.meta.env.BASE_URL': '"./"' } });
const safe = value => value.replaceAll('</script', '<\\/script');
const html = (await readFile('dev/delta-world-review/template.html', 'utf8')).replace('/*DATA*/', () => safe(JSON.stringify(records))).replace('/*ASSETS*/', () => safe(JSON.stringify(assets))).replace('/*BUNDLE*/', () => safe(ui.outputFiles[0].text));
await writeFile('output/delta-world-review.html', html); await writeFile(`${folder}/review.html`, html); await writeFile(`${folder}/review-metrics.json`, JSON.stringify(metrics, null, 2));
console.log(`Built output/delta-world-review.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB, four embedded worlds and comparisons)`);
