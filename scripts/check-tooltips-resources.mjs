import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'scratch/2026-11-07-tooltips-resources'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = [], errors = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
page.on('pageerror', e => errors.push(String(e)));
await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5189');
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { timeout: 120000 });
  await page.evaluate(async () => {
    window.testImport = async path => {
      const loaded = [...performance.getEntriesByType('resource')].reverse().find(e => new URL(e.name).pathname === path);
      return import(loaded?.name ?? path);
    };
    const { armyWarningFixture } = await testImport('/tests/helpers/army-warnings.ts');
    const state = armyWarningFixture();
    state.units = state.units.filter(u => u.id === 1); state.buildings = state.buildings.filter(b => b.faction === 0);
    state.marauderPacks = []; state.factions[0].research.levels = {};
    for (const [i, resource] of ['stone', 'iron', 'copper', 'salt', 'olives'].entries())
      Object.assign(state.world.tiles[26 * state.world.width + 17 + i], { resource, resourceGroup: i + 1, variation: .6 });
    __game.replaceState(state); __game.renderer.prepare(state); __game.renderer.follow = false;
    __game.renderer.camera = { x: 20, y: 28 }; __game.renderer.zoom = 2;
  });
  await page.waitForTimeout(300);
  check('All building and Leader actions have cost/cooldown tooltips', await page.locator('[data-build], [data-action], [data-hotbar-action]').evaluateAll(items => items.every(e => /Cost:/.test(e.dataset.tooltip) && /Cooldown:/.test(e.dataset.tooltip))));
  await page.locator('[data-hotbar-action="levy"]').hover();
  check('Disabled action tooltip remains available and states actual levy price/cooldown', (await page.locator('#action-tooltip').innerText()).includes('15 gold / citizen · Cooldown: 30s'));
  check('Tooltips use Pixel Operator', (await page.locator('#action-tooltip').evaluate(e => getComputedStyle(e).fontFamily)).includes('Pixel Operator'));
  await page.screenshot({ path: `${out}/resources-and-levy-tooltip.png` });
  await page.locator('[data-action="build"]').click();
  await page.locator('[data-build="library"]').hover();
  check('Locked library tooltip explains cost, build time and purpose', await page.locator('#action-tooltip').innerText().then(s => s.includes('200 gold') && s.includes('90s') && s.includes('research')));
  await page.screenshot({ path: `${out}/building-tooltip.png` });
  await page.keyboard.press('Escape');
  check('Escape closes the tooltip', await page.locator('#action-tooltip').isHidden());
  const p = await page.evaluate(() => __game.renderer.screenPoint({x:18.5,y:26.5}));
  await page.mouse.click(p.x,p.y);
  await page.locator('[data-resource-develop]').waitFor({state:'visible'});
  await page.locator('[data-resource-develop]').hover();
  check('Resource development action has accurate price and no cooldown', (await page.locator('#action-tooltip').innerText()).includes('Cost: 50 gold · Cooldown: None'));
  await page.screenshot({ path: `${out}/resource-popup.png` });
  const progression = await page.evaluate(async () => {
    const xp = await testImport('/src/game/leader-progression.ts');
    const leader = __game.state.units[0];
    const gained = [1,2,3].map(() => xp.awardLeaderXp(__game.state, xp.LEADER_VICTORY_XP));
    return { required: xp.leaderXpRequired(1), gained, level: leader.leaderProgression.level };
  });
  check('Three commander XP bounties are required for the first level', progression.required === 19200 && progression.gained.join() === '0,0,1' && progression.level === 2);
  await page.setViewportSize({width:844,height:390});
  await page.locator('#resource-activity .activity-close').click().catch(() => page.keyboard.press('Escape'));
  await page.locator('[data-hotbar-action="levy"]').hover();
  const rect = await page.locator('#action-tooltip').boundingBox();
  check('Tooltip stays inside a narrow landscape viewport', rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 844 && rect.y + rect.height <= 390);
  await page.screenshot({ path: `${out}/mobile-tooltip.png` });
  check('No runtime errors', errors.length === 0);
  await writeFile(`${out}/report.json`,JSON.stringify({checks,errors},null,2));
} finally { await browser.close(); }
