import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const output = 'scratch/2026-11-03-defense-rebuilding'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }), errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error))); await page.routeWebSocket('**', socket => socket.close());
const check = (name, value) => { checks.push({ name, pass: !!value }); assert.ok(value, name); console.log(name); };
const checkbox = page.locator('[name="auto-rebuild-defenses"]');
async function options() { await page.locator('#world').focus(); await page.keyboard.press('Escape'); await page.locator('[data-view="options"]').click(); }
async function resumePaused() { await page.locator('[data-frontend-action="back"]').click(); await page.locator('[data-frontend-action="resume"]').click(); }
async function destroyAndStep(id) {
  return page.evaluate(id => {
    const s = __game.state, wall = s.buildings.find(b => b.id === id), start = { x: wall.x + .5, y: wall.y + 1.5 };
    s.projectiles = [{ kind: 'arrow', attacker: 900, faction: -2, target: id, ...start, start,
      end: { x: wall.x + .5, y: wall.y + .5 }, damage: 10000, elapsed: 0, duration: .01 }];
    s.paused = false; for (let i = 0; i < 300; i++) __game.step(.05); s.paused = true;
    return { walls: s.buildings.filter(b => b.kind === 'wall'), gold: s.factions[0].gold, queued: s.defenseRebuilds?.length ?? 0 };
  }, id);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.evaluate(async () => {
    const { scoutRealm } = await import('/tests/helpers/scouts.ts');
    const s = scoutRealm(), leader = s.units[0]; leader.x = 35.5; leader.y = 25.5; leader.attack = 0;
    s.units = [leader]; s.paused = true; s.banditIntensity = 0;
    Object.assign(s.factions[0], { population: 20, gold: 1000 });
    Object.assign(s.factions[0].research.levels, { wall: 1, woodenTower: 1 });
    s.buildings = [{ id: 100, kind: 'palace', faction: 0, x: 2, y: 2, hp: 650, maxHp: 650, capacity: 20,
      unhousedResidents: 20, governorPermissions: { farms: false, housing: false } },
      { id: 101, kind: 'wall', faction: 0, x: 6, y: 4, hp: 100, maxHp: 100, capacity: 0 }];
    __game.replaceState(s); __game.renderer.prepare(s); __game.renderer.follow = false; __game.renderer.camera = { x: 6, y: 4 };
  });
  await options(); check('Rebuild checkbox defaults on', await checkbox.isChecked());
  await checkbox.uncheck();
  check('Unchecking changes the live faction setting', await page.evaluate(() => __game.state.factions[0].autoRebuildDefenses === false));
  await page.screenshot({ path: `${output}/settings-disabled.png` });
  await resumePaused();
  const disabled = await destroyAndStep(101); check('Combat destruction with setting off creates no replacement or charge', disabled.walls.length === 0 && disabled.gold === 1000 && disabled.queued === 0);
  await options(); await checkbox.check(); await page.screenshot({ path: `${output}/settings-enabled.png` }); await resumePaused();
  await page.evaluate(() => __game.entities(__game.state).buildings.add({ id: 201, kind: 'wall', faction: 0, x: 6, y: 4, hp: 100, maxHp: 100, capacity: 0 }));
  const enabled = await destroyAndStep(201);
  check('Builders restore the wall with the Leader distant', enabled.walls.length === 1 && !enabled.walls[0].construction && enabled.walls[0].id > 201);
  // The second period crosses an economy tick; compare the recorded paid work
  // through its fresh entity and ensure no duplicate replacement remains queued.
  check('Exactly one replacement completes', enabled.queued === 0 && enabled.walls[0].hp === enabled.walls[0].maxHp);
  await page.screenshot({ path: `${output}/rebuilt-wall.png` });
  await options(); await checkbox.uncheck(); await page.evaluate(() => __game.save());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await options(); check('Save/reload retains the disabled setting', !(await checkbox.isChecked()));
  await page.setViewportSize({ width: 750, height: 500 });
  const layout = await checkbox.evaluate(input => { const r = input.getBoundingClientRect(); return { bottom: r.bottom, right: r.right, font: getComputedStyle(input.parentElement).fontFamily }; });
  check('Setting is accessible in a compact window with Pixel Operator text', layout.bottom <= 500 && layout.right <= 750 && layout.font.includes('Pixel Operator'));
  check('No browser runtime errors', errors.length === 0);
} finally { writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
