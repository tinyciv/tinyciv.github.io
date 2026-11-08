import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = process.env.GAME_URL || 'https://tinyciv.github.io';
const out = process.env.QA_OUTPUT || 'output/public-loyalty';
await mkdir(out, { recursive: true });
const compiled = await build({ stdin: { contents: `export { loyaltyFixture } from './tests/helpers/loyalty';
  export { serializeGameSave, parseGameSave } from './src/game/game-save';
  export { initialCityLoyalty } from './src/game/loyalty-model';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false' } });
const model = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-unsafe-swiftshader'] });
const checks = [], errors = [], failures = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log(`PASS ${name}`); };
let page;
async function ready() {
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready', undefined, { timeout: 180000 });
  await page.locator('#frontend').waitFor({ state: 'hidden', timeout: 180000 });
}
async function openSaved(revolt) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(endpoint)) failures.push(`${response.status()} ${response.url()}`); });
  const f = model.loyaltyFixture(); f.state.time = 5; f.state.loyaltyUpdatedAt = 0;
  f.state.paused = !revolt; f.state.selected = 1; f.state.selectedType = 'unit';
  f.leader.attack = 10000; f.leader.hp = f.leader.maxHp = 10000;
  for (const faction of f.state.factions) { faction.nextRaid = 1000000; faction.nextRetinueAt = 1000000; }
  f.city.loyalty = { ...model.initialCityLoyalty(0, revolt ? .1 : 32), graceUntil: 0, target: -10,
    rate: -.23, pressure: .8, support: -24, trauma: revolt ? 75 : 15, traumaAt: 5, advanced: 1, guards: 1 };
  const serialized = model.serializeGameSave(f.state);
  // Seed only this disposable browser context, through the game's normal save
  // format. All subsequent logic and interactions use the deployed production JS.
  await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ body: '<html></html>', contentType: 'text/html' }) : route.continue());
  await page.goto(endpoint + '/?qa-bootstrap');
  await page.evaluate(serialized => new Promise((resolve, reject) => {
    const request = indexedDB.open('tinyciv-games', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('saves');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put(serialized, 'single-player');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), serialized);
  await page.unroute('**/*');
  await page.goto(endpoint + '/?loyalty-e2e=' + Date.now()); await ready();
  check('Deployed game resumes a saved city without development hooks', await page.evaluate(() => !window.__game));
  return context;
}
async function cityClick(button = 'left') {
  const bounds = await page.locator('#world').boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2 + 2 * 32 * 1.35, bounds.y + bounds.height / 2 - .5 * 32 * 1.35, { button });
}
try {
  let context = await openSaved(false);
  await cityClick(); await page.locator('.city-loyalty-summary').waitFor();
  check('Public settlement popup shows loyalty and its contributing factors', (await page.locator('.city-loyalty-summary').innerText()).includes('32/100') && (await page.locator('.city-loyalty-factors').innerText()).includes('Borders'));
  await page.screenshot({ path: `${out}/loyalty-breakdown.png` }); await page.keyboard.press('Escape');
  await page.screenshot({ path: `${out}/loyalty-city-panel.png` }); await context.close();
  context = await openSaved(true);
  await page.waitForTimeout(1000); await cityClick('right');
  await page.locator('#village-trade').waitFor({ timeout: 15000 });
  check('Live simulation turns a zero-loyalty city neutral and exposes diplomacy', await page.locator('#village-trade').isEnabled() && await page.locator('#village-ally').isEnabled() && await page.locator('#village-war').isEnabled());
  await page.screenshot({ path: `${out}/independent-city.png` });
  await page.locator('#village-trade').click(); await cityClick('right');
  check('Trade can be purchased once through the public UI', await page.locator('#village-trade').isDisabled());
  await page.locator('#village-ally').click(); await cityClick('right');
  check('Alliance can be purchased through the public UI', await page.locator('#village-ally').isDisabled());
  await page.locator('#village-war').click(); await cityClick('right');
  await page.locator('#capture-palace').waitFor({ timeout: 45000 });
  await page.locator('#capture-palace').click();
  check('Attacking and capturing the independent settlement works on production', await page.locator('#capture-palace').isHidden());
  await page.waitForTimeout(1500);
  const saved = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('tinyciv-games', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('saves', 'readonly').objectStore('saves').get('single-player');
      read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error);
    };
  }));
  const restored = model.parseGameSave(saved), captured = restored.buildings.find(building => building.cityName === 'Capua');
  check('Recapture saves restored ownership, residents and loyalty', captured.faction === 0 && captured.loyalty?.value >= 59 && restored.factions[0].population === 13);
  await page.screenshot({ path: `${out}/recaptured-city.png` });
  await context.close();
  check('Public assets load without HTTP errors', failures.length === 0);
  check('No browser runtime errors', errors.length === 0);
} catch (error) {
  checks.push(`FAILED: ${String(error)}`); await page?.screenshot({ path: `${out}/failure.png` }); throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ endpoint, checks, errors, failures }, null, 2));
  await browser.close();
}
