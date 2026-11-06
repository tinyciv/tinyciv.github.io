import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-02-siege-spears', checks = [], errors = [];
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  page.on('pageerror', error => errors.push(String(error)));
  const external = []; page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  const check = (name, passed, detail) => { checks.push({ name, passed: !!passed, detail }); assert.ok(passed, name); };
  await page.goto(`file://${resolve(output, 'index.html')}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check('self-contained offline preview requests no external resources', external.length === 0, external);
  await page.evaluate(() => __siegePreview.setTime(1.22));
  check('native sources all load', await page.evaluate(() => __siegePreview.state.assets.length === 5));
  check('paused replay shows long-range bolt and piercing impact', (await page.locator('#ranged-state').textContent()).includes('Bolt in flight')
    && (await page.locator('#melee-state').textContent()).includes('Three aligned'));
  const pixels = await page.locator('canvas').evaluateAll(canvases => canvases.map(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set(); for (let i = 0; i < data.length; i += 4) if (data[i + 3]) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return colors.size;
  }));
  check('all three scenes contain rendered artwork', pixels.every(count => count > 50), pixels);
  await page.screenshot({ path: `${output}/preview-desktop.png`, fullPage: true });
  await page.locator('#play').click(); await page.waitForTimeout(150);
  check('play resumes animation', await page.evaluate(() => __siegePreview.state.playing && __siegePreview.state.time > 1.22));
  await page.locator('#play').click(); await page.locator('#restart').click();
  check('replay resets a paused scene', await page.evaluate(() => !__siegePreview.state.playing && __siegePreview.state.time === 0));
  await page.locator('#speed').selectOption('2');
  check('speed control changes playback', await page.evaluate(() => __siegePreview.state.speed === 2));
  await page.locator('summary').click();
  check('original sheets are available for inspection', await page.locator('#ballista-sheet').isVisible()
    && await page.locator('#spear-sheet').evaluate(image => image.naturalWidth === 80 && image.naturalHeight === 224));
  await page.locator('summary').click();
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.evaluate(() => __siegePreview.setTime(1.22));
  check('390px layout has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/preview-mobile.png`, fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check('reduced motion starts paused', await page.evaluate(() => !__siegePreview.state.playing));
  check('no browser errors', errors.length === 0, errors);
  writeFileSync(`${output}/preview-browser-report.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(`${checks.length} checks passed; desktop/mobile screenshots saved.`);
} finally { await browser.close(); }
