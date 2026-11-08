import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'scratch/2026-10-30-gameplay-update';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
const check = (name, pass) => { checks.push({ name, pass }); assert.ok(pass, name); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.keyboard.press('Escape');
  for (const action of ['button', 'escape', 'close']) {
    await page.evaluate(action => {
      window.__game.newWorld(`victory-ui-${action}`, 'fractal');
      const state = window.__game.state;
      for (const faction of state.factions.slice(1)) faction.defeated = true;
      state.paused = false;
    }, action);
    await page.locator('#keep-playing').waitFor({ state: 'visible' });
    check(`${action}: victory offers both continuing and a new world`,
      await page.locator('#dialog-title').innerText() === 'Victory' && await page.locator('#play-again').isVisible());
    if (action === 'button') await page.screenshot({ path: `${output}/victory.png` });
    const before = await page.evaluate(() => ({ seed: window.__game.state.seed, time: window.__game.state.time }));
    if (action === 'button') await page.locator('#keep-playing').click();
    else if (action === 'escape') await page.keyboard.press('Escape');
    else await page.locator('#close-dialog').click();
    await page.waitForFunction(time => window.__game.state.time > time + .3, before.time);
    check(`${action}: keeps the same world running without another victory popup`, await page.evaluate(seed => {
      const state = window.__game.state;
      return state.seed === seed && state.victoryContinued && state.victory && !state.gameOver && !state.paused
        && document.querySelector('#dialog').hidden;
    }, before.seed));
  }
  check('production world persists in IndexedDB', await page.evaluate(async () => {
    const { readStoredGame } = await import('/src/game/game-storage.ts');
    await window.__game.save();
    const saved = await readStoredGame();
    return !!saved && JSON.parse(saved).state.victoryContinued === true;
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  check('reload retains the decision to continue', await page.evaluate(() => window.__game.state.victoryContinued
    && !window.__game.state.gameOver && document.querySelector('#dialog').hidden));
  const costs = await page.evaluate(async () => {
    const { BUILD_COSTS } = await import('/src/game/simulation.ts');
    const { RESEARCH_BRANCHES } = await import('/src/game/research.ts');
    return [BUILD_COSTS.library.gold, RESEARCH_BRANCHES.find(branch => branch.id === 'woodenTower').tiers[0].gold];
  });
  check('library and Fortification load at the new prices', costs[0] === 200 && costs[1] === 100);
  check('no browser runtime errors', errors.length === 0);
} finally {
  await writeFile(`${output}/victory-checks.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
