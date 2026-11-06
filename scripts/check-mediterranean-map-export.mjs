import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = 'scratch/2026-11-04-mediterranean-full-map';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
  (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const checks = [], errors = [], external = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
const view = () => page.evaluate(() => window.__mapReview.view);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const mapFits = value => value.zoom * 6144 <= value.width - 35 && value.zoom * 3184 <= value.height - 35;
const frameFingerprint = () => page.evaluate(() => {
  const canvas = document.querySelector('#map'), pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  for (let index = 0; index < pixels.length; index += 64) hash = Math.imul(hash ^ pixels[index], 16777619);
  return hash >>> 0;
});

try {
  await page.goto(pathToFileURL(resolve(process.argv[2] || 'output/mediterranean-full-map.html')).href);
  await page.waitForFunction(() => window.__mapReview?.ready, null, { timeout: 60000 });
  await settle();
  const metadata = await page.evaluate(() => window.__mapReview.map), initial = await view();
  check('Entire map is available at native resolution', metadata.width === 6144 && metadata.height === 3184 && metadata.tilesWide === 384 && metadata.tilesHigh === 199, metadata);
  check('Initial view fits the complete basin', initial.fitMode && mapFits(initial), initial);
  check('Embedded Pixel Operator font loads', await page.evaluate(() => document.fonts.check('16px "Pixel Operator"')));
  await page.screenshot({ path: `${out}/viewer-desktop.png` });
  await page.locator('#about').click();
  check('Source credits and historical limits travel with the file', await page.locator('#about-dialog').isVisible()
    && (await page.locator('#about-dialog').textContent()).includes('not an exact-year reconstruction')
    && await page.locator('#about-dialog a').count() === 4);
  await page.locator('#close-about').click();

  await page.locator('[data-region="alps"]').click(); await settle();
  const alps = await view();
  check('Alps shortcut centers on the correct geography', Math.abs(alps.centerX / 6144 * 54 - 12 - 9) < .01 && Math.abs(49 - alps.centerY / 3184 * 22 - 46) < .01 && alps.zoom > initial.zoom, alps);
  await page.screenshot({ path: `${out}/viewer-alps.png` });
  const canvas = page.locator('#map'), rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, -160); await settle();
  const zoomed = await view();
  // Browser mouse coordinates round to screen pixels on odd-size viewports.
  check('Wheel zoom preserves its center anchor', zoomed.zoom > alps.zoom && Math.abs(zoomed.centerX - alps.centerX) < .5 && Math.abs(zoomed.centerY - alps.centerY) < .5, zoomed);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 100, rect.y + rect.height / 2 + 40, { steps: 5 }); await page.mouse.up(); await settle();
  const panned = await view();
  check('Dragging pans the map', panned.centerX < zoomed.centerX && panned.centerY < zoomed.centerY, panned);
  await page.locator('#native').click(); await settle();
  check('100 percent restores native image scale', Math.abs((await view()).zoom - 1) < .0001);
  await canvas.focus(); await page.keyboard.press('ArrowRight'); await settle();
  const keyboard = await view();
  check('Arrow keys pan the focused map', keyboard.centerX > panned.centerX);
  await page.keyboard.press('0'); await settle();
  check('Zero key restores the full-map view', (await view()).fitMode && mapFits(await view()));

  const withTrees = await frameFingerprint();
  await page.locator('#vegetation').uncheck(); await settle();
  check('Vegetation toggle reveals the terrain image', !(await view()).vegetation && await frameFingerprint() !== withTrees);
  await page.locator('#starts').check(); await settle();
  check('Starting towns can be shown', (await view()).starts && metadata.starts === 11);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click();
  const download = await downloadPromise, png = await readFile(await download.path());
  check('PNG download retains the entire native-resolution map', download.suggestedFilename().endsWith('-terrain.png')
    && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) === 6144 && png.readUInt32BE(20) === 3184,
    { name: download.suggestedFilename(), bytes: png.length });

  await page.locator('#vegetation').check(); await page.locator('#starts').uncheck();
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await page.locator('#fit').click(); await settle();
  const mobile = await view();
  check('Mobile view fits the whole map without horizontal overflow', mapFits(mobile)
    && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight), mobile);
  await page.screenshot({ path: `${out}/viewer-mobile.png` });
  check('Standalone file makes no network requests', external.length === 0, external);
  check('Viewer has no runtime errors', errors.length === 0, errors);
} catch (error) {
  await page.screenshot({ path: `${out}/viewer-failure.png` }).catch(() => {}); throw error;
} finally {
  await writeFile(`${out}/viewer-checks.json`, JSON.stringify({ checks, errors, external }, null, 2));
  console.log(JSON.stringify({ checks, errors, external }, null, 2));
  await browser.close();
}
