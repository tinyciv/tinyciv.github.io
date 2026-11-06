import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('output', { recursive: true });
const files = { world: 'public/assets/puny-world/overworld.png', desert: 'public/assets/puny-world/desert-ledges.png',
  vegetation: 'public/assets/vegetation/medieval-nature.png' };
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key,
  `data:image/png;base64,${(await readFile(file)).toString('base64')}`])));
const bundle = await build({ entryPoints: ['dev/world-generation-lab/main.ts'], bundle: true, write: false,
  format: 'esm', target: 'es2022', minify: true, define: { 'import.meta.env.BASE_URL': '"./"' } });
const html = (await readFile('dev/world-generation-lab/template.html', 'utf8'))
  .replace('/*ASSETS*/', () => JSON.stringify(assets))
  .replace('/*BUNDLE*/', () => bundle.outputFiles[0].text.replaceAll('</script', '<\\/script'));
await writeFile('output/world-generation-lab.html', html);
console.log(`Built output/world-generation-lab.html (${Math.round(Buffer.byteLength(html) / 1024)} KB; embedded assets; no server required)`);
