import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const output = 'scratch/2026-10-30-world-generation';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } });
const errors = [], network = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
try {
  await page.goto(pathToFileURL(resolve('output/world-generation-lab.html')).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 60000 });
  check('three world modes and five feature samples render', await page.locator('.map-card').count() === 3 && await page.locator('.feature').count() === 5);
  const sceneInfo = await page.evaluate(() => [...window.__worldLab.scenes].map(([id, scene]) => ({ id, ...window.__worldLab.stats(scene.world),
    mode: scene.world.generationStyle, lakes: [...new Set(scene.world.tiles.filter(tile => tile.lakeShape).map(tile => tile.lakeShape))] })));
  check('each world uses its requested production mode', sceneInfo.slice(0, 3).every(scene => scene.id === scene.mode), sceneInfo.slice(0, 3));
  check('showcases include real hills, layered mountains, passes, and freshwater', sceneInfo[3].hills > 0 && sceneInfo[4].hills > 0
    && sceneInfo[5].mountains > 0 && sceneInfo[5].passes > 0 && sceneInfo[6].lakes.includes('compact') && sceneInfo[7].lakes.includes('snaky'), sceneInfo.slice(3));
  check('mountain showcase includes actual wooded upper floors', sceneInfo[5].woodedMountains > 0, { woods: sceneInfo[5].woods, woodedMountains: sceneInfo[5].woodedMountains });
  const reliefGeometry = await page.evaluate(() => {
    const lab = window.__worldLab, hills = lab.hillShapes(lab.scenes.get('grass-hills').world);
    const tiny = [2, 3, 4].map(length => hills.find(hill => hill.rectangular && Math.min(hill.width, hill.height) === 2 && Math.max(hill.width, hill.height) === length));
    const mountain = lab.scenes.get('mountain-range').world, sections = new Map();
    mountain.tiles.forEach((tile, i) => { if (tile.relief === 'mountains') { const x = i % mountain.width; sections.set(x, (sections.get(x) ?? 0) + 1); } });
    return { tiny, nonrectangular: hills.filter(hill => !hill.rectangular), hillCount: hills.length,
      mountainMeanWidth: [...sections.values()].reduce((sum, n) => sum + n, 0) / sections.size,
      mountainMaxWidth: Math.max(...sections.values()) };
  });
  check('hill showcase contains 2×2, 2×3, and 2×4 closed outcrops', reliefGeometry.tiny.every(hill => hill && hill.stairs === 0), reliefGeometry.tiny);
  check('hill silhouettes include irregular larger shelves', reliefGeometry.nonrectangular.length >= 2, { count: reliefGeometry.nonrectangular.length, total: reliefGeometry.hillCount });
  check('mountain showcase is a slim band, roughly one third the earlier 17-tile width', reliefGeometry.mountainMeanWidth <= 7 && reliefGeometry.mountainMaxWidth <= 9,
    { meanWidth: reliefGeometry.mountainMeanWidth, maxWidth: reliefGeometry.mountainMaxWidth });
  await page.screenshot({ path: `${output}/world-atlas-desktop.png`, fullPage: true });
  check('woodland is visible by default', await page.locator('#show-vegetation').isChecked());
  const woodedMode = sceneInfo.slice(0, 3).find(scene => scene.woodedHighGround > 0)?.id;
  check('production worlds include woodland on raised ground', !!woodedMode, sceneInfo.slice(0, 3).map(scene => ({ id: scene.id, woods: scene.woods, raisedWoods: scene.woodedHighGround })));
  await page.evaluate(id => { const lab = window.__worldLab; lab.setActive(lab.scenes.get(id)); }, woodedMode);
  await page.locator('[data-jump="woods"]').click(); await page.waitForTimeout(80);
  const woodedBefore = await page.locator('#detail').evaluate(canvas => canvas.toDataURL());
  const woodedTile = await page.evaluate(() => {
    const { active, center } = window.__worldLab, world = active.world;
    return world.tiles[Math.floor(center.y) * world.width + Math.floor(center.x)];
  });
  check('woodland jump locates an actual forested summit tile', !!woodedTile.ridge && ['forest', 'jungle'].includes(woodedTile.overlay), woodedTile);
  await page.locator('.view').screenshot({ path: `${output}/world-atlas-wooded-high-ground.png` });
  await page.locator('#show-vegetation').uncheck(); await page.waitForTimeout(80);
  const woodedAfter = await page.locator('#detail').evaluate(canvas => canvas.toDataURL());
  check('woodland toggle removes native tree sprites from the detail', woodedBefore !== woodedAfter);
  await page.locator('.view').screenshot({ path: `${output}/world-atlas-high-ground-bare.png` });
  await page.locator('#show-vegetation').check();
  const woodedMountain = await page.evaluate(() => {
    const lab = window.__worldLab;
    for (const scene of lab.scenes.values()) {
      if (scene.sample) continue;
      const cells = scene.world.tiles.flatMap((tile, i) => tile.ridge && tile.relief === 'mountains' && ['forest', 'jungle'].includes(tile.overlay) ? [i] : []);
      if (!cells.length) continue;
      const cell = cells[Math.floor(cells.length / 2)]; lab.setActive(scene, { x: cell % scene.world.width + .5, y: Math.floor(cell / scene.world.width) + .5 });
      return { mode: scene.id, mountainForestTiles: cells.length };
    }
  });
  check('native forests also occupy usable mountain floors', !!woodedMountain, woodedMountain);
  await page.waitForTimeout(80); await page.locator('.view').screenshot({ path: `${output}/world-atlas-wooded-mountain.png` });
  await page.locator('[data-scene="fractal"]').click({ position: { x: 80, y: 100 } });
  check('clicking a world changes the inspection panel', await page.locator('#detail-title').textContent() === 'Fractal');
  const before = await page.evaluate(() => window.__worldLab.zoom);
  await page.locator('#zoom-in').click();
  check('zoom controls change detailed terrain scale', await page.evaluate(() => window.__worldLab.zoom) > before);
  await page.locator('[data-jump="mountains"]').click();
  const pass = await page.evaluate(() => {
    const { active, center } = window.__worldLab; return active.world.tiles[Math.floor(center.y) * active.world.width + Math.floor(center.x)].mountainPass;
  });
  check('mountain jump locates a genuine pass', pass === true);
  await page.locator('#show-grid').check(); await page.locator('#show-routes').uncheck();
  check('grid and path annotations toggle independently', await page.locator('#show-grid').isChecked() && !(await page.locator('#show-routes').isChecked()));
  await page.locator('[data-scene="desert-hills"]').click();
  check('terrain sample opens in the inspector', await page.locator('#detail-title').textContent() === 'Desert hill country');
  await page.locator('#show-routes').check(); await page.locator('#show-grid').uncheck();
  await page.locator('#detail').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/world-atlas-desert-detail.png` });
  const detail = await page.locator('#detail').boundingBox();
  await page.mouse.move(detail.x + detail.width / 2, detail.y + detail.height / 2);
  check('tile inspection reports terrain and coordinates', /\d+, \d+/.test(await page.locator('#tile-info').textContent()));
  await page.locator('#show-grid').check();
  for (let n = 0; n < 5; n++) await page.locator('#zoom-in').click();
  for (const [index, hill] of reliefGeometry.tiny.entries()) {
    await page.evaluate(({ hill }) => { const lab = window.__worldLab; lab.setActive(lab.scenes.get('grass-hills'), { x: hill.x + hill.width / 2, y: hill.y + hill.height / 2 }); }, { hill });
    await page.waitForTimeout(80);
    await page.locator('.view').screenshot({ path: `${output}/world-atlas-outcrop-2x${index + 2}.png` });
  }
  const distinct = reliefGeometry.nonrectangular.filter((hill, index, all) => all.findIndex(other => other.rows.join('/') === hill.rows.join('/')) === index).slice(0, 4);
  for (const [index, hill] of distinct.entries()) {
    await page.evaluate(({ hill }) => { const lab = window.__worldLab; lab.setActive(lab.scenes.get('grass-hills'), { x: hill.x + hill.width / 2, y: hill.y + hill.height / 2 }); }, { hill });
    await page.waitForTimeout(80);
    await page.locator('.view').screenshot({ path: `${output}/world-atlas-irregular-hill-${index + 1}.png` });
  }
  await page.locator('[data-scene="mountain-range"]').click(); await page.locator('#reset-view').click();
  await page.waitForTimeout(80); await page.locator('.view').screenshot({ path: `${output}/world-atlas-slim-mountains.png` });
  await page.locator('#show-vegetation').uncheck(); await page.waitForTimeout(80);
  await page.locator('.view').screenshot({ path: `${output}/world-atlas-slim-mountains-bare.png` });
  await page.locator('#show-vegetation').check();
  check('all small and irregular hill examples remain inspectable', distinct.length >= 2 && await page.locator('#detail-title').textContent() === 'Mountain range');
  await page.locator('#show-grid').uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${output}/world-atlas-mobile.png`, fullPage: true });
  check('narrow layout has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.locator('#seed').fill('ATLAS-CHECK-2'); await page.locator('#regenerate').click();
  await page.waitForFunction(() => !document.querySelector('#loading').hidden === false && window.__worldLab.scenes.get('continents').world.seed === 'ATLAS-CHECK-2', null, { timeout: 60000 });
  check('regeneration replaces all worlds with the new seed', await page.evaluate(() => [...window.__worldLab.scenes.values()].slice(0, 3).every(scene => scene.world.seed === 'ATLAS-CHECK-2')));
  check('standalone makes no network requests', network.length === 0, network);
  check('no runtime errors', errors.length === 0, errors);
} finally {
  await writeFile(`${output}/world-atlas-checks.json`, JSON.stringify({ checks, errors, network }, null, 2));
  console.log(JSON.stringify({ checks, errors, network }, null, 2)); await browser.close();
}
