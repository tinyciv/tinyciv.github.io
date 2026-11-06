import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const scratch = 'scratch/2026-10-30-open-forests';
await mkdir(scratch, { recursive: true }); await mkdir('output', { recursive: true });
const modelPath = resolve(`${scratch}/review-generator.snapshot.mjs`);
const bundle = await build({ stdin: { contents: `export { generateWorld } from './src/world/generator.ts'; export * from './dev/open-forest-review/model.ts';`,
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
await writeFile(modelPath, bundle.outputFiles[0].text);
const { generateWorld, forestSummary, overviewPixels, REVIEW_SEEDS, REVIEW_STYLES } = await import(pathToFileURL(modelPath).href);
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
for (const [seedIndex, seed] of REVIEW_SEEDS.entries()) for (const [styleIndex, style] of REVIEW_STYLES.entries()) {
  const began = performance.now(), world = generateWorld(seed, undefined, undefined, { style });
  const id = `${String.fromCharCode(65 + seedIndex)}${styleIndex + 1}`, summary = forestSummary(world);
  const compressed = gzipSync(JSON.stringify(world), { level: 9 });
  const record = { id, seed, style, width: world.width, height: world.height, parameters: world.generationParameters,
    summary, capitals: world.spawns, secondary: world.secondarySpawns ?? [],
    preview: `data:image/png;base64,${png(world.width, world.height, overviewPixels(world)).toString('base64')}`,
    compressedWorld: compressed.toString('base64') };
  records.push(record); metrics.push({ id, seed, style, generationMs: Math.round(performance.now() - began), summary, parameters: record.parameters });
  await writeFile(`${scratch}/${id}-${style}.world.json.gz`, compressed);
  console.log(`${id} ${style} / ${seed}: ${(summary.forest * 100).toFixed(1)}% wooded; ${(summary.adjacentOpenGround * 100).toFixed(1)}% of trees touch a reachable gap; ${summary.solidTwoByTwo} solid 2×2 patches`);
}
const files = { world: 'public/assets/puny-world/overworld.png', desert: 'public/assets/puny-world/desert-ledges.png', vegetation: 'public/assets/vegetation/medieval-nature.png' };
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, `data:image/png;base64,${(await readFile(file)).toString('base64')}`])));
const ui = await build({ entryPoints: ['dev/open-forest-review/main.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', minify: true,
  define: { 'import.meta.env.BASE_URL': '"./"' } });
const safe = value => value.replaceAll('</script', '<\\/script');
const html = (await readFile('dev/open-forest-review/template.html', 'utf8')).replace('/*DATA*/', () => safe(JSON.stringify(records)))
  .replace('/*ASSETS*/', () => safe(JSON.stringify(assets))).replace('/*BUNDLE*/', () => safe(ui.outputFiles[0].text));
await writeFile('output/open-forest-world-review.html', html);
await writeFile(`${scratch}/review-metrics.json`, JSON.stringify(metrics, null, 2));
console.log(`Built output/open-forest-world-review.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB, 9 embedded worlds, no network required)`);
