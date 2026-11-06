import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
const output = 'scratch/2026-11-03-world-additions'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), checks = [], errors = [];
page.on('pageerror', error => errors.push(String(error))); await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
const check = (label, value, data) => { checks.push({ label, pass: !!value, data }); console.log(label, !!value, JSON.stringify(data)); assert.ok(value, `${label}: ${JSON.stringify(data)}`); };
async function fixture(twoDocks = false) {
  return page.evaluate(async twoDocks => {
    window.__fishingImport = async pathname => {
      const loaded = [...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === pathname);
      return import(loaded?.name ?? pathname);
    };
    const width = 56, height = 40, world = { width, height, seed: 'fishing-coast-browser', source: 'isolated QA coast', spawns: [], revision: 1,
      tiles: Array.from({ length: width * height }, (_, cell) => {
        const x = cell % width, y = Math.floor(cell / width), land = y < 18 || x >= 24 && x <= 26 && y <= 25;
        return { terrain: land ? 'grassland' : y < 22 ? 'coast' : 'ocean', overlay: 'none', elevation: land ? .3 : .1,
          moisture: .5, food: land ? 2 : 0, production: 1, gold: 0, variation: cell % 13 / 13 };
      }) };
    const palace = { id: 1, kind: 'palace', x: 15, y: 13, faction: 0, hp: 650, maxHp: 650, capacity: 4, unhousedResidents: 4,
      foodDelivered: 0, cityName: 'Ostia', governorPermissions: { farms: false, housing: false } };
    const s = { world, buildings: [palace], units: [{ id: 10, kind: 'leader', x: 16.5, y: 16.5, faction: 0, hp: 100, maxHp: 100,
        morale: 100, attack: 0, defense: 4, speed: 0, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Romans', color: '#c94c4c', affinity: 100, relation: 'self', food: 100, gold: 2000, production: 0,
        population: 4, culture: 0, incomeTotals: { food: 0, gold: 0, culture: 0 }, yields: { food: 0, production: 0, gold: 0 },
        nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false, research: { focus: 'sailing', levels: { scoutLodge: 1, sailing: 1 }, progress: {} } }],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], projectiles: [], bloodEffects: [], treasures: [],
      raiderCamps: [], marauderPacks: [], villages: [], treeClearings: [], roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0,
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null,
      gameOver: false, victory: false, victoryContinued: true, seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(s);
    const { dockPlacement } = await __fishingImport('/src/game/dock.ts');
    const docks = [17, ...(twoDocks ? [21] : [])].map((x, index) => {
      const placement = dockPlacement(s, x, 17, 0); if (!placement) throw Error('Invalid QA dock shoreline');
      return { id: 2 + index, kind: 'dock', x, y: 17, faction: 0, hp: 250, maxHp: 250, capacity: 0, dockFacing: placement.facing };
    });
    __game.entities(s).buildings.add(...docks);
    window.__fishingStep = dt => { s.paused = false; __game.step(dt); s.paused = true; __game.renderer.draw(s, dt); };
    __game.renderer.prepare(s); __game.renderer.follow = false; __game.renderer.camera = { x: 19, y: 18 }; __game.renderer.zoom = 1.7;
    __fishingStep(.05);
    if (!s.fishing) throw Error('Actual game tick did not initialize fishing');
    const natural = { zones: s.fishing.zones.length, fish: s.fishing.fish.length, fishingBoats: s.fishing.boats.length,
      sailboats: s.units.filter(unit => unit.kind === 'sailboat').length, docks: docks.map(d => ({ id: d.id, facing: d.dockFacing })) };
    s.fishing.zones.forEach(zone => zone.nextSpawnAt = 1e12);
    s.fishing.fish = [[20.5,20.5],[21.5,20.5],[20.5,21.5],[21.5,21.5],...(twoDocks ? [[22.5,20.5],[22.5,21.5]] : [])]
      .map(([x,y]) => ({ id: ++s.fishing.sequence, zone: s.fishing.zones[0].id, x, y, food: 5, spawnedAt: s.time, facing: 0 }));
    for (const boat of s.fishing.boats) { boat.x = boat.home.x; boat.y = boat.home.y; boat.phase = 'idle'; boat.cargo = 0; boat.target = undefined; boat.path = []; boat.nextPlanAt = s.time; }
    const { citySummaries } = await __fishingImport('/src/game/cities.ts');
    const city = citySummaries(s).find(city => city.palace.id === palace.id);
    window.__fishingBefore = { food: s.factions[0].food, delivered: palace.foodDelivered, income: s.factions[0].incomeTotals.food, cityFood: city.food };
    for (let i = 0; i < 18; i++) __game.renderer.draw(s, .05);
    return { natural, before: window.__fishingBefore, fishCount: s.fishing.fish.length };
  }, twoDocks);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const initial = await fixture();
  check('actual game tick creates natural fishing zones and an independent boat beside the Leader sailboat', initial.natural.zones > 0 && initial.natural.fish > 0 && initial.natural.fishingBoats === 1 && initial.natural.sailboats === 1, initial);
  const native = await page.evaluate(() => ['Fish-Sheet.png','Fishing-Boat.png'].map(file => performance.getEntriesByType('resource').some(entry => entry.name.endsWith(file))));
  check('native Miniworld fish and fishing-boat sheets are loaded', native.every(Boolean), native);
  const pixels = await page.evaluate(async () => {
    const s = __game.state, renderer = __game.renderer, fish = s.fishing.fish[0];
    const {fishSurfaceFrame}=await __fishingImport('/src/game/fishing-art.ts');
    window.__showFishFrame=(fish,frame)=>{ for(let age=0;age<35;age+=.02){fish.spawnedAt=s.time-age;if(fishSurfaceFrame(fish,s.time)===frame)return;}throw Error('No surface frame'); };
    const crop = point => { renderer.draw(s,0);const source = renderer.gpu.snapshot(),c=document.createElement('canvas');c.width=c.height=52;
      const p=renderer.screenPoint({x:point.x-.5,y:point.y-.5});c.getContext('2d').drawImage(source,p.x,p.y,52,52,0,0,52,52);return c.getContext('2d').getImageData(0,0,52,52).data; };
    const delta = (a,b) => { let count=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])count++;return count; };
    __showFishFrame(fish,3);const present=crop(fish);s.fishing.fish=s.fishing.fish.filter(f=>f!==fish);const absent=crop(fish);s.fishing.fish.unshift(fish);
    __showFishFrame(fish,-1);const submerged=crop(fish);__showFishFrame(fish,12);const ripple=crop(fish);__showFishFrame(fish,3);
    const zoneBefore=crop(fish),savedZones=s.fishing.zones;s.fishing.zones=[];const zoneAfter=crop(fish);s.fishing.zones=savedZones;
    const hidden={id:++s.fishing.sequence,zone:s.fishing.zones[0].id,x:45.5,y:33.5,food:5,spawnedAt:s.time,facing:0};
    __showFishFrame(hidden,3);
    const camera={...renderer.camera};renderer.camera={x:45,y:33};s.fishing.fish.push(hidden);
    const withHidden=crop(hidden);s.fishing.fish=s.fishing.fish.filter(f=>f!==hidden);const withoutHidden=crop(hidden);renderer.camera=camera;renderer.draw(s,0);
    const {updateFog,pointInSight}=await __fishingImport('/src/game/fog.ts');
    return { visibleFishPixelChanges:delta(present,absent),submergedPixelChanges:delta(submerged,absent),ripplePixelChanges:delta(ripple,absent),zonePixelChanges:delta(zoneBefore,zoneAfter),hiddenFishPixelChanges:delta(withHidden,withoutHidden),hiddenInSight:pointInSight(updateFog(s),hidden.x,hidden.y) };
  });
  check('visible fish render while hidden fish and zone geometry never leak through fog',pixels.visibleFishPixelChanges>20 && pixels.zonePixelChanges===0 && pixels.hiddenFishPixelChanges===0 && !pixels.hiddenInSight,pixels);
  check('submerged fish are entirely invisible and surface ripples briefly remain after the fish dives',pixels.submergedPixelChanges===0&&pixels.ripplePixelChanges>20,pixels);
  await page.screenshot({path:`${output}/fishing-visible-stock.png`});
  await page.evaluate(()=>{__showFishFrame(__game.state.fishing.fish[0],12);__game.renderer.draw(__game.state,0);});
  await page.screenshot({path:`${output}/fishing-surface-ripple.png`});
  const firstCatch = await page.evaluate(() => {
    const s=__game.state,before=__fishingBefore;let waterOnly=true,noEarlyCredit=true,trace=[];
    for(let i=0;i<400;i++){
      __fishingStep(.05);const b=s.fishing.boats[0],tile=s.world.tiles[Math.floor(b.y)*s.world.width+Math.floor(b.x)];
      waterOnly&&=['coast','ocean','river','lake'].includes(tile.terrain);
      noEarlyCredit&&=s.factions[0].food===before.food && s.buildings.find(b=>b.id===1).foodDelivered===before.delivered && s.factions[0].incomeTotals.food===before.income;
      trace.push({time:s.time,x:b.x,y:b.y,cargo:b.cargo,phase:b.phase,fish:s.fishing.fish.length});
      if(b.cargo>0)return {time:s.time,waterOnly,noEarlyCredit,cargo:b.cargo,phase:b.phase,fishLeft:s.fishing.fish.length,trace};
    }throw Error('No physical catch within20seconds');
  });
  check('the automatic boat travels on water and physically catches fish without crediting food yet',firstCatch.waterOnly&&firstCatch.noEarlyCredit&&firstCatch.cargo===5&&firstCatch.fishLeft===3,{...firstCatch,trace:undefined});
  await page.screenshot({path:`${output}/fishing-working.png`});
  const delivery = await page.evaluate(async () => {
    const s=__game.state,before=__fishingBefore;let waterOnly=true,noEarlyCredit=true,caughtOnWater=true,previousCargo=s.fishing.boats[0].cargo,largestCargo=previousCargo;
    for(let i=0;i<500;i++){
      __fishingStep(.05);const boat=s.fishing.boats[0],tile=s.world.tiles[Math.floor(boat.y)*s.world.width+Math.floor(boat.x)];
      const wet=['coast','ocean','river','lake'].includes(tile.terrain);waterOnly&&=wet;
      if(boat.cargo>previousCargo)caughtOnWater&&=wet;previousCargo=boat.cargo;largestCargo=Math.max(largestCargo,boat.cargo);
      if(!s.fishing.receipts.length)noEarlyCredit&&=s.factions[0].food===before.food && s.buildings.find(b=>b.id===1).foodDelivered===before.delivered && s.factions[0].incomeTotals.food===before.income;
      else {
        const {citySummaries}=await __fishingImport('/src/game/cities.ts'),{fishingCityFoodPerEconomyCycle}=await __fishingImport('/src/game/fishing.ts');
        const city=citySummaries(s).find(c=>c.palace.id===1), contribution=fishingCityFoodPerEconomyCycle(s,1);
        return {time:s.time,waterOnly,caughtOnWater,noEarlyCredit,largestCargo,fishLeft:s.fishing.fish.length,cargo:boat.cargo,phase:boat.phase,
          homeDistance:Math.hypot(boat.x-boat.home.x,boat.y-boat.home.y),foodDelta:s.factions[0].food-before.food,
          cityDelivered:s.buildings.find(b=>b.id===1).foodDelivered-before.delivered,incomeDelta:s.factions[0].incomeTotals.food-before.income,
          contribution,cityFoodDelta:city.food-before.cityFood,receipts:s.fishing.receipts};
      }
    }throw Error('Loaded fishing boat never delivered');
  });
  check('four fish become20food only after physical dock return, in faction,city and income ledgers',delivery.time<30&&delivery.waterOnly&&delivery.caughtOnWater&&delivery.noEarlyCredit&&delivery.largestCargo===20&&delivery.cargo===0&&delivery.homeDistance<.04&&delivery.foodDelta===20&&delivery.cityDelivered===20&&delivery.incomeDelta===20,delivery);
  check('city food summary includes actual delivered fishing income',delivery.contribution===20&&Math.abs(delivery.cityFoodDelta-delivery.contribution)<1e-6,delivery);
  // The HUD samples every150ms and native city ribbons refresh once per real
  // second. Let those production presentation cadences run while paused.
  await page.waitForTimeout(1250);
  const displayed=await page.evaluate(()=>({food:document.querySelector('#food').textContent,income:document.querySelector('#food-yield').textContent,
    cityFood:__game.renderer.citySummaryCache.values.find(city=>city.palace.id===1).food}));
  check('the actual resource HUD and native city ribbon refresh after delivery',displayed.food==='120'&&displayed.income==='(+20)'&&displayed.cityFood===20,displayed);
  await page.screenshot({path:`${output}/fishing-delivery.png`});

  await fixture(true);
  const shared = await page.evaluate(()=>{
    const s=__game.state,initialStock=s.fishing.fish.reduce((sum,f)=>sum+f.food,0),before=__fishingBefore;
    let reservationSafe=true,stockConserved=true,waterOnly=true,maxActive=0,returned=0;
    for(let i=0;i<500;i++){
      __fishingStep(.05);const boats=s.fishing.boats,targets=boats.map(b=>b.target).filter(t=>t!==undefined);
      reservationSafe&&=new Set(targets).size===targets.length&&s.fishing.fish.every(f=>f.claimedBy===undefined||boats.find(b=>b.id===f.claimedBy)?.target===f.id);
      const delivered=s.fishing.receipts.reduce((sum,r)=>sum+r.food,0),cargo=boats.reduce((sum,b)=>sum+b.cargo,0),stock=s.fishing.fish.reduce((sum,f)=>sum+f.food,0);
      stockConserved&&=stock+cargo+delivered===initialStock;maxActive=Math.max(maxActive,boats.filter(b=>b.phase!=='idle').length);
      waterOnly&&=boats.every(b=>['coast','ocean','river','lake'].includes(s.world.tiles[Math.floor(b.y)*s.world.width+Math.floor(b.x)].terrain));
      if(delivered===initialStock){returned=boats.filter(b=>b.cargo===0&&Math.hypot(b.x-b.home.x,b.y-b.home.y)<.04).length;break;}
    }
    return {time:s.time,initialStock,boats:s.fishing.boats.length,sailboats:s.units.filter(u=>u.kind==='sailboat').length,reservationSafe,stockConserved,waterOnly,maxActive,returned,
      delivered:s.fishing.receipts.reduce((sum,r)=>sum+r.food,0),foodDelta:s.factions[0].food-before.food,incomeDelta:s.factions[0].incomeTotals.food-before.income};
  });
  check('two docks share fish without duplicate reservations,catches or delivery',shared.boats===2&&shared.sailboats===2&&shared.maxActive===2&&shared.reservationSafe&&shared.stockConserved&&shared.waterOnly&&shared.delivered===30&&shared.foodDelta===30&&shared.incomeDelta===30&&shared.returned===2,shared);
  await page.screenshot({path:`${output}/fishing-two-docks.png`});
  await fixture();
  const detour=await page.evaluate(async()=>{
    const s=__game.state,renderer=__game.renderer,{updateFog,pointInSight}=await __fishingImport('/src/game/fog.ts');
    const fish={id:++s.fishing.sequence,zone:s.fishing.zones[0].id,x:29.5,y:20.5,food:5,spawnedAt:s.time,facing:Math.PI};s.fishing.fish=[fish];
    const initiallyHidden=!pointInSight(updateFog(s),fish.x,fish.y);let waterOnly=true,maxY=0,sightProbe;
    renderer.camera={x:26,y:23};renderer.zoom=1.5;
    for(let i=0;i<500;i++){
      __fishingStep(.05);const boat=s.fishing.boats[0];maxY=Math.max(maxY,boat.y);
      waterOnly&&=['coast','ocean','river','lake'].includes(s.world.tiles[Math.floor(boat.y)*s.world.width+Math.floor(boat.x)].terrain);
      const fog=updateFog(s);
      if(!sightProbe&&boat.x>=26.45&&boat.y>=26.45){
        const q={x:Math.floor(boat.x)+.5,y:Math.floor(boat.y)+.5};
        sightProbe={sourceRadius: fog.sources.find(source=>source.radius===4&&source.x===q.x&&source.y===q.y)?.radius,
          threeTilesVisible:pointInSight(fog,q.x+3,q.y),fiveTilesVisible:pointInSight(fog,q.x+5,q.y)};
      }
      if(pointInSight(fog,fish.x,fish.y)&&Math.hypot(boat.x-fish.x,boat.y-fish.y)>1){
        return {time:s.time,initiallyHidden,waterOnly,maxY,sightProbe,fishVisible:true,boat:{x:boat.x,y:boat.y,cargo:boat.cargo},foodDelta:s.factions[0].food-__fishingBefore.food};
      }
    }throw Error('Fishing boat did not discover the fish beyond the peninsula');
  });
  check('the boat detours around a peninsula and reveals fish with its own4-tile sight',detour.initiallyHidden&&detour.waterOnly&&detour.maxY>=26.45&&detour.sightProbe?.sourceRadius===4&&detour.sightProbe.threeTilesVisible&&!detour.sightProbe.fiveTilesVisible&&detour.foodDelta===0,detour);
  await page.evaluate(()=>__fishingStep(.4));
  await page.screenshot({path:`${output}/fishing-offshore-detour.png`});
  const finalReturn=await page.evaluate(()=>{
    const s=__game.state;let waterOnly=true;for(let i=0;i<500;i++){
      __fishingStep(.05);const b=s.fishing.boats[0];waterOnly&&=['coast','ocean','river','lake'].includes(s.world.tiles[Math.floor(b.y)*s.world.width+Math.floor(b.x)].terrain);
      if(s.fishing.receipts.length)return {time:s.time,waterOnly,foodDelta:s.factions[0].food-__fishingBefore.food,homeDistance:Math.hypot(b.x-b.home.x,b.y-b.home.y),cargo:b.cargo};
    }throw Error('Offshore catch never returned around peninsula');
  });
  check('the offshore catch returns by water and credits exactly once',finalReturn.time<30&&finalReturn.waterOnly&&finalReturn.foodDelta===5&&finalReturn.homeDistance<.04&&finalReturn.cargo===0,finalReturn);
  check('no browser runtime errors',errors.length===0,errors);rmSync(`${output}/fishing-failure.png`,{force:true});
}catch(error){await page.screenshot({path:`${output}/fishing-failure.png`}).catch(()=>{});throw error;}
finally{writeFileSync(`${output}/fishing-checks.json`,JSON.stringify({checks,errors},null,2));await browser.close();}
