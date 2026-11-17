import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const url = arg('url', 'http://127.0.0.1:5222/');
const out = arg('out', '/tmp/btv-drag-implementation-2026-11-09');
const state = JSON.parse(await readFile(arg('state', '/tmp/btv-pop800-2026-11-08/state.json'), 'utf8'));
const viewport = JSON.parse(await readFile(arg('viewport', '/tmp/btv-pop800-2026-11-08/viewport.json'), 'utf8'));
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr });
page.setDefaultTimeout(120000);
const errors = []; page.on('pageerror', error => errors.push(String(error)));
const report = {};
await mkdir(out, { recursive: true });
try {
  await page.addInitScript(state => {
    state.paused = true;
    window.name = 'tinyciv-development-handoff:' + JSON.stringify({ state });
    const raf = requestAnimationFrame.bind(window), pending = new Map(); let serial = 0;
    window.__gestureCheck = { raf, pending, hold: false };
    window.requestAnimationFrame = callback => {
      if (!__gestureCheck.hold) return raf(callback);
      pending.set(++serial, callback); return serial;
    };
  }, state);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.evaluate(() => { __gestureCheck.hold = true; __game.state.paused = true; });
  await page.waitForTimeout(100);
  await page.evaluate(viewport => {
    __game.renderer.camera = viewport.camera; __game.renderer.zoom = viewport.zoom; __game.renderer.follow = false;
    __gestureCheck.pump = () => new Promise(resolve => __gestureCheck.raf(now => {
      const callbacks = [...__gestureCheck.pending.values()]; __gestureCheck.pending.clear();
      callbacks.forEach(callback => callback(now)); resolve();
    }));
  }, viewport);
  const pump = () => page.evaluate(() => __gestureCheck.pump());
  for (let i = 0; i < 5; i++) await pump();
  const client = point => page.evaluate(point => {
    const bounds = document.querySelector('#world').getBoundingClientRect();
    const p = __game.renderer.screenPoint({ x: point.x + .5, y: point.y + .5 });
    return { x: bounds.left + p.x, y: bounds.top + p.y };
  }, point);
  const begin = async (kind, start) => {
    await page.evaluate(kind => {
      __game.state.buildMode = kind;
      document.querySelector('#world').addEventListener('pointerdown', event => { __gestureCheck.pointerId = event.pointerId; }, { once: true });
    }, kind);
    const screen = await client(start); await page.mouse.move(screen.x, screen.y); await page.mouse.down();
  };
  const finish = async end => { const screen = await client(end); await page.mouse.move(screen.x, screen.y); await page.mouse.up(); };
  const drain = async () => {
    for (let i = 0; i < 100; i++) {
      await pump();
      if (!await page.evaluate(() => __game.constructionStatus.pending)) return;
    }
    throw new Error('Construction queue did not finish while paused.');
  };

  await begin('irrigation', { x: 139, y: 150 });
  const end = { x: 133, y: 153 }, screen = await client(end);
  report.coalescing = await page.evaluate(screen => {
    const canvas = document.querySelector('#world'), before = __game.renderer.constructionGesture;
    for (let i = 0; i < 200; i++) canvas.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: __gestureCheck.pointerId, pointerType: 'mouse', buttons: 1,
      clientX: screen.x + (i % 2) * .1, clientY: screen.y }));
    return { events: 200, samePreviewBeforeFrame: __game.renderer.constructionGesture === before };
  }, screen);
  assert.equal(report.coalescing.samePreviewBeforeFrame, true);
  await pump();
  report.irrigationPreview = await page.evaluate(() => {
    const preview = __game.renderer.constructionGesture;
    __gestureCheck.route = preview.points.map(p => ({ ...p }));
    __gestureCheck.farms = __game.state.fields.map(f => [f.camp, f.x, f.y]);
    __gestureCheck.beforeIds = new Set(__game.state.buildings.map(b => b.id));
    __gestureCheck.gold = __game.state.factions[0].gold;
    return { end: preview.requestedEnd, cost: preview.plan.cost, cells: preview.plan.tiles.length };
  });
  assert.deepEqual(report.irrigationPreview.end, end); assert.equal(report.irrigationPreview.cells, 2);
  await page.evaluate(() => { __game.state.factions[0].gold = 35; });
  await page.waitForTimeout(360); await pump();
  report.affordability = await page.evaluate(() => ({
    sameRoute: JSON.stringify(__game.renderer.constructionGesture.points) === JSON.stringify(__gestureCheck.route),
    affordable: __game.renderer.constructionGesture.plan.tiles.length,
    requested: __game.renderer.constructionGesture.requestedTiles,
    status: document.querySelector('#build-status').textContent,
  }));
  assert.equal(report.affordability.sameRoute, true); assert.equal(report.affordability.affordable, 1);
  assert.equal(report.affordability.requested, 2); assert.match(report.affordability.status, /Need 35 more gold/);
  await page.screenshot({ path: `${out}/irrigation-affordability.png` });
  await page.evaluate(() => { __game.state.factions[0].gold = __gestureCheck.gold; });
  await finish(end);
  report.irrigationRelease = await page.evaluate(() => ({
    jobs: __game.constructionStatus.jobs,
    newlyCreated: __game.state.buildings.filter(b => !__gestureCheck.beforeIds.has(b.id)).length,
    pendingOutlines: __game.renderer.pendingConstruction.flatMap(job => job.points).length,
  }));
  assert.equal(report.irrigationRelease.jobs, 1); assert.equal(report.irrigationRelease.newlyCreated, 0);
  assert.ok(report.irrigationRelease.pendingOutlines > 0);
  await drain();
  report.irrigationCompletion = await page.evaluate(() => ({
    ...__game.constructionStatus.lastResult, paused: __game.state.paused,
    spent: __gestureCheck.gold - __game.state.factions[0].gold,
    cropsUnmoved: JSON.stringify(__gestureCheck.farms) === JSON.stringify(__game.state.fields.map(f => [f.camp, f.x, f.y])),
    remainingOutlines: __game.renderer.pendingConstruction.length,
  }));
  assert.equal(report.irrigationCompletion.placed, 2); assert.equal(report.irrigationCompletion.spent, 70);
  assert.equal(report.irrigationCompletion.cropsUnmoved, true); assert.equal(report.irrigationCompletion.paused, true);
  assert.equal(report.irrigationCompletion.remainingOutlines, 0);

  await page.evaluate(state => { __game.replaceState(state); __game.state.paused = true; }, structuredClone(state));
  await pump();
  await begin('road', { x: 148, y: 151 });
  await page.evaluate(() => {
    __gestureCheck.beforeIds = new Set(__game.state.buildings.map(b => b.id));
    __gestureCheck.gold = __game.state.factions[0].gold;
  });
  await finish({ x: 148, y: 146 });
  for (let i = 0; i < 20; i++) {
    await pump();
    if (await page.evaluate(() => __game.state.buildings.some(b => b.kind === 'road' && !__gestureCheck.beforeIds.has(b.id)))) break;
  }
  await page.keyboard.press('Escape');
  await drain();
  report.roadCancellation = await page.evaluate(() => ({
    created: __game.state.buildings.filter(b => b.kind === 'road' && !__gestureCheck.beforeIds.has(b.id)).length,
    spent: __gestureCheck.gold - __game.state.factions[0].gold,
    pending: __game.constructionStatus.pending,
    remainingOutlines: __game.renderer.pendingConstruction.length,
    status: document.querySelector('#build-status').textContent,
  }));
  assert.equal(report.roadCancellation.created, 1); assert.equal(report.roadCancellation.spent, 5);
  assert.equal(report.roadCancellation.pending, false); assert.equal(report.roadCancellation.remainingOutlines, 0);
  assert.match(report.roadCancellation.status, /cancelled/);

  await page.evaluate(state => { __game.replaceState(state); __game.state.paused = true; }, structuredClone(state));
  await pump();
  report.ordinaryPausedOrder = await page.evaluate(async () => {
    const { buildAt, constructionReconciliationPending } = await import('/src/game/simulation.ts');
    __gestureCheck.gold = __game.state.factions[0].gold; __gestureCheck.time = __game.state.time;
    const result = buildAt(__game.state, 'road', 148, 151);
    return { result, pendingBeforeFrames: constructionReconciliationPending(__game.state), jobs: __game.constructionStatus.jobs };
  });
  assert.equal(report.ordinaryPausedOrder.result.ok, true);
  assert.equal(report.ordinaryPausedOrder.pendingBeforeFrames, true); assert.equal(report.ordinaryPausedOrder.jobs, 0);
  for (let i = 0; i < 20; i++) {
    await pump();
    if (!await page.evaluate(async () => (await import('/src/game/simulation.ts')).constructionReconciliationPending(__game.state))) break;
  }
  Object.assign(report.ordinaryPausedOrder, await page.evaluate(async () => ({
    pendingAfterFrames: (await import('/src/game/simulation.ts')).constructionReconciliationPending(__game.state),
    spent: __gestureCheck.gold - __game.state.factions[0].gold,
    gameSeconds: __game.state.time - __gestureCheck.time,
  })));
  assert.equal(report.ordinaryPausedOrder.pendingAfterFrames, false);
  assert.equal(report.ordinaryPausedOrder.spent, 5); assert.equal(report.ordinaryPausedOrder.gameSeconds, 0);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/gesture-behavior.json`, JSON.stringify({ ...report, errors }, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
