import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-10-31-forbidden-zones';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
// Fresh, isolated storage: never attach to or change the player's running session.
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const url = message.location().url || '';
  if (url.endsWith('/favicon.ico') && message.text().includes('404')) return;
  // HMR is intentionally disconnected below so concurrent source edits cannot
  // replace this isolated test's state halfway through a drag or screenshot.
  if (url.endsWith('/@vite/client') && message.text().includes('[vite] failed to connect to websocket')) return;
  errors.push(`${message.text()} ${url}`.trim());
});
await page.routeWebSocket('**', socket => socket.close());
const settle = () => page.waitForTimeout(180);
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
};
const zones = () => page.evaluate(async () => {
  const { forbiddenCells, forbiddenRegions } = await import('/src/game/forbidden-zones.ts');
  const { state, renderer } = window.__game;
  const texture = renderer.gpu.art.cache.get('forbidden-zone-marker')?.art.texture;
  return { cells: [...forbiddenCells(state)], regions: forbiddenRegions(state),
    markers: texture ? renderer.gpu.stage.children.filter(child => child.texture === texture).map(marker => ({ x: marker.x, y: marker.y, width: marker.width, height: marker.height })) : [],
    time: state.time, paused: state.paused };
});
async function drag(start, end) {
  const points = await page.evaluate(points => points.map(p => window.__game.renderer.screenPoint({ x: p.x + .5, y: p.y + .5 })), [start, end]);
  for (const point of points) assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, point), 'world', 'Rectangle endpoints must hit the canvas');
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 12 });
  await settle();
  const preview = await page.evaluate(() => window.__game.renderer.areaPreview);
  await page.mouse.up(); await settle();
  return preview;
}
async function clearZones() {
  await page.evaluate(async () => {
    const { setForbiddenRectangle } = await import('/src/game/forbidden-zones.ts');
    const state = window.__game.state;
    setForbiddenRectangle(state, { x: 0, y: 0 }, { x: state.world.width - 1, y: state.world.height - 1 }, false);
  });
  await settle();
}
async function ready() {
  await page.waitForFunction(() => window.__game && ['ready', 'error'].includes(document.documentElement.dataset.assets));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.assets), 'ready', `Game startup failed: ${errors.join('\n')}`);
  if (await page.locator('#dialog').isVisible()) await page.keyboard.press('Escape');
}

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await ready();
  const view = await page.evaluate(() => {
    window.__game.newWorld('forbidden-frontier', 'fractal');
    const { state, renderer } = window.__game;
    state.paused = true;
    const city = state.buildings.find(b => b.faction === 0 && b.kind === 'palace');
    renderer.camera = { x: city.x + 3, y: city.y + 1 }; renderer.follow = false; renderer.zoom = 1.8;
    return { city: { x: city.x, y: city.y }, base: { x: city.x + 3, y: city.y - 3 }, camera: { ...renderer.camera }, zoom: renderer.zoom };
  });
  await settle();
  const button = page.locator('[data-action="forbid"]');
  check('Forbid is a named, icon-free top-level action', await button.isVisible() && (await button.innerText()).trim() === 'Forbid'
    && await button.locator('.icon, img, svg, canvas').count() === 0);
  await button.click(); await settle();
  check('Forbid becomes the active tool', await button.getAttribute('aria-pressed') === 'true');
  const point = (dx, dy = 0) => ({ x: view.base.x + dx, y: view.base.y + dy });
  let preview = await drag(point(0), point(2, 2)), result = await zones();
  check('Drag previews a rectangular forbidden area', preview?.tool === 'forbid' && !preview.erase, preview);
  check('A 3×3 rectangle creates nine cells and one rendered marker', result.cells.length === 9 && result.regions.length === 1 && result.markers.length === 1, result);
  await drag(point(5), point(7, 2)); result = await zones();
  check('Separate rectangles have two regions and two rendered markers', result.cells.length === 18 && result.regions.length === 2 && result.markers.length === 2, result);
  await drag(point(3, 1), point(4, 1)); result = await zones();
  check('A connecting strip merges both regions into one marker', result.cells.length === 20 && result.regions.length === 1 && result.markers.length === 1, result);
  preview = await drag(point(3, 1), point(4, 1)); result = await zones();
  check('Starting inside a zone previews erase mode', preview?.tool === 'forbid' && preview.erase, preview);
  check('Erasing the connection splits the zone and restores two markers', result.cells.length === 18 && result.regions.length === 2 && result.markers.length === 2, result);
  await clearZones();
  await drag(point(0), point(0)); await drag(point(1, 1), point(1, 1)); result = await zones();
  check('Corner-touching cells also share one marker', result.cells.length === 2 && result.regions.length === 1 && result.markers.length === 1, result);
  await clearZones();
  const hidden = await page.evaluate(async () => {
    const { updateFog } = await import('/src/game/fog.ts');
    const { state, renderer } = window.__game, fog = updateFog(state), { width, height } = state.world;
    for (let y = 8; y < height - 8; y++) for (let x = 8; x < width - 8; x++) {
      if (![0, 1, width, width + 1].every(offset => !fog.explored[y * width + x + offset] && !fog.visible[y * width + x + offset])) continue;
      renderer.camera = { x: x + 1, y: y + 1 }; renderer.follow = false;
      return { x, y, explored: [...fog.explored], visible: [...fog.visible] };
    }
    throw new Error('Generated world needs an unexplored area');
  });
  await settle(); await drag(hidden, { x: hidden.x + 1, y: hidden.y + 1 }); result = await zones();
  const fogUnchanged = await page.evaluate(async before => {
    const { updateFog } = await import('/src/game/fog.ts');
    const fog = updateFog(window.__game.state);
    return before.explored.every((value, i) => value === fog.explored[i]) && before.visible.every((value, i) => value === fog.visible[i]);
  }, hidden);
  check('Fog permits marking and shows the zone without revealing terrain', result.cells.length === 4 && result.markers.length === 1 && fogUnchanged, { markerCount: result.markers.length, fogUnchanged });
  await page.screenshot({ path: `${output}/forbid-in-fog.png` });
  const serialized = await page.evaluate(async () => {
    const { serializeGameSave, parseGameSave } = await import('/src/game/game-save.ts');
    const state = window.__game.state, restored = parseGameSave(serializeGameSave(state));
    window.__game.save();
    return { equal: JSON.stringify(restored.forbiddenZones) === JSON.stringify(state.forbiddenZones), cells: [...state.forbiddenZones.cells] };
  });
  check('Forbidden zones round-trip through the game save', serialized.equal);
  await page.reload({ waitUntil: 'networkidle' }); await ready();
  const persisted = await zones();
  check('A browser reload restores forbidden designations', JSON.stringify(persisted.cells) === JSON.stringify(serialized.cells), persisted.cells);

  // The final screenshot is the real generated map and real UI designation,
  // without synthetic terrain, spawned scenery, or image annotations.
  await clearZones();
  await page.evaluate(view => {
    const { state, renderer } = window.__game; state.paused = true;
    renderer.camera = view.camera; renderer.zoom = view.zoom; renderer.follow = false;
  }, view);
  await button.click(); await settle();
  await drag({ x: view.city.x + 3, y: view.city.y - 3 }, { x: view.city.x + 6, y: view.city.y - 1 });
  await drag({ x: view.city.x - 5, y: view.city.y + 2 }, { x: view.city.x - 3, y: view.city.y + 4 });
  await page.mouse.move(1430, 45); await settle();
  const before = await zones(); await page.waitForTimeout(460); const after = await zones();
  check('The white markers hop subtly while the paused world stays fixed', before.time === after.time && before.paused
    && before.markers.length === 2 && after.markers.some((marker, i) => Math.abs(marker.y - before.markers[i].y) > .15)
    && after.markers.every((marker, i) => Math.abs(marker.y - before.markers[i].y) <= 3.01), { before: before.markers, after: after.markers });
  await page.screenshot({ path: `${output}/forbid-in-game.png` });
  check('Screenshot retains the active main action and two connected-zone markers', await button.isVisible() && await button.getAttribute('aria-pressed') === 'true'
    && after.regions.length === 2 && after.markers.length === 2);
  check('No runtime or game-asset errors', errors.length === 0, errors);
  writeFileSync(`${output}/report.json`, JSON.stringify({ pass: true, checks, errors, view, screenshot: `${output}/forbid-in-game.png` }, null, 2));
  console.log(JSON.stringify({ pass: true, checks: checks.length, screenshot: `${output}/forbid-in-game.png` }));
} catch (error) {
  writeFileSync(`${output}/report.json`, JSON.stringify({ pass: false, checks, errors, error: String(error) }, null, 2));
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally { await context.close(); await browser.close(); }
