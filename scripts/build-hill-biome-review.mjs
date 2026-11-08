import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const folder = 'scratch/2026-11-07-tiered-hill-biomes';
await mkdir(folder, { recursive: true });
await mkdir('output', { recursive: true });
const model = await build({ entryPoints: ['dev/hill-biome-review/model.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const snapshot = resolve(`${folder}/generator.snapshot.mjs`);
await writeFile(snapshot, model.outputFiles[0].text);
const { REVIEW_WORLDS, generateHillWorld } = await import(pathToFileURL(snapshot).href);
const records = [], metrics = [];
for (const definition of REVIEW_WORLDS) {
  const path = `${folder}/${definition.id}.world.json.gz`, start = performance.now();
  const scene = process.argv.includes('--reuse-worlds') ? JSON.parse(gunzipSync(await readFile(path)).toString()) : generateHillWorld(definition);
  const compressed = gzipSync(JSON.stringify(scene), { level: 9 });
  await writeFile(path, compressed);
  records.push({ ...definition, compressedScene: compressed.toString('base64') });
  metrics.push({ ...definition, metrics: scene.metrics, regions: scene.regions });
  console.log(`${definition.name}: ${scene.world.width}×${scene.world.height}, ${Math.round(performance.now() - start)}ms`);
}
const files = {
  world: 'public/assets/puny-world/overworld.png', desert: 'public/assets/puny-world/desert-ledges.png',
  medieval: 'public/assets/vegetation/medieval-nature.png', salt: 'public/assets/resources/salt-pan-joins.png',
  ...Object.fromEntries(['2A','2B','2C','2D'].map(id => [`marsh-${id}`, `public/assets/vegetation/marsh/${id}.png`])),
};
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([id, path]) => [id, `data:image/png;base64,${(await readFile(path)).toString('base64')}`])));
const font = async name => `data:font/ttf;base64,${(await readFile(`public/assets/fonts/pixel-operator/${name}.ttf`)).toString('base64')}`;
const ui = await build({ entryPoints: ['dev/hill-biome-review/main.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', minify: true, define: { 'import.meta.env.BASE_URL': '"./"' } });
const safe = value => value.replaceAll('</script', '<\\/script');
const html = (await readFile('dev/hill-biome-review/template.html', 'utf8'))
  .replace('/*FONT*/', await font('PixelOperator')).replace('/*FONT_BOLD*/', await font('PixelOperator-Bold'))
  .replace('/*DATA*/', () => safe(JSON.stringify(records))).replace('/*ASSETS*/', () => safe(JSON.stringify(assets)))
  .replace('/*BUNDLE*/', () => safe(ui.outputFiles[0].text));
await writeFile('output/hill-biome-worlds.html', html);
await writeFile('output/hill-biome-worlds-v2.html', html);
await writeFile(`${folder}/review.html`, html);
await writeFile(`${folder}/metrics.json`, JSON.stringify(metrics, null, 2));
console.log(`Built output/hill-biome-worlds.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB).`);
