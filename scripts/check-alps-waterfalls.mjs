import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = 'scratch/2026-11-05-alps-waterfalls';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
  (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const checks = [], errors = [], external = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  await page.goto(pathToFileURL(resolve('output/mediterranean-alps.html')).href);
  await page.waitForFunction(() => window.__mapReview?.ready, null, { timeout: 60000 });
  const metadata = await page.evaluate(() => window.__mapReview.map);
  check('Alpine section has five waterfalls and four native animation frames', metadata.waterfalls === 5 && metadata.frames === 4
    && metadata.width === metadata.tilesWide * 16 && metadata.height === metadata.tilesHigh * 16, metadata);
  check('Alpine title and regional controls match the cropped map', (await page.title()).startsWith('Alps')
    && await page.locator('[data-region="iberia"]').isHidden() && await page.locator('[data-region="nile"]').isHidden());
  const fit = await page.evaluate(() => window.__mapReview.view);
  check('Initial view includes the entire Alpine section', fit.fitMode && fit.zoom * metadata.width <= fit.width - 35 && fit.zoom * metadata.height <= fit.height - 35, fit);
  await page.locator('#animate').click(); await settle();
  await page.screenshot({ path: `${out}/alps-overview.png` });
  await page.locator('#next-waterfall').click(); await settle();
  const focused = await page.evaluate(() => window.__mapReview.view);
  check('Next waterfall reveals a close view with a location marker', focused.zoom === 3 && focused.waterfallIndex === 0
    && await page.locator('#show-waterfalls').isChecked(), focused);
  await page.locator('#animate').click();
  const frames = await page.evaluate(() => new Promise(resolve => {
    const seen = new Map(), started = performance.now();
    const capture = () => {
      const state = window.__mapReview.view, canvas = document.querySelector('#map');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let i = 0; i < pixels.length; i += 4) hash = Math.imul(hash ^ pixels[i], 16777619);
      seen.set(canvas.dataset.frame, hash >>> 0);
      if (seen.size === 4 || performance.now() - started > 3000) resolve([...seen]);
      else requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  }));
  check('All four waterfall frames change the displayed pixels', frames.length === 4 && new Set(frames.map(([, hash]) => hash)).size === 4, frames);
  await page.locator('#animate').click(); await settle();
  const paused = await page.evaluate(() => window.__mapReview.view.frameIndex);
  await page.waitForTimeout(240);
  check('Pause holds the waterfall frame', paused === await page.evaluate(() => window.__mapReview.view.frameIndex));
  await page.screenshot({ path: `${out}/waterfall-1.png` });
  for (let index = 1; index < metadata.waterfalls; index++) {
    await page.locator('#next-waterfall').click(); await settle();
    await page.screenshot({ path: `${out}/waterfall-${index + 1}.png` });
  }
  await page.locator('#vegetation').uncheck(); await settle();
  check('Terrain-only view preserves the same waterfall selection', !(await page.evaluate(() => window.__mapReview.view.vegetation))
    && await page.evaluate(() => window.__mapReview.view.waterfallIndex) === 4);
  const pending = page.waitForEvent('download'); await page.locator('#download').click();
  const download = await pending, png = await readFile(await download.path());
  check('PNG download contains the complete Alpine section', png.readUInt32BE(16) === metadata.width && png.readUInt32BE(20) === metadata.height);
  await page.locator('#vegetation').check(); await page.locator('#show-waterfalls').uncheck();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#fit').click(); await settle();
  const mobile = await page.evaluate(() => window.__mapReview.view);
  check('Mobile view fits the Alps and keeps controls within the viewport', mobile.zoom * metadata.width <= mobile.width - 35
    && mobile.zoom * metadata.height <= mobile.height - 35 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), mobile);
  await page.screenshot({ path: `${out}/alps-mobile.png` });
  check('Viewer works offline without runtime errors', !errors.length && !external.length, { errors, external });
} catch (error) {
  await page.screenshot({ path: `${out}/viewer-failure.png` }).catch(() => {}); throw error;
} finally {
  await writeFile(`${out}/viewer-checks.json`, JSON.stringify({ checks, errors, external }, null, 2));
  console.log(JSON.stringify({ checks, errors, external }, null, 2));
  await browser.close();
}
