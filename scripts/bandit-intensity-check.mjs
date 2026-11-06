import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-02-bandit-intensity';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.routeWebSocket(/.*/, () => {});
const checks = [], errors = [];
page.on('pageerror', error => errors.push(String(error)));
function check(name, passed, detail) {
  checks.push({ name, passed: !!passed, detail }); console.log(name, passed);
  assert.ok(passed, JSON.stringify({ name, detail }));
}
const ready = () => page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', { timeout: 60000 });
const slider = page.locator('#bandit-intensity');
const label = page.locator('[data-bandit-value]');
async function change(value) {
  await slider.fill(String(value)); await slider.dispatchEvent('input'); await slider.dispatchEvent('change');
}
async function newWorld(seed) {
  await page.locator('[data-frontend-action="back"]').click();
  await page.locator('[data-view="single"]').click();
  await page.locator('[name="seed"]').fill(seed);
  await page.locator('[data-form="single"] button[type="submit"]').click();
  await page.locator('#frontend').waitFor({ state: 'hidden', timeout: 60000 });
  await page.evaluate(() => { __game.state.paused = true; });
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5174/', { waitUntil: 'networkidle' }); await ready();
  await page.locator('[data-view="options"]').click();
  check('Bandit intensity defaults to 100%', await slider.inputValue() === '100' && (await label.textContent()).includes('100'));
  const attributes = await slider.evaluate(input => ({ min: input.min, max: input.max, step: input.step, label: input.labels[0]?.textContent }));
  check('accessible slider spans Off through 300% in 25% steps', attributes.min === '0' && attributes.max === '300'
    && attributes.step === '25' && attributes.label.includes('Bandit intensity'), attributes);
  await newWorld('BTV-847');
  await page.keyboard.press('Escape'); await page.locator('[data-view="options"]').click();
  const before = await page.evaluate(() => ({ time: __game.state.time, next: __game.state.raiderCamps.map(c => c.nextRaidAt),
    raiders: __game.state.units.filter(u => u.faction === -2 && u.hp > 0).map(u => u.id), intensity: __game.state.banditIntensity }));
  check('baseline new world has living bandits and scheduled raids', before.raiders.length > 0 && before.next.some(next => next > before.time), before);
  await slider.fill('200'); await slider.dispatchEvent('input');
  check('slider previews its new percentage while dragging', (await label.textContent()).includes('200'));
  await slider.dispatchEvent('change');
  const doubled = await page.evaluate(async () => {
    const s = __game.state, module = await import('/src/game/bandit-intensity.ts');
    return { time: s.time, intensity: s.banditIntensity, next: s.raiderCamps.map(c => c.nextRaidAt),
      globalCap: module.banditPopulationCap(s, 240), campCap: module.banditPopulationCap(s, 90),
      raiders: s.units.filter(u => u.faction === -2 && u.hp > 0).map(u => u.id) };
  });
  check('200% applies immediately and halves remaining raid waits', doubled.intensity === 2
    && doubled.next.every((next, i) => Math.abs(next - doubled.time - Math.max(0, before.next[i] - before.time) / 2) < .001), doubled);
  check('raising intensity preserves existing bandit identities', JSON.stringify(doubled.raiders) === JSON.stringify(before.raiders));
  check('200% doubles global and per-camp population caps', doubled.globalCap === 480 && doubled.campCap === 180, doubled);
  await slider.focus(); await page.keyboard.press('ArrowLeft');
  check('keyboard arrows change intensity by one step', await slider.inputValue() === '175'
    && await page.evaluate(() => __game.state.banditIntensity === 1.75));
  await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: `${output}/options-desktop.png` });
  await page.locator('[data-frontend-action="back"]').click(); await page.locator('[data-frontend-action="save"]').click();
  await page.reload({ waitUntil: 'networkidle' }); await ready();
  check('save and reload retain 200% and automatically resume the paused game', await page.locator('#frontend').isHidden()
    && await page.evaluate(() => __game.state.banditIntensity === 2 && __game.state.paused));
  await page.keyboard.press('Escape'); await page.locator('[data-view="options"]').click();
  check('restored setting is reflected in Options', await slider.inputValue() === '200');
  const living = await page.evaluate(() => __game.state.units.filter(u => u.faction === -2 && u.hp > 0).map(u => u.id));
  await change(0);
  check('Off retains existing bandits rather than deleting units', await page.evaluate(ids => __game.state.banditIntensity === 0
    && JSON.stringify(__game.state.units.filter(u => u.faction === -2 && u.hp > 0).map(u => u.id)) === JSON.stringify(ids), living));
  await page.setViewportSize({ width: 390, height: 844 });
  const fit = await slider.evaluate(input => {
    const r = input.getBoundingClientRect(), panel = input.closest('.frontend-panel'), p = panel.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, panelBottom: p.bottom,
      width: innerWidth, height: innerHeight, font: getComputedStyle(input).fontFamily,
      scroll: panel.scrollWidth > panel.clientWidth };
  });
  check('mobile slider fits and uses Pixel Operator', fit.left >= 0 && fit.right <= fit.width && fit.bottom <= fit.height
    && fit.panelBottom <= fit.height && !fit.scroll && fit.font.includes('Pixel Operator'), fit);
  await page.screenshot({ path: `${output}/options-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 950 });
  await newWorld('bandits-off');
  const off = await page.evaluate(() => ({ intensity: __game.state.banditIntensity, units: __game.state.units.filter(u => u.faction === -2).length }));
  check('next world inherits Off before its initial bandits would spawn', off.intensity === 0 && off.units === 0, off);
  const after = await page.evaluate(async () => {
    const { updateFogRaids } = await import('/src/game/fog-raids.ts'); const s = __game.state;
    s.paused = false; s.time += 1200; updateFogRaids(s); s.paused = true;
    return s.units.filter(u => u.faction === -2).length;
  });
  check('Off continues suppressing new raids after twenty game minutes', after === 0, after);
  await page.keyboard.press('Escape'); await page.locator('[data-view="options"]').click(); await change(50);
  const enabled = await page.evaluate(() => ({ intensity: __game.state.banditIntensity,
    times: (__game.state.raiderCamps ?? []).map(c => c.nextRaidAt), now: __game.state.time }));
  check('Bandits can be enabled again at 50% with finite future clocks', enabled.intensity === .5
    && enabled.times.every(time => Number.isFinite(time) && time >= enabled.now), enabled);
  check('no browser runtime errors', errors.length === 0, errors);
} finally {
  if (checks.at(-1)?.name !== 'no browser runtime errors') await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  writeFileSync(`${output}/browser-report.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
