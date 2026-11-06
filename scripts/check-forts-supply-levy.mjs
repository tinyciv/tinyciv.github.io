import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const output = process.env.ARTIFACT_DIR || 'scratch/2026-11-04-forts-supply-levy'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }), errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error))); await page.routeWebSocket('**', socket => socket.close());
const check = (name, value) => { checks.push({ name, pass: !!value }); assert.ok(value, name); console.log(name); };
async function clickWorld(x, y) {
  const p = await page.evaluate(({ x, y }) => { const r = __game.renderer, box = document.querySelector('#world').getBoundingClientRect(); return { x: box.left + r.width / 2 + (x - r.camera.x) * 32 * r.zoom, y: box.top + r.height / 2 + (y - r.camera.y) * 32 * r.zoom }; }, { x, y });
  await page.mouse.click(p.x, p.y);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5178/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.evaluate(async () => {
    const { scoutRealm } = await import('/tests/helpers/scouts.ts');
    const { updateForts } = await import('/src/game/forts.ts');
    const { updateWallStats } = await import('/src/game/wall-stats.ts');
    const s = scoutRealm(), leader = s.units[0]; leader.x = 17.8; leader.y = 15.5;
    s.paused = true; s.banditIntensity = 0;
    Object.assign(s.factions[0], { population: 30, gold: 5000, color: '#4f9ee8' });
    Object.assign(s.factions[0].research.levels, { wall: 1, woodenTower: 1, supplyTrain: 1, massLevy: 1 });
    s.buildings = [{ id: 100, kind: 'palace', faction: 0, x: 10, y: 13, hp: 650, maxHp: 650, capacity: 30, unhousedResidents: 30, governorPermissions: { farms: false, housing: false } },
      { id: 101, kind: 'fort', faction: 0, x: 15, y: 13, hp: 225, maxHp: 225, capacity: 0, armor: 2 },
      { id: 102, kind: 'supplyDepot', faction: 0, x: 20, y: 14, hp: 250, maxHp: 250, capacity: 0 }];
    s.units = [leader, ...Array.from({ length: 10 }, (_, i) => ({ ...leader, id: 10 + i, kind: 'worker', x: 12.5 + i % 4, y: 17 + Math.floor(i / 4), hp: 50, maxHp: 50, attack: 0, defense: 0, home: 100, collector: true, order: 'work', speed: 2.2, range: 1.1, leaderProgression: undefined }))];
    __game.replaceState(s); updateWallStats(s, true); updateForts(s);
    __game.renderer.prepare(s); __game.renderer.follow = false; __game.renderer.camera = { x: 16, y: 14 }; __game.renderer.zoom = 1.5;
  });
  await page.waitForFunction(() => !document.querySelector('[data-hotbar-action="levy"]').disabled);
  await page.locator('[data-hotbar-action="levy"]').click();
  check('Mass levy hotbar converts one third of population', await page.evaluate(() => __game.state.units.filter(u => u.kind === 'levyInfantry').length === 10));
  await page.screenshot({ path: `${output}/levy-and-buildings.png` });
  check('Mass levy becomes Dismiss levy in the same slot', await page.locator('[data-hotbar-action="levy"] .hotbar-label').textContent() === 'Dismiss levy');
  await page.locator('[data-hotbar-action="levy"]').click();
  check('Dismiss hotbar restores civilian jobs', await page.evaluate(() => __game.state.units.filter(u => u.kind === 'worker').length === 10));
  await clickWorld(16, 14);
  await page.locator('[data-fort-brigade]').waitFor({ state: 'visible' });
  await page.locator('[data-fort-brigade]').click();
  check('Fort popup buys first brigade tier', await page.evaluate(() => __game.state.buildings.find(b => b.id === 101).fort.brigadeLevel === 1));
  await page.screenshot({ path: `${output}/fort-brigade.png` });
  await page.evaluate(async () => {
    const { preserveDestroyedFort } = await import('/src/game/forts.ts');
    const s = __game.state, fort = s.buildings.find(b => b.id === 101); fort.hp = 0; preserveDestroyedFort(s, fort);
  });
  await page.locator('[data-fort-rebuild]').waitFor({ state: 'visible' });
  check('Ruined Fort remains selectable with half-price rebuilding', (await page.locator('.fort-rebuild-effect').textContent()).includes('150 gold'));
  await page.screenshot({ path: `${output}/fort-foundation.png` });
  await page.locator('[data-fort-rebuild]').click();
  check('Rebuild retains the Fort identity and brigade upgrade', await page.evaluate(() => { const f = __game.state.buildings.find(b => b.id === 101); return !!f.construction && f.construction.paidGold === 150 && f.fort.brigadeLevel === 1; }));
  if (await page.locator('.activity-close').isVisible()) await page.locator('.activity-close').click();
  await page.locator('[data-action="fortifications"]').click();
  check('Fort appears in fortifications', await page.locator('[data-build="fort"]').isVisible());
  await page.screenshot({ path: `${output}/fort-build-menu.png` });
  await page.locator('[data-action="fortifications"]').click();
  await page.evaluate(async () => {
    const { updateSupplyDepots } = await import('/src/game/supply-train.ts');
    const s = __game.state, depot = s.buildings.find(b => b.id === 102); depot.supplyDepot = { nextDispatchAt: 0 }; updateSupplyDepots(s);
  });
  check('Supply depot dispatches a real cart', await page.evaluate(() => __game.state.units.some(u => u.kind === 'supplyCart')));
  await page.screenshot({ path: `${output}/supply-cart.png` });
  check('Levy and garrison have dedicated pixel emblems', await page.locator('.hotbar-auxiliary .military-action-icon').count() === 2 && await page.locator('.hotbar-auxiliary .levy-action-icon').count() === 1 && await page.locator('.hotbar-auxiliary .garrison-action-icon').count() === 1);
  check('New controls use Pixel Operator', await page.locator('[data-hotbar-action="levy"]').evaluate(b => getComputedStyle(b).fontFamily.includes('Pixel Operator')));
  check('No browser runtime errors', errors.length === 0);
} finally { writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
