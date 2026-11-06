import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// An isolated copy proves the study is portable; no running game is touched.
const output = path.resolve('output/art-resolution-study');
const temporary = mkdtempSync(path.join(tmpdir(), 'btv-resolution-qa-'));
const html = path.join(temporary, 'study.html');
copyFileSync('output/btv-art-resolution-study.html', html);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1120 }, offline: true, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], requests = [];
const report = { testedFrom: 'isolated offline file:// copy', pass: false, checks: [], variants: [], screenshots: [], errors };
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => requests.push(request.url()));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = data => Buffer.from(data.split(',')[1], 'base64');
const pass = name => { report.checks.push({ name, pass: true }); console.log('PASS ' + name); };
const capture = async (name, selector, whole = false) => {
  await page.locator(selector).evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'start' }));
  if (whole) await page.locator(selector).screenshot({ path: path.join(output, name) });
  else await page.screenshot({ path: path.join(output, name) });
  report.screenshots.push(name);
};
const validateDataLink = (link, file) => { assert.equal(hash(bytes(link.href)), hash(readFileSync(file)), file); assert.equal(link.name, path.basename(file)); };
try {
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  if (await page.evaluate(() => RESOLUTION_STUDY.state.playing)) await page.locator('#play-toggle').click();
  await page.evaluate(() => { RESOLUTION_STUDY.state.time = 0; RESOLUTION_STUDY.renderAll(); });
  await capture('qa-resolution-overview-1440.png', '#compare', true);
  await page.setViewportSize({ width: 1280, height: 1120 });
  await capture('qa-resolution-overview-1280.png', '#compare', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('qa-resolution-mobile.png', '#compare');
  await capture('qa-resolution-mobile-p16.png', '.comparison-card[data-option="p16"]');
  await page.setViewportSize({ width: 1440, height: 1120 });
  console.log('EARLY_SCREENSHOTS_READY');

  const manifest = await page.evaluate(() => RESOLUTION_STUDY.data.manifest);
  const sceneSize = await page.evaluate(() => [RESOLUTION_STUDY.scene.width, RESOLUTION_STUDY.scene.height]);
  assert.equal(manifest.assets.length, 8); assert.equal(manifest.options.length, 4);
  assert.equal(await page.locator('.comparison-card').count(), 4);
  assert.equal(await page.locator('#treatment option').count(), 2);
  const dataLinks = [];
  function collect(value) { if (!value || typeof value !== 'object') return; if (value.path && value.dataUrl) dataLinks.push(value); for (const child of Object.values(value)) if (typeof child === 'object') collect(child); }
  collect(manifest);
  for (const item of dataLinks) { assert.equal(hash(bytes(item.dataUrl)), hash(readFileSync(item.path))); assert.equal(item.sha256, hash(bytes(item.dataUrl))); }
  const inspected = await page.evaluate(() => {
    const S = RESOLUTION_STUDY, result = [];
    for (const asset of S.data.manifest.assets) for (const [treatment, variants] of [['simplified', asset.variants], ['resolution', asset.resolutionOnly]]) for (const [option, variant] of Object.entries(variants)) {
      const image = S.images.get(S.sourceKey(asset.id, option, treatment)), c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const x = c.getContext('2d'); x.drawImage(image, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, colors = new Set(), alphas = new Set();
      for (let i = 0; i < d.length; i += 4) { alphas.add(d[i + 3]); if (d[i + 3]) colors.add('#' + [...d.slice(i, i + 3)].map(v => v.toString(16).padStart(2, '0')).join('')); }
      const frames = [];
      for (let f = 0; f < variant.frames; f++) { const frame = x.getImageData(f * variant.frameWidth, 0, variant.frameWidth, variant.frameHeight); let h = 2166136261; for (const b of frame.data) h = Math.imul(h ^ b, 16777619); frames.push(h >>> 0); }
      result.push({ id: asset.id, kind: asset.kind, treatment, option, width: image.width, height: image.height, colors: [...colors], alphas: [...alphas].sort((a, b) => a - b), frameHashes: frames });
    }
    return result;
  });
  assert.equal(inspected.length, 56);
  for (const item of inspected) {
    const asset = manifest.assets.find(a => a.id === item.id), v = (item.treatment === 'resolution' ? asset.resolutionOnly : asset.variants)[item.option];
    assert.deepEqual([item.width, item.height], [v.width, v.height]); assert.equal(item.width, v.frameWidth * v.frames); assert.equal(item.height, v.frameHeight);
    // Current production PNGs retain partial alpha. Browser canvas decoding
    // can round their premultiplied RGB, so exact file bytes are authoritative.
    if (item.option !== 'current') {
      assert.ok(item.alphas.every(a => a === 0 || a === 255)); assert.equal(item.colors.length, v.colors);
      const p = Number(item.option.slice(1));
      assert.equal(v.frameWidth, asset.kind === 'palace' ? 2 * p : p);
      assert.equal(v.frameHeight, asset.kind === 'tower' ? 1.75 * p : asset.kind === 'palace' ? 2 * p : p);
      if (item.treatment === 'simplified') {
        const allowed = new Set(asset.kind === 'farm' ? [...manifest.palettes.grain8, ...manifest.palettes.currentSoil] : asset.kind === 'palace' ? [...manifest.palettes.wood16, ...manifest.palettes.banner3] : manifest.palettes.wood16);
        assert.ok(item.colors.every(color => allowed.has(color)), item.id + ' exact declared palette');
        assert.ok(item.colors.length <= (asset.kind === 'farm' ? 13 : asset.kind === 'palace' ? 19 : 16));
      }
    }
    if (asset.kind === 'farm') { assert.equal(item.frameHashes.length, 6); assert.ok(new Set(item.frameHashes).size > 1, 'visible farm motion survives native import: ' + item.id + '/' + item.option); }
    report.variants.push({ ...item, colors: item.colors.length, uniqueFrames: new Set(item.frameHashes).size });
  }
  pass('all56 embedded variants match files and dimensions; candidates have binary alpha and exact restricted palettes');

  for (const treatment of ['simplified', 'resolution']) {
    await page.locator('#treatment').selectOption(treatment);
    for (const asset of manifest.assets) {
      await page.locator('#asset-select').selectOption(asset.id);
      const links = await page.locator('.detail-card').evaluateAll(cards => cards.map(card => { const a = card.querySelector('.native-download'); return { option: card.dataset.option, name: a.download, href: a.href }; }));
      assert.equal(links.length, 4);
      for (const link of links) validateDataLink(link, (treatment === 'resolution' && link.option !== 'current' ? asset.resolutionOnly : asset.variants)[link.option].path);
    }
    const table = await page.locator('#source-table-body tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('a')].map(a => ({ name: a.download, href: a.href }))));
    for (let a = 0; a < manifest.assets.length; a++) for (let o = 0; o < manifest.options.length; o++) {
      const asset = manifest.assets[a], option = manifest.options[o].id;
      validateDataLink(table[a][o], (treatment === 'resolution' && option !== 'current' ? asset.resolutionOnly : asset.variants)[option].path);
    }
    const labels = await page.locator('.comparison-card .option-heading small').allTextContents();
    assert.match(labels[0], /baseline/); for (const label of labels.slice(1)) assert.match(label, treatment === 'resolution' ? /Current design/ : /Simplified redraw/);
  }
  pass('both treatments update all8 asset downloads, source table and clear comparison labels; current remains unchanged');

  const sceneChecks = await page.evaluate(() => {
    const S = RESOLUTION_STUDY, options = S.data.manifest.options.map(o => o.id), result = [];
    const canvas = document.createElement('canvas'); canvas.width = S.scene.width; canvas.height = S.scene.height; canvas.dataset.zoom = '1';
    const saved = S.scenePlacements.splice(0), terrainAndUnits = [];
    for (const option of options) { S.drawScene(canvas, option, { time: 1.75, grid: false, units: true, farms: true, highlight: false }); terrainAndUnits.push(canvas.toDataURL()); }
    S.scenePlacements.push(...saved);
    const original = CanvasRenderingContext2D.prototype.drawImage;
    for (const treatment of ['simplified', 'resolution']) {
      S.state.treatment = treatment;
      for (const option of options) {
        const calls = [];
        CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) { if (this.canvas === canvas) { const key = [...S.images].find(([, value]) => value === image)?.[0]; if (key) calls.push({ key, args }); } return original.call(this, image, ...args); };
        try { S.drawScene(canvas, option, { time: 1.75, grid: false, units: true, farms: true, highlight: false }); } finally { CanvasRenderingContext2D.prototype.drawImage = original; }
        result.push({ treatment, option, calls });
      }
    }
    S.state.treatment = 'simplified'; S.renderAll();
    return { terrainAndUnitsIdentical: new Set(terrainAndUnits).size === 1, result, placements: saved };
  });
  assert.equal(sceneChecks.terrainAndUnitsIdentical, true);
  for (const scene of sceneChecks.result) {
    const assetCalls = scene.calls.filter(c => manifest.assets.some(a => c.key.startsWith(a.id + ':')));
    assert.equal(assetCalls.length, sceneChecks.placements.length);
    for (let i = 0; i < assetCalls.length; i++) {
      const place = sceneChecks.placements[i], a = manifest.assets.find(a => a.id === place.id), call = assetCalls[i];
      assert.ok(call.key.startsWith(a.id + ':' + scene.option));
      const expected = a.kind === 'palace' ? [place.x * 32, place.y * 32, 64, 64] : a.kind === 'farm' ? [place.x * 32, place.y * 32, 32, 32] : a.kind === 'tower' ? [place.x * 32 + 1.6, place.y * 32 - 20, 28.8, 50.4] : [place.x * 32 + 1.6, place.y * 32 + 1.6, 28.8, 28.8];
      call.args.slice(-4).forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9));
    }
    assert.deepEqual(scene.calls.filter(c => c.key.startsWith('unit:')), sceneChecks.result[0].calls.filter(c => c.key.startsWith('unit:')));
  }
  report.scene = { terrainAndUnitsIdentical: true, checkedDraws: sceneChecks.result.reduce((sum, r) => sum + r.calls.length, 0) };
  pass('all8 scenes use identical physical asset bounds, tower foot anchor, unchanged terrain and exact unit draw geometry');

  await page.locator('#treatment').selectOption('simplified');
  await page.locator('#asset-select').selectOption('grain-ripe');
  const timeBefore = await page.evaluate(() => RESOLUTION_STUDY.state.time);
  const pausedBefore = await page.locator('.scene-canvas').evaluateAll(c => c.map(x => x.toDataURL()));
  await page.waitForTimeout(220);
  assert.equal(await page.evaluate(() => RESOLUTION_STUDY.state.time), timeBefore);
  assert.deepEqual(await page.locator('.scene-canvas').evaluateAll(c => c.map(x => x.toDataURL())), pausedBefore);
  const framesBefore = await page.locator('.detail-canvas').evaluateAll(c => c.map(x => Number(x.dataset.frame)));
  await page.locator('#step-frame').click();
  const framesAfter = await page.locator('.detail-canvas').evaluateAll(c => c.map(x => Number(x.dataset.frame)));
  assert.deepEqual(framesAfter, framesBefore.map(f => (f + 1) % 6));
  await page.locator('#play-toggle').click();
  await page.waitForFunction(old => RESOLUTION_STUDY.state.time > old + .8, timeBefore);
  await page.locator('#play-toggle').click();
  assert.equal(new Set(await page.locator('.scene-canvas').evaluateAll(c => c.map(x => x.dataset.time))).size, 1);
  const currentFrames = await page.locator('.detail-canvas').evaluateAll(c => c.map(x => x.dataset.frame));
  assert.equal(new Set(currentFrames).size, 1);
  for (const id of ['show-grid', 'show-units', 'show-farms']) {
    const before = await page.locator('.scene-canvas').first().evaluate(c => c.toDataURL()); await page.locator('#' + id).click();
    assert.notEqual(await page.locator('.scene-canvas').first().evaluate(c => c.toDataURL()), before); await page.locator('#' + id).click();
  }
  for (const scale of [1, 1.35, 2, 4]) {
    await page.locator('#scene-scale').selectOption(String(scale));
    const dimensions = await page.locator('.scene-canvas').evaluateAll(c => c.map(x => [x.width, x.height, x.getBoundingClientRect().width, x.getBoundingClientRect().height]));
    for (const d of dimensions) assert.deepEqual(d, [Math.round(sceneSize[0] * scale), Math.round(sceneSize[1] * scale), Math.round(sceneSize[0] * scale), Math.round(sceneSize[1] * scale)]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  pass('play/pause, selected-frame step, synchronized farm clock, three scene toggles and four actual raster zooms work');

  await page.locator('#scene-scale').selectOption('2');
  await page.evaluate(() => { RESOLUTION_STUDY.state.time = 0; RESOLUTION_STUDY.renderAll(); });
  for (const option of ['p16', 'p32']) {
    const data = await page.locator('.comparison-card[data-option="' + option + '"] .scene-canvas').evaluate(c => c.toDataURL());
    const name = 'qa-resolution-' + option + '-scene.png'; writeFileSync(path.join(output, name), bytes(data)); report.screenshots.push(name);
  }
  await page.locator('#treatment').selectOption('resolution'); await page.locator('#scene-scale').selectOption('1');
  await capture('qa-resolution-only-overview.png', '#compare', true);
  await page.locator('#treatment').selectOption('simplified');
  await page.locator('.detail-card[data-option="p16"] .inspect-native').click();
  assert.equal(await page.locator('#pixel-dialog').isVisible(), true);
  for (const view of ['frame', 'sheet']) {
    await page.locator('#pixel-view').selectOption(view);
    const native = await page.locator('#pixel-canvas').evaluate(c => [Number(c.dataset.nativeWidth), Number(c.dataset.nativeHeight)]);
    assert.deepEqual(native, [view === 'frame' ? 16 : 96, 16]);
  }
  const inspectorLink = await page.locator('#pixel-download').evaluate(a => ({ name: a.download, href: a.href }));
  validateDataLink(inspectorLink, manifest.assets.find(a => a.id === 'grain-ripe').variants.p16.path);
  const frameEvent = page.waitForEvent('download'); await page.locator('#pixel-frame-download').click(); const frameDownload = await frameEvent;
  assert.equal(await frameDownload.failure(), null); assert.match(frameDownload.suggestedFilename(), /grain-ripe-p16-frame-1\.png$/);
  const downloadedFrame = readFileSync(await frameDownload.path()); assert.deepEqual([downloadedFrame.readUInt32BE(16), downloadedFrame.readUInt32BE(20)], [16, 16]);
  await page.locator('#pixel-grid').check(); await page.locator('#pixel-zoom').selectOption('16');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'qa-resolution-mobile-inspector.png') }); report.screenshots.push('qa-resolution-mobile-inspector.png');
  await page.locator('#pixel-close').click();
  for (const scale of ['1', '1.35', '2', '4']) { await page.locator('#scene-scale').selectOption(scale); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await page.locator('#scene-scale').selectOption('1'); await capture('qa-resolution-mobile-details.png', '#details');
  const manifestEvent = page.waitForEvent('download'); await page.locator('#download-manifest').click(); const manifestDownload = await manifestEvent;
  const downloadedManifest = JSON.parse(readFileSync(await manifestDownload.path(), 'utf8'));
  assert.ok(!JSON.stringify(downloadedManifest).includes('data:image'));
  const originalManifest = JSON.parse(readFileSync('output/art-resolution-study/manifest.json', 'utf8'));
  function subset(expected, actual) { for (const [key, value] of Object.entries(expected)) { if (value && typeof value === 'object') subset(value, actual[key]); else assert.deepEqual(actual[key], value); } }
  subset(originalManifest, downloadedManifest);
  pass('native/sheet inspector, exact source downloads, native-frame export, metadata and390px layouts work');

  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true, reducedMotion: 'reduce' });
  const reducedPage = await reduced.newPage(); await reducedPage.goto(pathToFileURL(html).href); await reducedPage.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await reducedPage.evaluate(() => RESOLUTION_STUDY.state.playing), false); await reduced.close();
  assert.deepEqual(errors, []); assert.deepEqual(requests.filter(url => /^https?:/.test(url)), []);
  assert.deepEqual([...new Set(requests.filter(url => /^file:/.test(url)))], [pathToFileURL(html).href]);
  pass('offline portability, reduced-motion startup and zero runtime errors');
  report.pass = true;
} catch (error) {
  report.failure = String(error.stack || error); await page.screenshot({ path: path.join(output, 'qa-resolution-failure.png') }).catch(() => {}); throw error;
} finally {
  writeFileSync(path.join(output, 'qa-resolution-report.json'), JSON.stringify(report, null, 2) + '\n');
  await context.close(); await browser.close(); rmSync(temporary, { recursive: true, force: true });
}
