import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const folder = 'scratch/2026-11-01-warcamp-tight';
await mkdir(folder, { recursive: true }); await mkdir('output', { recursive: true });
const model = await build({ entryPoints: ['dev/marauder-camp-review/layouts.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const modelPath = resolve(`${folder}/layouts.snapshot.mjs`); await writeFile(modelPath, model.outputFiles[0].text);
const { CAMP_LAYOUTS, validateCampLayout } = await import(pathToFileURL(modelPath).href);
for (const layout of CAMP_LAYOUTS) {
  const ratio = layout.width * layout.height / (layout.previousWidth * layout.previousHeight);
  if (!Number.isFinite(ratio) || ratio > .4) throw new Error(`${layout.id} has not been made sufficiently compact.`);
}
const validation = CAMP_LAYOUTS.map(layout => ({ id: layout.id, result: validateCampLayout(layout) }));
if (validation.some(check => !check.result.valid)) throw new Error(`Invalid camp layouts: ${JSON.stringify(validation)}`);
await writeFile(`${folder}/layout-validation.json`, JSON.stringify(validation, null, 2));
const files = { world: 'public/assets/puny-world/overworld.png', palisades: 'dev/marauder-camp-review/art/palisades.png',
  lookouts: 'dev/marauder-camp-review/art/lookouts.png' };
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, path]) => [name, `data:image/png;base64,${(await readFile(path)).toString('base64')}`])));
const bundle = await build({ entryPoints: ['dev/marauder-camp-review/main.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', minify: true, define: { 'import.meta.env.BASE_URL': '"./"' } });
const safe = text => text.replaceAll('</script', '<\\/script');
const html = (await readFile('dev/marauder-camp-review/template.html', 'utf8')).replace('/*ASSETS*/', () => safe(JSON.stringify(assets))).replace('/*BUNDLE*/', () => safe(bundle.outputFiles[0].text));
await writeFile('output/marauder-camp-review.html', html); await writeFile('output/marauder-camp-review-compact.html', html);
await writeFile(`${folder}/review.html`, html);
const warcamp = CAMP_LAYOUTS.find(layout => layout.id === '3B');
const focused = html
  .replace('<title>Compact marauder camps · Timber studies</title>', '<title>Blackroot Warcamp · Tighter stockades</title>')
  .replace('<body>', '<body class="focused-review">')
  .replace('<h1>Compact marauder camps</h1>', '<h1>Blackroot Warcamp</h1>')
  .replace('Tight tent rows, narrow lanes, and layered timber defenses. Only tents, wooden walls, guard towers, signs, and roads.',
    `${warcamp.width} × ${warcamp.height} tiles, down from 25 × 25. Three irregular defensive tiers, tighter tent wards, and strictly single-tile palisades. Toggle the grid to inspect each wall.`)
  .replace('<b>06</b>Compact variants · 2–3 wall tiers', '<b>3B · Revised</b>Single-tile stockades')
  .replace('window.MARAUDER_ASSETS=', 'window.MARAUDER_FOCUS={campId:"3B",previousWidth:25,previousHeight:25};window.MARAUDER_ASSETS=');
await writeFile('output/marauder-warcamp-tight.html', focused);
await writeFile(`${folder}/warcamp.html`, focused);
console.log(`Built output/marauder-camp-review.html: ${CAMP_LAYOUTS.length} camps, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, all assets embedded.`);
console.log(JSON.stringify(validation));
