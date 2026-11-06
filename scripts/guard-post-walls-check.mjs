import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-01-guard-post-walls';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const checks = [], errors = [];
const check = (name, value, detail) => { checks.push({ name, passed: !!value, detail }); assert.ok(value, name); };
page.on('pageerror', error => errors.push(String(error)));
const settle = () => page.waitForTimeout(160);
const popup = page.locator('#building-activity');
const checkbox = page.getByRole('checkbox', { name: 'Stay inside city walls' });
const note = page.locator('#guard-walls-note');
async function openPost(x) {
  await page.keyboard.press('Escape');
  const p = await page.evaluate(x => __game.renderer.screenPoint({ x: x + .5, y: 12.55 }), x);
  await page.mouse.click(p.x, p.y);
  await popup.waitFor({ state: 'visible' }); await settle();
}
async function options() {
  return page.evaluate(() => __game.state.buildings.filter(b => b.kind === 'guardPost').map(b => ({
    id: b.id, wallsOnly: b.guardPost?.wallsOnly === true, level: b.guardPost?.level ?? 0,
  })));
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { updateFog } = await import('/src/game/fog.ts');
    const building = (id, kind, x, y, extra = {}) => ({ id, kind, faction: 0, x, y,
      hp: 300, maxHp: 300, armor: 2, capacity: 0, ...extra });
    let id = 100;
    const walls = [];
    for (let y = 10; y <= 20; y++) for (let x = 12; x <= 24; x++)
      if (x === 12 || x === 24 || y === 10 || y === 20) walls.push(building(id++, 'wall', x, y));
    const state = {
      world: { width: 40, height: 32, seed: 'guard-post-walls-browser', source: 'isolated QA', spawns: [], revision: 1,
        tiles: Array.from({ length: 1280 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
          moisture: .7, food: 3, production: 1, gold: 0, variation: (i % 13) / 13 })) },
      buildings: [building(1, 'palace', 17, 16, { cityName: 'Roma', initialCity: true, hp: 650, maxHp: 650,
        capacity: 20, unhousedResidents: 20, governorPermissions: { farms: false, housing: false } }),
        building(2, 'guardPost', 16, 12), building(3, 'guardPost', 20, 12), ...walls,
        building(4, 'road', 18, 10), building(5, 'road', 18, 11)],
      units: [{ id: 10, kind: 'leader', faction: 0, x: 18.5, y: 14, hp: 100, maxHp: 100, morale: 100,
        attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
        moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Romans', color: '#ee3434', affinity: 100, relation: 'self', food: 500,
        gold: 1000, population: 20, production: 0, culture: 10000, yields: { food: 0, gold: 20, production: 0 },
        nextRaid: Infinity, defeated: false, research: { focus: 'wall', levels: { woodenTower: 1, wall: 1 }, progress: {} } }],
      time: 10, tick: 0, paused: true, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [], fields: [],
      treeClearings: [], selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
      seed: 'guard-post-walls-browser', rngState: 1, raiderCamps: [], marauderPacks: [], treasures: [], villages: [],
      fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 }, roamingMaraudersVersion: 1,
    };
    __game.replaceState(state); updateFog(state); __game.renderer.prepare(state);
    __game.renderer.zoom = 1.6; __game.renderer.camera = { x: 18.5, y: 14 }; __game.renderer.follow = false;
  });
  await settle(); await openPost(16);
  check('guard popup offers a labeled, default-off checkbox', await checkbox.isVisible() && !await checkbox.isChecked());
  check('enclosure note stays hidden while unrestricted', await note.isHidden());
  await checkbox.check(); await settle();
  let state = await options();
  check('checkbox changes this post only', state[0].wallsOnly && !state[1].wallsOnly, state);
  check('checked mode explains enclosure fallback', await note.isVisible() && (await note.textContent()).includes('remain at the post if no enclosure exists'));
  check('toggle is free', await page.evaluate(() => __game.state.factions[0].gold === 1000));
  await page.screenshot({ path: `${output}/guard-post-walls-enabled.png` });
  await page.keyboard.press('Escape');
  check('Escape closes the guard popup', await popup.isHidden());
  await openPost(16);
  check('reopening the same post preserves the checked option', await checkbox.isChecked());
  await openPost(20);
  check('the other post remains unrestricted', !await checkbox.isChecked() && await note.isHidden());
  await checkbox.focus(); await page.keyboard.press('Space'); await settle();
  state = await options();
  check('keyboard Space independently enables the second post', state.every(p => p.wallsOnly) && await checkbox.isChecked(), state);
  await openPost(16); await checkbox.uncheck(); await settle();
  state = await options();
  check('disabling one post preserves the other setting', !state[0].wallsOnly && state[1].wallsOnly && await note.isHidden(), state);
  await openPost(20);
  const rect = await popup.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height,
    scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight }; });
  check('desktop popup is compact and fits without scrolling', rect.width * rect.height < 1440 * 950 * .1 && rect.scrollWidth <= rect.clientWidth && rect.scrollHeight <= rect.clientHeight, rect);
  const price = await page.evaluate(async () => {
    const { BUILD_COSTS } = await import('/src/game/simulation.ts');
    const { GUARD_POST_UPGRADE_COSTS } = await import('/src/game/guard-posts.ts');
    return { build: BUILD_COSTS.guardPost.gold, tower: BUILD_COSTS.woodenTower.gold, library: BUILD_COSTS.library.gold,
      blacksmith: BUILD_COSTS.blacksmith.gold, upgrades: GUARD_POST_UPGRADE_COSTS };
  });
  check('upgrade button shows the current tier price', Number(await page.locator('.guard-cost').textContent()) === price.upgrades[0], price);
  const beforeGold = await page.evaluate(() => __game.state.factions[0].gold);
  await page.locator('[data-guards]').click(); await settle();
  check('purchasing a guard upgrade retains walls-only and advances its displayed price', await checkbox.isChecked()
    && Number(await page.locator('.guard-cost').textContent()) === price.upgrades[1]
    && await page.evaluate(() => __game.state.factions[0].gold) === beforeGold - price.upgrades[0]);
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await page.evaluate(() => { __game.renderer.camera = { x: 20.5, y: 14 }; }); await settle();
  const mobile = await popup.evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight }; });
  check('mobile popup keeps the checkbox and button reachable without internal scrolling', mobile.left >= 0 && mobile.right <= 390 && mobile.top >= 0 && mobile.bottom <= 844
    && mobile.scrollWidth <= mobile.clientWidth && mobile.scrollHeight <= mobile.clientHeight, mobile);
  await page.screenshot({ path: `${output}/guard-post-walls-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 950 }); await page.keyboard.press('Escape'); await page.keyboard.press('f'); await settle();
  check('guard and tower building tooltips show authoritative prices', (await page.locator('[data-build="guardPost"]').getAttribute('title')).includes(`· ${price.build} gold ·`)
    && (await page.locator('[data-build="woodenTower"]').getAttribute('title')).includes(`· ${price.tower} gold ·`), price);
  await page.keyboard.press('b'); await settle();
  check('library and blacksmith show their reduced 250 and 300 gold prices', price.library === 250 && price.blacksmith === 300
    && (await page.locator('[data-build="library"]').getAttribute('title')).includes('· 250 gold ·')
    && (await page.locator('[data-build="blacksmith"]').getAttribute('title')).includes('· 300 gold ·'), price);
  check('no browser errors', errors.length === 0, errors);
} finally {
  writeFileSync(`${output}/browser-report.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
