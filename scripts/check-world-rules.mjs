import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'scratch/2026-11-07-world-rules';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5189', { timeout: 120000 });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { timeout: 120000 });
  const generated = await page.evaluate(() => {
    const state = __game.state; state.paused = true;
    const cities = state.buildings.filter(b => b.kind === 'palace' && b.villageId === undefined);
    let cityGap = Infinity, resourceGap = Infinity;
    for (let a = 0; a < cities.length; a++) for (let b = a + 1; b < cities.length; b++)
      if (cities[a].faction !== cities[b].faction) cityGap = Math.min(cityGap, Math.hypot(cities[a].x - cities[b].x, cities[a].y - cities[b].y));
    const groups = new Map();
    state.world.tiles.forEach((tile, cell) => {
      if (tile.resourceGroup) {
        const group = groups.get(tile.resourceGroup) ?? [];
        group.push({ x: cell % state.world.width, y: Math.floor(cell / state.world.width) }); groups.set(tile.resourceGroup, group);
      }
    });
    const all = [...groups.values()];
    for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++)
      for (const p of all[a]) for (const q of all[b]) resourceGap = Math.min(resourceGap, Math.hypot(p.x - q.x, p.y - q.y));
    return { width: state.world.width, height: state.world.height, cities: cities.length,
      factions: new Set(cities.map(city => city.faction)).size, cityGap, resourceGap,
      groups: groups.size, sizes: [...new Set(all.map(group => group.length))].sort((a,b) => a-b) };
  });
  check('A real browser new game separates all foreign starting cities by at least 80 tiles', generated.factions === 6 && generated.cities === 11 && generated.cityGap >= 80, generated);
  check('Generated deposits are at least ten tiles apart with varied sizes', generated.groups >= 5 && generated.resourceGap >= 10 && generated.sizes.length >= 4, generated);
  const result = await page.evaluate(async () => {
    const loaded = path => [...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === path)?.name ?? path;
    const { canWalk } = await import(loaded('/src/game/pathfinding.ts'));
    const { moveUnit, validateBuildAt } = await import(loaded('/src/game/simulation.ts'));
    const { goldFlowSummary } = await import(loaded('/src/game/gold-ledger.ts'));
    const { recordLeaderDeath } = await import(loaded('/src/game/leader-respawn.ts'));
    const world = { width: 40, height: 32, seed: 'world-rules-browser', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: 1280 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
    const city = (id,x) => ({ id, kind:'palace', faction:0, x, y:10, hp:650,maxHp:650,capacity:4,unhousedResidents:0,
      governorPermissions:{farms:false,housing:false} });
    const leader = { id:100,kind:'leader',faction:0,x:15.5,y:15.5,hp:100,maxHp:100,morale:100,attack:20,defense:5,speed:3.6,range:4,
      order:'hold',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0 };
    const state = { world,buildings:[city(1,10),city(2,25)], units:[leader], factions:[{id:0,name:'Roma',color:'#c94c4c',affinity:100,relation:'self',
      food:100,gold:5,production:0,population:0,culture:10000,yields:{food:0,gold:0,production:0},nextRaid:1e9,nextRetinueAt:1e9,defeated:false}],
      time:29.9,tick:0,paused:true,speed:1,gameOver:false,victory:false,events:[],particles:[],fields:[],treasures:[],
      raiderCamps:[],marauderPacks:[],treeClearings:[],villages:[],roamingMaraudersVersion:1,
      fogRaids:{nextAt:1e9,waves:0,pressureVersion:1}, wildlife:{herds:[],sequence:0,nextRespawnAt:1e9,targetHerds:0},banditIntensity:0,
      selected:100,selectedType:'unit',buildMode:null,diplomacy:null,seed:world.seed,rngState:1 };
    ['stone','copper','iron'].forEach((resource,i) => Object.assign(world.tiles[15 * 40 + 18 + i],{resource,resourceGroup:i+1}));
    __game.replaceState(state); __game.renderer.prepare(state); __game.renderer.camera={x:19,y:14}; __game.renderer.zoom=1.5;
    const blocked = ['stone','copper','iron'].map((resource,i) => ({ resource,walkable:canWalk(state,18.5+i,15.5,0),
      house:validateBuildAt(state,'house',18+i,15),road:validateBuildAt(state,'road',18+i,15) }));
    const goldBeforeRejected = state.factions[0].gold;
    const build = __game.build('road',18,15);
    const goldAfterRejected = state.factions[0].gold;
    let enteredDeposit = false;
    for (let i=0;i<200;i++) { state.time+=.1; moveUnit(state,leader,{x:23.5,y:15.5},.1); enteredDeposit ||= ['stone','copper','iron'].includes(world.tiles[Math.floor(leader.y)*40+Math.floor(leader.x)]?.resource); }
    const arrived = Math.hypot(leader.x-23.5,leader.y-15.5)<.5;
    state.time=29.9; state.paused=false; __game.step(.1); state.paused=true;
    const afterUpkeep = state.factions[0].gold, ledger=goldFlowSummary(state,state.factions[0]);
    state.factions[0].gold=12; leader.hp=0; recordLeaderDeath(state,leader,Date.now());
    return {blocked,build,goldBeforeRejected,goldAfterRejected,arrived,enteredDeposit,afterUpkeep,ledger,afterDeath:state.factions[0].gold};
  });
  check('All three mineral types block walking, houses and roads', result.blocked.every(item => !item.walkable && !item.house.ok && !item.road.ok), result.blocked);
  check('Rejected construction spends no gold', !result.build.ok && result.goldBeforeRejected === result.goldAfterRejected, result.build);
  check('A Leader walks around the mineral barrier without entering it', result.arrived && !result.enteredDeposit, result);
  check('Real upkeep and Leader death cannot overdraw the treasury', result.afterUpkeep === 0 && result.ledger.totalOutlays === 5 && result.afterDeath === 0, result);
  check('No browser runtime errors', errors.length === 0, errors);
} finally {
  await writeFile(`${out}/checks.json`,JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors},null,2));
  await browser.close();
}
