import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Read an isolated offline HTML copy. These checks never open the running game.
const output = path.resolve('output/puny-world-gallery');
const nativeDir = path.join(output, 'farm-overlays/native');
const temp = mkdtempSync(path.join(tmpdir(), 'puny-farm-qa-'));
const html = path.join(temp, 'gallery.html');
copyFileSync('output/btv-puny-world-gallery.html', html);
mkdirSync(nativeDir, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1150 }, offline: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => requests.push(request.url()));
const report = { testedFrom: 'isolated file:// copy with browser offline', checks, sources: [], comparisons: [], screenshots: [], errors };
const check = (name, detail) => { checks.push({ name, pass: true, ...(detail ? { detail } : {}) }); console.log('PASS ' + name); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const overflow = async label => {
  const size = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  assert.ok(size.page <= size.viewport, label + ': no horizontal overflow');
  check(label + ': no horizontal overflow', size);
};
const screenshot = async name => {
  await page.locator('#farms').evaluate(section => section.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, name) }); report.screenshots.push(name);
};

try {
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.ok(await page.locator('#farms').isVisible());
  const manifest = await page.evaluate(() => DATA.farmOverlays);
  assert.equal(manifest.items.length, 4);
  assert.deepEqual(manifest.items.map(item => item.id), ['seedlings', 'green-grain', 'ripe-grain', 'stubble']);
  assert.equal(await page.locator('#farm-grid .farm-card').count(), 4);
  assert.equal(await page.locator('.farm-download').count(), 4);
  assert.equal(await page.locator('.farm-raw-download').count(), 4);

  for (const item of manifest.items) {
    const sourceBytes = readFileSync(path.join(output, 'farm-overlays', item.path));
    assert.equal(hash(Buffer.from(item.dataUrl.split(',')[1], 'base64')), hash(sourceBytes), item.id + ': raw generated image unchanged');
    const sourceCheck = await page.evaluate(async item => {
      const raw = new Image(); raw.src = item.dataUrl; await raw.decode();
      const rawCanvas = document.createElement('canvas'); rawCanvas.width = raw.width; rawCanvas.height = raw.height;
      const rc = rawCanvas.getContext('2d'); rc.drawImage(raw, 0, 0);
      const source = rc.getImageData(0, 0, raw.width, raw.height).data;
      let transparent = 0, belowThreshold = 0;
      for (let i = 3; i < source.length; i += 4) { if (source[i] === 0) transparent++; if (source[i] < 128) belowThreshold++; }
      const canvas = farmNativeLayers.get(item.id).canvas;
      const native = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const reference = document.createElement('canvas'); reference.width = reference.height = 32;
      const referenceContext = reference.getContext('2d'); referenceContext.imageSmoothingEnabled = false;
      referenceContext.drawImage(raw, 0, 0, raw.width, raw.height, 0, 0, 32, 32);
      const sampled = referenceContext.getImageData(0, 0, 32, 32).data;
      const alphaValues = [...new Set(Array.from(native).filter((_, index) => index % 4 === 3))].sort((a, b) => a - b);
      let opaque = 0, edgeOpaque = 0, alphaMismatches = 0, colorMismatches = 0, maxColorDelta = 0, colorDeltaTotal = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        // Independently decoded source, sampled by the browser's nearest-neighbor
        // rasterizer (avoids assuming its internal fixed-point sample rounding).
        const expectedAlpha = sampled[i + 3] < 128 ? 0 : 255;
        if (native[i + 3] !== expectedAlpha) alphaMismatches++;
        if (native[i + 3]) {
          opaque++;
          if (x === 0 || y === 0 || x === 31 || y === 31) edgeOpaque++;
          for (let ch = 0; ch < 3; ch++) {
            const delta = Math.abs(native[i + ch] - sampled[i + ch]);
            if (delta) colorMismatches++;
            maxColorDelta = Math.max(maxColorDelta, delta); colorDeltaTotal += delta;
          }
        }
      }
      return { width: raw.width, height: raw.height, nativeWidth: canvas.width, nativeHeight: canvas.height, transparentPercent: transparent / (raw.width * raw.height) * 100, belowThresholdPercent: belowThreshold / (raw.width * raw.height) * 100, alphaValues, opaque, coveragePercent: opaque / 1024 * 100, edgeOpaque, alphaMismatches, colorMismatches, maxColorDelta, meanColorDelta: colorDeltaTotal / (opaque * 3), nativeDataUrl: canvas.toDataURL('image/png') };
    }, item);
    assert.equal(sourceCheck.width, 1254); assert.equal(sourceCheck.height, 1254);
    assert.ok(sourceCheck.transparentPercent > 85 && sourceCheck.transparentPercent < 99.5, item.id + ': source is sparse transparent plants');
    assert.equal(sourceCheck.nativeWidth, 32); assert.equal(sourceCheck.nativeHeight, 32);
    assert.deepEqual(sourceCheck.alphaValues, [0, 255]);
    assert.ok(sourceCheck.opaque >= 15 && sourceCheck.opaque <= 160, item.id + ': legible sparse crop coverage without a field-wide rectangle');
    assert.equal(sourceCheck.edgeOpaque, 0, item.id + ': transparent tile borders');
    // A separately decoded high-resolution image can take a different browser
    // raster path. Record its sample deltas; the authoritative compositor test
    // below uses the exact exported binary-alpha texture, byte for byte.
    const dataUrl = sourceCheck.nativeDataUrl;
    delete sourceCheck.nativeDataUrl;
    writeFileSync(path.join(nativeDir, item.id + '.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    report.sources.push({ id: item.id, ...sourceCheck, exportedNativePath: path.relative(process.cwd(), path.join(nativeDir, item.id + '.png')) });
  }
  check('four original source PNGs preserved; native32 layers use nearest-neighbor import and exact binary alpha', report.sources);

  for (const terrain of ['grass', 'sand', 'shore']) {
    await page.locator('#farm-terrain').selectOption(terrain);
    for (let index = 0; index < manifest.items.length; index++) {
      await page.locator('#farm-growth').selectOption(String(index));
      await page.locator('#farm-show').check();
      await page.locator('#farm-clip').check();
      const result = await page.evaluate(({ id, terrain }) => {
        const before = document.querySelector('#farm-before').getContext('2d').getImageData(0, 0, 96, 96).data;
        const after = document.querySelector('#farm-after').getContext('2d').getImageData(0, 0, 96, 96).data;
        const native = farmNativeLayers.get(id).canvas.getContext('2d').getImageData(0, 0, 32, 32).data;
        let outsideSupport = 0, outsideChanged = 0, cropPixels = 0, cropColorErrors = 0, changed = 0, water = 0, waterChanged = 0;
        for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
          const i = (y * 96 + x) * 4;
          const isWater = terrain === 'shore' && before[i + 1] > before[i] + 20 && before[i + 2] > before[i] + 20;
          const same = [0, 1, 2, 3].every(ch => before[i + ch] === after[i + ch]);
          if (!same) changed++;
          if (isWater) { water++; if (!same) waterChanged++; }
          const withinField = x >= 16 && x < 80 && y >= 16 && y < 80;
          const n = (((y - 16 + 32) % 32) * 32 + (x - 16 + 32) % 32) * 4;
          const hasPlant = withinField && native[n + 3] === 255 && !isWater;
          if (!hasPlant) { outsideSupport++; if (!same) outsideChanged++; }
          else {
            cropPixels++;
            if (![0, 1, 2, 3].every(ch => after[i + ch] === native[n + ch])) cropColorErrors++;
          }
        }
        return { id, terrain, outsideSupport, outsideChanged, cropPixels, cropColorErrors, changed, water, waterChanged };
      }, { id: manifest.items[index].id, terrain });
      assert.equal(result.outsideChanged, 0, `${result.id}/${terrain}: every uncovered terrain byte remains identical`);
      assert.equal(result.cropColorErrors, 0, `${result.id}/${terrain}: visible plants use ordinary opaque source colors`);
      assert.equal(result.waterChanged, 0, `${result.id}/${terrain}: shoreline water remains byte-identical`);
      if (terrain !== 'shore') assert.ok(result.changed > 0, `${result.id}/${terrain}: visible crop pixels present`);
      else assert.ok(result.water > 1000, 'shore fixture includes meaningful water coverage');
      await page.locator('#farm-show').uncheck();
      assert.equal(await page.evaluate(() => document.querySelector('#farm-before').toDataURL() === document.querySelector('#farm-after').toDataURL()), true, `${result.id}/${terrain}: hiding crops returns exact original terrain`);
      await page.locator('#farm-show').check();
      report.comparisons.push(result);
    }
  }
  check('all twelve terrain/stage combinations preserve every uncovered pixel, with exact terrain restoration when hidden', report.comparisons);
  check('shoreline clipping leaves every water pixel unchanged and plant pixels use ordinary source-over colors');

  const downloads = await page.locator('.farm-download,.farm-raw-download').evaluateAll(anchors => anchors.map(a => ({ name: a.download, href: a.href })));
  for (const d of downloads) { assert.match(d.href, /^data:image\/png;base64,/); assert.match(d.name, /\.png$/); }
  for (let i = 0; i < 4; i++) {
    const card = page.locator('.farm-card').nth(i);
    await card.locator('.farm-pick').click();
    assert.equal(await page.locator('#farm-growth').inputValue(), String(i));
    assert.equal(await card.locator('.farm-pick').getAttribute('aria-pressed'), 'true');
    const native = Buffer.from((await card.locator('.farm-download').getAttribute('href')).split(',')[1], 'base64');
    assert.equal(hash(native), hash(readFileSync(path.join(nativeDir, manifest.items[i].id + '.png'))));
    await card.locator('.farm-inspect').click();
    assert.ok(await page.locator('#inspector').isVisible());
    await page.locator('#close-inspector').click();
  }
  const downloadEvent = page.waitForEvent('download');
  await page.locator('.farm-download').first().click();
  const download = await downloadEvent;
  assert.equal(await download.failure(), null);
  assert.match(download.suggestedFilename(), /32x32\.png$/);
  check('four native downloads, four original downloads, card selection and alpha inspectors work');

  await page.locator('#farm-growth').selectOption('2');
  await page.locator('#farm-terrain').selectOption('grass');
  await overflow('desktop1440');
  await screenshot('qa-farms-desktop.png');
  await page.locator('#farm-grid').evaluate(section => section.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, 'qa-farms-layers.png') }); report.screenshots.push('qa-farms-layers.png');
  await page.locator('#farm-terrain').selectOption('shore');
  await screenshot('qa-farms-shore.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await overflow('mobile390');
  await screenshot('qa-farms-mobile.png');
  await page.locator('#farm-grid').evaluate(section => section.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, 'qa-farms-mobile-layers.png') }); report.screenshots.push('qa-farms-mobile-layers.png');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests.filter(url => /^https?:/.test(url)), []);
  assert.deepEqual(requests.filter(url => /^file:/.test(url)), [pathToFileURL(html).href]);
  check('standalone farm comparison works offline without external requests or runtime errors');
  report.pass = true;
} catch (error) {
  report.pass = false; report.failure = String(error.stack || error);
  await page.screenshot({ path: path.join(output, 'qa-farms-failure.png') }).catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(output, 'qa-farms-report.json'), JSON.stringify(report, null, 2) + '\n');
  await context.close(); await browser.close(); rmSync(temp, { recursive: true, force: true });
}
