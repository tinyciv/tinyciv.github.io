import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const out = process.env.MEDITERRANEAN_REVIEW_DIR || 'scratch/2026-11-04-mediterranean-mountains-creeks';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
  (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
// Freeze this review's module graph while other workspace edits continue.
await page.routeWebSocket(/\/\?token=/, socket => socket.close());
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { timeout: 60000 });
  await page.locator('[data-view="single"]').click();
  const style = page.locator('[data-form="single"] [name="style"]');
  check('Exact requested world label is available', await style.locator('option[value="mediterranean"]').textContent() === 'Mediterreanean');
  await style.selectOption('mediterranean');
  check('Fixed geography disables procedural landscape selection', await page.locator('[name="landform"]').isDisabled());
  await page.locator('[name="seed"]').fill('MED-200BC');
  await page.screenshot({ path: `${out}/option.png` });
  await page.locator('[data-form="single"] button[type="submit"]').click();
  await page.waitForFunction(() => window.__game.state.world.generationStyle === 'mediterranean' && document.querySelector('#frontend').hidden, null, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    requestAnimationFrame = () => 0;
    const game = window.__game, state = game.state; state.paused = true;
    const world = state.world;
    window.__medReveal = () => {
      game.renderer.draw(state, .05);
      // Use the compositor's exact FogView; HMR can give dynamic imports a
      // separate module/cache instance from the running game's import graph.
      const fog = game.renderer.fogView;
      fog.visible.fill(1); fog.explored.fill(1); fog.owned.fill(1);
      fog.revision++; fog.explorationRevision++; fog.ownershipRevision++;
      game.renderer.prepare(state); for (let i = 0; i < 10; i++) game.renderer.draw(state, .05);
    };
    game.renderer.center(state); game.renderer.draw(state, .05);
    return { width: world.width, height: world.height, seed: world.seed,
      capitals: world.spawns.length, secondary: world.secondarySpawns.length,
      rivers: world.tiles.filter(t => t.terrain === 'river').length,
      creeks: world.tiles.filter(t => t.creek).length,
      ledges: world.tiles.filter(t => t.ridge).length, stairs: world.tiles.filter(t => t.stair).length,
      tiers: [1,2,3,4,5].map(level => world.tiles.filter(t => t.ridge && (t.ridgeTier ?? 1) === level).length),
      forests: world.tiles.filter(t => t.overlay === 'forest').length, marsh: world.tiles.filter(t => t.marsh).length,
      towns: state.buildings.filter(b => b.kind === 'palace').length, units: state.units.length };
  });
  check('Selected option starts the geographic game', result.width === 384 && result.height === 199 && result.seed === 'MED-200BC' && result.capitals === 6 && result.secondary === 5 && result.towns >= 11, result);
  check('Live game retains abundant rivers, ledges and woodland', result.rivers > 2000 && result.ledges > 7000 && result.stairs > 100 && result.forests > 5000 && result.marsh > 100, result);
  check('Smaller channels and multiple mountain tiers reach the live game', result.creeks > 1000 && result.tiers[2] > 100, result);
  await page.screenshot({ path: `${out}/starting-town.png` });
  for (const [name, lon, lat, zoom] of [['alps',10,46,.9],['alps-detail',8,46,1.5],['iberia',-3,40,.9],['nile',31,30.5,.9]]) {
    await page.evaluate(({ lon, lat, zoom }) => {
      const r = __game.renderer; r.follow = false; r.zoom = zoom;
      r.camera = { x: (lon + 12) / 54 * __game.state.world.width, y: (49 - lat) / 22 * __game.state.world.height };
      __medReveal();
    }, { lon, lat, zoom });
    check(`${name} terrain is revealed for visual inspection`, await page.evaluate(() => __game.renderer.fogView.explored.every(Boolean)));
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  const simulation = await page.evaluate(() => {
    const s = __game.state; s.paused = false;
    const before = s.time; for (let i = 0; i < 20; i++) __game.step(.05); s.paused = true;
    return { advanced: s.time > before, finite: s.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)) };
  });
  check('Simulation advances with finite unit positions', simulation.advanced && simulation.finite, simulation);
  await page.keyboard.press('Escape');
  await page.locator('[data-view="single"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  check('Mobile menu has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${out}/option-mobile.png` });
  check('No browser runtime errors', errors.length === 0, errors);
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }); throw error;
} finally {
  await writeFile(`${out}/browser-checks.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2)); await browser.close();
}
