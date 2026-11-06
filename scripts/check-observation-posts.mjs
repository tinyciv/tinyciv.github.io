import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const out = 'scratch/2026-11-05-observation-posts';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
let campfireResponses = 0; page.on('response', response => { if(response.url().includes('/assets/medieval/Village-Campfire.png') && response.ok()) campfireResponses++; });
const errors = []; page.on('pageerror', error => errors.push(String(error)));

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready', null, { timeout: 60000 }).catch(async error => { console.log(JSON.stringify({errors, page: await page.evaluate(() => ({title: document.title, assets: document.documentElement.dataset.assets, text: document.body.innerText.slice(0,500)}))})); throw error; });
  const startupCampfireLoaded = campfireResponses > 0;
  const result = await page.evaluate(async () => {
    requestAnimationFrame = () => 0;
    const { Renderer } = await import('/src/game/renderer.ts');
    const { scoutRealm } = await import('/tests/helpers/scouts.ts');
    const { placeObservationPost, updateObservationPost } = await import('/src/game/observation-posts.ts');
    const { drawObservationCampfire, observationFireFrame, drawObservationSmoke, loadObservationPostArt } = await import('/src/game/observation-post-art.ts');
    await loadObservationPostArt();
    const { entityStore } = await import('/src/game/entity-store.ts');
    const { withPlayerFaction } = await import('/src/game/player-context.ts');
    const { entityVisible } = await import('/src/game/fog.ts');
    const make = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
    const load = async src => { const image = new Image(); image.src = src; await image.decode(); return image; };
    const native = await load('/assets/medieval/Village-Campfire.png');
    const atlas = await load('/scratch/2026-10-28-puny-medieval/pack/PUNY-WORLD-PAID_v1/punyworld-atlas.png');
    const source = make(32,16); source.getContext('2d').drawImage(atlas,2368,16,32,16,0,0,32,16);
    const exported = make(32,16); exported.getContext('2d').drawImage(native,0,0);
    const a = source.getContext('2d').getImageData(0,0,32,16).data, b = exported.getContext('2d').getImageData(0,0,32,16).data;
    const sourceDifferences = a.reduce((n,value,index) => n + Number(value !== b[index]),0);
    const frames = [];
    for (const time of [0,.25]) {
      const actual = make(40,32), expected = make(40,32);
      drawObservationCampfire(actual.getContext('2d'),time);
      expected.getContext('2d').drawImage(native,observationFireFrame(time)*16,0,16,16,24,16,16,16);
      const pixels = actual.getContext('2d').getImageData(0,0,40,32).data, reference = expected.getContext('2d').getImageData(0,0,40,32).data;
      frames.push({ time, frame: observationFireFrame(time), differences: pixels.reduce((n,value,index)=>n+Number(value!==reference[index]),0), opaque: pixels.filter((value,index)=>index%4===3&&value>0).length });
    }
    const state = scoutRealm(), store = entityStore(state);
    store.buildings.add({ id:103, kind:'palace', faction:0,x:2,y:10,hp:1000,maxHp:1000,capacity:4,unhousedResidents:4 });
    state.factions[0].population=4; state.paused=true;
    store.units.retain(unit=>unit.kind==='leader'); state.units[0].x=29.5;state.units[0].y=17.5;
    state.factions.push({...state.factions[0],id:1,name:'Enemy',color:'#3988ff',relation:'war',population:0});
    const placed=placeObservationPost(state,0,{x:31.5,y:16.5});
    const post=state.units.find(unit=>unit.observationPost);
    const canvas=make(768,512),mini=make(80,80);canvas.style.width='768px';canvas.style.height='512px';mini.style.width=mini.style.height='80px';
    document.body.append(canvas,mini);
    const renderer=new Renderer(canvas,mini);await renderer.initialize();renderer.follow=false;renderer.zoom=4;renderer.camera={x:31,y:16.5};
    const renders=[];
    for(const time of [0,.25]) {state.time=time;renderer.draw(state,0);renders.push({name:`campfire-frame-${observationFireFrame(time)}.png`,image:(await renderer.snapshot()).toDataURL()});}
    store.units.add({...state.units[0],id:901,faction:1,x:30.5,y:16.5});
    state.observationSmoke=[{x:33,y:15,faction:0,startedAt:60}];
    state.time=62;
    const concealed=withPlayerFaction(state,1,()=>entityVisible(state,post));
    withPlayerFaction(state,1,()=>renderer.draw(state,0));renders.push({name:'enemy-hidden-smoke.png',image:(await renderer.snapshot()).toDataURL()});
    const smokeStats=[];
    for(let cycle=0;cycle<2;cycle++) for(let phase=0;phase<8;phase++) {
      state.time=60+phase*5/8;
      withPlayerFaction(state,1,()=>renderer.draw(state,0));
      if(cycle===1) smokeStats.push({...renderer.renderStats});
    }
    const scout=state.units.find(unit=>unit.id===901);scout.x=post.x;scout.y=post.y;
    updateObservationPost(state,post,0,()=>{},(x,y)=>x!==y);
    const discovered=withPlayerFaction(state,1,()=>entityVisible(state,post));
    withPlayerFaction(state,1,()=>renderer.draw(state,0));renders.push({name:'enemy-discovered.png',image:(await renderer.snapshot()).toDataURL()});
    const smokeCanvas=make(32,32);drawObservationSmoke(smokeCanvas.getContext('2d'),3);
    const smokePixels=smokeCanvas.getContext('2d').getImageData(0,0,32,32).data;
    const smokeAlpha=Math.max(...smokePixels.filter((_value,index)=>index%4===3));
    renderer.destroy();canvas.remove();mini.remove();
    return { placed, sourceDifferences, frames, concealed, discovered, smokeStats, smokeAlpha, renders };
  });
  for(const render of result.renders) {await writeFile(`${out}/${render.name}`,Buffer.from(render.image.split(',')[1],'base64'));delete render.image;}
  await writeFile(`${out}/results.json`,JSON.stringify({...result,startupCampfireLoaded,errors},null,2));
  assert.equal(result.placed.ok,true);assert.equal(result.sourceDifferences,0);assert.equal(startupCampfireLoaded,true);
  assert.deepEqual(result.frames.map(frame=>frame.frame),[0,1]);
  for(const frame of result.frames){assert.equal(frame.differences,0);assert.ok(frame.opaque>0);}
  assert.equal(result.concealed,false);assert.equal(result.discovered,true);assert.ok(result.smokeAlpha>0&&result.smokeAlpha<=36);
  assert.ok(result.smokeStats.every(stats=>stats.rasterized===0),'Cached smoke phases must not rebake artwork.');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({out,sourceDifferences:result.sourceDifferences,frames:result.frames,concealed:result.concealed,discovered:result.discovered,cachedSmokeRasterizations:result.smokeStats.map(stats=>stats.rasterized),errors}));
} finally { await browser.close(); }
