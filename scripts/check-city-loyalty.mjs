import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'scratch/2026-11-07-loyalty'; await mkdir(out,{recursive:true});
const browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage({viewport:{width:1440,height:900}}), checks=[], errors=[];
const check=(name,value)=>{ assert.ok(value,name); checks.push(name); console.log(`PASS ${name}`); };
page.on('pageerror',e=>errors.push(String(e)));
await page.routeWebSocket('**',s=>s.close());
await page.addInitScript(()=>performance.setResourceTimingBufferSize(10000));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5189');
  await page.waitForFunction(()=>window.__game && document.documentElement.dataset.assets==='ready',null,{timeout:120000});
  await page.evaluate(async()=>{
    window.loyaltyImport=async path=>{ const loaded=[...performance.getEntriesByType('resource')].reverse().find(e=>new URL(e.name).pathname===path); return import(loaded?.name??path); };
    const {loyaltyFixture}=await loyaltyImport('/tests/helpers/loyalty.ts');
    const {initialCityLoyalty}=await loyaltyImport('/src/game/loyalty-model.ts');
    const f=loyaltyFixture(); f.state.paused=true; f.state.selected=f.leader.id; f.state.selectedType='unit';
    f.city.loyalty={...initialCityLoyalty(0,32),target:-10,rate:-.23,pressure:.8,support:-24,trauma:15,advanced:1,guards:1};
    __game.replaceState(f.state); __game.renderer.prepare(f.state); __game.renderer.follow=false;
    __game.renderer.camera={x:20,y:30}; __game.renderer.zoom=1.8;
  });
  await page.waitForTimeout(300);
  await page.screenshot({path:`${out}/loyalty-warning.png`});
  const alpha=await page.evaluate(async()=>{
    const {loyaltyPanelAlpha}=await loyaltyImport('/src/game/loyalty-model.ts'); const c=__game.state.buildings.find(b=>b.id===900);
    return [0,1500,3000].map(now=>loyaltyPanelAlpha(c,0,now));
  });
  check('At-risk city panel pulses on a slow three-second cycle',alpha[0]===1&&alpha[1]===.72&&alpha[2]===1);
  const center=await page.evaluate(()=>__game.renderer.screenPoint({x:18,y:29.5}));
  await page.mouse.click(center.x,center.y); await page.locator('.city-loyalty-summary').waitFor({state:'visible'});
  check('Settlement popup explains score, trend, target, and pressures', (await page.locator('.city-loyalty-summary').innerText()).includes('32/100') && (await page.locator('.city-loyalty-factors').innerText()).includes('Borders'));
  await page.screenshot({path:`${out}/loyalty-breakdown.png`});
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
    const {updateCityLoyalty}=await loyaltyImport('/src/game/loyalty.ts'); const {secedeCity}=await loyaltyImport('/src/game/city-secession.ts');
    const s=__game.state,c=s.buildings.find(b=>b.id===900); s.time=5;s.loyaltyUpdatedAt=0;s.nextLoyaltyAt=0;
    c.loyalty.value=.1;c.loyalty.graceUntil=0;c.loyalty.trauma=75;c.loyalty.traumaAt=5;
    updateCityLoyalty(s,c=>secedeCity(s,c));
  });
  await page.waitForTimeout(1200);
  check('Zero loyalty changes the city to a white neutral faction',await page.evaluate(()=>{
    const s=__game.state,c=s.buildings.find(b=>b.id===900); return c.villageId!==undefined&&s.factions.find(f=>f.id===c.faction).color==='#ffffff';
  }));
  await page.screenshot({path:`${out}/neutral-city.png`});
  await page.mouse.click(center.x,center.y,{button:'right'});
  await page.locator('#village-trade').waitFor({state:'visible'});
  check('Revolted settlement offers trade, alliance and war in the existing diplomacy popup', await page.locator('#village-trade').isEnabled()&&await page.locator('#village-ally').isEnabled()&&await page.locator('#village-war').isEnabled());
  await page.screenshot({path:`${out}/neutral-city-diplomacy.png`});
  await page.locator('#village-trade').click();
  check('Trade purchase creates a live route to the independent settlement',await page.evaluate(()=>__game.state.tradeRoutes.some(r=>r.villageId===__game.state.villages[0].id)));
  await page.mouse.click(center.x,center.y,{button:'right'}); await page.locator('#village-war').click();
  await page.evaluate(async()=>{
    const {updateGame}=await loyaltyImport('/src/game/simulation.ts'); const s=__game.state,c=s.buildings.find(b=>b.id===900),l=s.units.find(u=>u.id===1);
    c.hp=1;s.projectiles=[{start:{x:l.x,y:l.y},end:{x:c.x+1,y:c.y+1},x:l.x,y:l.y,attacker:l.id,target:c.id,faction:0,damage:100,elapsed:0,duration:.01}];
    s.paused=false;updateGame(s,.1,{up:false,down:false,left:false,right:false});s.paused=true;
  });
  await page.waitForTimeout(300);
  check('Attacking the independent settlement offers military recapture',await page.evaluate(()=>__game.state.palaceCaptures?.[0]?.palaceId===900));
  await page.evaluate(async()=>{ const {resolvePalaceCapture}=await loyaltyImport('/src/game/simulation.ts'); resolvePalaceCapture(__game.state,900,true); });
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  check('Recapture restores faction ownership and gives 60 loyalty',await page.evaluate(()=>__game.state.buildings.some(b=>b.kind==='palace'&&b.cityName==='Capua'&&b.faction===0&&b.loyalty?.value===60)));
  await page.screenshot({path:`${out}/recaptured-city.png`});
  check('No browser runtime errors',errors.length===0);
  await writeFile(`${out}/browser-report.json`,JSON.stringify({checks,errors},null,2));
} finally { await browser.close(); }
