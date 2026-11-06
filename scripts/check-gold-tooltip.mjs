import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out='scratch/2026-11-03-gold-tooltip'; mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:900}}), checks=[], errors=[];
page.on('pageerror',error=>errors.push(String(error))); await page.routeWebSocket('**',socket=>socket.close());
await page.addInitScript(()=>performance.setResourceTimingBufferSize(10000));
const check=(name,passed,detail)=>{checks.push({name,passed:!!passed,detail});console.log(passed?'PASS':'FAIL',name,JSON.stringify(detail));assert.ok(passed,name);};
const settle=()=>page.waitForTimeout(220), anchor=page.locator('.resource.gold'), tooltip=page.locator('.gold-flow-tooltip');
const summary=()=>page.evaluate(async()=>{const {goldFlowSummary}=await __researchImport('/src/game/gold-ledger.ts');return goldFlowSummary(__game.state,__game.state.factions[0]);});
const visibleRows=()=>tooltip.locator('.gold-flow-row').evaluateAll(rows=>Object.fromEntries(rows.map(row=>[row.dataset.category,row.querySelector('dd').textContent])));
try {
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5177/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__game&&document.documentElement.dataset.assets==='ready');
  await page.evaluate(async () => {
    window.__researchImport = async path => { const loaded = [...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === path); return import(loaded?.name ?? path); };
    const width = 48, height = 32, world = { width, height, seed: 'gold-tooltip-qa', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .7, food: 3, production: 1, gold: 0, variation: i % 13 / 13 })) };
    const building = (id, kind, x, y) => ({ id, kind, faction: 0, x, y, hp: 750, maxHp: 750, capacity: 0 });
    const s = { world, buildings: [{ ...building(1, 'palace', 15, 11), cityName: 'Roma', capacity: 0, unhousedResidents: 0, governorPermissions: { farms: false, housing: false } }, building(3, 'library', 20, 14)],
      units: [{ id: 500, kind: 'leader', faction: 0, x: 20.5, y: 16.5, hp: 100, maxHp: 100, morale: 100, attack: 20, defense: 5, speed: 3.6, range: 4, order: 'hold', retinueStance: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Roma', color: '#c94c4c', affinity: 100, relation: 'self', food: 300, gold: 1000, production: 0, population: 0, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
      time: 0, tick: 0, paused: true, speed: 1, gameOver: false, victory: false, events: [], particles: [], projectiles: [], bloodEffects: [], fields: [], treasures: [], raiderCamps: [], marauderPacks: [], treeClearings: [], villages: [],
      roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0,
      selected: 500, selectedType: 'unit', buildMode: null, diplomacy: null, seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(s); __game.renderer.prepare(s); __game.renderer.follow = false; __game.renderer.camera = { x: 21, y: 15 }; __game.renderer.zoom = 1.65;
  });
  await settle();
  check('gold retains the compact 30-second income counter',await page.locator('#gold-yield').textContent()==='(+0)');
  check('gold has a keyboard focus target and no native title',await anchor.getAttribute('tabindex')==='0'&&await anchor.getAttribute('title')===null);
  await anchor.hover(); await tooltip.waitFor({state:'visible'});
  check('empty ledger shows zero totals without empty source rows',await tooltip.locator('.gold-flow-row').count()===0&&await tooltip.locator('[data-total="inputs"]').textContent()==='0'&&await tooltip.locator('[data-total="outlays"]').textContent()==='0'&&await tooltip.locator('[data-total="net"]').textContent()==='0');
  const font=await tooltip.evaluate(e=>getComputedStyle(e).fontFamily);check('custom tooltip uses Pixel Operator',/Pixel Operator/.test(font),font);
  await page.evaluate(async()=>{const {grantIncome}=await __researchImport('/src/game/resource-income.ts');grantIncome(__game.state.factions[0],{gold:100},__game.state,'taxes');}); await settle();
  let flow=await summary(), rows=await visibleRows();
  check('real gross income and Science diversion appear separately',flow.totalInputs===100&&flow.totalOutlays===25&&flow.net===75&&rows.taxes==='+100'&&rows.science==='−25',flow);
  check('positive net is green and signed',await tooltip.locator('[data-total="net"]').textContent()==='+75'&&await tooltip.locator('[data-total="net"]').evaluate(e=>e.classList.contains('is-positive')));
  check('visible counter still reports gross income over 30 seconds',await page.locator('#gold-yield').textContent()==='(+100)');
  await page.evaluate(async()=>{
    const {grantIncome}=await __researchImport('/src/game/resource-income.ts'),{spendGold,refundGold}=await __researchImport('/src/game/gold-ledger.ts'),s=__game.state,f=s.factions[0];
    grantIncome(f,{gold:40},s,'trade');grantIncome(f,{gold:8},s,'loot');grantIncome(f,{gold:200},s,'treasure');
    for(const [amount,category] of [[62.5,'construction'],[50,'settlements'],[15,'defenses'],[5,'army'],[25,'upgrades'],[100,'immigration'],[250,'diplomacy'],[10,'raided']])spendGold(s,f,amount,category);
    refundGold(s,f,12.5);
  }); await settle(); flow=await summary();rows=await visibleRows();
  check('real purchases, upkeep and refunds are categorized and rounded',rows.trade==='+40'&&rows.loot==='+8'&&rows.treasure==='+200'&&rows.refunds==='+13'&&rows.construction==='−63'&&rows.settlements==='−50'&&rows.defenses==='−15'&&rows.army==='−5'&&rows.upgrades==='−25'&&rows.immigration==='−100'&&rows.diplomacy==='−250'&&rows.raided==='−10',rows);
  check('totals reconcile gross receipts and all outlays',flow.totalInputs===360.5&&flow.totalOutlays===604.5&&flow.net===-244&&await tooltip.locator('[data-total="net"]').textContent()==='−244',flow);
  check('negative net uses the outlay color and omits nonexistent fees',await tooltip.locator('[data-total="net"]').evaluate(e=>e.classList.contains('is-negative'))&&!('transfers' in rows)&&!('other' in rows));
  check('spending and refunds do not reduce the existing income counter',await page.locator('#gold-yield').textContent()==='(+348)');
  await page.screenshot({path:`${out}/gold-flow-desktop.png`});
  const beforeRead=await page.evaluate(()=>JSON.stringify(__game.state.factions[0].goldLedger));
  const box=await tooltip.boundingBox();await page.mouse.move(box.x+25,box.y+25,{steps:5});await settle();
  check('hovering from the gold counter into the tooltip stays open',await tooltip.isVisible());
  const selected=await page.evaluate(()=>__game.state.selected);await tooltip.locator('.gold-flow-header').click();await settle();check('tooltip clicks do not select or issue orders in the world',await page.evaluate(()=>__game.state.selected)===selected);
  await page.waitForTimeout(500);check('reading the tooltip never mutates the authoritative ledger',await page.evaluate(()=>JSON.stringify(__game.state.factions[0].goldLedger))===beforeRead);
  check('paused wall time does not age the game-time ledger', (await summary()).totalInputs===360.5&&await page.evaluate(()=>__game.state.time)===0);
  await page.mouse.move(1200,600);await settle();check('pointer exit dismisses the tooltip',await tooltip.isHidden());
  await page.locator('#world').focus();await page.keyboard.press('Tab');await settle();check('Tab reaches gold and opens its accessible tooltip',await anchor.evaluate(e=>e===document.activeElement)&&await tooltip.isVisible()&&await anchor.getAttribute('aria-describedby')===await tooltip.getAttribute('id'));
  await page.keyboard.press('Escape');await settle();check('Escape closes only the tooltip without opening the menu',await tooltip.isHidden()&&await page.locator('#dialog').isHidden());
  await page.keyboard.press('Tab');check('keyboard focus exits without a trap',!await anchor.evaluate(e=>e===document.activeElement));
  for(const viewport of [{width:800,height:700},{width:390,height:844},{width:750,height:500}]){
    await page.setViewportSize(viewport);await anchor.hover();await settle();
    const m=await tooltip.evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:e.scrollWidth-e.clientWidth};});
    check(`tooltip stays inside ${viewport.width}×${viewport.height}`,m.left>=0&&m.right<=viewport.width&&m.top>=0&&m.bottom<=viewport.height&&m.overflow<=1,m);
    await page.screenshot({path:`${out}/gold-flow-${viewport.width}.png`});
  }
  await page.evaluate(()=>{const s=__game.state;s.paused=false;for(let i=0;i<590;i++)__game.step(.1);s.paused=true;});await settle();
  flow=await summary();check('receipts remain in the rolling minute after 59 game seconds',flow.totalInputs===360.5,{time:await page.evaluate(()=>__game.state.time),flow});
  await page.evaluate(()=>{const s=__game.state;s.paused=false;for(let i=0;i<20;i++)__game.step(.1);s.paused=true;});await settle();
  flow=await summary();check('receipts and expenses age out after 60 simulated seconds while open',flow.totalInputs===0&&flow.totalOutlays===0&&await tooltip.locator('.gold-flow-row').count()===0,{time:await page.evaluate(()=>__game.state.time),flow});
  check('no native tooltip is recreated by HUD refresh',await anchor.getAttribute('title')===null);
  check('no browser errors',errors.length===0,errors);
} finally {writeFileSync(`${out}/checks.json`,JSON.stringify({checks,errors},null,2));await browser.close();}
