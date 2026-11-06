import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFarmBoundary } from '../output/puny-world-gallery/farm-structures/connected-fences.mjs';

// Isolated file-only QA. Never accesses a game server, active game, or save.
const output = path.resolve('output/puny-world-gallery');
const nativeDir = path.join(output, 'farm-structures/native');
const temp = mkdtempSync(path.join(tmpdir(), 'puny-fences-qa-'));
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
const report = { testedFrom: 'isolated offline file:// copy', checks, parts: [], topologies: [], comparisons: [], screenshots: [], errors };
const check = name => { checks.push({ name, pass: true }); console.log('PASS ' + name); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const edgeKey = vertices => vertices.map(v => v.join(',')).sort().join('|');
const cases = [
  { name: 'single', cells: ['1,1'], edges: 4, posts: 4, components: 1 },
  { name: 'block', cells: ['1,1', '2,1', '1,2', '2,2'], edges: 8, posts: 8, components: 1 },
  { name: 'ell', cells: ['1,1', '1,2', '2,2'], edges: 8, posts: 8, components: 1 },
  { name: 'ring', cells: ['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2'], edges: 16, posts: 16, components: 1 },
  { name: 'diagonal', cells: ['0,0', '1,1'], edges: 8, posts: 7, components: 2 },
  { name: 'separated', cells: ['0,0', '2,0'], edges: 8, posts: 8, components: 2 },
  { name: 'full', cells: Array.from({ length: 16 }, (_, i) => `${i % 4},${Math.floor(i / 4)}`), edges: 16, posts: 16, components: 1 },
  { name: 'empty', cells: [], edges: 0, posts: 0, components: 0 },
];

// Independent topology oracle: add all four geometric edges from every tile;
// remove pairs that occupy the same geometric edge. The remaining endpoints
// define posts, including one shared physical post at a diagonal contact.
function expectedBoundary(cells) {
  const candidates = new Map();
  for (const key of cells) {
    const [x, y] = key.split(',').map(Number);
    for (const vertices of [[[x, y], [x + 1, y]], [[x + 1, y], [x + 1, y + 1]], [[x, y + 1], [x + 1, y + 1]], [[x, y], [x, y + 1]]]) {
      const key = edgeKey(vertices);
      if (candidates.has(key)) candidates.delete(key); else candidates.set(key, vertices);
    }
  }
  const edges = [...candidates.values()];
  return { edges, posts: [...new Set(edges.flatMap(vertices => vertices.map(v => v.join(','))))].map(key => key.split(',').map(Number)) };
}

async function screenshot(name, selector = '#farms') {
  await page.locator(selector).evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, name) }); report.screenshots.push(name);
}

try {
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const manifest = await page.evaluate(() => DATA.farmOverlays);
  assert.equal(manifest.mode, 'connected-fences');
  assert.equal(manifest.items.length, 4);
  assert.equal(await page.locator('.farm-cell').count(), 16);
  assert.equal(await page.locator('.farm-download').count(), 4);
  for (const item of manifest.items) {
    assert.equal(hash(Buffer.from(item.dataUrl.split(',')[1], 'base64')), hash(readFileSync(path.join(output, 'farm-structures', item.path))), `${item.id}: original image retained unchanged`);
    const part = await page.evaluate(id => {
      const canvas = farmNativeLayers.get(id).canvas;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const alphas = new Set(), rows = [], columns = []; let opaque = 0;
      for (let y = 0; y < canvas.height; y++) {
        let row = 0;
        for (let x = 0; x < canvas.width; x++) { const a = data[(y * canvas.width + x) * 4 + 3]; alphas.add(a); row += +(a > 0); }
        opaque += row; rows.push(row);
      }
      for (let x = 0; x < canvas.width; x++) { let column = 0; for (let y = 0; y < canvas.height; y++) column += +(data[(y * canvas.width + x) * 4 + 3] > 0); columns.push(column); }
      return { id, width: canvas.width, height: canvas.height, alphaValues: [...alphas].sort((a, b) => a - b), opaque, transparent: canvas.width * canvas.height - opaque, rows, columns, dataUrl: canvas.toDataURL('image/png') };
    }, item.id);
    assert.equal(part.width, item.nativeWidth); assert.equal(part.height, item.nativeHeight);
    assert.deepEqual(part.alphaValues, [0, 255], `${item.id}: binary transparency`);
    assert.ok(part.opaque > 4 && part.transparent > 0, `${item.id}: visible art and transparent gaps`);
    if (item.id === 'furrows') {
      assert.ok(part.transparent > 500, 'furrows leave most ground uncovered');
      assert.ok(part.rows.filter(value => value === 0).length >= 8, 'furrow rows have multiple fully transparent separating rows');
      assert.ok(part.rows.filter(value => value > 0).length >= 3, 'furrows contain multiple visible rows');
    }
    writeFileSync(path.join(nativeDir, item.id + '.png'), Buffer.from(part.dataUrl.split(',')[1], 'base64'));
    delete part.dataUrl;
    report.parts.push(part);
  }
  check('four native transparent parts exported with correct dimensions, binary alpha and open furrow gaps');

  for (const fixture of cases) {
    const expected = expectedBoundary(fixture.cells);
    const actual = await page.evaluate(cells => extractFarmTopology(cells), fixture.cells);
    const portable = buildFarmBoundary(fixture.cells.map(key => { const [x, y] = key.split(',').map(Number); return { x, y }; }));
    assert.deepEqual(portable.edges.map(edge => edgeKey(edge.vertices)).sort(), expected.edges.map(edgeKey).sort(), fixture.name + ': portable assembler matches independent boundary');
    assert.deepEqual(portable.posts.map(post => `${post.x},${post.y}`).sort(), expected.posts.map(v => v.join(',')).sort(), fixture.name + ': portable posts match independent vertices');
    assert.equal(portable.components, fixture.components, fixture.name + ': portable connected components');
    assert.equal(actual.edges.length, fixture.edges, fixture.name + ': expected rail count');
    assert.equal(actual.posts.length, fixture.posts, fixture.name + ': expected post count');
    assert.equal(actual.components, fixture.components, fixture.name + ': four-connected components');
    const actualKeys = actual.edges.map(edge => edgeKey(edge.vertices));
    assert.equal(new Set(actualKeys).size, actualKeys.length, fixture.name + ': no repeated rail');
    assert.deepEqual(actualKeys.sort(), expected.edges.map(edgeKey).sort(), fixture.name + ': boundary edges only; every shared internal edge absent');
    const postKeys = actual.posts.map(post => `${post.x},${post.y}`);
    assert.equal(new Set(postKeys).size, postKeys.length, fixture.name + ': each vertex has one post');
    assert.deepEqual(postKeys.sort(), expected.posts.map(v => v.join(',')).sort(), fixture.name + ': exact boundary vertices');
    report.topologies.push({ name: fixture.name, tiles: fixture.cells.length, edges: actual.edges.length, posts: actual.posts.length, components: actual.components });

    for (const terrain of ['grass', 'sand', 'shore']) {
      await page.locator('#farm-terrain').selectOption(terrain);
      await page.evaluate(cells => { farmCells = new Set(cells); renderFarmComparison(); }, fixture.cells);
      const result = await page.evaluate(async ({ cells, expected, terrain }) => {
        const before = document.querySelector('#farm-before').getContext('2d').getImageData(0, 0, 160, 160).data;
        const after = document.querySelector('#farm-after').getContext('2d').getImageData(0, 0, 160, 160).data;
        const mask = document.createElement('canvas'); mask.width = mask.height = 160;
        const mc = mask.getContext('2d'); mc.imageSmoothingEnabled = false;
        const draw = (id, x, y) => { const p = farmNativeLayers.get(id); mc.drawImage(p.canvas, 16 + x * 32 - p.item.anchorX, 16 + y * 32 - p.item.anchorY); };
        for (const key of cells) { const [x, y] = key.split(',').map(Number); draw('furrows', x, y); }
        for (const vertices of expected.edges) {
          const horizontal = vertices[0][1] === vertices[1][1];
          draw(horizontal ? 'fence-horizontal' : 'fence-vertical', Math.min(vertices[0][0], vertices[1][0]), Math.min(vertices[0][1], vertices[1][1]));
        }
        for (const [x, y] of expected.posts) draw('fence-post', x, y);
        const support = mc.getImageData(0, 0, 160, 160).data;
        const img = new Image(); img.src = document.querySelector('#farm-after').dataset.overlayDataUrl; await img.decode();
        const actualCanvas = document.createElement('canvas'); actualCanvas.width = actualCanvas.height = 160;
        const ac = actualCanvas.getContext('2d'); ac.drawImage(img, 0, 0);
        const overlay = ac.getImageData(0, 0, 160, 160).data;
        let exposed = 0, exposedChanged = 0, painted = 0, water = 0, waterChanged = 0, supportErrors = 0, blendingErrors = 0;
        for (let i = 0; i < 160 * 160; i++) {
          const k = i * 4;
          const isWater = terrain === 'shore' && before[k + 1] > before[k] + 20 && before[k + 2] > before[k] + 20;
          const expectedAlpha = isWater ? 0 : support[k + 3];
          if (overlay[k + 3] !== expectedAlpha) supportErrors++;
          const same = [0, 1, 2, 3].every(ch => before[k + ch] === after[k + ch]);
          if (!expectedAlpha) { exposed++; if (!same) exposedChanged++; }
          else { painted++; if (![0, 1, 2, 3].every(ch => overlay[k + ch] === after[k + ch])) blendingErrors++; }
          if (isWater) { water++; if (!same) waterChanged++; }
        }
        return { terrain, exposed, exposedChanged, painted, water, waterChanged, supportErrors, blendingErrors };
      }, { cells: fixture.cells, expected, terrain });
      assert.equal(result.supportErrors, 0, `${fixture.name}/${terrain}: only expected furrows and perimeter parts paint pixels`);
      assert.equal(result.exposedChanged, 0, `${fixture.name}/${terrain}: all exposed terrain bytes identical`);
      assert.equal(result.blendingErrors, 0, `${fixture.name}/${terrain}: ordinary source-over part colors`);
      assert.equal(result.waterChanged, 0, `${fixture.name}/${terrain}: no water pixels changed`);
      if (fixture.cells.length && terrain !== 'shore') assert.ok(result.painted > 0);
      if (terrain === 'shore') assert.ok(result.water > 1000);
      if (fixture.name === 'block' && terrain === 'shore') assert.ok(result.painted > 100, 'shore fixture visibly shows land field as well as protected water');
      await page.locator('#farm-show').uncheck();
      assert.ok(await page.evaluate(() => document.querySelector('#farm-before').toDataURL() === document.querySelector('#farm-after').toDataURL()), `${fixture.name}/${terrain}: hiding fields restores exact ground`);
      await page.locator('#farm-show').check();
      report.comparisons.push({ name: fixture.name, ...result });
    }
  }
  check('eight independent topology cases have correct rails, unique posts, holes, disconnected patches and no internal fences');
  check('portable connected-fences module matches the independent boundary oracle and gallery geometry');
  check('24 topology/terrain composites match independent part support; exposed ground and clipped water remain byte-identical');

  await page.locator('[data-farm-preset="clear"]').click();
  assert.equal(await page.locator('#farm-tile-count').textContent(), '0');
  await page.locator('.farm-cell[data-cell="1,1"]').click();
  assert.equal(await page.locator('#farm-edge-count').textContent(), '4');
  await page.locator('.farm-cell[data-cell="2,1"]').click();
  assert.equal(await page.locator('#farm-edge-count').textContent(), '6');
  assert.equal(await page.locator('#farm-post-count').textContent(), '6');
  await page.locator('.farm-cell[data-cell="1,1"]').click();
  assert.equal(await page.locator('#farm-edge-count').textContent(), '4');
  await page.locator('#farm-gridlines').uncheck();
  assert.ok(await page.locator('#farm-cell-grid').evaluate(grid => grid.classList.contains('hide-grid')));
  await page.locator('#farm-gridlines').check();
  await page.locator('[data-farm-preset="block"]').click();
  await page.locator('#farm-clip').uncheck();
  assert.ok(Number(await page.locator('#farm-after').getAttribute('data-changed-water-pixels')) > 0, 'unclipped fixture crosses meaningful water pixels');
  await page.locator('#farm-clip').check();
  assert.equal(await page.locator('#farm-after').getAttribute('data-changed-water-pixels'), '0');
  check('editor adds/removes tiles and shared boundaries; presets, grid and land clipping controls update correctly');

  for (let i = 0; i < 4; i++) {
    const item = manifest.items[i], card = page.locator('.farm-card').nth(i);
    const href = await card.locator('.farm-download').getAttribute('href');
    assert.equal(hash(Buffer.from(href.split(',')[1], 'base64')), hash(readFileSync(path.join(nativeDir, item.id + '.png'))));
    const original = await card.locator('.farm-raw-download').getAttribute('href');
    assert.equal(hash(Buffer.from(original.split(',')[1], 'base64')), hash(readFileSync(path.join(output, 'farm-structures', item.path))));
    await card.locator('.farm-inspect').click();
    assert.ok(await page.locator('#inspector').isVisible());
    await page.locator('#close-inspector').click();
  }
  const downloadEvent = page.waitForEvent('download');
  await page.locator('.farm-download').first().click();
  assert.equal(await (await downloadEvent).failure(), null);
  check('native and original PNG downloads match files; all alpha inspectors open');

  await page.locator('#farm-terrain').selectOption('grass');
  await page.locator('[data-farm-preset="block"]').click();
  await page.locator('#farm-gridlines').uncheck();
  await screenshot('qa-farm-structures-desktop.png');
  await page.locator('[data-farm-preset="ell"]').click();
  await screenshot('qa-farm-structures-ell.png');
  await page.locator('#farm-terrain').selectOption('shore');
  await page.locator('[data-farm-preset="block"]').click();
  await screenshot('qa-farm-structures-shore.png');
  await screenshot('qa-farm-structures-parts.png', '#farm-grid');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1150 });
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, `${width}px: no page overflow`);
  }
  await screenshot('qa-farm-structures-mobile.png');
  await screenshot('qa-farm-structures-mobile-field.png', '#farm-cell-grid');
  await screenshot('qa-farm-structures-mobile-parts.png', '#farm-grid');
  check('desktop and390px mobile layouts have no horizontal overflow');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests.filter(url => /^https?:/.test(url)), []);
  assert.deepEqual(requests.filter(url => /^file:/.test(url)), [pathToFileURL(html).href]);
  check('standalone page runs offline without sibling files, external requests or runtime errors');
  report.pass = true;
} catch (error) {
  report.pass = false; report.failure = String(error.stack || error);
  await page.screenshot({ path: path.join(output, 'qa-farm-structures-failure.png') }).catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(output, 'qa-farm-structures-report.json'), JSON.stringify(report, null, 2) + '\n');
  await context.close(); await browser.close(); rmSync(temp, { recursive: true, force: true });
}
