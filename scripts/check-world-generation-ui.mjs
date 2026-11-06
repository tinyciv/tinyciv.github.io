import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'scratch/2026-10-30-world-generation';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
async function openWorldChoices() {
  if (await page.locator('#new-world-form').isVisible()) return;
  await page.locator('#menu').click();
  await page.locator('#new-game').click();
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  check('first launch offers all three world shapes', await page.locator('#new-world-form input[type=radio]').count() === 3 && await page.locator('#new-world-form').isVisible());
  check('world choice pauses the game', await page.evaluate(() => window.__game.state.paused));
  check('Fractal is selected by default', await page.locator('input[name=world-style]:checked').inputValue() === 'fractal');
  await page.screenshot({ path: `${output}/new-world-desktop.png` });
  const initialSeed = await page.evaluate(() => window.__game.state.seed);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__game.state.paused = true; });
  await openWorldChoices();
  check('New game opens choices before replacing the settlement', await page.locator('#new-world-form').isVisible() && await page.evaluate(seed => window.__game.state.seed === seed, initialSeed));
  const signatures = [];
  for (const style of ['continents', 'pangaea', 'fractal']) {
    await openWorldChoices();
    await page.locator(`.world-style:has(input[value="${style}"])`).click();
    await page.locator('#new-seed').fill('BTV-world-modes-review');
    await page.locator('#new-world').click();
    await page.waitForFunction(style => window.__game.state.world.generationStyle === style && document.querySelector('#dialog').hidden,
      style, { timeout: 30000 });
    const result = await page.evaluate(() => {
      const state = window.__game.state; state.paused = true;
      const world = state.world;
      let signature = 2166136261;
      for (const tile of world.tiles) { signature = Math.imul(signature ^ tile.terrain.charCodeAt(0), 16777619); signature = Math.imul(signature ^ (tile.ridgeTier ?? 0), 16777619); }
      return { style: world.generationStyle, seed: world.seed, width: world.width, height: world.height,
        capitals: world.spawns.length, secondary: world.secondarySpawns.length,
        factions: state.factions.filter(faction => faction.villageId === undefined).length, totalFactions: state.factions.length,
        hills: world.tiles.filter(tile => tile.relief === 'hills' && tile.ridge).length,
        mountains: world.tiles.filter(tile => tile.relief === 'mountains' && tile.ridge).length,
        passes: world.tiles.filter(tile => tile.mountainPass).length,
        lakes: [...new Set(world.tiles.filter(tile => tile.terrain === 'lake').map(tile => tile.lakeShape).filter(Boolean))], signature };
    });
    signatures.push(result.signature);
    check(`${style} generates a playable world using selected mode`, result.style === style && result.seed === 'BTV-world-modes-review' && result.capitals === 6 && result.secondary === 5 && result.factions === 6 && result.width === 194 && result.height === 153, result);
    check(`${style} contains hills, mountains and compact freshwater`, result.hills > 0 && result.mountains > 0 && result.lakes.includes('compact'), result);
    await page.screenshot({ path: `${output}/game-${style}.png` });
  }
  check('same seed produces three distinct world layouts', new Set(signatures).size === 3, signatures);
  await openWorldChoices();
  check('new world selector defaults to Fractal', await page.locator('input[name=world-style]:checked').inputValue() === 'fractal');
  await page.setViewportSize({ width: 390, height: 844 });
  check('new world selector fits a narrow viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/new-world-mobile.png` });
  await page.keyboard.press('Escape');
  check('cancel keeps existing mode and pause state', await page.evaluate(() => window.__game.state.world.generationStyle === 'fractal' && window.__game.state.paused));
  check('no runtime errors', errors.length === 0, errors);
} finally {
  await writeFile(`${output}/new-world-checks.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
