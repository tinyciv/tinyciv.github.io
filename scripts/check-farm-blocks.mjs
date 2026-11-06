import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const output = 'scratch/2026-11-03-farm-blocks'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = process.env.FARM_GENERATED_ONLY ? JSON.parse(readFileSync(`${output}/checks.json`,'utf8')).checks.filter(c=>!c.label.startsWith('freshly') && c.label!=='no runtime errors') : [], errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.routeWebSocket('**', socket => socket.close());
const check = (label, value, data) => { checks.push({ label, pass: !!value, data }); console.log(label, !!value); assert.ok(value, `${label}: ${JSON.stringify(data)}`); };
const settle = () => page.waitForTimeout(100);
async function fixture() {
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const world = { width: 64, height: 48, seed: 'farm-block-browser', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: 3072 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .7,
        food: 3, production: 1, gold: 0, variation: i % 13 / 13 })) };
    const state = { world, buildings: [{ id: 1, kind: 'palace', x: 12, y: 20, faction: 0, hp: 650, maxHp: 650, capacity: 4,
        unhousedResidents: 4, cityName: 'Roma', governorPermissions: { farms: false, housing: false } }],
      units: [{ id: 10, kind: 'leader', x: 24.5, y: 23.5, faction: 0, hp: 100, maxHp: 100, morale: 100, attack: 0,
        defense: 4, speed: 0, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Romans', color: '#c94c4c', affinity: 100, relation: 'self', food: 50, gold: 2000, production: 0,
        population: 4, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], projectiles: [], bloodEffects: [], treasures: [],
      raiderCamps: [], marauderPacks: [], villages: [], treeClearings: [], roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0,
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null,
      gameOver: false, victory: false, victoryContinued: true, seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(state); const { updateFog } = await import('/src/game/fog.ts'); updateFog(state);
    __game.renderer.prepare(state); __game.renderer.follow = false; __game.renderer.camera = { x: 22, y: 20 }; __game.renderer.zoom = 1.65;
  }); await settle();
  await page.keyboard.press('b'); await settle(); await page.locator('[data-build="camp"]').click(); await settle();
  assert.equal(await page.evaluate(() => __game.state.buildMode), 'camp');
}
async function hover(x, y) {
  const point = await page.evaluate(({x,y}) => __game.renderer.screenPoint({x:x+.5,y:y+.5}), {x,y});
  await page.mouse.move(point.x, point.y); await settle(); return point;
}
async function click(x, y) { const point = await hover(x,y); await page.mouse.click(point.x,point.y); await settle(); return state(); }
async function state() { return page.evaluate(() => ({gold:__game.state.factions[0].gold,
  farms:__game.state.buildings.filter(b=>b.kind==='camp' && b.hp>0).map(b=>({x:b.x,y:b.y,pending:!!b.construction})),
  status:document.querySelector('#build-status').textContent, invalid:document.querySelector('#build-status').classList.contains('invalid')})); }
async function redPreview(x,y,name) {
  await hover(x,y);
  const clip = await page.evaluate(({x,y}) => { const p=__game.renderer.screenPoint({x,y}),size=32*__game.renderer.zoom;
    return {x:Math.floor(p.x)-2,y:Math.floor(p.y)-2,width:Math.ceil(size)+4,height:Math.ceil(size)+4}; },{x,y});
  const png=await page.screenshot({path:`${output}/${name}-cell.png`,clip});
  const pixels=await page.evaluate(async data=>{ const image=new Image();image.src=data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
    const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let red=0;
    for(let i=0;i<p.length;i+=4) if(p[i]>180 && p[i]>p[i+1]*1.3 && p[i]>p[i+2]*1.3)red++;return red;
  },`data:image/png;base64,${png.toString('base64')}`);
  check(`${name}: invalid farm ghost is visibly red`,pixels>60,{redPixels:pixels});
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__game && document.documentElement.dataset.assets==='ready');
  await page.evaluate(()=>{ window.__farmInitialState=__game.state; });
  if (!process.env.FARM_GENERATED_ONLY) {
  await fixture();
  let result=await click(18,18);
  check('manual placement remains one farm cell costing 12.5 gold',result.farms.length===1 && result.farms[0].x===18 && result.farms[0].y===18 && result.gold===1987.5,result);
  for(let x=19;x<=23;x++)result=await click(x,18);
  check('a six-plot line is allowed without any aspect-ratio restriction',result.farms.length===6 && result.gold===1925,result);
  await redPreview(24,18,'long-seventh');
  result=await click(24,18);
  check('a long seventh plot is rejected with a clear aspect error and no spending',result.farms.length===6 && result.gold===1925 && result.invalid && /aspect ratio.*1.5/i.test(result.status),result);
  await page.screenshot({path:`${output}/long-seventh-rejected.png`});

  await fixture();
  for(const [x,y] of [[18,18],[19,18],[20,18],[18,19],[19,19],[20,19]])await click(x,y);
  result=await click(18,20);
  check('a compact seventh plot is accepted',result.farms.length===7 && result.gold===1912.5,result);
  for(const [x,y] of [[19,20],[20,20],[21,18],[21,19],[21,20],[18,21],[19,21],[20,21],[21,21]])result=await click(x,y);
  check('a compact block accepts exactly sixteen pending farm orders',result.farms.length===16 && result.farms.every(f=>f.pending) && result.gold===1800,result);
  await redPreview(22,19,'seventeenth');result=await click(22,19);
  check('a seventeenth plot counts pending orders and is rejected without spending',result.farms.length===16 && result.gold===1800 && result.invalid && /at most 16/i.test(result.status),result);
  await page.screenshot({path:`${output}/seventeenth-rejected.png`});

  await fixture();
  for(const x of [18,19,20,22,23,24])await click(x,18);
  const before=await state();result=await click(21,18);
  check('bridging two small blocks cannot create an illegal long block',before.farms.length===6 && result.farms.length===6 && result.gold===before.gold && /aspect ratio.*1.5/i.test(result.status),result);

  await fixture();await page.evaluate(()=>{__game.renderer.camera={x:29,y:23};});await settle();
  const hidden=await page.evaluate(async()=>{const {updateFog,pointExplored}=await import('/src/game/fog.ts');return !pointExplored(updateFog(__game.state),33,24);});
  check('fog test tile is genuinely unexplored',hidden);
  result=await click(33,24);
  check('farm placement is still allowed in unexplored fog within Leader reach',result.farms.some(f=>f.x===33 && f.y===24) && result.gold===1987.5,result);
  await page.screenshot({path:`${output}/fog-placement.png`});
  }
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__game && document.documentElement.dataset.assets==='ready');
  const generated=await page.evaluate(async()=>{
    const {generateWorld}=await import('/src/world/generator.ts'),{createGame}=await import('/src/game/simulation.ts');
    const s=createGame(generateWorld('farm-block-browser-final'));s.paused=true;__game.replaceState(s);
    const {farmBlockPlacementQuery}=await import('/src/game/farm-blocks.ts');
    const farms=s.buildings.filter(b=>b.kind==='camp' && b.hp>0),validation=farmBlockPlacementQuery(s).canAddAll(farms);
    const home=s.buildings.find(b=>b.kind==='palace' && b.faction===0);
    __game.renderer.prepare(s);__game.renderer.follow=false;__game.renderer.camera={x:home.x+1,y:home.y+1};__game.renderer.zoom=1;
    return {seed:s.world.seed,population:s.factions[0].population,farms:farms.length,validation};
  });
  check('freshly generated starting farms obey size and compactness rules',generated.population===20 && generated.farms>20 && generated.validation.ok,generated);
  await settle();await page.screenshot({path:`${output}/generated-starting-farms.png`});
  check('no runtime errors',errors.length===0,errors);
} catch(error){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{writeFileSync(`${output}/checks.json`,JSON.stringify({checks,errors},null,2));await browser.close();}
