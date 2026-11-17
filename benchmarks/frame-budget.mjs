import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const url = arg('url', 'http://127.0.0.1:5173/'), label = arg('label', 'current');
const drag = process.argv.includes('--drag'), dragCommit = process.argv.includes('--drag-commit');
const dragKind = arg('drag-kind', 'road'), pointerInterval = Number(arg('pointer-interval', '125'));
if (!['road', 'irrigation'].includes(dragKind)) throw new Error('Drag kind must be road or irrigation.');
if (!Number.isFinite(pointerInterval) || pointerInterval < 0) throw new Error('Pointer interval must be nonnegative.');
if (drag && process.argv.includes('--placement')) throw new Error('Choose --drag or --placement, not both.');
if (dragCommit && !drag) throw new Error('--drag-commit requires --drag.');
const out = arg('out', '/tmp/btv-smooth-2026-11-08'), seconds = Number(arg('seconds', '30'));
const cadence = Number(arg('cadence', '0'));
if (!Number.isFinite(cadence) || cadence < 0) throw new Error('Cadence must be zero or a positive frame rate.');
const source = await readFile(arg('state', `${out}/state.json`), 'utf8'), state = JSON.parse(source);
const viewport = JSON.parse(await readFile(arg('viewport', `${out}/viewport.json`), 'utf8'));
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)],
    p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) };
};
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr });
page.setDefaultTimeout(120_000);
const errors = []; page.on('pageerror', error => errors.push(String(error)));
try {
  await page.addInitScript(state => {
    // Load the captured world directly, avoiding an unrelated generated world
    // and its retained caches/GC before the measured replay.
    state.paused = true;
    window.name = 'tinyciv-development-handoff:' + JSON.stringify({ state });
    const raf = requestAnimationFrame.bind(window), pending = new Map(); let serial = 0;
    window.__frameBench = { raf, pending, hold: false };
    window.requestAnimationFrame = callback => {
      if (!__frameBench.hold) return raf(callback);
      pending.set(++serial, callback); return serial;
    };
  }, state);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.evaluate(() => { __frameBench.hold = true; __game.state.paused = true; });
  await page.waitForTimeout(100);
  await page.evaluate(async viewport => {
    const state = __game.state;
    const wasm = await import('/src/game/navigation-wasm.ts'); await wasm.loadNavigationWasm();
    __game.replaceState(state); state.paused = true;
    __game.renderer.camera = viewport.camera; __game.renderer.zoom = viewport.zoom;
    __game.renderer.follow = false;
    const invoke = now => { const callbacks = [...__frameBench.pending.values()]; __frameBench.pending.clear(); callbacks.forEach(callback => callback(now)); };
    __frameBench.invoke = invoke;
    for (let i = 0; i < 5; i++) await new Promise(resolve => __frameBench.raf(now => { invoke(now); resolve(); }));
  }, viewport);
  let dragSetup = null;
  if (drag) {
    dragSetup = await page.evaluate(async dragKind => {
      const state = __game.state, renderer = __game.renderer, canvas = document.querySelector('#world');
      const { validateBuildAt } = await import('/src/game/simulation.ts');
      const { constructionRoute } = await import('/src/game/construction-route.ts');
      const { planConstruction } = await import('/src/game/construction.ts');
      const { constructionPreviewContext } = await import('/src/game/construction-preview-cache.ts');
      const { playerFaction } = await import('/src/game/player-context.ts');
      const { updateFog, pointInSight } = await import('/src/game/fog.ts');
      const faction = playerFaction(state), fog = updateFog(state, faction);
      const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === faction && unit.hp > 0);
      if (!leader) throw new Error('Construction drag needs a living player leader.');
      const bounds = canvas.getBoundingClientRect();
      const client = point => {
        const screen = renderer.screenPoint({ x: point.x + .5, y: point.y + .5 });
        return { x: bounds.left + screen.x, y: bounds.top + screen.y };
      };
      const roads = new Set(state.buildings.filter(building => building.hp > 0 && building.kind === dragKind && building.faction === faction)
        .map(building => `${building.x}:${building.y}`));
      const candidates = [];
      for (let y = Math.max(0, Math.floor(leader.y) - 9); y <= Math.min(state.world.height - 1, Math.floor(leader.y) + 9); y++) {
        for (let x = Math.max(0, Math.floor(leader.x) - 9); x <= Math.min(state.world.width - 1, Math.floor(leader.x) + 9); x++) {
          const point = { x, y }, screen = client(point);
          if (Math.hypot(x + .5 - leader.x, y + .5 - leader.y) > 9.5 || !pointInSight(fog, x, y)
            || screen.x < bounds.left + 16 || screen.x > bounds.right - 16
            || screen.y < bounds.top + 16 || screen.y > bounds.bottom - 16
            || document.elementFromPoint(screen.x, screen.y) !== canvas) continue;
          if (roads.has(`${x}:${y}`) || validateBuildAt(state, dragKind, x, y).ok) candidates.push(point);
        }
      }
      candidates.sort((a, b) => Math.hypot(a.x - renderer.camera.x, a.y - renderer.camera.y)
        - Math.hypot(b.x - renderer.camera.x, b.y - renderer.camera.y));
      let chosen, attempts = 0;
      for (const start of candidates.slice(0, 12)) {
        const targets = candidates.filter(point => Math.abs(point.x - start.x) + Math.abs(point.y - start.y) >= 4)
          .sort((a, b) => Math.abs(b.x - start.x) + Math.abs(b.y - start.y) - Math.abs(a.x - start.x) - Math.abs(a.y - start.y));
        for (const target of targets.slice(0, 24)) {
          attempts++;
          const route = constructionRoute(state, dragKind, start, target), plan = planConstruction(state, dragKind, route);
          const end = route.at(-1);
          if (route.length < 4 || end?.x !== target.x || end.y !== target.y || !plan.ok || plan.skipped || plan.tiles.length < 2) continue;
          const endpoints = route.slice(2).filter(point => {
            const screen = client(point);
            return document.elementFromPoint(screen.x, screen.y) === canvas;
          });
          if (endpoints.length < 2) continue;
          chosen = { faction, start, endpoints, routeCells: route.length, newCells: plan.tiles.length, cost: plan.cost };
          break;
        }
        if (chosen) break;
      }
      if (!chosen) throw new Error(`No affordable visible construction stroke found near the player leader (${candidates.length} candidate cells, ${attempts} route attempts).`);
      // The preflight chooses legal input coordinates, never renderer previews.
      // Its route/quote cache entries must not hide the measured first preview.
      const context = constructionPreviewContext(state, dragKind); context.routes.clear(); context.plans.clear(); context.routeChecks?.clear();
      state.buildMode = dragKind;
      __frameBench.drag = { ...chosen, pointerId: null };
      canvas.addEventListener('pointerdown', event => { __frameBench.drag.pointerId = event.pointerId; }, { once: true });
      return { ...chosen, clientStart: client(chosen.start), candidates: candidates.length, routeAttempts: attempts,
        setup: 'Validated while paused; real mouse-down after render warmup; preflight route and quote cache entries cleared.' };
    }, dragKind);
    await page.mouse.move(dragSetup.clientStart.x, dragSetup.clientStart.y);
    await page.mouse.down({ button: 'left' });
    await page.evaluate(dragKind => {
      const canvas = document.querySelector('#world'), drag = __frameBench.drag;
      if (drag.pointerId === null || !canvas.hasPointerCapture(drag.pointerId)
        || __game.state.buildMode !== dragKind || !__game.renderer.buildPreview.length)
        throw new Error('Real mouse-down did not start the construction stroke.');
    }, dragKind);
  }
  const cdp = await page.context().newCDPSession(page);
  let profileClockOffsetMs;
  if (process.argv.includes('--cpu')) {
    await cdp.send('Performance.enable');
    const before = await page.evaluate(() => performance.now());
    const { metrics } = await cdp.send('Performance.getMetrics');
    const after = await page.evaluate(() => performance.now());
    profileClockOffsetMs = metrics.find(metric => metric.name === 'Timestamp').value * 1000 - (before + after) / 2;
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  }
  const result = await page.evaluate(async ({ seconds, placement, paused, drag, dragCommit, cadence, dragKind, pointerInterval }) => {
    const frames = [], renderer = __game.renderer; let current;
    for (const key of ['draw', 'prepare', 'prepareFog', 'drawMinimap']) {
      const original = renderer[key]; if (typeof original !== 'function') continue;
      renderer[key] = function (...args) {
        const start = performance.now();
        if (current && key === 'draw') {
          const work = __game.constructionStatus;
          current.construction = work && work.workSerial !== current.constructionSerial ? work.workMs : 0;
          current.sim = start - current.start - (current.pointer || 0) - (current.commit || 0) - current.construction;
        }
        try { return original.apply(this, args); }
        finally { if (current) current[key] = (current[key] || 0) + performance.now() - start; }
      };
    }
    __game.state.paused = paused;
    const canvas = document.querySelector('#world'), bounds = canvas.getBoundingClientRect();
    let pointerMoves = 0, previewFrames = 0, lastPointerMove = -Infinity;
    let dragMoves = 0, dragPreviewFrames = 0, validDragFrames = 0, maximumRouteCells = 0, commit = null;
    let commitBuildingIds, commitStarted = 0, completedBeforeCommit = 0;
    const dragState = drag ? __frameBench.drag : null;
    const dragPointer = (type, point, buttons) => {
      const screen = renderer.screenPoint({ x: point.x + .5, y: point.y + .5 });
      canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: dragState.pointerId,
        pointerType: 'mouse', button: type === 'pointermove' ? -1 : 0, buttons,
        clientX: bounds.left + screen.x, clientY: bounds.top + screen.y }));
    };
    if (placement) __game.state.buildMode = 'house';
    const { navigationWasmStatus } = await import('/src/game/navigation-wasm.ts');
    const navigationBefore = navigationWasmStatus();
    const initialPositions = new Map(__game.state.units.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
    const initialUnitHp = __game.state.units.reduce((sum, unit) => sum + unit.hp, 0);
    const initialDeliveredFood = __game.state.buildings.reduce((sum, building) => sum + (building.foodDelivered ?? 0), 0);
    const started = performance.now(), gameTime = __game.state.time;
    let previous = 0, nextFrameAt = 0;
    await new Promise(resolve => {
      const pump = now => {
        if (cadence) {
          if (nextFrameAt && now < nextFrameAt - .5) { __frameBench.raf(pump); return; }
          const period = 1000 / cadence;
          nextFrameAt ||= now;
          nextFrameAt += Math.max(1, Math.floor((now - nextFrameAt + .5) / period) + 1) * period;
        }
        current = { start: performance.now(), atMs: performance.now() - started, interval: previous ? now - previous : 0,
          constructionSerial: __game.constructionStatus?.workSerial }; previous = now;
        // Exercise the real pointer handler. Setting renderer.hover directly
        // would be cleared by the frame's refreshWorldPointer callback.
        if (placement && now - lastPointerMove >= pointerInterval) {
          const phase = pointerMoves++ % 16 / 15;
          const start = performance.now();
          canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true,
            pointerId: 1, pointerType: 'mouse', clientX: bounds.left + bounds.width * (.3 + .4 * phase),
            clientY: bounds.top + bounds.height * (.45 + .05 * Math.sin(phase * Math.PI * 2)) }));
          current.pointer = performance.now() - start;
          lastPointerMove = now;
        }
        if (drag && !commit && now - lastPointerMove >= pointerInterval) {
          const period = Math.max(2, dragState.endpoints.length * 2 - 2), phase = dragMoves++ % period;
          const index = phase < dragState.endpoints.length ? phase : period - phase;
          const start = performance.now();
          dragPointer('pointermove', dragState.endpoints[index], 1);
          current.pointer = performance.now() - start;
          lastPointerMove = now;
        }
        if (drag && dragCommit && !commit && performance.now() - started >= Math.max(0, seconds * 1000 - 250)) {
          commitBuildingIds = new Set(__game.state.buildings.map(building => building.id));
          const start = performance.now(); commitStarted = start;
          completedBeforeCommit = __game.constructionStatus?.completed ?? 0;
          const end = dragState.endpoints.at(-1);
          dragPointer('pointermove', end, 1);
          const previewCells = renderer.buildPreview.length;
          dragPointer('pointerup', end, 0);
          commit = { atMs: performance.now() - started, durationMs: performance.now() - start, previewCells,
            pending: !!__game.constructionStatus?.pending, completed: false, placedCells: 0 };
          current.commit = commit.durationMs;
        }
        __frameBench.invoke(now);
        if (commit && !commit.completed) {
          const status = __game.constructionStatus;
          commit.pending = !!status?.pending;
          commit.completedJobs = (status?.completed ?? 0) - completedBeforeCommit;
          commit.placedCells = commit.completedJobs > 0 ? status.lastResult.placed
            : __game.state.buildings.filter(building => !commitBuildingIds.has(building.id)
              && building.kind === dragKind && building.faction === dragState.faction).length;
          if (!commit.pending) {
            commit.completed = true; commit.completedAtMs = performance.now() - started;
            commit.completionLatencyMs = performance.now() - commitStarted;
            if (commit.completedJobs > 0) commit.result = status.lastResult;
          }
        }
        if (placement && __game.state.buildMode === 'house' && renderer.hover) previewFrames++;
        if (drag && !commit && renderer.buildPreview.length) {
          dragPreviewFrames++;
          maximumRouteCells = Math.max(maximumRouteCells, renderer.buildPreview.length);
          if (!document.querySelector('#build-status').classList.contains('invalid')) validDragFrames++;
        }
        current.total = performance.now() - current.start;
        current.other = current.total - (current.sim || 0) - (current.draw || 0) - (current.pointer || 0) - (current.commit || 0) - (current.construction || 0);
        delete current.start; delete current.constructionSerial; frames.push(current); current = null;
        const measured = performance.now() - started;
        if (measured < seconds * 1000 || commit?.pending && measured < seconds * 1000 + 10000) __frameBench.raf(pump); else resolve();
      }; __frameBench.raf(pump);
    });
    const elapsed = performance.now() - started;
    __game.state.paused = true;
    if (drag && !commit) dragPointer('pointercancel', dragState.start, 0);
    const navigationAfter = navigationWasmStatus();
    const navigation = { before: navigationBefore, after: navigationAfter,
      delta: Object.fromEntries(Object.keys(navigationAfter).filter(key => typeof navigationAfter[key] === 'number')
        .map(key => [key, navigationAfter[key] - navigationBefore[key]])) };
    const alive = __game.state.units.filter(unit => unit.hp > 0);
    const distances = alive.map(unit => { const initial = initialPositions.get(unit.id); return initial ? Math.hypot(unit.x - initial.x, unit.y - initial.y) : 0; });
    const activity = { livingUnits: alive.length, outsideUnits: alive.filter(unit => !unit.inside).length,
      workers: alive.filter(unit => unit.kind === 'worker').length, outsideWorkers: alive.filter(unit => unit.kind === 'worker' && !unit.inside).length,
      collectors: alive.filter(unit => unit.collector).length, workingBuilders: alive.filter(unit => unit.builder && !unit.inside && unit.buildPhase === 'working').length,
      movingUnits: alive.filter(unit => unit.moving).length, displacedUnits: distances.filter(distance => distance > .1).length,
      engagedUnits: alive.filter(unit => !unit.inside && __game.state.time - unit.lastCombat < 1.1).length,
      unitHpLost: initialUnitHp - __game.state.units.reduce((sum, unit) => sum + unit.hp, 0),
      meanDisplacement: distances.reduce((sum, distance) => sum + distance, 0) / Math.max(1, distances.length),
      returnOrders: alive.filter(unit => unit.attackReturn).length,
      foodDelivered: __game.state.buildings.reduce((sum, building) => sum + (building.foodDelivered ?? 0), 0) - initialDeliveredFood,
      activeConstruction: __game.state.buildings.filter(building => building.hp > 0 && building.construction && !building.construction.waitingForBuilder).length };
    return { frames, elapsed, startedAt: started, activity, navigation,
      placement: placement ? { kind: 'house', pointerMoves, previewFrames } : null,
      drag: drag ? { kind: dragKind, pointerMoves: dragMoves, previewFrames: dragPreviewFrames,
        validPreviewFrames: validDragFrames, maximumRouteCells, commit } : null,
      gameSeconds: __game.state.time - gameTime,
      units: __game.state.units.length, buildings: __game.state.buildings.length, fields: __game.state.fields.length,
      speed: __game.state.speed, renderStats: renderer.renderStats, gameOver: __game.state.gameOver };
  }, { seconds, placement: process.argv.includes('--placement'), paused: process.argv.includes('--paused'), drag, dragCommit, cadence, dragKind, pointerInterval });
  if (drag) await page.mouse.up({ button: 'left' });
  if (drag && (!result.drag.previewFrames || result.drag.maximumRouteCells < 2)) errors.push('Construction drag did not produce a multi-cell construction preview.');
  if (dragCommit && !result.drag.commit?.placedCells) errors.push('Measured construction release did not place any new cells.');
  if (dragCommit && !result.drag.commit?.completed) errors.push('Construction purchase or its deferred maintenance did not finish within the measurement window.');
  if (process.argv.includes('--cpu')) { const { profile } = await cdp.send('Profiler.stop'); await writeFile(path.join(out, `${label}.cpuprofile`), JSON.stringify(profile)); }
  const report = { label, url, viewport, cadence, pointerInterval, profileClockOffsetMs, ...result, dragSetup, errors, timingSchemaVersion: 3,
    cpu: os.cpus()[0]?.model, browser: await browser.version(),
    snapshotSha256: createHash('sha256').update(source).digest('hex'),
    initial: { units: state.units.length, buildings: state.buildings.length, fields: state.fields.length },
    firstFrame: result.frames[0],
    fps: result.frames.length * 1000 / result.elapsed,
    over33: result.frames.filter(frame => frame.total > 1000 / 30).length,
    over50: result.frames.filter(frame => frame.total > 50).length,
    metrics: Object.fromEntries(['total', 'sim', 'draw', 'pointer', 'commit', 'construction', 'other', 'interval'].map(key => [key, summary(result.frames.slice(1).map(frame => frame[key] || 0))])) };
  await writeFile(path.join(out, `${label}.json`), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(out, `${label}.png`) });
  console.log(JSON.stringify({ ...report, frames: undefined }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
