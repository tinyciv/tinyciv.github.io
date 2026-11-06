import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const folder = 'scratch/2026-11-01-warcamp-tight';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1060 }, deviceScaleFactor: 1 });
const checks = [], errors = [], network = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
function check(name, pass, detail) {
  checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
}

try {
  await page.goto(pathToFileURL(resolve('output/marauder-camp-review.html')).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30000 });
  const layouts = await page.evaluate(() => window.__marauderReview.layouts);
  check('six distinct camp plans load offline', layouts.length === 6 && new Set(layouts.map(layout => layout.id)).size === 6);
  const assets = await page.evaluate(() => Object.entries(window.__marauderReview.images).map(([id, image]) => ({
    id, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, embedded: image.src?.startsWith('data:') ?? true,
  })));
  check('all native sprite sheets are embedded and decoded', assets.length > 0 && assets.every(asset => asset.width > 0 && asset.height > 0 && asset.embedded), assets);
  check('review contains only requested sprite sheets', assets.every(asset => ['world', 'palisades', 'lookouts', 'signs'].includes(asset.id)), assets.map(asset => asset.id));
  check('layout data contains only tents, defenses, signs and roads', layouts.every(layout => ['buildings', 'props', 'units', 'trees'].every(key => !layout[key]?.length)));
  const audits = layouts.map(layout => {
    const key = (x, y) => y * layout.width + x;
    const inside = (x, y) => x >= 0 && y >= 0 && x < layout.width && y < layout.height;
    const walls = new Set(layout.walls.map(point => key(point.x, point.y)));
    const gates = new Set(layout.gates.map(point => key(point.x, point.y)));
    const towers = new Set(layout.towers.map(point => key(point.x, point.y)));
    const defensiveCells = new Set([...walls, ...gates]);
    const thickWallBlocks = [];
    for (let y = 0; y < layout.height - 1; y++) for (let x = 0; x < layout.width - 1; x++)
      if ([[x,y],[x+1,y],[x,y+1],[x+1,y+1]].every(([px,py]) => defensiveCells.has(key(px,py)))) thickWallBlocks.push({x,y});
    const sites = new Set(), overlaps = [];
    for (const tent of layout.tents) {
      const cell = key(tent.x, tent.y);
      if (sites.has(cell) || walls.has(cell) || gates.has(cell) || towers.has(cell)) overlaps.push({ tent });
      sites.add(cell);
    }
    const signs = new Set(), signOverlaps = [];
    for (const sign of layout.signs) {
      const cell = key(sign.x, sign.y);
      if (sites.has(cell) || walls.has(cell) || gates.has(cell) || towers.has(cell) || signs.has(cell)) signOverlaps.push(sign);
      signs.add(cell);
    }
    const blocked = new Set([...walls, ...sites, ...towers, ...signs]);
    const costs = Array(layout.width * layout.height).fill(Infinity), queue = [];
    for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) if (x === 0 || y === 0 || x === layout.width - 1 || y === layout.height - 1) {
      const cell = key(x, y); if (!blocked.has(cell)) { costs[cell] = 0; queue.push(cell); }
    }
    while (queue.length) {
      queue.sort((a, b) => costs[b] - costs[a]);
      const cell = queue.pop(), x = cell % layout.width, y = Math.floor(cell / layout.width);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (!inside(x + dx, y + dy)) continue;
        const next = key(x + dx, y + dy), cost = costs[cell] + Number(gates.has(next));
        if (!blocked.has(next) && cost < costs[next]) { costs[next] = cost; queue.push(next); }
      }
    }
    const entrances = layout.tents.map(tent => ({ tier: tent.tier, gatesCrossed: costs[key(tent.x, tent.y + 1)] }));
    return { id: layout.id, width: layout.width, height: layout.height, tierCount: layout.tierCount,
      previousWidth: layout.previousWidth, previousHeight: layout.previousHeight, areaFraction: layout.width * layout.height / (layout.previousWidth * layout.previousHeight),
      wallCount: walls.size, gates: gates.size, towers: towers.size, tents: sites.size, signs: signs.size, signOverlaps, thickWallBlocks,
      overlaps, entrances, gateWallOverlap: [...gates].filter(cell => walls.has(cell)),
      gateTowerOverlap: [...gates].filter(cell => towers.has(cell)),
      unfortifiedTowers: [...towers].filter(cell => !walls.has(cell)),
      blockedPaths: layout.paths.filter(point => blocked.has(key(point.x, point.y))),
      distinctTiers: [...new Set(layout.walls.map(point => point.tier))] };
  });
  check('camp footprints remain compact relative to their previous designs', audits.every(a => a.areaFraction <= (a.id === '3B' ? .65 : .4)), audits.map(({ id, width, height, previousWidth, previousHeight, areaFraction }) => ({ id, width, height, previousWidth, previousHeight, areaFraction })));
  const warcamp = audits.find(a => a.id === '3B');
  check('the selected warcamp is substantially smaller than its previous twenty-five-tile plan', warcamp.width * warcamp.height <= 625 * .65, warcamp);
  check('all warcamp walls are single-cell runs without solid two-by-two blocks', warcamp.thickWallBlocks.length === 0, warcamp.thickWallBlocks);
  check('all six layouts avoid solid two-by-two defense blocks', audits.every(a => !a.thickWallBlocks.length), audits.map(a => ({id:a.id, thickWallBlocks:a.thickWallBlocks})));
  check('compact camps retain multiple defensive tiers', audits.every(a => a.width >= 15 && a.height >= 15 && a.tierCount >= 2 && a.distinctTiers.length === a.tierCount), audits);
  check('all gates are open, towers stand on walls, and tents do not overlap structures', audits.every(a => !a.overlaps.length && !a.gateWallOverlap.length && !a.gateTowerOverlap.length && !a.unfortifiedTowers.length), audits);
  check('every tent door is reachable from outside through walkable gates', audits.every(a => a.entrances.every(entry => Number.isFinite(entry.gatesCrossed))), audits.map(a => ({ id: a.id, entrances: a.entrances })));
  check('defensive tiers require passing their gates with no gap bypasses', audits.every(a => a.entrances.every(entry => entry.gatesCrossed >= entry.tier)
    && a.entrances.some(entry => entry.gatesCrossed >= a.tierCount)), audits.map(a => ({ id: a.id, entrances: a.entrances })));
  check('designated roads stay clear of tents, signs and solid defenses', audits.every(a => !a.blockedPaths.length), audits.map(a => ({ id: a.id, blockedPaths: a.blockedPaths })));
  check('signs occupy separate cells clear of tents and defenses', audits.every(a => !a.signOverlaps.length), audits.map(a => ({ id: a.id, signOverlaps: a.signOverlaps })));
  await writeFile(`${folder}/layout-audit.json`, JSON.stringify(audits, null, 2));
  await page.screenshot({ path: `${folder}/gallery-desktop.png`, fullPage: true });
  await page.locator('#overview').screenshot({ path: 'output/marauder-camp-overview.png' });
  await page.locator('#overview').screenshot({ path: `${folder}/gallery-overview.png` });
  const drawings = [];
  for (let index = 0; index < layouts.length; index++) {
    await page.locator(`#camp-tabs button[data-index="${index}"]`).click();
    await page.locator('#zoom').selectOption('fit');
    drawings.push(await page.locator('#scene').evaluate(canvas => canvas.toDataURL()));
    await page.locator('#scene').screenshot({ path: `${folder}/camp-${layouts[index].id}.png` });
    check(`${layouts[index].id}: variant control opens the selected camp`, await page.evaluate(id => {
      const review = window.__marauderReview, current = review.current;
      return (typeof current === 'number' ? review.layouts[current].id : typeof current === 'string' ? current : current.id ?? review.layouts[current.index].id) === id;
    }, layouts[index].id));
  }
  check('all six variants produce different scenes', new Set(drawings).size === 6);
  await page.locator('#camp-tabs button[data-index="1"]').click();
  const image = () => page.locator('#scene').evaluate(canvas => canvas.toDataURL());
  const allTiers = await image();
  await page.locator('#layers').selectOption('2');
  const middleTiers = await image();
  await page.locator('#layers').selectOption('3');
  const innerTier = await image();
  check('tier isolation exposes different defensive layers', new Set([allTiers, middleTiers, innerTier]).size === 3);
  await page.locator('#layers').selectOption('all');
  for (const id of ['defenses', 'labels', 'grid']) {
    const before = await image(), checked = await page.locator(`#${id}`).isChecked();
    await page.locator(`#${id}`).setChecked(!checked);
    check(`${id}: display toggle changes the rendered scene`, before !== await image());
    await page.locator(`#${id}`).setChecked(checked);
  }
  await page.locator('#zoom').selectOption('1');
  const width1 = await page.locator('#scene').evaluate(canvas => canvas.getBoundingClientRect().width);
  await page.locator('#zoom').selectOption('2');
  const width2 = await page.locator('#scene').evaluate(canvas => canvas.getBoundingClientRect().width);
  check('integer zoom preserves a twofold scale change', Math.abs(width2 - width1 * 2) < 1, { width1, width2 });
  await page.locator('#zoom').selectOption('fit');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#save').click();
  const download = await downloadEvent, stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const png = Buffer.concat(chunks), dimensions = await page.locator('#scene').evaluate(canvas => [canvas.width, canvas.height]);
  check('PNG export contains the full native-resolution camp', png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && png.readUInt32BE(16) === dimensions[0] && png.readUInt32BE(20) === dimensions[1], { width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
  await writeFile(`${folder}/downloaded-camp.png`, png);
  await page.screenshot({ path: `${folder}/detail-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  check('mobile page has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('mobile gallery retains one header and all six overview cards', await page.locator('h1').count() === 1 && await page.locator('#overview .overview-card').count() === 6);
  await page.screenshot({ path: `${folder}/gallery-mobile-viewport.png` });
  await page.locator('.details').screenshot({ path: `${folder}/details-mobile.png` });
  await page.screenshot({ path: `${folder}/gallery-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page.goto(pathToFileURL(resolve('output/marauder-warcamp-tight.html')).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check('focused review contains only the revised warcamp', await page.evaluate(() => {
    const review = window.__marauderReview;
    return review.layouts.length === 1 && review.layouts[0].id === '3B' && document.querySelector('#scene').dataset.id === '3B';
  }));
  await page.locator('#grid').uncheck();
  await page.locator('#scene').screenshot({ path: 'output/marauder-warcamp-tight.png' });
  await page.locator('#scene').screenshot({ path: `${folder}/warcamp-tight.png` });
  const plain = await image();
  await page.locator('#grid').check();
  check('focused tile grid visibly demonstrates wall thickness', plain !== await image());
  await page.locator('#scene').screenshot({ path: 'output/marauder-warcamp-tight-grid.png' });
  await page.locator('#scene').screenshot({ path: `${folder}/warcamp-tight-grid.png` });
  await page.screenshot({ path: `${folder}/focused-grid-desktop.png` });
  await page.locator('#grid').uncheck();
  await page.screenshot({ path: `${folder}/focused-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  check('focused mobile review has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${folder}/focused-mobile.png` });
  check('standalone review makes no network requests', network.length === 0, network);
  check('no browser runtime errors', errors.length === 0, errors);
} finally {
  await writeFile(`${folder}/browser-checks.json`, JSON.stringify({ checks, errors, network }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, passed: checks.filter(check => check.pass).length, errors, network }, null, 2));
  await browser.close();
}
