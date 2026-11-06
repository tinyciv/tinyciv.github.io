import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-10-26-monuments-culture';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [], report = { checks, errors, layouts: [] };
page.on('pageerror', error => errors.push(String(error)));
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail ?? ''); };
const close = (a, b, tolerance = 1e-7) => Math.abs(a - b) < tolerance;
const clickTile = async (x, y) => {
  const point = await page.evaluate(point => window.__game.renderer.screenPoint(point), { x: x + .5, y: y + .5 });
  await page.mouse.click(point.x, point.y);
};
const advance = seconds => page.evaluate(seconds => {
  const game = window.__game; game.state.paused = false; game.step(seconds); game.state.paused = true;
}, seconds);

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  if (await page.locator('#dialog').isVisible()) await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { updateFog } = await import('/src/game/fog.ts');
    const game = window.__game;
    const world = { width: 48, height: 36, seed: 'culture-monument-browser', source: 'browser fixture', spawns: [], revision: 0,
      tiles: Array.from({ length: 48 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .3 })) };
    const state = { world, buildings: [{ id: 1, kind: 'palace', faction: 0, x: 14, y: 17, hp: 650, maxHp: 650, capacity: 0 }],
      units: [{ id: 2, kind: 'leader', faction: 0, x: 20.5, y: 18.5, hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5,
        speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Culture test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 199,
        production: 0, population: 4, growth: 0, culture: 0, research: { focus: 'monument', levels: { monument: 1 }, progress: {} },
        yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, defeated: false }],
      time: 0, tick: 0, paused: true, speed: 1, gameOver: false, victory: false, events: [], particles: [], projectiles: [],
      fields: [], treasures: [], raiderCamps: [], marauderPacks: [], roamingMaraudersVersion: 1,
      selected: 2, selectedType: 'unit', buildMode: null, diplomacy: null, seed: world.seed, rngState: 1,
      fog: undefined, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    game.replaceState(state); updateFog(game.state);
    game.renderer.prepare(game.state); game.renderer.follow = false; game.renderer.camera = { x: 18, y: 18 }; game.renderer.zoom = 2;
  });
  await page.keyboard.press('b'); await page.keyboard.press('m');
  await page.waitForFunction(() => window.__game.state.buildMode === 'monument' && document.querySelector('[data-build="monument"]').getAttribute('aria-pressed') === 'true');
  check('B then M selects Monument', true);
  await clickTile(19, 17);
  const rejected = await page.evaluate(() => ({ gold: window.__game.state.factions[0].gold, monuments: window.__game.state.buildings.filter(building => building.kind === 'monument').length }));
  check('199 gold rejects placement without a charge', rejected.gold === 199 && rejected.monuments === 0, rejected);
  await page.evaluate(() => { window.__game.state.factions[0].gold = 200; });
  await page.waitForFunction(() => !document.querySelector('[data-build="monument"]').disabled);
  await clickTile(19, 17); await page.keyboard.press('Escape');
  const queued = await page.evaluate(() => ({ gold: window.__game.state.factions[0].gold, culture: window.__game.state.factions[0].culture,
    monument: window.__game.state.buildings.find(building => building.kind === 'monument') }));
  check('200 gold queues a 20-second monument', queued.gold === 0 && queued.culture === 0 && queued.monument?.construction?.duration === 20, queued);
  assert.ok(queued.monument, 'The remaining integration checks require the UI-placed monument');
  const construction = await page.evaluate(() => {
    const game = window.__game, monument = game.state.buildings.find(building => building.kind === 'monument');
    let working = false, incomeWhileUnfinished = false, steps = 0;
    game.state.paused = false;
    while (monument.construction && steps++ < 600) {
      game.step(.1);
      if (monument.construction?.waitingForBuilder === false) working ||= game.state.units.some(unit => unit.builder && unit.buildSite === monument.id && unit.buildPhase === 'working');
      if (monument.construction && game.state.factions[0].culture !== 0) incomeWhileUnfinished = true;
    }
    game.state.paused = true; game.state.selected = monument.id; game.state.selectedType = 'building';
    return { completed: !monument.construction, working, incomeWhileUnfinished, elapsed: game.state.time, culture: game.state.factions[0].culture };
  });
  check('real builder finishes with no income during construction', construction.completed && construction.working && !construction.incomeWhileUnfinished && construction.elapsed >= 20, construction);
  const cultureBefore = await page.evaluate(() => window.__game.state.factions[0].culture);
  await advance(2.5);
  const income = await page.evaluate(async () => {
    const { culturePerSecond } = await import('/src/game/culture.ts');
    return { culture: window.__game.state.factions[0].culture, rate: culturePerSecond(window.__game.state, 0) };
  });
  check('completed monument earns two thirds culture per simulated second', close(income.culture - cultureBefore, 2.5 * 2 / 3) && close(income.rate, 2 / 3), income);
  await page.waitForFunction(() => document.querySelector('#selection-panel').title.includes('culture/s'));
  check('selected monument advertises income in its tooltip and keeps three compact stats',
    await page.locator('#selection-stats > span > .stat-label').allTextContents().then(labels => labels.join(',') === 'HP,Attack,Defense'));
  const population = await page.evaluate(async () => {
    const { territory } = await import('/src/game/borders.ts'), state = window.__game.state;
    const before = territory(state), count = [...before.owners].filter(owner => owner === 0).length;
    state.factions[0].population = 40;
    const after = territory(state); state.factions[0].population = 4;
    return { sameCache: before === after, before: count, after: [...after.owners].filter(owner => owner === 0).length };
  });
  check('population changes neither claim size nor territory cache', population.sameCache && population.before === population.after, population);
  const threshold = await page.evaluate(async () => {
    const { territory, borderRadius } = await import('/src/game/borders.ts');
    const { cultureLevel, nextCultureThreshold } = await import('/src/game/culture.ts');
    const game = window.__game; game.state.factions[0].culture = 99;
    const before = territory(game.state), initialRadius = borderRadius('palace',99);
    game.state.paused = false; game.step(1.5); game.state.paused = true;
    const culture = game.state.factions[0].culture, after = territory(game.state);
    return { culture, level: cultureLevel(culture), next: nextCultureThreshold(culture), initialRadius, radius: borderRadius('palace',culture),
      changedCache: before !== after, before: [...before.owners].filter(owner => owner===0).length, after: [...after.owners].filter(owner => owner===0).length };
  });
  check('99 to 100 culture expands borders and advances the threshold to 300', close(threshold.culture,100) && threshold.level===1 && threshold.next===300
    && close(threshold.radius,threshold.initialRadius+1.3) && threshold.changedCache && threshold.after>threshold.before, threshold);
  await page.waitForTimeout(200);
  const hud = { culture: await page.locator('#culture').textContent(), title: await page.locator('.resource.culture').getAttribute('title') };
  check('culture HUD shows the count and keeps threshold and production details in its tooltip',
    hud.culture==='100' && hud.title.includes('Next expansion at 300 culture') && /0\.67 culture per second/.test(hud.title), hud);
  await page.evaluate(() => window.__game.save());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets==='ready');
  const restored = await page.evaluate(() => ({ culture: window.__game.state.factions[0].culture, paused: window.__game.state.paused,
    monuments: window.__game.state.buildings.filter(building => building.kind==='monument' && !building.construction).length,
    marauders: window.__game.state.units.filter(unit => unit.faction<0).length }));
  check('culture and completed monument survive reload without spawning fixture enemies', close(restored.culture,threshold.culture) && restored.paused && restored.monuments===1 && restored.marauders===0, restored);
  await page.keyboard.press('b'); await page.keyboard.press('m');
  for (const width of [1440,900,375]) {
    const height = width===375 ? 812 : 900;
    await page.setViewportSize({width,height}); await page.waitForTimeout(200);
    const layout = await page.evaluate(() => {
      const rect = element => { const b=element.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}; };
      const culture=rect(document.querySelector('.resource.culture')), panel=rect(document.querySelector('#build-panel'));
      const values=[...document.querySelectorAll('#culture')].map(rect);
      const controls=[...document.querySelectorAll('.time-controls button')].map(rect), buttons=[...document.querySelectorAll('[data-build]:not([hidden])')].map(rect);
      return { width:innerWidth,height:innerHeight,culture,values,controls,panel,buttons,status:rect(document.querySelector('#build-status')),
        logicalPanelHeight:parseFloat(getComputedStyle(document.querySelector('#build-panel')).height), pageOverflow:document.documentElement.scrollWidth>innerWidth };
    });
    report.layouts.push(layout);
    const visible = box => box.x>=-.75 && box.y>=-.75 && box.right<=width+.75 && box.bottom<=height+.75;
    const inPanel = box => box.x>=layout.panel.x-.75 && box.y>=layout.panel.y-.75 && box.right<=layout.panel.right+.75 && box.bottom<=layout.panel.bottom+.75;
    check(`${width}px culture and time controls fit`, !layout.pageOverflow && visible(layout.culture) && layout.values.every(box=>visible(box)&&box.right<=layout.culture.right+.75) && layout.controls.every(visible), { culture:layout.culture,controls:layout.controls });
    const columns = new Set(layout.buttons.map(button => Math.round(button.x))).size;
    check(`${width}px twelve build buttons fit a three-column popup`, layout.buttons.length===12 && columns===3 && visible(layout.panel) && layout.buttons.every(inPanel));
    check(`${width}px construction feedback fits outside the bottom controls`, visible(layout.status) && layout.status.bottom < layout.panel.bottom);
    await page.mouse.move(width-5,100); await page.screenshot({path:`${output}/culture-hud-${width}.png`});
  }
  const destroyed = await page.evaluate(async () => {
    const { culturePerSecond } = await import('/src/game/culture.ts');
    const game=window.__game, before=game.state.factions[0].culture;
    game.state.buildings.find(building=>building.kind==='monument').hp=0;
    game.state.paused=false; game.step(2); game.state.paused=true;
    return {before,after:game.state.factions[0].culture,rate:culturePerSecond(game.state,0)};
  });
  check('destroying the monument stops income while retaining earned culture', close(destroyed.before,destroyed.after) && destroyed.rate===0, destroyed);
  check('no browser runtime errors', errors.length===0,errors);
  Object.assign(report,{queued,construction,income,population,threshold,hud,restored,destroyed});
  writeFileSync(`${output}/culture-monument-report.json`,JSON.stringify(report,null,2));
  assert.equal(checks.filter(check=>!check.pass).length,0,'Culture/monument browser checks failed; see the saved report');
} finally { await browser.close(); }
