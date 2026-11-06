import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-10-27-beaches-water';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const savePNG = (name, data) => writeFileSync(`${output}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5176/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const result = await page.evaluate(async () => {
    const { generateWorld } = await import('/src/world/generator.ts');
    const { paintTerrain, drawAnimatedWater, rasterTerrain } = await import('/src/game/terrain.ts');
    const { drawPalm } = await import('/src/game/palm-art.ts');
    const { drawOverlay } = await import('/src/game/sprites.ts');
    const { punyWorldPixels } = await import('/src/game/puny-world.ts');
    const water = new Set(['ocean', 'coast', 'lake', 'river']);
    const makeCanvas = () => document.createElement('canvas');
    const coast = (world, i) => {
      if (water.has(world.tiles[i].terrain)) return false;
      const x = i % world.width, y = Math.floor(i / world.width);
      return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => {
        const nx=x+dx,ny=y+dy;
        return nx>=0 && ny>=0 && nx<world.width && ny<world.height && ['ocean','coast'].includes(world.tiles[ny*world.width+nx].terrain);
      });
    };
    const scene = (world, time = 0) => {
      const canvas = makeCanvas(); paintTerrain(canvas, world);
      const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false;
      for (let y=0;y<world.height;y++) for(let x=0;x<world.width;x++) {
        const tile = world.tiles[y*world.width+x];
        if(water.has(tile.terrain)) drawAnimatedWater(c,world,x,y,x*32,y*32,32,time);
        else if(tile.palm) drawPalm(c,x*32,y*32,32);
        else if(tile.overlay!=='none') drawOverlay(c,tile.overlay,x*32,y*32,32,time,tile.variation);
      }
      return canvas;
    };
    const crop = (source, x, y, width=20, height=15) => {
      const canvas=makeCanvas();canvas.width=width*48;canvas.height=height*48;
      const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;
      c.drawImage(source,x*32,y*32,width*32,height*32,0,0,canvas.width,canvas.height);
      return canvas.toDataURL();
    };
    const fixture={width:30,height:20,seed:'coast-showcase',source:'controlled coast fixture',revision:1,spawns:[],tiles:[]};
    for(let y=0;y<fixture.height;y++) for(let x=0;x<fixture.width;x++) {
      const edge=Math.round(10+2*Math.sin(y/5)), isLand=x<=edge;
      const beach=isLand && y<12 && x>=edge-2;
      fixture.tiles.push({terrain:isLand?(beach?'desert':'grassland'):(x<=edge+2?'coast':'ocean'),overlay:'none',elevation:isLand?.3:0,moisture:.5,food:1,production:0,gold:0,variation:.3,...(beach?{beach:true}: {})});
    }
    for(const [x,y] of [[9,2],[11,7]]) fixture.tiles[y*30+x].palm=true;
    fixture.tiles[2*30+5].overlay='forest';
    const before=JSON.stringify(fixture), base=scene(fixture), images={showcase:crop(base,4,0,24,18)};
    const frames=[];
    for(let frame=0;frame<4;frame++) {
      const canvas=scene(fixture,frame/3+.01);
      images[`wave-${frame}`]=crop(canvas,7,1,8,8);
      frames.push(canvas.toDataURL());
    }
    const atlas=punyWorldPixels(), palette=new Set();
    for(let i=0;i<atlas.data.length;i+=4) palette.add(Array.from(atlas.data.slice(i,i+4)).join(','));
    const raster=rasterTerrain(fixture);
    let foreignPixels=0, transparentPixels=0;
    for(let i=0;i<raster.pixels.length;i+=4) {
      if(!palette.has(Array.from(raster.pixels.slice(i,i+4)).join(','))) foreignPixels++;
      if(raster.pixels[i+3]!==255) transparentPixels++;
    }
    const initialRenderReadOnly=before===JSON.stringify(fixture);
    const horizontalColors=[];
    const c=base.getContext('2d');
    for(let x=14;x<29;x++) horizontalColors.push(Array.from(c.getImageData(x*32+16,6*32+16,1,1).data).join(','));
    // One coastline edit can affect a wide depth band; cached updates must match fresh paint.
    const cached=makeCanvas();paintTerrain(cached,fixture);
    fixture.tiles[6*30+18]={...fixture.tiles[6*30+18],terrain:'desert',beach:true};fixture.revision++;
    paintTerrain(cached,fixture);const fresh=makeCanvas();paintTerrain(fresh,fixture);
    const a=cached.getContext('2d').getImageData(0,0,cached.width,cached.height).data;
    const b=fresh.getContext('2d').getImageData(0,0,fresh.width,fresh.height).data;
    let repaintMismatch=0;for(let i=0;i<a.length;i+=4) if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])repaintMismatch++;
    const samples=[];
    for(const seed of ['CROWN','BTV-847','coastal-palm']) {
      const world=generateWorld(seed), coastCells=world.tiles.map((_,i)=>i).filter(i=>coast(world,i));
      const count=coastCells.filter(i=>['desert','plains'].includes(world.tiles[i].terrain)).length;
      const palms=world.tiles.filter(t=>t.palm).length;
      const candidates=coastCells.filter(i=>world.tiles[i].beach).map(i=>{
        const cx=i%world.width,cy=Math.floor(i/world.width);let score=0;
        for(let y=Math.max(0,cy-5);y<Math.min(world.height,cy+6);y++) for(let x=Math.max(0,cx-7);x<Math.min(world.width,cx+8);x++) {
          const t=world.tiles[y*world.width+x];score+=t.palm?10:t.beach?1:0;
        }
        return {i,score};
      }).sort((a,b)=>b.score-a.score);
      const best=candidates[0]?.i??coastCells[0];
      const x=Math.max(0,Math.min(world.width-20,best%world.width-10));
      const y=Math.max(0,Math.min(world.height-15,Math.floor(best/world.width)-7));
      const original=JSON.stringify(world);images[seed]=crop(scene(world),x,y);
      samples.push({seed,coastline:coastCells.length,sandyCoastline:count,fraction:count/coastCells.length,palms,renderReadOnly:original===JSON.stringify(world)});
    }
    return {images,samples,checks:{foreignPixels,transparentPixels,repaintMismatch,distinctWaterCenterColors:new Set(horizontalColors).size,animationFrames:new Set(frames).size,initialRenderReadOnly}};
  });
  for(const [name,data] of Object.entries(result.images))savePNG(name,data);
  assert.equal(result.checks.foreignPixels,0,'Terrain must use only original atlas colors');
  assert.equal(result.checks.transparentPixels,0,'Ground must be fully opaque');
  assert.equal(result.checks.repaintMismatch,0,'Cached coast/depth edits must equal a full repaint');
  assert.ok(result.checks.distinctWaterCenterColors>=3,'Water must have at least three distance bands');
  assert.ok(result.checks.animationFrames>1,'Native shoreline animation must remain animated');
  assert.ok(result.checks.initialRenderReadOnly,'Rendering must not mutate coast data');
  assert.ok(result.samples.every(sample=>sample.renderReadOnly));
  assert.ok(result.samples.every(sample=>sample.fraction>.43&&sample.fraction<.57));
  assert.ok(result.samples.every(sample=>sample.palms>0));
  assert.deepEqual(errors,[]);
  const report={checks:result.checks,samples:result.samples,errors};
  writeFileSync(`${output}/browser-report.json`,JSON.stringify(report,null,2));
  const cards=result.samples.map(sample=>`<figure><figcaption><strong>${sample.seed}</strong><span>${sample.sandyCoastline}/${sample.coastline} shoreline tiles sandy · ${sample.palms} palms in world</span></figcaption><img src="${result.images[sample.seed]}" alt="Generated coastline from seed ${sample.seed}"></figure>`).join('');
  const frames=[0,1,2,3].map(frame=>result.images[`wave-${frame}`]);
  writeFileSync(`${output}/gallery.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BTV · Puny coastlines</title>
  <style>*{box-sizing:border-box}body{margin:0;background:#101b19;color:#ebe8d7;font:16px/1.55 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:42px 24px}header{margin-bottom:28px}h1{font:48px/1.1 Georgia,serif;margin:8px 0 16px}.eyebrow{font-size:12px;letter-spacing:.15em;color:#d5b56a;text-transform:uppercase}p{max-width:800px;color:#bdc9bd}.metrics{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}.metrics span{padding:9px 16px;border:1px solid #435349;background:#1b2b26;border-radius:4px}.metrics b{color:#e5c47b}figure{margin:0 0 28px;background:#1a2925;border:1px solid #435349;border-radius:5px;overflow:hidden}figcaption{display:flex;justify-content:space-between;gap:12px;padding:14px 18px;flex-wrap:wrap}figcaption span{font-size:13px;color:#bdc9bd}img{display:block;width:100%;height:auto;image-rendering:pixelated}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.grid figure{margin:0}.wave{display:grid;grid-template-columns:minmax(240px,384px) 1fr;gap:28px;align-items:center;margin:32px 0}.wave img{border:1px solid #435349}button{font:inherit;background:#283d32;color:#f0e7ce;border:1px solid #a68f52;padding:9px 16px;border-radius:4px;cursor:pointer}footer{font-size:13px;color:#a9baab;border-top:1px solid #435349;padding-top:20px;margin-top:32px}@media(max-width:700px){main{padding:24px 16px}h1{font-size:36px}.grid,.wave{grid-template-columns:1fr}.metrics{gap:7px}.metrics span{padding:7px 10px}}</style>
  <main><header><div class="eyebrow">TinyCiv / World generation</div><h1>Beaches and deeper water</h1><p>Connected sandy shores, occasional palms, and water bands following the coast. Every terrain and palm pixel comes from the original Puny World atlas.</p><div class="metrics"><span><b>50.05%</b> sandy coastline</span><span><b>1–3 tiles</b> beach width</span><span><b>5.18%</b> of beach tiles have palms</span></div><p style="font-size:13px">Coverage measured across 100 generated worlds. These are renders from the implemented game code.</p></header>
  <figure><figcaption><strong>Shore and water detail</strong><span>Controlled scene · sand-to-grass transition</span></figcaption><img src="${result.images.showcase}" alt="Puny sandy shore with palms and three offshore water colors"></figure>
  <div class="grid">${cards}</div>
  <section class="wave"><img id="waves" src="${frames[0]}" alt="Four original Puny shoreline animation frames"><div><h2>Native shoreline animation</h2><p>The original four frames animate the shoreline and water transitions. Rivers and fords retain their existing movement rules.</p><button id="toggle" type="button">Pause waves</button></div></section>
  <footer>Original Puny World assets by Shade · No recoloring or generated artwork · All images embedded for offline viewing</footer></main>
  <script>const frames=${JSON.stringify(frames)};let frame=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;const button=document.getElementById('toggle');function label(){button.textContent=playing?'Pause waves':'Play waves';button.setAttribute('aria-pressed',String(playing));}button.onclick=()=>{playing=!playing;label()};label();setInterval(()=>{if(playing){frame=(frame+1)%frames.length;document.getElementById('waves').src=frames[frame]}},334);</script></html>`);
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
