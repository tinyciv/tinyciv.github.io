import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('output/company-lab',{recursive:true});
const files={world:'public/assets/puny-world/overworld.png',infantry:'public/assets/puny-world/characters/Human-Soldier-Cyan.png',archer:'public/assets/puny-world/characters/Archer-Green.png',arrow:'public/assets/puny-world/Arrow.png'};
const assets=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,file])=>[key,`data:image/png;base64,${(await readFile(file)).toString('base64')}`])));
const bundle=await build({entryPoints:['dev/company-lab/ui.ts'],bundle:true,write:false,format:'esm',target:'es2022',minify:true});
const html=(await readFile('dev/company-lab/template.html','utf8')).replace('/*ASSETS*/',()=>JSON.stringify(assets)).replace('/*BUNDLE*/',()=>bundle.outputFiles[0].text.replaceAll('</script','<\\/script'));
await writeFile('output/company-lab.html',html);
console.log(`Built output/company-lab.html (${Math.round(Buffer.byteLength(html)/1024)}KB, embedded assets, no server required)`);
