import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const out = 'scratch/2026-11-03-formation'; await mkdir(out, { recursive: true });
const files = { world: 'public/assets/puny-world/overworld.png', soldier: 'public/assets/puny-world/characters/Human-Soldier-Cyan.png',
  leader: 'public/assets/puny-world/characters/Warrior-Blue.png', enemy: 'public/assets/puny-world/characters/Orc-Grunt.png' };
const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, `data:image/png;base64,${(await readFile(file)).toString('base64')}`])));
const font = `data:font/ttf;base64,${(await readFile('public/assets/fonts/pixel-operator/PixelOperator.ttf')).toString('base64')}`;
const bundle = await build({ entryPoints: ['dev/formation-lab/main.ts'], bundle: true, write: false, format: 'esm', target: 'es2022', minify: true });
const html = (await readFile('dev/formation-lab/template.html', 'utf8')).replace('/*FONT*/', font)
  .replace('/*ASSETS*/', () => JSON.stringify(assets)).replace('/*BUNDLE*/', () => bundle.outputFiles[0].text.replaceAll('</script', '<\\/script'));
await writeFile(`${out}/index.html`, html); console.log(`Built ${out}/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB, all assets and font embedded).`);
