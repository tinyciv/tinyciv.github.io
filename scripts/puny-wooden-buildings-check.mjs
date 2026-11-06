import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Gallery-only QA: an isolated offline copy, never an active game or saved game.
const output = path.resolve('output/puny-world-gallery');
const assetDir = path.join(output, 'wooden-buildings');
const temp = mkdtempSync(path.join(tmpdir(), 'puny-wooden-qa-'));
const html = path.join(temp, 'gallery.html'); copyFileSync('output/btv-puny-world-gallery.html', html);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1150 }, offline: true, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(String(error))); page.on('request', request => requests.push(request.url()));
const report = { testedFrom: 'isolated offline file:// gallery', checks, native: [], well: null, exports: [], screenshots: [], errors };
const check = name => { checks.push({ name, pass: true }); console.log('PASS ' + name); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const savePNG = (relative, dataUrl) => { const target = path.resolve(assetDir, relative); assert.ok(target.startsWith(assetDir + path.sep)); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, Buffer.from(dataUrl.split(',')[1], 'base64')); report.exports.push(path.relative(assetDir, target)); };
const screenshot = async (name, selector) => { await page.locator(selector).evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' })); await page.screenshot({ path: path.join(output, name) }); report.screenshots.push(name); };

try {
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' }); await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const manifest = await page.evaluate(() => DATA.woodenBuildings);
  assert.equal(manifest.items.length, 8);
  assert.equal(await page.locator('#wooden-houses .wooden-card').count(), 4);
  assert.equal(await page.locator('#wooden-features .wooden-card').count(), 3);
  assert.equal(await page.locator('#wooden-gate-view option').count(), 2);
  for (const source of manifest.sources) assert.equal(hash(Buffer.from(source.dataUrl.split(',')[1], 'base64')), hash(readFileSync(path.resolve(assetDir, source.path))), source.id + ': original source PNG embedded unchanged');
  const checks = await page.evaluate(() => {
    function inspect(canvas) {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let pixels = 0, left = canvas.width, top = canvas.height, right = -1, bottom = -1; const alphas = new Set();
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const a = data[(y * canvas.width + x) * 4 + 3]; alphas.add(a); if (a) { pixels++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); } }
      return { width: canvas.width, height: canvas.height, pixels, alphaValues: [...alphas].sort((a, b) => a - b), bounds: { left, top, right, bottom }, dataUrl: canvas.toDataURL() };
    }
    const native = [], wells = [];
    for (const [id, entry] of woodenNative) {
      if (entry.canvas) { native.push({ id, kind: woodenKind(entry.item), item: entry.item, ...inspect(entry.canvas) }); continue; }
      const base = inspect(entry.base), foreground = inspect(entry.foreground), motion = entry.motion.map(inspect), frames = entry.frames.map(inspect);
      const bd = entry.base.getContext('2d').getImageData(0, 0, 64, 64).data, fd = entry.foreground.getContext('2d').getImageData(0, 0, 64, 64).data;
      const md = entry.motion.map(canvas => canvas.getContext('2d').getImageData(0, 0, 64, 64).data), cd = entry.frames.map(canvas => canvas.getContext('2d').getImageData(0, 0, 64, 64).data);
      const sd = entry.sheet.getContext('2d').getImageData(0, 0, 384, 64).data;
      let fixedVisiblePixels = 0, invariantErrors = 0, foregroundErrors = 0, occludedMotionPixels = 0, compositingErrors = 0, sheetErrors = 0;
      for (let i = 0; i < 4096; i++) {
        const k = i * 4, outsideMotion = md.every(data => !data[k + 3]);
        if (outsideMotion && (bd[k + 3] || fd[k + 3])) fixedVisiblePixels++;
        for (let frame = 0; frame < cd.length; frame++) {
          const expected = fd[k + 3] ? fd : md[frame][k + 3] ? md[frame] : bd;
          if (![0, 1, 2, 3].every(ch => cd[frame][k + ch] === expected[k + ch])) compositingErrors++;
          if (outsideMotion && ![0, 1, 2, 3].every(ch => cd[frame][k + ch] === (fd[k + 3] ? fd : bd)[k + ch])) invariantErrors++;
          if (fd[k + 3]) { if (md[frame][k + 3]) occludedMotionPixels++; if (![0, 1, 2, 3].every(ch => cd[frame][k + ch] === fd[k + ch])) foregroundErrors++; }
          const s = (Math.floor(i / 64) * 384 + frame * 64 + i % 64) * 4;
          if (![0, 1, 2, 3].every(ch => cd[frame][k + ch] === sd[s + ch])) sheetErrors++;
        }
      }
      wells.push({ id, item: entry.item, base, foreground, motion, frames, sheet: inspect(entry.sheet), motionSheet: inspect(entry.motionSheet), fixedVisiblePixels, invariantErrors, foregroundErrors, occludedMotionPixels, compositingErrors, sheetErrors });
    }
    return { native, wells };
  });
  function assertNative(item, w, h, label, allowEmpty = false, connectedEdges = false) {
    assert.equal(item.width, w); assert.equal(item.height, h);
    if (allowEmpty && !item.pixels) { assert.deepEqual(item.alphaValues, [0]); return; }
    assert.deepEqual(item.alphaValues, [0, 255], label + ': binary transparency'); assert.ok(item.pixels > 4, label + ': visible art');
    if (!connectedEdges) assert.ok(item.bounds.left > 0 && item.bounds.top > 0 && item.bounds.right < w - 1 && item.bounds.bottom < h - 1, label + ': no native frame edge clipping');
  }
  for (const native of checks.native) {
    const { item } = native; assertNative(native, item.nativeWidth, item.nativeHeight, native.id, false, native.kind === 'gate');
    if (native.kind === 'tower') { assert.equal(native.width, 64); assert.equal(native.height, 112); assert.ok(native.bounds.bottom - native.bounds.top > 64); }
    else { assert.equal(native.width, 64); assert.equal(native.height, 64); }
    savePNG(item.nativePath || 'native/' + native.id + '.png', native.dataUrl);
    delete native.dataUrl; delete native.item; report.native.push(native);
  }
  const houseBounds = report.native.filter(item => item.kind === 'house').map(item => item.bounds);
  for (const edge of ['left', 'top', 'right', 'bottom']) assert.ok(Math.max(...houseBounds.map(box => box[edge])) - Math.min(...houseBounds.map(box => box[edge])) <= 2, 'house artwork uses a consistent normalized visual bounding box');
  assert.equal(checks.wells.length, 1); const well = checks.wells[0], wi = well.item;
  assert.equal(well.motion.length, 6); assert.equal(well.frames.length, 6);
  assertNative(well.base, 64, 64, 'well/base'); assertNative(well.foreground, 64, 64, 'well/foreground', !wi.foreground);
  for (let index = 0; index < 6; index++) {
    assertNative(well.motion[index], 64, 64, 'well/motion' + index); assertNative(well.frames[index], 64, 64, 'well/frame' + index);
    savePNG(`native/${well.id}-frame-${index}.png`, well.frames[index].dataUrl); savePNG(`native/${well.id}-motion-${index}.png`, well.motion[index].dataUrl);
  }
  assert.equal(new Set(well.frames.map(frame => hash(Buffer.from(frame.dataUrl.split(',')[1], 'base64')))).size, 6, 'six distinct visible well animation frames');
  assert.equal(well.sheet.width, 384); assert.equal(well.sheet.height, 64); assert.equal(well.motionSheet.width, 384); assert.equal(well.motionSheet.height, 64);
  assert.equal(well.invariantErrors, 0); assert.equal(well.foregroundErrors, 0); assert.equal(well.compositingErrors, 0); assert.equal(well.sheetErrors, 0);
  assert.ok(well.fixedVisiblePixels > 200, 'substantial fixed structure outside moving bucket/rope');
  savePNG(wi.nativePath || 'native/' + well.id + '.png', well.sheet.dataUrl); savePNG(wi.basePath || 'native/' + well.id + '-base.png', well.base.dataUrl);
  savePNG(wi.motionPath || wi.motionSheetPath || 'native/' + well.id + '-motion.png', well.motionSheet.dataUrl);
  savePNG(wi.foregroundPath || 'native/' + well.id + '-foreground.png', well.foreground.dataUrl);
  for (const item of [well.base, well.foreground, well.sheet, well.motionSheet, ...well.motion, ...well.frames]) delete item.dataUrl;
  delete well.item; report.well = well;
  check('eight exact native building assets exported with transparent margins and required runtime dimensions');
  check('well has six changing frames, exact fixed structure, foreground-over-bucket layering and384×64 sheet assembly');

  await page.locator('#toggle-play').click();
  const before = await page.locator('.wooden-well .art-stage canvas').evaluate(canvas => canvas.toDataURL());
  await page.waitForTimeout(160); assert.equal(await page.locator('.wooden-well .art-stage canvas').evaluate(canvas => canvas.toDataURL()), before);
  const wellFrame = await page.evaluate(() => players.find(player => player.woodenItem && woodenKind(player.woodenItem) === 'well').lastFrame);
  await page.locator('#step-forward').click(); assert.equal(await page.evaluate(() => players.find(player => player.woodenItem && woodenKind(player.woodenItem) === 'well').lastFrame), (wellFrame + 1) % 6);
  await page.locator('#step-back').click(); assert.equal(await page.evaluate(() => players.find(player => player.woodenItem && woodenKind(player.woodenItem) === 'well').lastFrame), wellFrame);
  await page.locator('#toggle-play').click(); await page.waitForFunction(old => document.querySelector('.wooden-well .art-stage canvas').toDataURL() !== old, before); await page.locator('#toggle-play').click();
  for (const mode of ['base', 'motion', 'foreground', 'composite']) { await page.locator('#wooden-well-layer').selectOption(mode); assert.equal(await page.locator('.wooden-well-film canvas').count(), ['base', 'foreground'].includes(mode) ? 1 : 6); }
  check('well animation respects global playback and both frame steps; all four layer modes render');

  await page.locator('#wooden-footprints').uncheck();
  const noFootprint = await page.locator('#wooden-houses .art-stage canvas').evaluateAll(canvases => canvases.map(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 400, 400).data)));
  await page.locator('#wooden-footprints').check();
  const footprints = await page.locator('#wooden-houses .art-stage canvas').evaluateAll((canvases, before) => canvases.map((canvas, index) => {
    const current = canvas.getContext('2d').getImageData(0, 0, 400, 400).data, changed = [];
    // Compare only the independently known160px footprint border. Interior
    // house pixels are unrelated to the one-cell boundary being tested.
    for (let pixel = 0; pixel < 160000; pixel++) {
      const x = pixel % 400, y = Math.floor(pixel / 400);
      if ((x <= 122 || x >= 277 || y <= 202 || y >= 357) && [0, 1, 2, 3].some(ch => current[pixel * 4 + ch] !== before[index][pixel * 4 + ch])) changed.push(pixel);
    }
    return changed;
  }), noFootprint);
  assert.ok(footprints[0].length > 100); for (const mask of footprints) assert.deepEqual(mask, footprints[0], 'all house tiers display the identical one-cell footprint');
  report.houseFootprintPixels = footprints[0].length;
  const groundBefore = await page.locator('#wooden-houses .art-stage canvas').first().evaluate(canvas => canvas.toDataURL());
  await page.locator('#wooden-ground').uncheck(); assert.notEqual(await page.locator('#wooden-houses .art-stage canvas').first().evaluate(canvas => canvas.toDataURL()), groundBefore); await page.locator('#wooden-ground').check();
  const gateOptions = await page.locator('#wooden-gate-view option').evaluateAll(options => options.map(option => option.value));
  const gates = [];
  for (const id of gateOptions) {
    await page.locator('#wooden-gate-view').selectOption(id);
    const card = page.locator('.wooden-gate-combined'); assert.equal(await card.getAttribute('data-building'), id);
    gates.push({ id, image: await card.locator('canvas').evaluate(canvas => canvas.toDataURL()), download: await card.locator('.wooden-download').getAttribute('href') });
  }
  assert.notEqual(gates[0].image, gates[1].image, 'two gate orientations have distinct source art and road axes'); assert.notEqual(gates[0].download, gates[1].download);
  check('all house footprint masks match exactly; ground toggle and both open gate orientation views update');

  const anchorData = await page.locator('#wooden-buildings a[download]').evaluateAll(links => links.map(link => ({ name: link.download, href: link.href })));
  assert.ok(anchorData.length >= 14); for (const link of anchorData) { assert.match(link.href, /^data:image\/png;base64,/); assert.match(link.name, /\.png$/); }
  for (const id of gateOptions) { await page.locator('#wooden-gate-view').selectOption(id); await page.locator('.wooden-gate-combined .wooden-inspect').click(); assert.ok(await page.locator('#inspector').isVisible()); await page.locator('#close-inspector').click(); }
  await page.locator('.wooden-well-inspect').click(); assert.ok(await page.locator('#inspector').isVisible()); await page.locator('#close-inspector').click();
  const metadataEvent = page.waitForEvent('download'); await page.locator('#wooden-metadata').click(); const metadata = await metadataEvent; assert.equal(await metadata.failure(), null); assert.match(metadata.suggestedFilename(), /\.json$/);
  check('native/original downloads, orientation-aware inspectors and building metadata work');

  await screenshot('qa-wooden-buildings-desktop.png', '#wooden-buildings'); await screenshot('qa-wooden-buildings-features.png', '#wooden-features');
  await page.locator('#wooden-gate-view').selectOption(gateOptions[0]); await screenshot('qa-wooden-buildings-gate-ns.png', '#wooden-features');
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1150 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await screenshot('qa-wooden-buildings-mobile.png', '#wooden-buildings'); await screenshot('qa-wooden-buildings-mobile-well.png', '.wooden-well'); await screenshot('qa-wooden-buildings-mobile-gate.png', '.wooden-gate-combined');
  check('desktop and390px mobile layouts fit without horizontal overflow');
  assert.deepEqual(errors, []); assert.deepEqual(requests.filter(url => /^https?:/.test(url)), []); assert.deepEqual([...new Set(requests.filter(url => /^file:/.test(url)))], [pathToFileURL(html).href]);
  check('new section and gallery initialize offline without sibling dependencies or runtime errors'); report.pass = true;
} catch (error) {
  report.pass = false; report.failure = String(error.stack || error); await page.screenshot({ path: path.join(output, 'qa-wooden-buildings-failure.png') }).catch(() => {}); throw error;
} finally {
  writeFileSync(path.join(output, 'qa-wooden-buildings-report.json'), JSON.stringify(report, null, 2) + '\n'); await context.close(); await browser.close(); rmSync(temp, { recursive: true, force: true });
}
