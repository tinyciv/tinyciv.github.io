import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const scratch = 'scratch/2026-10-30-fractal-review';
await mkdir(scratch, { recursive: true }); await mkdir('output', { recursive: true });
const modelPath = resolve(`${scratch}/gallery-generator.snapshot.mjs`);
const model = await build({ stdin: { contents: `export { generateWorld } from './src/world/generator.ts'; export * from './dev/fractal-gallery/model.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
await writeFile(modelPath, model.outputFiles[0].text);
const { generateWorld, sampleSettings, measure, overviewPixels } = await import(pathToFileURL(modelPath).href);
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function crc32(bytes) { let n = 0xffffffff; for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ n >>> 8; return (n ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, crc]); }
function png(width, height, pixels) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const records = [], metrics = [], started = performance.now();
for (const sample of sampleSettings()) {
  const start = performance.now(), world = generateWorld(sample.seed, undefined, undefined, { style: 'fractal', parameters: sample.parameters });
  const summary = measure(world), preview = `data:image/png;base64,${png(world.width, world.height, overviewPixels(world)).toString('base64')}`;
  records.push({ ...sample, width: world.width, height: world.height, summary, capitals: world.spawns, secondary: world.secondarySpawns ?? [], preview });
  metrics.push({ id: sample.id, summary, generationMs: Math.round(performance.now() - start), parameters: sample.parameters });
  console.log(`Sample ${sample.id}: ${Math.round(summary.forest * 100)}% woodland, ${Math.round(summary.desert * 100)}% desert, ${summary.mountainBodies} mountain bodies, ${summary.lakeCount} lakes, ${summary.minimumStartDistance.toFixed(1)} tile minimum capital gap`);
}
const files = { world: 'public/assets/puny-world/overworld.png', desert: 'public/assets/puny-world/desert-ledges.png', vegetation: 'public/assets/vegetation/medieval-nature.png' };
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, `data:image/png;base64,${(await readFile(file)).toString('base64')}`])));
const bundle = await build({ entryPoints: ['dev/fractal-gallery/main.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', minify: true, define: { 'import.meta.env.BASE_URL': '"./"' } });
const html = (await readFile('dev/fractal-gallery/template.html', 'utf8')).replace('/*DATA*/', () => JSON.stringify(records).replaceAll('</script', '<\\/script')).replace('/*ASSETS*/', () => JSON.stringify(assets)).replace('/*BUNDLE*/', () => bundle.outputFiles[0].text.replaceAll('</script', '<\\/script'));
await writeFile('output/fractal-generation-gallery.html', html);
await writeFile(`${scratch}/gallery-samples.json`, JSON.stringify({ seed: records[0].seed, elapsedMs: Math.round(performance.now() - started), samples: metrics }, null, 2));
console.log(`Built output/fractal-generation-gallery.html (${Math.round(Buffer.byteLength(html) / 1024)} KB; 25 precomputed worlds; no network required)`);
