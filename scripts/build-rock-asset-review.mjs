import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const manifests = ['lpc.json', 'puny-tiny.json', 'other.json'];
const entries = (await Promise.all(manifests.map(file => readFile(`dev/rock-asset-review/${file}`, 'utf8').then(JSON.parse)))).flat();
try { entries.push(...JSON.parse(await readFile('dev/rock-asset-review/flare.json', 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const ids = new Set(), images = {}, aliases = new Map(), hashes = new Map();
for (const entry of entries) {
  if (!entry.id || ids.has(entry.id)) throw new Error(`Missing/duplicate ID: ${entry.id}`);
  ids.add(entry.id);
  const source = entry.source.startsWith('/assets/') ? `public${entry.source}` : entry.source;
  const path = resolve(root, source);
  entry.source = relative(root, path);
  if (!aliases.has(entry.source)) {
    const bytes = await readFile(path);
    if (bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error(`Expected original PNG: ${source}`);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = hashes.get(hash) || `source-${hash.slice(0, 16)}`;
    hashes.set(hash, key); aliases.set(entry.source, key);
    images[key] ??= { width, height, data: `data:image/png;base64,${bytes.toString('base64')}`, hash };
  }
  entry.image = aliases.get(entry.source);
  const image = images[entry.image];
  if (![entry.x, entry.y, entry.width, entry.height].every(Number.isInteger)
    || entry.x < 0 || entry.y < 0 || entry.width < 1 || entry.height < 1
    || entry.x + entry.width > image.width || entry.y + entry.height > image.height)
    throw new Error(`Invalid crop ${entry.id}: ${JSON.stringify(entry)} for ${image.width}×${image.height}`);
}
const licenseFiles = [
  'public/assets/puny-world/LICENSE.txt', 'public/assets/puny-world/DUNGEON-LICENSE.txt',
  'public/assets/tiny-overworld/LICENSE.txt', 'public/assets/miniworld/LICENSE.txt',
  'public/assets/lpc-rocks/LICENSE.txt', 'public/assets/lpc-rocks/CREDITS-rocks.txt',
  'public/assets/lpc-overworld/LICENSE.txt', 'public/assets/lpc-overworld/CREDITS.txt',
];
const credits = await Promise.all(licenseFiles.map(async path => ({ path, text: await readFile(path, 'utf8') })));
const inventory = {};
for (const name of ['inventory.json', 'other-notes.json', 'lpc-notes.json']) {
  try { inventory[name] = JSON.parse(await readFile(`dev/rock-asset-review/${name}`, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const notes of Object.values(inventory)) for (const path of notes.creditPaths || []) {
  if (credits.some(credit=>credit.path===path) || /\.json$/i.test(path) || !/(LICENSE|COPYING|CREDITS?|\.txt$|\.md$)/i.test(path)) continue;
  credits.push({path,text:await readFile(path,'utf8')});
}
const data = { entries, images, credits, inventory };
const template = await readFile('dev/rock-asset-review/template.html', 'utf8');
const script = await readFile('dev/rock-asset-review/main.js', 'utf8');
const safe = value => value.replaceAll('<', '\\u003c');
const html = template.replace('/*CATALOG_DATA*/', () => safe(JSON.stringify(data)))
  .replace('/*CATALOG_SCRIPT*/', () => script.replaceAll('</script', '<\\/script'));
await mkdir('output', { recursive: true });
await mkdir('scratch/2026-10-30-rock-assets', { recursive: true });
await writeFile('output/rock-asset-review.html', html);
await writeFile('scratch/2026-10-30-rock-assets/catalog.json', JSON.stringify({ entries, sources: Object.fromEntries(Object.entries(images).map(([key, { data, ...metadata }]) => [key, metadata])), inventory }, null, 2));
console.log(JSON.stringify({ output: 'output/rock-asset-review.html', entries: entries.length, packs: new Set(entries.map(entry => entry.pack)).size, sources: Object.keys(images).length, bytes: Buffer.byteLength(html) }, null, 2));
