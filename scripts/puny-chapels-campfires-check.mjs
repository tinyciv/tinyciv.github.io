import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Only an isolated standalone HTML copy is opened; the running game is untouched.
const output = path.resolve('output/puny-world-gallery');
const assetDir = path.join(output, 'chapels-campfires');
const nativeDir = path.join(assetDir, 'native');
const temp = mkdtempSync(path.join(tmpdir(), 'puny-chapels-qa-'));
const html = path.join(temp, 'gallery.html');
copyFileSync('output/btv-puny-world-gallery.html', html);
mkdirSync(nativeDir, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, offline: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => requests.push(request.url()));
const report = { testedFrom: 'isolated offline file:// copy', checks, churches: [], campfires: [], exports: [], screenshots: [], errors };
const check = name => { checks.push({ name, pass: true }); console.log('PASS ' + name); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const savePNG = (name, dataUrl) => {
  const target = path.join(nativeDir, name); mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(dataUrl.split(',')[1], 'base64'));
  report.exports.push(path.relative(assetDir, target));
};
const screenshot = async (name, selector) => {
  await page.locator(selector).evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, name) }); report.screenshots.push(name);
};

try {
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const village = await page.evaluate(() => DATA.village);
  assert.equal(village.churches.length, 3); assert.equal(village.campfires.length, 3);
  assert.equal(await page.locator('.church-card').count(), 3);
  assert.equal(await page.locator('.campfire-card').count(), 3);
  assert.equal(await page.locator('#characters-grid > article').count(), 4);
  assert.equal(await page.locator('#concept-grid > article').count(), 3);
  assert.equal(await page.locator('.farm-cell').count(), 16);
  for (const item of [...village.churches, ...village.campfires]) {
    assert.equal(hash(Buffer.from(item.dataUrl.split(',')[1], 'base64')), hash(readFileSync(path.resolve(assetDir, item.path))), item.id + ': original source PNG retained unchanged');
  }
  const nativeChecks = await page.evaluate(() => {
    function inspect(canvas) {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const alphas = new Set(); let pixels = 0, left = canvas.width, top = canvas.height, right = -1, bottom = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const a = data[(y * canvas.width + x) * 4 + 3]; alphas.add(a);
        if (a) { pixels++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
      }
      return { width: canvas.width, height: canvas.height, alphaValues: [...alphas].sort((a, b) => a - b), pixels, bounds: { left, top, right, bottom }, dataUrl: canvas.toDataURL('image/png') };
    }
    const churches = [...villageNative.churches.entries()].map(([id, entry]) => ({ id, ...inspect(entry.canvas) }));
    const campfires = [...villageNative.campfires.entries()].map(([id, entry]) => {
      const base = inspect(entry.base), flames = entry.flames.map(inspect), frames = entry.frames.map(inspect);
      const baseData = entry.base.getContext('2d').getImageData(0, 0, 32, 32).data;
      const flameData = entry.flames.map(canvas => canvas.getContext('2d').getImageData(0, 0, 32, 32).data);
      const frameData = entry.frames.map(canvas => canvas.getContext('2d').getImageData(0, 0, 32, 32).data);
      const sheet = entry.sheet.getContext('2d').getImageData(0, 0, 192, 32).data;
      let fixedPixels = 0, fixedBasePixels = 0, baseInvariantErrors = 0, compositingErrors = 0, sheetErrors = 0;
      for (let i = 0; i < 32 * 32; i++) {
        const k = i * 4, outsideAllFlames = flameData.every(data => data[k + 3] === 0);
        if (outsideAllFlames) { fixedPixels++; if (baseData[k + 3]) fixedBasePixels++; }
        for (let frame = 0; frame < 6; frame++) {
          if (outsideAllFlames && ![0, 1, 2, 3].every(ch => frameData[frame][k + ch] === baseData[k + ch])) baseInvariantErrors++;
          const expected = flameData[frame][k + 3] ? flameData[frame] : baseData;
          if (![0, 1, 2, 3].every(ch => frameData[frame][k + ch] === expected[k + ch])) compositingErrors++;
          const sheetIndex = (Math.floor(i / 32) * 192 + frame * 32 + i % 32) * 4;
          if (![0, 1, 2, 3].every(ch => frameData[frame][k + ch] === sheet[sheetIndex + ch])) sheetErrors++;
        }
      }
      return { id, fps: entry.item.fps, frameSpace: entry.item.frameSpace, base, flames, frames, sheet: inspect(entry.sheet), flameSheet: inspect(entry.flameSheet), fixedPixels, fixedBasePixels, baseInvariantErrors, compositingErrors, sheetErrors };
    });
    return { churches, campfires };
  });
  function assertFramed(item, width, height, label) {
    assert.equal(item.width, width); assert.equal(item.height, height);
    assert.deepEqual(item.alphaValues, [0, 255], label + ': clean binary transparency');
    assert.ok(item.pixels > 4, label + ': visible artwork');
    assert.ok(item.bounds.left > 0 && item.bounds.top > 0 && item.bounds.right < width - 1 && item.bounds.bottom < height - 1, label + ': artwork has native margins without edge clipping');
  }
  for (const church of nativeChecks.churches) {
    assertFramed(church, 64, 64, church.id);
    assert.ok(church.pixels > 200 && church.pixels < 3500, church.id + ': legible silhouette with transparent surroundings');
    savePNG(church.id + '.png', church.dataUrl); delete church.dataUrl;
    report.churches.push(church);
  }
  check('three transparent64×64 churches exported; native artwork is legible and unclipped');
  for (const fire of nativeChecks.campfires) {
    assert.equal(fire.frames.length, 6); assert.equal(fire.flames.length, 6); assert.equal(fire.fps, 8);
    assertFramed(fire.base, 32, 32, fire.id + '/base');
    for (let index = 0; index < 6; index++) {
      assertFramed(fire.flames[index], 32, 32, fire.id + '/flame' + index);
      assertFramed(fire.frames[index], 32, 32, fire.id + '/frame' + index);
      savePNG(`${fire.id}-flame-${index}.png`, fire.flames[index].dataUrl);
      savePNG(`${fire.id}-frame-${index}.png`, fire.frames[index].dataUrl);
    }
    assert.equal(new Set(fire.frames.map(frame => hash(Buffer.from(frame.dataUrl.split(',')[1], 'base64')))).size, 6, fire.id + ': all six complete frames visibly differ');
    assert.equal(new Set(fire.flames.map(frame => hash(Buffer.from(frame.dataUrl.split(',')[1], 'base64')))).size, 6, fire.id + ': all six flame layers differ');
    assert.equal(fire.sheet.width, 192); assert.equal(fire.sheet.height, 32);
    assert.equal(fire.flameSheet.width, 192); assert.equal(fire.flameSheet.height, 32);
    assert.equal(fire.baseInvariantErrors, 0); assert.equal(fire.compositingErrors, 0); assert.equal(fire.sheetErrors, 0);
    assert.ok(fire.fixedBasePixels >= 20, fire.id + ': stable visible logs or stones outside flame union');
    savePNG(fire.id + '-base.png', fire.base.dataUrl);
    savePNG(fire.id + '-sheet.png', fire.sheet.dataUrl);
    savePNG(fire.id + '-flames.png', fire.flameSheet.dataUrl);
    for (const frame of [fire.base, fire.sheet, fire.flameSheet, ...fire.frames, ...fire.flames]) delete frame.dataUrl;
    report.campfires.push(fire);
  }
  check('three fires export six distinct32px frames, flame layers, fixed bases and192×32 sheets');
  check('every non-flame pixel matches the fixed base across all frames; sheet crops and source-over composition are exact');

  await page.locator('#toggle-play').click();
  const paused = await page.locator('.campfire-card .art-stage > canvas').evaluateAll(canvases => canvases.map(canvas => canvas.toDataURL()));
  await page.waitForTimeout(200);
  assert.deepEqual(await page.locator('.campfire-card .art-stage > canvas').evaluateAll(canvases => canvases.map(canvas => canvas.toDataURL())), paused);
  const frameBefore = await page.evaluate(() => players.filter(player => player.campfireId).map(player => player.lastFrame));
  await page.locator('#step-forward').click();
  const frameAfter = await page.evaluate(() => players.filter(player => player.campfireId).map(player => player.lastFrame));
  assert.deepEqual(frameAfter, frameBefore.map(frame => (frame + 1) % 6));
  await page.locator('#step-back').click();
  assert.deepEqual(await page.evaluate(() => players.filter(player => player.campfireId).map(player => player.lastFrame)), frameBefore);
  const speedSamples = [];
  for (const multiplier of ['0.5', '2']) {
    await page.locator('#speed').selectOption(multiplier);
    const before = await page.evaluate(() => clock);
    await page.locator('#toggle-play').click();
    await page.waitForTimeout(400);
    await page.locator('#toggle-play').click();
    const elapsed = await page.evaluate(() => clock);
    speedSamples.push({ multiplier: Number(multiplier), elapsedAnimationTime: elapsed - before });
  }
  assert.ok(speedSamples[1].elapsedAnimationTime > speedSamples[0].elapsedAnimationTime * 2, 'speed control materially changes playback rate');
  report.speedSamples = speedSamples;
  await page.locator('#speed').selectOption('1');
  for (const item of village.campfires) {
    const card = page.locator(`.campfire-card[data-campfire="${item.id}"]`), mode = card.locator('select');
    await mode.selectOption('base'); assert.equal(await card.locator('.campfire-film canvas').count(), 1);
    await mode.selectOption('flames'); assert.equal(await card.locator('.campfire-film canvas').count(), 6);
    await mode.selectOption('composite'); assert.equal(await card.locator('.campfire-film canvas').count(), 6);
    await card.locator('.campfire-inspect').click(); assert.ok(await page.locator('#inspector').isVisible()); await page.locator('#close-inspector').click();
  }
  check('global pause/play, both frame steps and speed work for all new fires; preview layer selectors and inspectors work');

  const downloads = await page.locator('.church-download,.campfire-download,.campfire-base-download').evaluateAll(anchors => anchors.map(a => ({ name: a.download, data: a.href })));
  assert.equal(downloads.length, 9);
  for (const item of downloads) { assert.match(item.name, /\.png$/); assert.match(item.data, /^data:image\/png;base64,/); }
  for (const item of village.churches) {
    const href = await page.locator(`.church-card[data-church="${item.id}"] .church-download`).getAttribute('href');
    assert.equal(hash(Buffer.from(href.split(',')[1], 'base64')), hash(readFileSync(path.join(nativeDir, item.id + '.png'))));
  }
  for (const item of village.campfires) {
    const card = page.locator(`.campfire-card[data-campfire="${item.id}"]`);
    for (const [selector, suffix] of [['.campfire-download', '-sheet.png'], ['.campfire-base-download', '-base.png']]) {
      const href = await card.locator(selector).getAttribute('href');
      assert.equal(hash(Buffer.from(href.split(',')[1], 'base64')), hash(readFileSync(path.join(nativeDir, item.id + suffix))));
    }
  }
  const downloadEvent = page.waitForEvent('download'); await page.locator('#village-metadata').click();
  const download = await downloadEvent; assert.equal(await download.failure(), null); assert.match(download.suggestedFilename(), /\.json$/);
  check('native downloads exactly match exported assets; animation metadata downloads successfully');
  for (const item of village.campfires.filter(item => item.apngPath)) {
    const event = page.waitForEvent('download');
    await page.locator(`.campfire-card[data-campfire="${item.id}"] .campfire-apng`).click();
    const download = await event;
    assert.equal(await download.failure(), null);
    assert.equal(hash(readFileSync(await download.path())), hash(readFileSync(path.resolve(assetDir, item.apngPath))), item.id + ': animated PNG download matches packaged asset byte for byte');
  }
  if (village.campfires.some(item => item.apngPath)) check('all animated PNG downloads match packaged animation files byte for byte');

  await screenshot('qa-chapels-desktop.png', '#village');
  await screenshot('qa-chapels-churches.png', '#village-churches');
  await screenshot('qa-chapels-fires.png', '#village-campfires');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), width + ': no horizontal page overflow');
  }
  await screenshot('qa-chapels-mobile.png', '#village');
  await screenshot('qa-chapels-mobile-church.png', '#village-churches');
  await screenshot('qa-chapels-mobile-fire.png', '#village-campfires');
  check('new churches and fire layouts fit desktop and390px mobile without overflow');

  const reducedContext = await browser.newContext({ viewport: { width: 1200, height: 900 }, offline: true, reducedMotion: 'reduce' });
  try {
    const reduced = await reducedContext.newPage(); reduced.on('pageerror', error => errors.push(String(error))); reduced.on('request', request => requests.push(request.url()));
    await reduced.goto(pathToFileURL(html).href, { waitUntil: 'load' }); await reduced.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    assert.equal(await reduced.locator('#toggle-play').getAttribute('aria-pressed'), 'false');
    const before = await reduced.locator('.campfire-card .art-stage > canvas').evaluateAll(canvases => canvases.map(canvas => canvas.toDataURL()));
    await reduced.waitForTimeout(250);
    assert.deepEqual(await reduced.locator('.campfire-card .art-stage > canvas').evaluateAll(canvases => canvases.map(canvas => canvas.toDataURL())), before);
    await reduced.locator('#toggle-play').click();
    await reduced.waitForFunction(initial => document.querySelector('.campfire-card .art-stage > canvas').toDataURL() !== initial, before[0]);
  } finally { await reducedContext.close(); }
  check('reduced-motion preference starts all new fires paused; explicit play still works');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests.filter(url => /^https?:/.test(url)), []);
  assert.deepEqual([...new Set(requests.filter(url => /^file:/.test(url)))], [pathToFileURL(html).href]);
  check('standalone initialization preserves older sections and works offline without external dependencies or runtime errors');
  report.pass = true;
} catch (error) {
  report.pass = false; report.failure = String(error.stack || error);
  await page.screenshot({ path: path.join(output, 'qa-chapels-failure.png') }).catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(output, 'qa-chapels-report.json'), JSON.stringify(report, null, 2) + '\n');
  await context.close(); await browser.close(); rmSync(temp, { recursive: true, force: true });
}
