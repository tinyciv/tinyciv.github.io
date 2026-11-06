import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = process.env.SCOUT_QA_OUTPUT || 'scratch/2026-11-02-cavalry-browser';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks = [], errors = [];
const check = (label, pass, data) => { checks.push({ label, pass: !!pass, data }); console.log(label, !!pass); assert.ok(pass, `${label}: ${JSON.stringify(data)}`); };
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => errors.push(String(error)));
// A fresh browser context never reads or modifies the user's live settlement.
await page.routeWebSocket('**', socket => socket.close());
const settle = () => page.waitForTimeout(160), popup = page.locator('#building-activity');
const ready = () => page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', { timeout: 60000 });
async function simulate(seconds) {
  await page.evaluate(seconds => {
    const s = __game.state; s.paused = false;
    for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += .1) __game.step(Math.min(.1, seconds - elapsed));
    s.paused = true;
  }, seconds); await settle();
}
async function openBuilding(id) {
  if (await popup.isVisible()) await page.locator('.activity-close').click();
  const point = await page.evaluate(id => {
    const s = __game.state, b = s.buildings.find(b => b.id === id), leader = s.units.find(u => u.kind === 'leader' && u.faction === 0);
    Object.assign(leader, { x: b.x + .5, y: b.y + 2.5 }); delete leader.path; delete leader.destination;
    __game.renderer.camera = { x: b.x + 1, y: b.y + 1 }; __game.renderer.follow = false;
    return __game.renderer.screenPoint({ x: b.x + .55, y: b.y + .55 });
  }, id); await settle(); await page.mouse.click(point.x, point.y); await popup.waitFor({ state: 'visible' }); await settle();
}
const army = () => page.evaluate(() => __game.state.units.filter(u => ['warrior','horseman','archer','spearman'].includes(u.kind) && u.faction === 0 && u.hp > 0)
  .map(u => ({ id:u.id, kind:u.kind, speed:u.speed, attack:u.attack, hp:u.hp, maxHp:u.maxHp, kills:u.kills, squad:u.retinueSquad, inside:u.inside, training:u.training })));
async function libraryLayout(label) {
  const layout = await page.evaluate(() => {
    const p=document.querySelector('#building-activity').getBoundingClientRect(), n=document.querySelector('button[data-research="horsebackRiding"]').getBoundingClientRect(),
      d=document.querySelector('.research-detail').getBoundingClientRect(), scroll=document.querySelector('.research-tree-scroll');
    return { viewport:[innerWidth,innerHeight], popup:{x:p.x,y:p.y,w:p.width,h:p.height}, node:{x:n.x,y:n.y,w:n.width,h:n.height},
      overlap: n.x < d.right && n.right > d.x && n.y < d.bottom && n.bottom > d.y,
      fits: p.x >= 0 && p.y >= 0 && p.right <= innerWidth && p.bottom <= innerHeight,
      scroll: scroll.scrollHeight-scroll.clientHeight, metrics:[document.querySelector('.research-board'),document.querySelector('.research-detail'),...document.querySelector('.research-detail').children].map(el=>{const r=el.getBoundingClientRect();return {class:el.className,y:r.y,h:r.height,client:el.clientHeight,scroll:el.scrollHeight}}) };
  });
  check(`${label}: new technology fits without obscuring the detail panel`, layout.fits && !layout.overlap && layout.scroll <= 1, layout);
  await page.screenshot({path:`${output}/research-${label}.png`});
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' }); await ready();
  await page.evaluate(async () => {
    const world = { width: 96, height: 64, seed: 'scout-exploration-browser', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: 6144 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .7,
        food: 3, production: 1, gold: 0, variation: i % 13 / 13 })) };
    const building = (id, kind, x, y, extra = {}) => ({ id, kind, x, y, faction: 0, hp: 250, maxHp: 250, capacity: 0, ...extra });
    const person = (id, kind, x, y) => ({ id, kind, x, y, faction: 0, hp: 100, maxHp: 100, morale: 100, attack: kind === 'leader' ? 0 : 17, defense: 4,
      speed: kind === 'leader' ? 0 : 3.96, range: 1.1, order: 'hold', retinueStance: 'hold', cooldown: 0, lastCombat: -60,
      lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0, home: 1 });
    const state = { world, buildings: [building(1, 'palace', 15, 30, { cityName: 'Roma', capacity: 4, unhousedResidents: 4,
      governorPermissions: { farms: false, housing: false } }), building(3, 'library', 18, 28), building(5, 'archeryRange', 18, 35),
      ...[[13, 29], [13, 31], [15, 33], [18, 32]].map(([x, y], i) => building(10 + i, 'house', x, y, { capacity: 4, residents: 4 }))],
      units: [person(500, 'leader', 22.5, 33.5), ...Array.from({ length: 5 }, (_, i) => person(501 + i, 'warrior', 14.5 + i, 27.5))],
      factions: [{ id: 0, name: 'Romans', color: '#c94c4c', affinity: 100, relation: 'self', food: 0, gold: 4000, production: 0,
        population: 20, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false,
        research: { focus: 'horsebackRiding', levels: { scoutLodge: 1, archeryRange: 1, militaryTactics: 1 }, progress: {}, autoResearch: false } }],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], projectiles: [], bloodEffects: [], treasures: [],
      raiderCamps: [], marauderPacks: [], villages: [], treeClearings: [], roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0,
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, selected: 500, selectedType: 'unit', buildMode: null, diplomacy: null,
      gameOver: false, victory: false, victoryContinued: true, seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(state);
    const { updateFog } = await import('/src/game/fog.ts'); updateFog(state);
    __game.renderer.prepare(state); __game.renderer.follow = false; __game.renderer.camera = { x: 21, y: 31 }; __game.renderer.zoom = 1.65;
  }); await settle();

  await openBuilding(3);
  await page.locator('button[data-research="horsebackRiding"]').click(); await settle();
  check('Horseback Riding is available after Exploration and Military Tactics', await page.locator('.research-start').isEnabled());
  await libraryLayout('desktop');
  await page.setViewportSize({width:750,height:500}); await settle(); await libraryLayout('compact');
  await page.setViewportSize({width:1440,height:900}); await settle();
  const goldBefore = await page.evaluate(() => __game.state.factions[0].gold);
  await page.locator('.research-start').click(); await settle();
  check('research funding costs exactly 400 gold', await page.evaluate(() => __game.state.factions[0].gold) === goldBefore-400);
  await page.locator('.activity-close').click(); await simulate(121);
  check('research finishes and unlocks stables', await page.evaluate(() => __game.state.factions[0].research.levels.horsebackRiding === 1));
  await page.evaluate(() => { const leader=__game.state.units.find(u=>u.id===500);leader.x=22.5;leader.y=33.5;__game.renderer.camera={x:21,y:31}; }); await settle();
  await page.keyboard.press('b'); await settle();
  check('unlocked stable appears in the build menu', await page.locator('[data-build="stable"]').isEnabled());
  const paidBefore=await page.evaluate(()=>__game.state.factions[0].gold);
  await page.keyboard.press('y'); await settle();
  const site=await page.evaluate(()=>__game.renderer.screenPoint({x:21.5,y:31.5}));await page.mouse.click(site.x,site.y);await settle();
  const stableId=await page.evaluate(()=>__game.state.buildings.find(b=>b.kind==='stable')?.id);
  check('stable starts normal paid construction for 350 gold', !!stableId && await page.evaluate(({id,gold})=>!!__game.state.buildings.find(b=>b.id===id)?.construction && __game.state.factions[0].gold===gold-350,{id:stableId,gold:paidBefore}));
  await simulate(70);
  check('civilian completes the stable through the normal simulation',await page.evaluate(id=>!__game.state.buildings.find(b=>b.id===id)?.construction,stableId));
  const original=await army(); await openBuilding(stableId);
  await page.locator('[name="horsemen"]').fill('40');await page.locator('[name="horsemen"]').dispatchEvent('input');await settle();
  check('stable assigns two of five troops without instant conversion',(await page.locator('.horseman-count').textContent()).trim()==='2' && (await army()).every(u=>u.kind==='warrior'));
  await page.screenshot({path:`${output}/stable-assigned.png`});await page.locator('.activity-close').click();
  let entered=false;
  for(let i=0;i<16;i++){await simulate(1);entered ||= (await army()).some(u=>u.inside && u.training);}
  const trained=await army();
  check('soldiers physically visit the stable and emerge as horsemen',entered && trained.filter(u=>u.kind==='horseman').length===2,trained);
  check('mounting preserves the army IDs, squad memberships and experience',original.every(old=>trained.some(u=>u.id===old.id && u.squad===old.squad && u.kills===old.kills)) && trained.length===original.length,{original,trained});
  check('horsemen have 65% greater speed and 50% greater attack',trained.filter(u=>u.kind==='horseman').every(u=>Math.abs(u.speed-6.534)<1e-8 && Math.abs(u.attack-25.5)<1e-8));
  await openBuilding(stableId);await page.screenshot({path:`${output}/stable-mounted.png`});await page.locator('.activity-close').click();
  const combat = await page.evaluate(async () => {
    const s=__game.state, rider=s.units.find(u=>u.kind==='horseman'), savedIDs=s.units.filter(u=>u.kind==='warrior'||u.kind==='horseman').map(u=>u.id);
    s.factions.push({id:1,name:'Target faction',color:'#5577ff',affinity:0,relation:'war',food:0,gold:0,population:0,production:0,yields:{food:0,gold:0,production:0},nextRaid:1e9,nextRetinueAt:1e9,defeated:false});
    for(const u of s.units){u.x=10.5+(u.id%6);u.y=20.5;u.order='hold';u.retinueStance='hold';u.path=undefined;u.destination=undefined;u.target=undefined;u.joiningRetinue=false;}
    Object.assign(rider,{x:18.5,y:25.5,order:'follow',retinueStance:'aggressive',cooldown:0,lastCombat:-60,lastDamagedAt:-60});rider.cavalryCharge=undefined;rider.forcedAttack={target:9001};
    const target=(id,x)=>({id,x,y:25.5,faction:1,kind:'warrior',hp:1000,maxHp:1000,attack:0,defense:0,speed:0,range:1.1,morale:100,order:'hold',retinueStance:'hold',cooldown:0,lastCombat:-60,lastDamagedAt:-60,facing:Math.PI,moving:false,attackTime:0});
    s.units.push(target(9001,26.5),target(9002,27.5));const leader=s.units.find(u=>u.kind==='leader');leader.x=22.5;leader.y=28.5;__game.replaceState(s);const {updateFog}=await import('/src/game/fog.ts');updateFog(s);
    __game.renderer.camera={x:24,y:26};__game.renderer.zoom=2.5;__game.renderer.follow=false;
    let impact;
    s.paused=false;
    for(let i=0;i<300;i++){const before=s.units.filter(u=>u.id===9001||u.id===9002).map(u=>({id:u.id,x:u.x,y:u.y}));__game.step(.05);__game.renderer.draw(s,.05);if(rider.cavalryCharge?.readyAt>s.time){impact={time:s.time,rider:{x:rider.x,y:rider.y},charge:{...rider.cavalryCharge},before,targets:s.units.filter(u=>u.id===9001||u.id===9002).map(u=>({id:u.id,x:u.x,y:u.y,hp:u.hp}))};break;}}
    s.paused=true;__game.renderer.prepare(s);__game.renderer.draw(s,0);return {id:rider.id,savedIDs,impact,final:{x:rider.x,y:rider.y,kind:rider.kind,order:rider.order,stance:rider.retinueStance,target:rider.target,forced:rider.forcedAttack,charge:rider.cavalryCharge,path:rider.path,speed:rider.speed,training:rider.training,inside:rider.inside,morale:rider.morale,targets:s.units.filter(u=>u.id===9001||u.id===9002).map(u=>({id:u.id,x:u.x,y:u.y,hp:u.hp,order:u.order}))}};
  });await settle();
  check('actual pursuit builds and spends a charge',!!combat.impact,combat);
  check('charge damages the primary and nearby enemy',combat.impact.targets.every(u=>u.hp<1000),combat.impact);
  check('charge impact leaves enemy positions unchanged',combat.impact.targets.every(u=>{const before=combat.impact.before.find(previous=>previous.id===u.id);return before && Math.hypot(u.x-before.x,u.y-before.y)<1e-7;}),combat.impact);
  await page.screenshot({path:`${output}/charge-impact.png`});
  const cooldown=await page.evaluate(async id=>{
    const s=__game.state,rider=s.units.find(u=>u.id===id),target=s.units.find(u=>u.id===9001),ready=rider.cavalryCharge.readyAt;
    rider.x=target.x-1;rider.y=target.y;rider.speed=0;rider.path=undefined;rider.pathGoal=undefined;rider.cooldown=0;
    __game.replaceState(s);s.paused=false;for(let i=0;i<200;i++)__game.step(.05);s.paused=true;
    return {ready,after:rider.cavalryCharge.readyAt,hp:target.hp};
  },combat.id);
  check('stationary melee never retriggers a running charge',cooldown.ready===cooldown.after,cooldown);
  await page.locator('#menu').click();await page.locator('[data-frontend-action="save"]').click();await page.reload({waitUntil:'networkidle'});await ready();
  const restored=await page.evaluate(id=>{const u=__game.state.units.find(u=>u.id===id);return {speed:u?.speed,readyAt:u?.cavalryCharge?.readyAt,kind:u?.kind};},combat.id);
  check('save/reload restores cavalry speed and spent charge cooldown',restored.kind==='horseman' && Math.abs(restored.speed-6.534)<1e-8 && restored.readyAt===cooldown.ready,restored);
  const art=await page.evaluate(async()=>{const {horsemanSheet,stableSheet,horsemanPose}=await import('/src/game/cavalry-art.ts');const h=horsemanSheet('#c94c4c'),s=stableSheet('#c94c4c');return {horse:[h?.width,h?.height],stable:[s?.width,s?.height],pose:horsemanPose({id:0,facing:0,moving:true,attackTime:0},0)}});
  check('native stable and mounted knight art are loaded',art.horse.join(',')==='128,384' && art.stable.join(',')==='16,16',art);
  check('no runtime errors',errors.length===0,errors);
} catch(error){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{writeFileSync(`${output}/checks.json`,JSON.stringify({checks,errors},null,2));await browser.close();}
