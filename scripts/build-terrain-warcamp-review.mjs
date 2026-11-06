import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const folder = 'scratch/2026-11-01-terrain-warcamps';
await mkdir(folder, { recursive: true });
await mkdir('output', { recursive: true });
const model = await build({ entryPoints: ['dev/warcamp-terrain-review/model.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const modelPath = resolve(`${folder}/model.snapshot.mjs`);
await writeFile(modelPath, model.outputFiles[0].text);
const { buildReview, validatePlan, planCamp } = await import(pathToFileURL(modelPath).href);
const initial = buildReview(1);
if (!Array.isArray(initial) || !initial.length) throw new Error('Terrain camp review produced no cases.');
if (initial.filter(item => item.plan.status === 'placed').length !== 3 || initial.filter(item => item.plan.status === 'rejected').length !== 1)
  throw new Error('Seed 1 must show three placed camps and one honest rejection.');
await writeFile(`${folder}/initial-cases.json`, JSON.stringify(initial));
const validation = [], preservation = [];
for (const seed of [1, 2, 3, 17]) {
  const cases = seed === 1 ? initial : buildReview(seed);
  for (const item of cases) {
    const result = validatePlan(item.world, item.plan);
    validation.push({ seed, id: item.id, status: item.plan.status, metrics: item.plan.metrics, ...result });
    const world = structuredClone(item.world), before = JSON.stringify(world), bounds = item.plan.bounds;
    const anchor = bounds ? { x: Math.floor(bounds.x + bounds.width / 2), y: Math.floor(bounds.y + bounds.height / 2) }
      : { x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) };
    const repeated = planCamp(world, anchor, seed);
    preservation.push({ seed, id: item.id, status: repeated.status, unchanged: JSON.stringify(world) === before });
  }
}
if (validation.some(result => !result.valid)) throw new Error(`Terrain camp validation failed: ${JSON.stringify(validation.filter(result => !result.valid))}`);
if (JSON.stringify(initial) !== JSON.stringify(buildReview(1))) throw new Error('The same terrain review seed produced different cases.');
if (preservation.some(result => !result.unchanged)) throw new Error('Camp placement changed the existing world.');
await writeFile(`${folder}/model-validation.json`, JSON.stringify(validation, null, 2));
await writeFile(`${folder}/terrain-preservation.json`, JSON.stringify(preservation, null, 2));

const files = {
  world: 'public/assets/puny-world/overworld.png',
  palisades: 'dev/marauder-camp-review/art/palisades.png',
  lookouts: 'dev/marauder-camp-review/art/lookouts.png',
};
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, path]) =>
  [name, `data:image/png;base64,${(await readFile(path)).toString('base64')}`])));
const bundle = await build({ entryPoints: ['dev/warcamp-terrain-review/main.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', minify: true,
  define: { 'import.meta.env.BASE_URL': '"./"' } });
const safe = value => value.replaceAll('</script', '<\\/script');
const template = await readFile('dev/warcamp-terrain-review/template.html', 'utf8');
if (!template.includes('/*ASSETS*/') || !template.includes('/*BUNDLE*/')) throw new Error('Missing standalone review placeholders.');
const html = template.replace('/*ASSETS*/', () => safe(JSON.stringify(assets))).replace('/*BUNDLE*/', () => safe(bundle.outputFiles[0].text));
await writeFile('output/marauder-terrain-review.html', html);
await writeFile(`${folder}/review.html`, html);
console.log(`Built output/marauder-terrain-review.html: ${initial.length} terrain cases, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, offline assets and procedural regeneration embedded.`);
console.log(`Validated ${validation.length} plans across four seeds and deterministic repeated generation.`);
