import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'scratch/2026-11-07-army-warnings';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log(`PASS ${name}`); };
page.on('pageerror', e => errors.push(String(e)));
await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
async function setup(camera = 25) {
  await page.evaluate(async camera => {
    const load = async path => {
      const entry = [...performance.getEntriesByType('resource')].reverse().find(e => new URL(e.name).pathname === path);
      return import(entry?.name ?? path);
    };
    const { armyWarningFixture } = await load('/tests/helpers/army-warnings.ts');
    const state = armyWarningFixture();
    __game.replaceState(state); __game.renderer.prepare(state); __game.renderer.follow = false;
    __game.renderer.camera = { x: camera, y: 26 }; __game.renderer.zoom = 1.5;
    const { withPlayerFaction } = await load('/src/game/player-context.ts');
    const { toggleInfantryFormation } = await load('/src/game/infantry-drill.ts');
    const { updateMarauderFormations } = await load('/src/game/marauder-formations.ts');
    const { levyPopulation } = await load('/src/game/mass-levy.ts');
    withPlayerFaction(state, 1, () => toggleInfantryFormation(state));
    updateMarauderFormations(state, () => true); levyPopulation(state, 3, 1);
  }, camera);
  await page.waitForTimeout(200);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5189');
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { timeout: 120000 });
  await setup();
  check('Three real mobilizations produce three visible warning buttons', await page.locator('.army-warning:visible').count() === 3);
  const marauder = page.getByRole('button', { name: 'Nearby marauders have entered into a formation and are on the move', exact: true });
  const formation = page.getByRole('button', { name: 'The Carthaginians have entered into a formation and are on the move!', exact: true });
  const levy = page.getByRole('button', { name: 'The Carthaginians are conscripting their people to raise a large army!', exact: true });
  check('Nearby faction formation is onscreen and distant marauders pin to the edge', await formation.getAttribute('data-edge') === 'false' && await marauder.getAttribute('data-edge') === 'true');
  check('Faction and marauder colors match their armies', await formation.evaluate(e => getComputedStyle(e).backgroundColor) === 'rgb(54, 139, 212)' && await marauder.evaluate(e => getComputedStyle(e).backgroundColor) === 'rgb(156, 98, 206)');
  await levy.hover();
  check('Levy tooltip has exact requested text and Pixel Operator font', await page.locator('.army-warning-tooltip').textContent() === 'The Carthaginians are conscripting their people to raise a large army!' && (await page.locator('.army-warning-tooltip').evaluate(e => getComputedStyle(e).fontFamily)).includes('Pixel Operator'));
  await page.screenshot({ path: `${out}/desktop-formation-and-levy.png` });
  const opacity = await formation.locator('.army-warning-sign').evaluate(e => getComputedStyle(e).opacity);
  await page.waitForTimeout(220);
  check('Exclamation mark visibly flashes', opacity !== await formation.locator('.army-warning-sign').evaluate(e => getComputedStyle(e).opacity));
  await marauder.click();
  check('Clicking warning shows tooltip without selecting a unit or issuing an order', await page.evaluate(() => __game.state.selected === null && __game.state.units[0].order === 'hold'));
  await page.screenshot({ path: `${out}/desktop-offscreen-tooltip.png` });
  await page.evaluate(() => { __game.renderer.camera = { x: 80.5, y: 26 }; });
  await page.waitForTimeout(100);
  check('Panning to marauders converts edge marker into a hovering marker', await marauder.getAttribute('data-edge') === 'false');
  await page.waitForTimeout(6200);
  check('Warnings expire after six real seconds without replay while paused', await page.locator('.army-warning').count() === 0);
  await page.setViewportSize({ width: 844, height: 390 });
  await setup();
  await marauder.click();
  await page.waitForTimeout(100);
  const bounds = await page.locator('.army-warning-tooltip').boundingBox();
  console.log('mobile tooltip bounds', bounds);
  await page.screenshot({ path: `${out}/mobile-offscreen-tooltip.png` });
  check('Mobile tooltip remains within viewport', bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 844 && bounds.y + bounds.height <= 390);
  await page.screenshot({ path: `${out}/mobile-offscreen-tooltip.png` });
  check('No browser runtime errors', errors.length === 0);
  await writeFile(`${out}/browser-report.json`, JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
