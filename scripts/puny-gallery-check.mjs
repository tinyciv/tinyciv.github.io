import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Open only an isolated copy of the standalone HTML. No development server,
// active game tab, gameplay state, or saved game is accessed by this check.
const output = path.resolve('output/puny-world-gallery');
const html = path.resolve(process.env.GALLERY_FILE || 'output/btv-puny-world-gallery.html');
const temp = mkdtempSync(path.join(tmpdir(), 'puny-gallery-qa-'));
const isolated = path.join(temp, 'gallery.html');
mkdirSync(output, { recursive: true });
copyFileSync(html, isolated);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1, offline: true });
const page = await context.newPage();
const errors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => requests.push(request.url()));
const report = { html, testedFrom: 'isolated file:// copy with browser network offline', checks, errors };
const check = (name, detail) => { checks.push({ name, pass: true, ...(detail ? { detail } : {}) }); console.log(`PASS ${name}`); };
const snapshot = selector => page.locator(selector).first().evaluate(canvas => canvas.toDataURL());
const noOverflow = async label => {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  assert.ok(dimensions.page <= dimensions.viewport, `${label}: horizontal page overflow ${JSON.stringify(dimensions)}`);
  check(`${label}: no horizontal page overflow`, dimensions);
};
const closeInspector = async () => { if (await page.locator('#inspector').isVisible()) await page.locator('#close-inspector').click(); };

try {
  await page.goto(pathToFileURL(isolated).href, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const data = await page.locator('#gallery-data').evaluate(node => JSON.parse(node.textContent));
  const catalog = data.catalog;
  const generated = data.generated;
  assert.equal(catalog.sources.length, 5);
  assert.equal(generated.items.length, 3);
  assert.equal(await page.locator('#characters-grid > article').count(), 4);
  assert.equal(await page.locator('#concept-grid > article').count(), 3);
  assert.equal(await page.locator('#source-list .source-row').count(), 8);
  for (const source of catalog.sources) {
    assert.match(source.dataUrl, /^data:image\/png;base64,/);
    const embedded = Buffer.from(source.dataUrl.split(',')[1], 'base64');
    const actual = readFileSync(source.relativePath);
    assert.equal(createHash('sha256').update(embedded).digest('hex'), createHash('sha256').update(actual).digest('hex'), source.id + ': original source pixels preserved');
  }
  check('all five original PNGs are embedded unchanged; three generated sheets present');

  const world = catalog.sources.find(source => source.id === 'world');
  const occupancy = await page.evaluate(async source => {
    const img = new Image(); img.src = source.dataUrl; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const c = canvas.getContext('2d'); c.drawImage(img, 0, 0);
    const pixels = c.getImageData(0, 0, img.width, img.height).data;
    let occupied = 0;
    for (let top = 0; top < img.height; top += 16) for (let left = 0; left < img.width; left += 16) {
      let found = false;
      for (let y = top; y < top + 16 && !found; y++) for (let x = left; x < left + 16; x++) if (pixels[(y * img.width + x) * 4 + 3] > 0) { found = true; break; }
      occupied += +found;
    }
    return { width: img.width, height: img.height, occupied, total: img.width * img.height / 256 };
  }, world);
  assert.equal(await page.locator('#tile-grid .tile').count(), occupancy.occupied);
  report.world = occupancy;
  check('world tile browser covers every nontransparent 16×16 cell', occupancy);

  // The blank-cell toggle makes complete native atlas coverage reviewable.
  const blankToggle = page.locator('#tile-blanks');
  await blankToggle.check();
  assert.equal(await page.locator('#tile-grid .tile').count(), occupancy.total);
  await blankToggle.uncheck();
  await page.locator('#tile-search').fill('0,0');
  assert.ok(await page.locator('#tile-grid .tile').count() > 0);
  await page.locator('#tile-grid .tile').first().click();
  assert.ok(await page.locator('#inspector-download').getAttribute('download'));
  await closeInspector();
  await page.locator('#tile-search').fill('a phrase that cannot match a source tile');
  assert.equal(await page.locator('#tile-grid .tile').count(), 0);
  await page.locator('#tile-search').fill('');
  await page.locator('#tile-usage').selectOption('used');
  const usedCount = await page.locator('#tile-grid .tile').count();
  assert.ok(usedCount > 0 && usedCount < occupancy.occupied);
  await page.locator('#tile-usage').selectOption('all');
  check('blank cells, source coordinates, search, usage filtering and crop inspection');

  await page.locator('#toggle-play').click();
  assert.equal(await page.locator('#toggle-play').getAttribute('aria-pressed'), 'false');
  await page.locator('#character-action').selectOption('walk');
  const idleHash = await snapshot('#characters-grid canvas');
  await page.waitForTimeout(200);
  assert.equal(await snapshot('#characters-grid canvas'), idleHash, 'paused artwork is stable');
  const directions = await page.locator('#directions button').allTextContents();
  assert.deepEqual(directions, ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']);
  const directionHashes = [];
  for (const direction of directions) {
    await page.locator('#directions').getByRole('button', { name: direction, exact: true }).click();
    directionHashes.push(await page.locator('#characters-grid canvas').first().evaluate(canvas => canvas.toDataURL()));
  }
  assert.ok(new Set(directionHashes).size >= 5, 'direction selections change the actual source pixels');
  const actions = await page.locator('#character-action option').evaluateAll(options => options.map(option => option.value));
  for (const action of actions) {
    await page.locator('#character-action').selectOption(action);
    const nonempty = await page.locator('#characters-grid canvas').evaluateAll(canvases => canvases.map(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)));
    assert.ok(nonempty.every(Boolean), `${action}: original characters have visible artwork`);
  }
  for (const character of catalog.characters) {
    const columns = new Set(character.animations.flatMap(animation => animation.columns));
    assert.equal(columns.size, 24, `${character.id}: complete source state coverage`);
  }
  check('all original character actions and eight distinct direction selections', { actions, directions });

  await page.locator('#character-action').selectOption('walk');
  await page.locator('#directions').getByRole('button', { name: 'S', exact: true }).click();
  const beforeStep = await page.locator('#characters-grid .frame-caption').first().textContent();
  await page.locator('#step-forward').click();
  assert.notEqual(await page.locator('#characters-grid .frame-caption').first().textContent(), beforeStep, 'manual frame control advances artwork');
  await page.locator('#speed').selectOption('2');
  await page.locator('#scale').selectOption('1.25');
  const large = await page.locator('#characters-grid canvas').first().evaluate(canvas => canvas.toDataURL());
  await page.locator('#scale').selectOption('0.75');
  const small = await page.locator('#characters-grid canvas').first().evaluate(canvas => canvas.toDataURL());
  assert.notEqual(large, small, 'scale selector changes rendered pixel size');
  await page.locator('#scale').selectOption('1');
  await page.locator('#background').selectOption('dark');
  assert.equal(await page.locator('body').getAttribute('data-background'), 'dark');
  await page.locator('#background').selectOption('checker');
  const movingBefore = await page.locator('#characters-grid canvas').first().evaluate(canvas => canvas.toDataURL());
  await page.locator('#toggle-play').click();
  await page.waitForFunction(before => document.querySelector('#characters-grid canvas').toDataURL() !== before, movingBefore);
  await page.locator('#toggle-play').click();
  await page.locator('#speed').selectOption('1');
  check('pause, resume, speed, manual frame, backdrop and artwork scale controls');

  assert.equal(await page.locator('#world-animations .water-card').count(), catalog.worldAnimations.length);
  assert.equal(catalog.worldAnimations.length, 12);
  check('all twelve bundled water animation groups are visible');

  report.generated = [];
  for (const item of generated.items) {
    assert.ok(item.frameSpace, `${item.id}: generated frames use a common canvas and anchor`);
    const embedded = Buffer.from(item.dataUrl.split(',')[1], 'base64');
    assert.equal(createHash('sha256').update(embedded).digest('hex'), createHash('sha256').update(readFileSync(path.join(output, 'generated', item.path))).digest('hex'), item.id + ': generated PNG is embedded unchanged');
    const selector = page.locator(`#concept-${item.id}`);
    assert.equal(await selector.locator('option').count(), 4);
    const animations = [];
    for (let index = 0; index < item.animations.length; index++) {
      await selector.selectOption(String(index));
      const card = selector.locator('xpath=ancestor::article');
      assert.equal(await card.locator('.animation-film canvas').count(), 4);
      const hashes = await card.locator('.animation-film canvas').evaluateAll(canvases => canvases.map(canvas => canvas.toDataURL()));
      assert.ok(new Set(hashes).size >= 2, `${item.id}/${index}: sequence contains changing artwork`);
      const bounds = await card.locator('.animation-film canvas').evaluateAll(canvases => canvases.map(canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width, right = 0, top = canvas.height, bottom = 0;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] > 100) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        return { left, right, top, bottom, width: canvas.width, height: canvas.height };
      }));
      for (const box of bounds) assert.ok(box.left > 1 && box.right < box.width - 2 && box.top > 1 && box.bottom < box.height - 2, `${item.id}/${index}: anchored frame is contained without edge clipping`);
      animations.push({ label: item.animations[index].label, uniqueFrames: new Set(hashes).size, bounds });
    }
    report.generated.push({ id: item.id, animations });
    await selector.selectOption('0');
  }
  check('all three new studies expose four playable four-frame sequences', report.generated);

  // Verify every full-sheet inspector after a crop, including actual native
  // dimensions, adjustable grid and zoom, and usable downloads.
  for (let index = 0; index < 8; index++) {
    await page.locator('#source-list .source-row').nth(index).getByRole('button', { name: 'Inspect' }).click();
    await page.locator('#sheet-zoom').fill('1');
    await page.locator('#sheet-zoom').dispatchEvent('input');
    const source = [...catalog.sources, ...generated.items][index];
    const size = await page.locator('#modal-canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height, inlineWidth: canvas.style.width, inlineHeight: canvas.style.height }));
    assert.equal(size.width, source.width);
    assert.equal(size.height, source.height);
    assert.equal(size.inlineWidth, '');
    assert.equal(size.inlineHeight, '');
    await page.locator('#show-grid').uncheck();
    await page.locator('#show-grid').check();
    await closeInspector();
  }
  const downloads = await page.locator('a[download]:not(#concept-manifest)').evaluateAll(anchors => anchors.map(anchor => ({ name: anchor.download, embedded: anchor.href.startsWith('data:image/png;base64,') })));
  assert.ok(downloads.length >= 16);
  assert.ok(downloads.every(download => download.name && download.embedded));
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#atlas-download').click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'overworld.png');
  assert.equal(await download.failure(), null);
  check('all eight full-sheet inspectors, cell grids, zoom and PNG downloads', { downloadAnchors: downloads.length });
  const metadata = await page.locator('#concept-manifest').evaluate(async anchor => ({ name: anchor.download, data: await (await fetch(anchor.href)).json() }));
  assert.match(metadata.name, /\.json$/);
  assert.equal(metadata.data.items.length, 3);
  assert.ok(metadata.data.items.every(item => !item.dataUrl && item.frameSpace && item.animations.length === 4));
  check('portable JSON download includes frame crops and anchors without duplicate embedded PNGs');

  await noOverflow('desktop 1440px');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'qa-desktop.png') });
  await page.locator('#concepts').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'qa-new-studies.png') });
  for (const item of generated.items) await page.locator(`#concept-${item.id}`).selectOption('3');
  // Capture the release/trade/strong-row filmstrips together for visual QA.
  for (let step = 0; step < 4 && !(await page.locator('#concept-grid .frame-caption').first().textContent()).includes('03 /'); step++) await page.locator('#step-forward').click();
  await page.locator('#concepts').evaluate(section => section.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, 'qa-new-actions.png') });
  await page.locator('#step-forward').click();
  await page.locator('#concepts').evaluate(section => section.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, 'qa-new-actions-recovery.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await noOverflow('mobile 390px');
  await page.screenshot({ path: path.join(output, 'qa-mobile.png') });
  await page.locator('#concepts').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'qa-mobile-studies.png') });
  await page.locator('#atlas-inspect').click();
  await noOverflow('mobile inspector');
  await page.screenshot({ path: path.join(output, 'qa-mobile-inspector.png') });
  await closeInspector();

  const externalRequests = requests.filter(url => /^https?:/.test(url));
  const fileRequests = requests.filter(url => url.startsWith('file:'));
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(fileRequests, [pathToFileURL(isolated).href]);
  assert.deepEqual(errors, []);
  report.requestCounts = { external: externalRequests.length, file: fileRequests.length };
  report.screenshots = ['qa-desktop.png', 'qa-new-studies.png', 'qa-new-actions.png', 'qa-new-actions-recovery.png', 'qa-mobile.png', 'qa-mobile-studies.png', 'qa-mobile-inspector.png'];
  check('standalone file works without network requests or sibling files; no runtime errors');
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.failure = String(error.stack || error);
  await page.screenshot({ path: path.join(output, 'qa-failure.png') }).catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(output, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await context.close();
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
