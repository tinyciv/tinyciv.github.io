import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-01-healer-shack'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
// Keep this fresh isolated client stable while other agents save source files.
await page.routeWebSocket(/.*/, () => {});
const checks = [], errors = [], check = (name, passed, detail) => { checks.push({ name, passed: !!passed, detail }); assert.ok(passed, `${name}: ${JSON.stringify(detail)}`); };
page.on('pageerror', error => errors.push(String(error)));
const settle = () => page.waitForTimeout(180), popup = page.locator('#building-activity');
async function advance(seconds) {
  await page.evaluate(seconds => { const s = __game.state; s.paused = false;
    for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += .1) __game.step(Math.min(.1, seconds - elapsed));
    s.paused = true;
  }, seconds); await settle();
}
async function fit(name, width, height) {
  const box = await popup.evaluate(e => { const r = e.getBoundingClientRect(), scroll = e.querySelector('.research-tree-scroll'); return {
    x: r.x, y: r.y, right: r.right, bottom: r.bottom,
    scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight }; });
  check(name, box.x >= 0 && box.y >= 0 && box.right <= width && box.bottom <= height
    && box.scrollWidth <= box.clientWidth && box.scrollHeight <= box.clientHeight, box);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  if (await page.locator('#frontend').isVisible()) {
    await page.locator('[data-view="single"]').click();
    await page.locator('[data-form="single"] button[type="submit"]').click();
    await page.locator('#frontend').waitFor({ state: 'hidden', timeout: 60000 });
  }
  await page.evaluate(async () => {
    const { updateFog } = await import('/src/game/fog.ts');
    const person = (id, kind, x, y) => ({ id, kind, faction: 0, x, y, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: kind === 'leader' ? 4 : 1.1, order: 'hold', retinueStance: 'hold',
      cooldown: 0, lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0, home: 1 });
    const building = (id, kind, x, y, extra = {}) => ({ id, kind, faction: 0, x, y, hp: 300, maxHp: 300, capacity: 0, ...extra });
    const state = { world: { width: 40, height: 32, seed: 'healer-browser', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: 1280 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .7, food: 3, production: 1, gold: 0, variation: (i % 13) / 13 })) },
      buildings: [building(1, 'palace', 17, 18, { cityName: 'Roma', initialCity: true, hp: 650, maxHp: 650,
        capacity: 20, unhousedResidents: 20, populationGrowth: -1e9, governorPermissions: { farms: false, housing: false } }), building(2, 'library', 22, 14)],
      units: [person(10, 'leader', 21.5, 17.5), person(11, 'warrior', 18.5, 24.5)],
      factions: [{ id: 0, name: 'Romans', color: '#ee3434', affinity: 100, relation: 'self', food: 500, gold: 1000,
        population: 20, production: 0, culture: 10000, yields: { food: 0, gold: 19.5, production: 0 }, nextRaid: 1e9,
        nextRetinueAt: 1e9, defeated: false, research: { focus: 'traditionalMedicine', levels: {}, progress: {}, autoResearch: false } }],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [], fields: [],
      treeClearings: [], selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
      seed: 'healer-browser', rngState: 1, raiderCamps: [], marauderPacks: [], treasures: [], villages: [], retinueStance: 'hold',
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 } };
    __game.replaceState(state); updateFog(state); __game.renderer.prepare(state);
    __game.renderer.zoom = 1.6; __game.renderer.camera = { x: 21, y: 18 }; __game.renderer.follow = false;
  }); await settle();
  await page.locator('[data-action="build"]').click();
  const build = page.locator('[data-build="healerShack"]');
  check('locked healer is listed in Build with its research requirement', await build.isVisible() && await build.isDisabled()
    && (await build.getAttribute('title')).includes('Traditional Medicine'));
  const locked = await page.evaluate(async () => { const { validateBuildAt } = await import('/src/game/simulation.ts');
    return validateBuildAt(__game.state, 'healerShack', 21, 20); });
  check('engine rejects construction before Traditional Medicine', !locked.ok && locked.message.includes('Traditional Medicine'), locked);
  await page.keyboard.press('Escape');
  const library = await page.evaluate(() => __game.renderer.screenPoint({ x: 22.55, y: 14.55 }));
  await page.mouse.click(library.x, library.y); await popup.waitFor({ state: 'visible' }); await settle();
  const medicine = page.locator('button[data-research="traditionalMedicine"]'); await medicine.click(); await settle();
  const start = page.locator('.research-start');
  check('independent Medicine node shows200 gold with no prerequisite', await start.isEnabled() && (await start.textContent()).includes('200')
    && await page.locator('.research-node[data-research]').count() === 14);
  await medicine.locator('img').evaluate(image => image.decode());
  check('research uses the native healer icon', await medicine.locator('img').evaluate(image => image.naturalWidth === 16 && image.src.includes('Healers-Shack')));
  await fit('14-node research tree fits desktop without scrolling', 1440, 950);
  await page.screenshot({ path: `${output}/medicine-research-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await fit('14-node research tree fits narrow viewport without scrolling', 390, 844);
  await page.screenshot({ path: `${output}/medicine-research-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 950 }); await settle();
  await start.click(); await settle();
  check('research deducts200 once', await page.evaluate(() => __game.state.factions[0].gold === 800 && __game.state.factions[0].research.paid.traditionalMedicine));
  await advance(59.8);
  check('research remains locked before60 seconds', await page.evaluate(() => !__game.state.factions[0].research.levels.traditionalMedicine));
  await advance(.3);
  check('real simulation completes research after60 seconds', await page.evaluate(() => __game.state.factions[0].research.levels.traditionalMedicine === 1));
  await page.keyboard.press('Escape'); await page.locator('[data-action="build"]').click(); await settle();
  check('completion immediately enables the healer build button', await build.isEnabled());
  const goldBefore = await page.evaluate(() => __game.state.factions[0].gold);
  await build.click(); await settle();
  const site = await page.evaluate(() => __game.renderer.screenPoint({ x: 21.5, y: 20.5 })); await page.mouse.move(site.x, site.y); await settle();
  const effect = await page.evaluate(async () => { const { buildingPlacementEffect } = await import('/src/game/building-aoe.ts'); return buildingPlacementEffect(__game.state.buildMode); });
  check('placement preview offers four-tile beneficial coverage', effect.radius === 4 && effect.beneficial, effect);
  await page.screenshot({ path: `${output}/healer-placement.png` });
  const menuLayout = await page.locator('#build-panel').evaluate(panel => {
    const inspect = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { tag: e.tagName,
      id: e.id, class: e.className, box: { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom },
      css: Object.fromEntries(['height', 'min-height', 'max-height', 'padding', 'margin', 'box-sizing', 'display',
        'padding-bottom', 'grid-template-rows', 'grid-auto-rows', 'gap', 'overflow', 'transform', 'position'].map(k => [k, c.getPropertyValue(k)])) }; };
    return [inspect(panel), ...[...panel.children].map(inspect), ...[...panel.querySelectorAll('[data-build]')].map(inspect)];
  }); writeFileSync(`${output}/build-menu-layout.json`, JSON.stringify(menuLayout, null, 2));
  check('five-row building menu reserves space above its lower ornament', parseFloat(menuLayout[0].css['padding-bottom']) >= 32
    && menuLayout.at(-1).box.bottom < menuLayout[0].box.bottom - 25, { panel: menuLayout[0], last: menuLayout.at(-1) });
  check('Settlement button remains unobscured and clickable', await page.locator('[data-build="palace"]').evaluate(button => {
    const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }));
  await page.mouse.click(site.x, site.y); await settle();
  const ordered = await page.evaluate(async () => { const s = __game.state, b = s.buildings.find(b => b.kind === 'healerShack');
    const { buildingWidth, buildingHeight } = await import('/src/game/types.ts');
    return { building: b, gold: s.factions[0].gold, width: b && buildingWidth(b), height: b && buildingHeight(b) }; });
  check('click orders a1×1 shack for200 gold and45 seconds', ordered.building?.construction?.duration === 45
    && ordered.building.construction.paidGold === 200 && ordered.gold === goldBefore - 200 && ordered.width === 1 && ordered.height === 1, ordered);
  await page.keyboard.press('Escape'); await advance(44);
  check('construction does not finish before45 seconds of work', await page.evaluate(() => !!__game.state.buildings.find(b => b.kind === 'healerShack')?.construction));
  await advance(20);
  check('normal builder travel and work completes the healer', await page.evaluate(() => { const b = __game.state.buildings.find(b => b.kind === 'healerShack'); return !!b && !b.construction; }));
  const before = await page.evaluate(async () => {
    const s = __game.state, leader = s.units.find(u => u.id === 10), control = s.units.find(u => u.id === 11);
    Object.assign(leader, { x: 22.5, y: 20.5, hp: 40, lastDamagedAt: s.time - 16 });
    Object.assign(control, { x: 18.5, y: 24.5, hp: 40, lastDamagedAt: s.time - 16 });
    for (const u of [leader, control]) { delete u.path; delete u.destination; delete u.target; }
    const { insideOwnBorders } = await import('/src/game/borders.ts');
    return [leader, control].map(u => ({ id: u.id, hp: u.hp, within: insideOwnBorders(s, 0, u.x, u.y) }));
  }); check('both comparison soldiers are eligible for ordinary border healing', before.every(u => u.within), before);
  await advance(1);
  const healed = await page.evaluate(() => [10, 11].map(id => { const u = __game.state.units.find(u => u.id === id); return { id, hp: u.hp, x: u.x, y: u.y }; }));
  check('actual game gives7.2HP nearby versus2.4HP outside the healer radius', Math.abs(healed[0].hp - 47.2) < 1e-6 && Math.abs(healed[1].hp - 42.4) < 1e-6, healed);
  await page.screenshot({ path: `${output}/healer-completed.png` });
  await page.evaluate(() => { const s = __game.state, leader = s.units.find(u => u.id === 10); leader.hp = 40; leader.lastDamagedAt = s.time; });
  await advance(1);
  check('nearby healer preserves the normal post-hit recovery delay', await page.evaluate(() => __game.state.units.find(u => u.id === 10).hp === 40));
  check('no runtime errors in the full research/build/healing flow', errors.length === 0, errors);
} finally {
  if (!checks.at(-1)?.name.includes('no runtime errors')) {
    console.log('Visible frontend:', await page.locator('#frontend').textContent().catch(() => 'unavailable'));
    await page.screenshot({ path: `${output}/browser-failure.png` }).catch(() => {});
  }
  writeFileSync(`${output}/browser-report.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2)); await browser.close();
}
