import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const script = await build({ entryPoints:['dev/river-network-design/main.ts'], bundle:true, write:false, format:'iife', target:'es2022', minify:true });
const atlas = `data:image/png;base64,${(await readFile('public/assets/puny-world/overworld.png')).toString('base64')}`;
const notes = await readFile('dev/river-network-design/design-notes.md','utf8');
const template = await readFile('dev/river-network-design/template.html','utf8');
const html = template.replace('/*ATLAS*/',()=>JSON.stringify(atlas)).replace('/*DESIGN_NOTES*/',()=>JSON.stringify(notes).replaceAll('<','\\u003c'))
  .replace('/*SCRIPT*/',()=>script.outputFiles[0].text.replaceAll('</script','<\\/script'));
await mkdir('output',{recursive:true});await writeFile('output/river-network-design.html',html);
console.log(`Built output/river-network-design.html (${(Buffer.byteLength(html)/1024).toFixed(0)} KB, fully offline)`);
