import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const label = arg('label') || 'profile';
const out = arg('out') || 'scratch/2026-10-27-engine-performance';
const ids = (arg('scenarios') || 'idle-100,idle-300,idle-600,combat-100,combat-300,combat-600').split(',');
const frames = Number(arg('frames') || 120), warmup = Number(arg('warmup') || 30);
const simulationUrl = arg('simulation') || '/src/game/simulation.ts';
const rafStart = Number(arg('raf-start') || 0);
const doProfiles = process.argv.includes('--cpu'), doRaf = process.argv.includes('--raf');
if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(warmup) || warmup < 0) throw new Error('Use positive integer --frames and nonnegative integer --warmup.');
if (!Number.isFinite(rafStart) || rafStart < 0 || rafStart > 15) throw new Error('Use --raf-start=0..15 simulated seconds.');
if (doRaf && simulationUrl !== '/src/game/simulation.ts') throw new Error('--raf runs the live application engine; use the default --simulation.');
mkdirSync(out, { recursive: true });
const errors = [];
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(60_000);
page.on('pageerror', error => errors.push(String(error)));
// Keep the actual application loop under explicit control. Both direct timings
// and optional RAF runs use the real engine, renderer, assets and DOM canvas.
await page.addInitScript(() => {
  const nativeRAF = window.requestAnimationFrame.bind(window), callbacks = new Map(); let serial = 0;
  window.__profileRAF = { nativeRAF, callbacks };
  // Font/loading presentation now waits for animation frames during startup.
  // Take control only after the application and renderer are ready.
  window.requestAnimationFrame = callback => {
    if (!window.__profileHold) return nativeRAF(callback);
    callbacks.set(++serial, callback); return serial;
  };
  window.cancelAnimationFrame = id => callbacks.delete(id);
});
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b), percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1) };
};
function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), parent = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id);
  const totals = new Map(), self = new Map(); let totalUs = 0;
  const keyFor = node => `${node.callFrame.functionName || '(anonymous)'} @ ${node.callFrame.url.replace(/\?.*$/, '').replace('http://127.0.0.1:5173', '')}:${node.callFrame.lineNumber + 1}`;
  for (let i = 0; i < (profile.samples || []).length; i++) {
    const id = profile.samples[i], us = profile.timeDeltas?.[i] || 1000; totalUs += us;
    const key = keyFor(nodes.get(id)); self.set(key, (self.get(key) || 0) + us);
    const seen = new Set(); let current = id;
    while (current !== undefined) { const key = keyFor(nodes.get(current)); if (!seen.has(key)) { totals.set(key, (totals.get(key) || 0) + us); seen.add(key); } current = parent.get(current); }
  }
  const ranked = map => [...map].map(([name, us]) => ({ name, ms: us / 1000, percent: us / totalUs * 100 })).sort((a, b) => b.ms - a.ms).slice(0, 30);
  return { sampledMs: totalUs / 1000, self: ranked(self), inclusive: ranked(totals) };
}
const report = { label, environment: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, browser: await browser.version(), viewport: [1440, 900], dpr: 1, headless: true, url: process.env.GAME_URL || 'http://127.0.0.1:5173/', simulationUrl, dt: 1 / 60, frames, warmup, rafStart, fixtureHp: 10000 }, scenarios: [], profiles: {}, raf: [], errors };
try {
  await page.goto(report.environment.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready' && window.__game, null, { polling: 50 });
  await page.evaluate(async simulationUrl => {
    window.__profileHold = true;
    const fixtures = await import('/dev/performance/scenarios.ts');
    const simulation = await import(simulationUrl);
    const navigation = await import('/src/game/navigation-wasm.ts');
    await navigation.loadNavigationWasm();
    window.__enginePerf = { fixtures, simulation, input: { up: false, down: false, left: false, right: false } };
    window.__game.state.paused = true;
    window.__enginePerf.setup = id => {
      const fixture = fixtures.createPerformanceScenario(id), renderer = window.__game.renderer;
      renderer.follow = false; renderer.camera = { ...fixture.camera }; renderer.zoom = fixture.zoom;
      renderer.hover = null; renderer.buildPreview = [];
      const start = performance.now(); renderer.draw(fixture.state, 0); const firstDrawMs = performance.now() - start;
      window.__enginePerf.active = fixture;
      return { metadata: fixture.metadata, firstDrawMs, units: fixture.state.units.length, buildings: fixture.state.buildings.length, fields: fixture.state.fields?.length || 0 };
    };
    window.__enginePerf.run = count => {
      const { active: { state }, simulation, input } = window.__enginePerf;
      const samples = [], healthBefore = state.units.reduce((n, u) => n + u.hp, 0);
      let movingSamples = 0, fightingSamples = 0;
      for (let i = 0; i < count; i++) {
        const a = performance.now(); simulation.updateGame(state, 1 / 60, input); const b = performance.now();
        window.__game.renderer.draw(state, 1 / 60); const c = performance.now();
        samples.push({ update: b - a, render: c - b, total: c - a });
        movingSamples += state.units.filter(u => u.moving).length;
        fightingSamples += state.units.filter(u => state.time - u.lastCombat < 1).length;
      }
      return { samples, time: state.time, units: state.units.length, gameOver: state.gameOver,
        healthLost: healthBefore - state.units.reduce((n, u) => n + u.hp, 0), movingMean: movingSamples / count, fightingMean: fightingSamples / count,
        heapBytes: performance.memory?.usedJSHeapSize };
    };
  }, simulationUrl);
  for (const id of ids) {
    const setup = await page.evaluate(id => window.__enginePerf.setup(id), id);
    await page.evaluate(n => window.__enginePerf.run(n), warmup);
    const measured = await page.evaluate(n => window.__enginePerf.run(n), frames);
    if (measured.gameOver || measured.time < (warmup + frames) / 60 - .01) throw new Error(`Invalid fixture ${id}: did not simulate all frames`);
    const result = { id, ...setup, ...measured, metrics: Object.fromEntries(['update', 'render', 'total'].map(name => [name, stats(measured.samples.map(s => s[name]))])), over16ms: measured.samples.filter(s => s.total > 1000 / 60).length };
    report.scenarios.push(result);
    await page.screenshot({ path: path.join(out, `${label}-${id}.png`) });
    writeFileSync(path.join(out, `${label}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(`${label} ${id}: update ${result.metrics.update.p50.toFixed(2)}ms; render ${result.metrics.render.p50.toFixed(2)}ms; total p95 ${result.metrics.total.p95.toFixed(2)}ms; fighting ${measured.fightingMean.toFixed(0)}`);
  }
  if (doProfiles) {
    const session = await page.context().newCDPSession(page); await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 1000 });
    for (const id of ids.filter(id => id === 'combat-600' || id === 'idle-600')) {
      await page.evaluate(id => window.__enginePerf.setup(id), id); await page.evaluate(n => window.__enginePerf.run(n), warmup);
      await session.send('Profiler.start'); await page.evaluate(n => window.__enginePerf.run(n), Math.min(frames, 90));
      const { profile } = await session.send('Profiler.stop');
      writeFileSync(path.join(out, `${label}-${id}.cpuprofile`), JSON.stringify(profile));
      report.profiles[id] = summarizeProfile(profile);
    }
    await session.detach();
  }
  if (doRaf) for (const id of ids.filter(id => id === 'combat-600' || id === 'idle-600')) {
    const raw = await page.evaluate(async ({ id, frames, warmup, rafStart }) => {
      const { state, camera, zoom } = window.__enginePerf.fixtures.createPerformanceScenario(id);
      let live = state;
      if (window.__game.replaceState) window.__game.replaceState(live);
      else { live = window.__game.state; for (const key of Object.keys(live)) delete live[key]; Object.assign(live, state); }
      const renderer = window.__game.renderer; renderer.follow = false; renderer.camera = camera; renderer.zoom = zoom;
      for (let i = 0; i < Math.round(rafStart * 60); i++) window.__enginePerf.simulation.updateGame(live, 1 / 60, window.__enginePerf.input);
      const invoke = now => {
        const queue = [...window.__profileRAF.callbacks.values()]; window.__profileRAF.callbacks.clear();
        for (const callback of queue) callback(now);
      };
      // Preparation has deliberately held the application's RAF clock still.
      // Prime its terrain/HUD caches and then its timestamp while paused, so
      // that artificial setup delay does not enter combat as a 150 ms step.
      const paused = live.paused; live.paused = true;
      for (let i = 0; i < 2; i++) await new Promise(resolve => window.__profileRAF.nativeRAF(now => { invoke(now); resolve(); }));
      live.paused = paused;
      const durations = [], intervals = []; let count = 0, previous = 0;
      await new Promise(resolve => {
        const pump = now => {
          const before = performance.now(); invoke(now);
          if (count >= warmup) { durations.push(performance.now() - before); intervals.push(now - previous); }
          previous = now; count++;
          if (count < frames + warmup) window.__profileRAF.nativeRAF(pump); else resolve();
        };
        window.__profileRAF.nativeRAF(pump);
      });
      return { durations, intervals, time: live.time, units: live.units.length, gameOver: live.gameOver, primedWhilePaused: true };
    }, { id, frames, warmup, rafStart });
    report.raf.push({ id, ...raw, workMs: stats(raw.durations), intervalMs: stats(raw.intervals), observedFps: 1000 / stats(raw.intervals).mean });
    console.log(`${label} RAF ${id}: ${report.raf.at(-1).observedFps.toFixed(1)}fps; p95 work ${report.raf.at(-1).workMs.p95.toFixed(2)}ms`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  report.pass = true;
  writeFileSync(path.join(out, `${label}.json`), JSON.stringify(report, null, 2) + '\n');
} finally { await browser.close(); }
