import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const folder = 'scratch/2026-11-01-terrain-warcamps';
await mkdir(folder, { recursive: true });
const helper = await build({ stdin: { contents: "export { traversable, canTraverseEdge } from './src/game/pathfinding.ts'; export { ridgeFootprintAllowed } from './src/game/ridges.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const helperPath = resolve(`${folder}/navigation-check.snapshot.mjs`);
await writeFile(helperPath, helper.outputFiles[0].text);
const { traversable, canTraverseEdge, ridgeFootprintAllowed } = await import(pathToFileURL(helperPath).href);
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1060 }, deviceScaleFactor: 1 });
const checks = [], errors = [], network = [], audits = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
function check(name, pass, detail) {
  checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
}
const water = new Set(['ocean', 'coast', 'river', 'lake']);
const directions = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function audit(item, seed) {
  const { world, plan } = item;
  if (plan.status === 'rejected') return { seed, id: item.id, rejected: true, valid: !plan.layout && !!plan.reason?.trim(), reason: plan.reason };
  const layout = plan.layout, issues = [], key = (x,y) => y * world.width + x;
  if (!layout) return { seed, id:item.id, valid:false, issues:['Placed plan has no layout'] };
  const walls = new Set(layout.walls.map(p => key(p.x,p.y))), gates = new Set(layout.gates.map(p => key(p.x,p.y)));
  const towers = new Set(layout.towers.map(p => key(p.x,p.y))), tents = new Set(layout.tents.map(p => key(p.x,p.y))), signs = new Set(layout.signs.map(p => key(p.x,p.y)));
  const solid = new Set([...walls,...gates]);
  const dryWalkable = (x,y) => x >= 0 && y >= 0 && x < world.width && y < world.height && !water.has(world.tiles[key(x,y)].terrain) && traversable(world,x,y);
  for (const category of ['walls','gates','towers','tents','signs']) for (const p of layout[category]) {
    const tile = world.tiles[key(p.x,p.y)];
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !dryWalkable(p.x,p.y) || !ridgeFootprintAllowed(world,p.x,p.y)
      || ['forest','jungle'].includes(tile?.overlay)) issues.push(`${category} violates terrain at ${p.x},${p.y}`);
  }
  for (const cell of gates) if (walls.has(cell) || towers.has(cell) || tents.has(cell) || signs.has(cell)) issues.push(`Blocked gate ${cell}`);
  for (const cell of towers) if (!walls.has(cell)) issues.push(`Tower without wall ${cell}`);
  for (const cell of tents) if (solid.has(cell) || towers.has(cell) || signs.has(cell)) issues.push(`Tent overlap ${cell}`);
  for (const cell of signs) if (solid.has(cell) || towers.has(cell)) issues.push(`Sign overlap ${cell}`);
  for (let y=0;y<world.height-1;y++) for(let x=0;x<world.width-1;x++)
    if ([[x,y],[x+1,y],[x,y+1],[x+1,y+1]].every(([px,py])=>solid.has(key(px,py)))) issues.push(`Thick wall ${x},${y}`);
  const blocked = new Set([...walls,...towers,...tents,...signs]);
  for (const p of layout.paths) if (!dryWalkable(p.x,p.y) || blocked.has(key(p.x,p.y)) || !ridgeFootprintAllowed(world,p.x,p.y)
    || ['forest','jungle'].includes(world.tiles[key(p.x,p.y)]?.overlay)) issues.push(`Road violates preserved terrain ${p.x},${p.y}`);
  const costs = Array(world.width*world.height).fill(Infinity), queue=[];
  for (let y=0;y<world.height;y++) for(let x=0;x<world.width;x++) if (x===0||y===0||x===world.width-1||y===world.height-1) {
    const cell=key(x,y);if(dryWalkable(x,y)&&!blocked.has(cell)){costs[cell]=0;queue.push(cell);}
  }
  while(queue.length){
    queue.sort((a,b)=>costs[b]-costs[a]);const cell=queue.pop(),x=cell%world.width,y=Math.floor(cell/world.width);
    for(const[dx,dy]of directions){
      const nx=x+dx,ny=y+dy,next=key(nx,ny);
      if(!dryWalkable(nx,ny)||blocked.has(next)||!canTraverseEdge(world,{x,y},{x:nx,y:ny}))continue;
      const value=costs[cell]+Number(gates.has(next));if(value<costs[next]){costs[next]=value;queue.push(next);}
    }
  }
  const tentGateDepths=layout.tents.map(p=>({x:p.x,y:p.y,tier:p.tier,depth:costs[key(p.x,p.y+1)]}));
  for(const door of tentGateDepths) if(!Number.isFinite(door.depth)||door.depth<door.tier)issues.push(`Tent door ${door.x},${door.y+1}: expected tier ${door.tier}, got ${door.depth}`);
  const tiers=[...new Set([...layout.walls,...layout.gates].map(p=>p.tier))];
  if(tiers.length!==3||!tentGateDepths.some(p=>p.depth>=3&&Number.isFinite(p.depth)))issues.push('Missing complete third defensive tier');
  return {seed,id:item.id,valid:!issues.length,issues,bounds:plan.bounds,tiers,tents:layout.tents.length,walls:walls.size,gates:gates.size,towers:towers.size,tentGateDepths};
}
const geometry = cases => JSON.stringify(cases.map(item=>({id:item.id,status:item.plan.status,layout:item.plan.layout})));

try {
  await page.goto(pathToFileURL(resolve('output/marauder-terrain-review.html')).href);
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:60000});
  const initial=await page.evaluate(()=>window.__terrainCampReview.cases);
  check('only the three native game asset sheets are embedded',JSON.stringify(await page.evaluate(()=>Object.keys(window.MARAUDER_ASSETS).sort()))===JSON.stringify(['lookouts','palisades','world']));
  check('seed 1 includes three placed terrain cases and one honest rejected site', initial.length===4
    && initial.filter(item=>item.plan.status==='placed').length===3 && initial.filter(item=>item.plan.status==='rejected').length===1, initial.map(item=>({id:item.id,status:item.plan.status})));
  for(const item of initial){const result=audit(item,1);audits.push(result);check(`${item.id}: placement respects terrain, access, gates and wall thickness`,result.valid,result);}
  const views=[];
  for(let index=0;index<initial.length;index++){
    await page.locator(`#case-tabs button[data-index="${index}"]`).click();
    check(`${initial[index].id}: terrain case selection works`,await page.locator('#scene').getAttribute('data-id')===initial[index].id);
    views.push(await page.locator('#scene').evaluate(canvas=>canvas.toDataURL()));
    await page.locator('#scene').screenshot({path:`${folder}/terrain-${initial[index].id}.png`});
    if(initial[index].plan.status==='rejected')check('rejected terrain is labeled without a fabricated camp',await page.locator('#status').getAttribute('data-status')==='rejected'
      && (await page.locator('#reason').textContent()).trim().length>0);
  }
  check('different terrain cases produce different rendered landscapes',new Set(views).size===initial.length);
  const accepted=initial.findIndex(item=>item.plan.status==='placed');
  await page.locator(`#case-tabs button[data-index="${accepted}"]`).click();
  const image=()=>page.locator('#scene').evaluate(canvas=>canvas.toDataURL());
  for(const id of ['terrain-only','grid','tiers']){
    const before=await image(),checked=await page.locator(`#${id}`).isChecked();
    await page.locator(`#${id}`).setChecked(!checked);check(`${id}: overlay control changes the scene`,before!==await image());
    await page.locator(`#${id}`).setChecked(checked);
  }
  await page.locator('#zoom').selectOption('1');const width1=await page.locator('#scene').evaluate(canvas=>canvas.getBoundingClientRect().width);
  await page.locator('#zoom').selectOption('2');const width2=await page.locator('#scene').evaluate(canvas=>canvas.getBoundingClientRect().width);
  check('native and game zoom retain their twofold scale ratio',Math.abs(width2-width1*2)<1,{width1,width2});
  await page.locator('#zoom').selectOption('fit');
  await page.locator('#regenerate').click();
  const second=await page.evaluate(()=>window.__terrainCampReview.cases);
  check('regenerate advances the seed and changes actual camp geometry',await page.locator('#seed').textContent()==='2'&&geometry(second)!==geometry(initial));
  for(const item of second){const result=audit(item,2);audits.push(result);check(`seed2 ${item.id}: regenerated geometry remains valid`,result.valid,result);}
  await page.evaluate(()=>window.__terrainCampReview.regenerate(1));
  check('regenerating the same seed reproduces the identical plans',geometry(await page.evaluate(()=>window.__terrainCampReview.cases))===geometry(initial));
  const downloadEvent=page.waitForEvent('download');await page.locator('#save').click();const download=await downloadEvent;
  const chunks=[],stream=await download.createReadStream();for await(const chunk of stream)chunks.push(chunk);const png=Buffer.concat(chunks);
  const size=await page.locator('#scene').evaluate(canvas=>[canvas.width,canvas.height]);
  check('PNG export preserves the complete terrain scene',png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.readUInt32BE(16)===size[0]&&png.readUInt32BE(20)===size[1],size);
  await writeFile(`${folder}/downloaded-scene.png`,png);
  await page.screenshot({path:`${folder}/review-desktop.png`});
  await page.setViewportSize({width:390,height:844});
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  check('mobile review fits the viewport without horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${folder}/review-mobile.png`});
  await page.screenshot({path:`${folder}/review-mobile-full.png`,fullPage:true});
  check('the standalone review makes no network requests',network.length===0,network);
  check('the browser reports no runtime errors',errors.length===0,errors);
  const overview=await browser.newPage({viewport:{width:1440,height:1280},deviceScaleFactor:1});
  const cards=await Promise.all(initial.map(async item=>{
    const src=`data:image/png;base64,${(await readFile(`${folder}/terrain-${item.id}.png`)).toString('base64')}`;
    return `<article><header>${item.name}<small>${item.plan.status==='placed'?`${item.plan.bounds.width} × ${item.plan.bounds.height} · ${item.plan.metrics.tentCount} tents · 3 tiers`:'Site rejected — terrain preserved'}</small></header><img src="${src}"></article>`;
  }));
  await overview.setContent(`<html><style>*{box-sizing:border-box}body{margin:0;padding:28px;background:#181b17;color:#e6e2cc;font:22px system-ui}h1{font-size:28px;margin:0 0 8px}p{margin:0 0 22px;color:#b6baa5;font-size:17px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:#24291f;border:1px solid #48513b;border-radius:9px;padding:12px}header{margin:0 4px 10px;font-weight:650}small{float:right;color:#bfc4ac;font-size:15px;font-weight:400;padding-top:6px}img{display:block;width:100%;image-rendering:pixelated}</style><h1>Terrain-adaptive Blackroot Warcamps</h1><p>Same compact camp rules, four existing landscapes · native game assets · seed 1</p><div class="grid">${cards.join('')}</div></html>`);
  await overview.locator('img').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
  await overview.screenshot({path:'output/marauder-terrain-overview.png',fullPage:true});
  await overview.close();
} finally {
  await writeFile(`${folder}/independent-audit.json`,JSON.stringify(audits,null,2));
  await writeFile(`${folder}/browser-checks.json`,JSON.stringify({checks,errors,network},null,2));
  console.log(JSON.stringify({checks:checks.length,passed:checks.filter(item=>item.pass).length,errors,network},null,2));
  await browser.close();
}
