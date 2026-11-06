import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync, deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const scratch = 'scratch/2026-10-30-landforms';
await mkdir(scratch, { recursive: true }); await mkdir('output', { recursive: true });
const reuse = process.argv.includes('--reuse-worlds');
const modelPath = resolve(`${scratch}/${reuse ? 'review-model' : 'review-generator'}.snapshot.mjs`);
const bundle = await build({ stdin: { contents: `export { generateWorld } from './src/world/generator.ts'; export * from './dev/landform-review/model.ts';`,
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
await writeFile(modelPath, bundle.outputFiles[0].text);
const { generateWorld, landformSummary, reviewPixels, REVIEW_SEEDS, REVIEW_FAMILIES, REVIEW_STYLE } = await import(pathToFileURL(modelPath).href);
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function crc32(bytes) { let n = 0xffffffff; for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ n >>> 8; return (n ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, crc]); }
function png(width, height, pixels) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const records = [], metrics = [];
const priorMetrics = reuse ? JSON.parse(await readFile(`${scratch}/review-metrics.json`, 'utf8')) : [];
for (const [familyIndex, family] of REVIEW_FAMILIES.entries()) for (const [seedIndex, seed] of REVIEW_SEEDS.entries()) {
  const id = `${familyIndex + 1}${String.fromCharCode(65 + seedIndex)}`, style = REVIEW_STYLE;
  const began = performance.now();
  const world = reuse ? JSON.parse(gunzipSync(await readFile(`${scratch}/${id}-${family}.world.json.gz`)).toString())
    : generateWorld(seed, undefined, undefined, { style, landformFamily: family });
  const generationMs = reuse ? priorMetrics.find(record => record.id === id).generationMs : Math.round(performance.now() - began);
  if (world.landformFamily !== family || !world.landformProvinces?.length) throw new Error(`${id}: missing or mismatched landform generation metadata`);
  const summary = landformSummary(world), compressed = gzipSync(JSON.stringify(world), { level: 9 });
  const previews = Object.fromEntries(['terrain', 'height', 'provinces'].map(mode => [mode, `data:image/png;base64,${png(world.width, world.height, reviewPixels(world, mode)).toString('base64')}`]));
  const record = { id, seed, style, family, width: world.width, height: world.height, parameters: world.generationParameters, generationMs,
    summary, capitals: world.spawns, secondary: world.secondarySpawns ?? [], provinces: world.landformProvinces, previews,
    compressedWorld: compressed.toString('base64') };
  records.push(record); metrics.push({ id, seed, style, family, width: world.width, height: world.height, capitals: world.spawns.length, secondary: world.secondarySpawns?.length ?? 0, generationMs, summary, parameters: record.parameters });
  if (!reuse) await writeFile(`${scratch}/${id}-${family}.world.json.gz`, compressed);
  console.log(`${id} ${family} / ${seed}: ${(summary.raisedShare * 100).toFixed(1)}% raised, ${summary.reliefShapes.length} relief bodies, ${summary.lakeCount} lakes, ${(summary.forest * 100).toFixed(1)}% woodland, ${generationMs}ms`);
}
const files = { world: 'public/assets/puny-world/overworld.png', desert: 'public/assets/puny-world/desert-ledges.png', vegetation: 'public/assets/vegetation/medieval-nature.png' };
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, `data:image/png;base64,${(await readFile(file)).toString('base64')}`])));
const ui = await build({ entryPoints: ['dev/landform-review/main.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', minify: true,
  define: { 'import.meta.env.BASE_URL': '"./"' } });
const safe = value => value.replaceAll('</script', '<\\/script');
const html = (await readFile('dev/landform-review/template.html', 'utf8')).replace('/*DATA*/', () => safe(JSON.stringify(records)))
  .replace('/*ASSETS*/', () => safe(JSON.stringify(assets))).replace('/*BUNDLE*/', () => safe(ui.outputFiles[0].text));
await writeFile('output/landform-world-review.html', html);
await writeFile(`${scratch}/review-metrics.json`, JSON.stringify(metrics, null, 2));
console.log(`Built output/landform-world-review.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB, 12 embedded worlds, no network required)`);
