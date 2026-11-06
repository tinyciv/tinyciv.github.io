import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-10-31-village-diplomacy';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const checks = [], errors = [];
const check = (label, pass, data) => { checks.push({ label, pass, data }); assert.ok(pass, `${label}: ${JSON.stringify(data)}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.routeWebSocket('**', socket => socket.close());
  const settle = () => page.waitForTimeout(150), dialog = page.locator('#dialog');
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5191/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready').catch(async error => {
    console.error(JSON.stringify({ errors, startup: await page.evaluate(() => ({ game: !!window.__game, assets: document.documentElement.dataset.assets, text: document.body.innerText.slice(0, 800) })) }));
    throw error;
  });
  const fixture = async (paused = true, gold = 4000) => {
    await page.keyboard.press('Escape');
    await page.evaluate(async ({ paused, gold }) => {
      const world = { width: 48, height: 36, seed: 'village-diplomacy-ui', source: 'isolated QA', spawns: [], revision: 1,
        tiles: Array.from({ length: 1728 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .7, food: 3, production: 1, gold: 0, variation: i % 13 / 13 })) };
      const building = (id, kind, x, y, faction = 3) => ({ id, kind, x, y, faction, hp: 350, maxHp: 350, capacity: 0, ...(faction === 3 ? { villageId: 2 } : {}) });
      const person = (id, kind, x, y, faction = 3) => ({ id, kind, x, y, faction, hp: 100, maxHp: 100, morale: 100, attack: kind === 'worker' ? 0 : 17,
        defense: 4, speed: 0, range: 4, order: 'hold', cooldown: 0, lastCombat: -100, moving: false, facing: 0, attackTime: 0, ...(faction === 3 ? { villageId: 2, home: 10 } : {}) });
      const faction = (id, name, color, relation) => ({ id, name, color, affinity: 100, relation, food: 500, gold: id === 0 ? gold : 0,
        production: 0, population: 0, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: Infinity, defeated: false,
        ...(id === 3 ? { villageId: 2 } : {}) });
      const state = { world,
        buildings: [building(1, 'palace', 12, 16, 0), building(10, 'villageTent', 22, 16), building(11, 'villageTent', 20, 14), building(12, 'villageTent', 25, 14)],
        units: [person(500, 'leader', 16.5, 16.5, 0), person(601, 'worker', 22.5, 14.5), person(602, 'worker', 24.5, 16.5), person(603, 'worker', 22.5, 19.5)],
        factions: [faction(0, 'Roma', '#c94c4c', 'self'), faction(3, 'Willow tribe', '#ffffff', 'peace')],
        villages: [{ id: 2, faction: 3, campId: 10, x: 22, y: 16, name: 'Willow tribe', identity: 'growers', relation: 'neutral', nextGrowthAt: 10000, nextThinkAt: 10000, nextRecruitAt: 10000 }],
        time: 150, tick: 5, paused, speed: 1, events: [], particles: [], fields: [], projectiles: [], bloodEffects: [], treasures: [], raiderCamps: [],
        marauderPacks: [], treeClearings: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 },
        selected: 500, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
        seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
      window.__game.replaceState(state);
      const { updateFog } = await import('/src/game/fog.ts'); updateFog(state);
      const { renderer } = window.__game; renderer.prepare(state); renderer.follow = false; renderer.camera = { x: 20, y: 16 }; renderer.zoom = 2;
    }, { paused, gold });
    await settle();
  };
  const rightClick = async (id = 11) => {
    const point = await page.evaluate(id => {
      const { state, renderer } = window.__game, building = state.buildings.find(b => b.id === id);
      const screen = renderer.screenPoint({ x: building.x + .5, y: building.y + .5 }), rect = renderer.canvas.getBoundingClientRect();
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    }, id);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await dialog.waitFor({ state: 'visible' }); await settle();
  };
  const stateSummary = () => page.evaluate(() => {
    const s = window.__game.state;
    return { gold: s.factions[0].gold, relation: s.villages[0].relation, trading: !!s.villages[0].trading,
      routes: s.tradeRoutes?.length ?? 0, bonus: s.factions[0].villageBonuses?.food ?? 0,
      paused: s.paused, diplomacy: s.diplomacy, dialog: !document.querySelector('#dialog').hidden };
  });

  await fixture(); await page.keyboard.press('b'); await rightClick();
  check('right-click a visible tent beyond camp activity range opens all diplomacy choices',
    await page.locator('#dialog-title').textContent() === 'Willow tribe'
    && await page.locator('[data-village-diplomacy]').count() === 3
    && await page.evaluate(() => Math.hypot(window.__game.state.units[0].x - 22.5, window.__game.state.units[0].y - 16.5) > 3));
  check('trade250 and alliance3000 buttons are enabled remotely',
    await page.locator('#village-trade').isEnabled() && await page.locator('#village-ally').isEnabled()
    && (await page.locator('#village-trade').textContent()).includes('250') && (await page.locator('#village-ally').textContent()).includes('3000'));
  await page.screenshot({ path: `${output}/neutral-village-dialog.png` });
  await page.locator('#village-trade').click(); await settle();
  let summary = await stateSummary();
  check('remote trade charges250 once and creates one village route', summary.gold === 3750 && summary.trading && summary.relation === 'trade' && summary.routes === 1 && !summary.dialog, summary);
  await rightClick(10);
  check('main tent offers the same popup and disables repeated trade', await page.locator('#village-trade').isDisabled() && await page.locator('#village-ally').isEnabled());
  await page.locator('#village-ally').click(); await settle(); summary = await stateSummary();
  check('remote alliance charges3000 and applies grower bonus without duplicating trade', summary.gold === 750 && summary.relation === 'allied' && summary.bonus === .1 && summary.routes === 1, summary);
  await rightClick();
  check('allied popup disables repeat purchases but retains war', await page.locator('#village-trade').isDisabled() && await page.locator('#village-ally').isDisabled() && await page.locator('#village-war').isEnabled());
  await page.screenshot({ path: `${output}/allied-village-dialog.png` });
  await page.keyboard.press('Escape'); await settle(); summary = await stateSummary();
  check('Escape closes diplomacy and preserves paused play', !summary.dialog && summary.paused && summary.diplomacy === null, summary);
  await rightClick(); await page.locator('#village-war').click(); await settle(); summary = await stateSummary();
  check('same popup declares war and removes trade and alliance bonus', summary.gold === 750 && summary.relation === 'war' && !summary.trading && summary.routes === 0 && summary.bonus === 0 && !summary.dialog, summary);

  await fixture(true, 2000);
  await page.evaluate(() => { window.__game.state.villages[0].tradeGoldByFaction = { 0: 12500, 7: 90000 }; });
  await rightClick();
  check('only trade with the player discounts the displayed alliance price',
    (await page.locator('#village-ally').textContent()).includes('1750')
    && (await page.locator('.village-trade-discount').textContent()).includes('1250')
    && await page.locator('#village-ally').isEnabled());
  await page.locator('#village-ally').click(); await settle(); summary = await stateSummary();
  check('discounted alliance charges its current quoted cost', summary.gold === 250 && summary.relation === 'allied', summary);

  await fixture(true, 500);
  await page.evaluate(() => { window.__game.state.villages[0].tradeGoldByFaction = { 0: 90000 }; });
  await rightClick();
  check('alliance discount stops at the500 gold minimum', (await page.locator('#village-ally').textContent()).includes('500') && await page.locator('#village-ally').isEnabled());
  await page.locator('#village-ally').click(); await settle(); summary = await stateSummary();
  check('minimum alliance charges exactly500', summary.gold === 0 && summary.relation === 'allied', summary);

  await fixture(false); await rightClick();
  check('opening village diplomacy temporarily pauses live play', (await stateSummary()).paused);
  await page.keyboard.press('Escape'); await settle(); summary = await stateSummary();
  check('Escape restores running play', !summary.dialog && !summary.paused && summary.diplomacy === null, summary);

  await fixture(true, 249); await rightClick();
  check('insufficient treasury disables trade and alliance', await page.locator('#village-trade').isDisabled() && await page.locator('#village-ally').isDisabled());
  await fixture(); await rightClick();
  await page.evaluate(() => { window.__game.state.factions[0].gold = 249; });
  await page.locator('#village-trade').click(); await settle(); summary = await stateSummary();
  check('payment revalidates gold changed after opening', summary.gold === 249 && summary.routes === 0 && summary.relation === 'neutral' && summary.dialog
    && /Need 250 gold/.test(await page.locator('#war-result').textContent()), summary);

  await fixture(); await rightClick();
  await page.evaluate(() => { window.__game.state.buildings.find(b => b.id === 11).hp = 0; });
  await page.locator('#village-trade').click(); await settle(); summary = await stateSummary();
  check('destroyed clicked structure rejects stale purchase', summary.gold === 4000 && summary.routes === 0 && summary.relation === 'neutral' && summary.dialog
    && /no longer visible/.test(await page.locator('#war-result').textContent()), summary);

  await fixture(); await rightClick();
  await page.evaluate(() => { window.__game.state.buildings.find(b => b.id === 10).hp = 0; });
  await page.locator('#village-ally').click(); await settle(); summary = await stateSummary();
  check('destroyed camp rejects stale alliance without charge', summary.gold === 4000 && summary.relation === 'neutral' && summary.bonus === 0 && summary.dialog
    && /no longer has a camp/.test(await page.locator('#war-result').textContent()), summary);
  await fixture();
  const activity = await page.evaluate(async () => {
    const { BuildingActivityPopup } = await import('/src/ui/building-activity.ts');
    const state = window.__game.state, camp = state.buildings.find(b => b.id === 10);
    Object.assign(state.units[0], { x: camp.x + .5, y: camp.y + 1.5 });
    const element = document.createElement('section'); element.className = 'building-activity'; document.body.append(element);
    const popup = new BuildingActivityPopup(element, () => state, () => ({x:700,y:500}), () => ({width:1440,height:900}), () => {}, () => {});
    popup.toggle(camp);
    const read = () => ({price:element.querySelector('[data-village-action="ally"] .upgrade-price').textContent, status:element.querySelector('.village-status').textContent});
    const first = read(); state.villages[0].tradeGoldByFaction = {0:5000}; popup.refresh(); const discounted = read();
    state.villages[0].tradeGoldByFaction[0] = 50000; popup.refresh(); const minimum = read();
    const trade = element.querySelector('[data-village-action="trade"] .upgrade-price').textContent;
    popup.close(); element.remove(); return {first,discounted,minimum,trade};
  });
  check('camp activity refreshes alliance3000 to2500 to500 while trade stays250',
    activity.first.price === '3000' && activity.discounted.price === '2500' && activity.discounted.status.includes('500 gold alliance discount')
    && activity.minimum.price === '500' && activity.trade === '250', activity);

  check('no browser runtime errors', errors.length === 0, errors);
  writeFileSync(`${output}/browser-check.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors }, null, 2));
} finally { await browser.close(); }
