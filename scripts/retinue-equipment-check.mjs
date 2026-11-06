import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-01-retinue-equipment'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const checks = [], errors = [], check = (name, passed, detail) => { checks.push({ name, passed: !!passed, detail }); assert.ok(passed, name); };
page.on('pageerror', error => errors.push(String(error)));
const settle = () => page.waitForTimeout(180), popup = page.locator('#building-activity');
async function openBuilding(id) {
  await page.keyboard.press('Escape');
  const point = await page.evaluate(id => {
    const b = __game.state.buildings.find(b => b.id === id);
    return __game.renderer.screenPoint({ x: b.x + (b.kind === 'palace' ? 1 : .5), y: b.y + .65 });
  }, id);
  await page.mouse.click(point.x, point.y); await popup.waitFor({ state: 'visible' }); await settle();
}
async function fit(name, width, height) {
  const box = await popup.evaluate(e => { const r = e.getBoundingClientRect(); return {
    x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
    scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight }; });
  check(name, box.x >= 0 && box.y >= 0 && box.right <= width && box.bottom <= height
    && box.scrollWidth <= box.clientWidth && box.scrollHeight <= box.clientHeight, box);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready'); await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { updateFog } = await import('/src/game/fog.ts');
    const person = (id, kind, x, y) => ({ id, kind, faction: 0, x, y, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: kind === 'leader' ? 4 : 1.1, order: 'hold', retinueStance: 'hold',
      cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, home: 1 });
    const building = (id, kind, x, y, extra = {}) => ({ id, kind, faction: 0, x, y, hp: 300, maxHp: 300, capacity: 0, ...extra });
    const state = { world: { width: 40, height: 32, seed: 'retinue-equipment-browser', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: 1280 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .7, food: 3, production: 1, gold: 0, variation: (i % 13) / 13 })) },
      buildings: [building(1, 'palace', 17, 16, { cityName: 'Roma', initialCity: true, hp: 650, maxHp: 650,
        capacity: 20, unhousedResidents: 20, populationGrowth: -1e9, governorPermissions: { farms: false, housing: false } }), building(2, 'blacksmith', 20, 12)],
      units: [person(10, 'leader', 18.5, 14), ...[[16.5, 14.5], [17.5, 14.5], [19.5, 14.5], [20.5, 14.5], [17.5, 15.5]]
        .map(([x, y], i) => person(11 + i, 'warrior', x, y))],
      factions: [{ id: 0, name: 'Romans', color: '#ee3434', affinity: 100, relation: 'self', food: 500, gold: 999,
        population: 20, production: 0, culture: 10000, yields: { food: 0, gold: 17.5, production: 0 }, nextRaid: 1e9,
        nextRetinueAt: 20, defeated: false, research: { focus: 'wall', levels: { woodenTower: 1, wall: 1 }, progress: {} } }],
      time: 10, tick: 0, paused: true, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [], fields: [],
      treeClearings: [], selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
      seed: 'retinue-equipment-browser', rngState: 1, raiderCamps: [], marauderPacks: [], treasures: [], villages: [], retinueStance: 'hold',
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 } };
    __game.replaceState(state); updateFog(state); __game.renderer.prepare(state);
    __game.renderer.zoom = 1.6; __game.renderer.camera = { x: 18.5, y: 14 }; __game.renderer.follow = false;
  });
  await settle(); await openBuilding(1);
  const buy = page.locator('[data-retinue-slot]');
  check('settlement exposes an unaffordable1000-gold retinue purchase', await buy.isVisible() && await buy.isDisabled()
    && (await buy.textContent()).includes('1000'));
  await page.evaluate(() => { __game.state.factions[0].gold = 1000; }); await settle();
  check('affordability refreshes while paused', await buy.isEnabled());
  await buy.click(); await settle();
  const purchased = await page.evaluate(async () => {
    const s = __game.state, f = s.factions[0];
    const { desiredRetinueSize } = await import('/src/game/archery.ts');
    const { citySummaries } = await import('/src/game/cities.ts');
    const { factionCommittedBudget } = await import('/src/game/faction-budget.ts');
    return { gold: f.gold, purchased: f.purchasedRetinueSlots, cap: desiredRetinueSize(f), troops: s.units.filter(u => u.kind === 'warrior').length,
      yields: f.yields.gold, cityGold: citySummaries(s)[0].gold, budget: factionCommittedBudget(s, f) };
  });
  check('purchase debits exactly1000 and adds one vacant permanent capacity slot', purchased.gold === 0 && purchased.purchased === 1
    && purchased.cap === 6 && purchased.troops === 5, purchased);
  check('UI, city income and AI budget include5 recurring gold in addition to soldier wages', purchased.yields === 12.5
    && purchased.cityGold === 12.5 && purchased.budget.upkeep === 5 && purchased.budget.surplus === 12.5, purchased);
  check('button disables after purchase and describes recurring upkeep', await buy.isDisabled()
    && (await buy.textContent()).includes('5 gold') && (await buy.getAttribute('title')).includes('1'), await buy.getAttribute('title'));
  await fit('settlement popup fits desktop without scrolling', 1440, 950);
  await page.screenshot({ path: `${output}/settlement-purchase.png` });
  await page.evaluate(() => { const s = __game.state; s.paused = false; __game.step(9.9); s.paused = true; });
  check('purchased capacity waits for ordinary recruitment', await page.evaluate(() => __game.state.units.filter(u => u.kind === 'warrior').length === 5));
  await page.evaluate(() => { const s = __game.state; s.paused = false; __game.step(.2); s.paused = true; });
  check('normal recruitment fills the new capacity one soldier at a time', await page.evaluate(() => __game.state.units.filter(u => u.kind === 'warrior').length === 6));
  await page.evaluate(() => { const s = __game.state; s.paused = false; __game.step(10); s.paused = true; });
  const billed = await page.evaluate(async () => { const { citySummaries } = await import('/src/game/cities.ts'); const s = __game.state;
    return { gold: s.factions[0].gold, yield: s.factions[0].yields.gold, city: citySummaries(s)[0].gold }; });
  check('economy charges the slot once:20tax−3soldierwages−5slotfee=12gold', billed.gold === 12 && billed.yield === 12 && billed.city === 12, billed);
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 390, height: 844 }); await settle(); await openBuilding(1);
  await fit('settlement popup fits narrow viewport without scrolling', 390, 844);
  await page.screenshot({ path: `${output}/settlement-mobile.png` });
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1440, height: 950 }); await settle();
  await page.evaluate(() => { __game.state.factions[0].gold = 10000; }); await openBuilding(2);
  const costs = [200, 400, 600, 800, 1000, 1200], multipliers = [1.15, 1.3, 1.5, 1.7, 1.9, 2.1], roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  for (const track of ['armor', 'weapon']) {
    const button = page.locator(`[data-upgrade="${track}"]`);
    check(`${track}: six visible tier indicators`, await button.locator('[data-level]').count() === 6);
    for (let tier = 0; tier < 6; tier++) {
      check(`${track}${roman[tier]} shows its authoritative price and multiplier`, Number(await button.locator('.upgrade-cost').textContent()) === costs[tier]
        && (await button.getAttribute('title')).includes(`${multipliers[tier]}×`));
      if (tier === 3) {
        await page.evaluate(gold => { __game.state.factions[0].gold = gold; }, costs[tier] - 1); await settle();
        check(`${track}IV cannot be bought below800gold`, await button.isDisabled());
        await page.evaluate(() => { __game.state.factions[0].gold = 10000; }); await settle();
      }
      const before = await page.evaluate(() => __game.state.factions[0].gold);
      await button.click(); await settle();
      const after = await page.evaluate(track => { const s = __game.state, key = `${track}Level`; return { gold: s.factions[0].gold,
        level: s.factions[0][key], unitLevels: s.units.filter(u => ['leader', 'warrior'].includes(u.kind)).map(u => u[key]) }; }, track);
      check(`${track}${roman[tier]} debits once and equips existing soldiers`, after.gold === before - costs[tier]
        && after.level === tier + 1 && after.unitLevels.every(level => level === tier + 1), after);
    }
    check(`${track}VI is the maximum with no seventh purchase`, await button.isDisabled()
      && (await button.locator('.upgrade-cost').textContent()) === 'Max' && await button.locator('[data-level].complete').count() === 6);
  }
  const art = await page.evaluate(async () => {
    const { factionSheet, characterIconUrl } = await import('/src/game/unit-sprites.ts');
    return ['leader', 'warrior'].map(role => ({ role, sameSheets: [4, 5, 6].every(level => factionSheet(role, '#ee3434', level) === factionSheet(role, '#ee3434', 3)),
      samePortraits: [4, 5, 6].every(level => characterIconUrl(role, '#ee3434', level) === characterIconUrl(role, '#ee3434', 3)) }));
  });
  check('higher armor tiers retain the existing legionary shield artwork and portraits', art.every(r => r.sameSheets && r.samePortraits), art);
  await fit('six-tier blacksmith popup fits desktop without scrolling', 1440, 950);
  await page.screenshot({ path: `${output}/blacksmith-tier-vi.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await fit('six-tier blacksmith popup fits narrow viewport without scrolling', 390, 844);
  await page.screenshot({ path: `${output}/blacksmith-mobile.png` });
  check('no browser runtime errors', errors.length === 0, errors);
} finally {
  writeFileSync(`${output}/browser-report.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2)); await browser.close();
}
