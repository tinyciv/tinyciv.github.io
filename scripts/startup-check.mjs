import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createPortListener } from 'node:net';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { captureArmsPreview } from './startup-arms-preview.mjs';
import { captureOffensivePreview } from './startup-offensive-preview.mjs';
import { captureBuildingPreview } from './startup-building-preview.mjs';
import { captureCannonFirePreview } from './startup-cannon-fire-preview.mjs';
import { captureShellImpactPreview } from './startup-shell-impact-preview.mjs';
import { captureMeadowPreview } from './startup-meadow-preview.mjs';

// Use unbundled browser modules to catch initialization cycles hidden by builds.
// Reuse each entry point's initial world; no rebuild or gameplay scenario.
// --world checks the menu-free viewer without advancing or interacting with it.
const worldViewer = process.argv.includes('--world');
const captureUI = process.argv.includes('--capture-ui');
const captureAI = process.argv.includes('--capture-ai');
const captureMilitary = process.argv.includes('--capture-military');
const captureHills = process.argv.includes('--capture-hills');
const captureArms = process.argv.includes('--capture-arms');
const captureOffensive = process.argv.includes('--capture-offensive');
const captureBuildings = process.argv.includes('--capture-buildings');
const captureMenu = process.argv.includes('--capture-menu');
const captureArt = process.argv.includes('--capture-art');
const captureCannonFire = process.argv.includes('--capture-cannon-fire');
const captureMeadow = process.argv.includes('--capture-meadow');
const captureShellImpact = process.argv.includes('--capture-shell-impact');
const started = performance.now(), errors = [];
// Vite treats port 0 as its default port. Choose an unused port explicitly.
const listener = createPortListener();
await new Promise((resolve, reject) => {
  listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve);
});
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const server = await createServer({ envFile: false, server: { host: '127.0.0.1', port, strictPort: true, open: false } });
let browser, page, timer;
try {
  await server.listen();
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'],
    executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
  page = await browser.newPage({ viewport: worldViewer ? { width: 1440, height: 960 } : { width: 800, height: 600 } });
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(4096);
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      try { return await decode.call(this); }
      catch (error) { throw new Error(`Image decode failed: ${this.currentSrc || this.src}`, { cause: error }); }
    };
  });
  const failure = new Promise((_, reject) => {
    const fail = message => { errors.push(message); reject(new Error(message)); };
    page.on('pageerror', error => fail(error.stack || String(error)));
    page.on('crash', () => fail('Browser page crashed'));
    page.on('console', message => {
      if (message.type() === 'error') fail(`${message.text()} ${message.location().url}`.trim());
    });
    page.on('requestfailed', request => fail(`${request.failure()?.errorText} ${request.url()}`));
    page.on('response', response => {
      if (response.status() >= 400) fail(`HTTP ${response.status()} ${response.url()}`);
    });
    timer = setTimeout(() => fail('Startup exceeded 30 seconds'), 30_000);
  });
  await Promise.race([failure, (async () => {
    // Attach errors before navigation and avoid networkidle's mandatory delay.
    await page.goto(`${server.resolvedUrls.local[0]}${worldViewer ? 'world.html?preset=archipelago&seed=world-viewer-review' : ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      if (document.documentElement.dataset.assets === 'error') throw new Error('Game asset loading failed');
      return document.documentElement.dataset.assets === 'ready';
    });
    const defenses = await page.evaluate(async viewerMode => {
      const state = viewerMode ? window.__worldViewer.state : window.__game.state;
      const { isHumanFaction } = await import('/src/game/player-context.ts');
      const { buildingMaintenance, watchtowerMaintenance, WATCHTOWER_MAINTENANCE } = await import('/src/game/maintenance.ts');
      const ai = new Set(state.factions.filter(faction => faction.id >= 0 && faction.villageId === undefined
        && !isHumanFaction(state, faction.id)).map(faction => faction.id));
      const towers = state.buildings.filter(building => ai.has(building.faction) && building.kind === 'woodenTower');
      return { towers: towers.length,
        palisades: state.buildings.filter(building => ai.has(building.faction) && building.kind === 'palisade').length,
        charged: towers.filter(tower => buildingMaintenance(state, tower) !== 0).length,
        reserved: towers.filter(tower => watchtowerMaintenance(state, tower.faction, tower.kind) !== 0).length,
        humanRate: WATCHTOWER_MAINTENANCE };
    }, worldViewer);
    assert.ok(defenses.towers > 0, 'AI starting wooden towers must remain');
    assert.equal(defenses.palisades, 0, 'AI starting towers must not have palisade rings');
    assert.equal(defenses.charged, 0, 'AI wooden towers must not charge upkeep');
    assert.equal(defenses.reserved, 0, 'AI tower forecasts must not reserve upkeep');
    assert.equal(defenses.humanRate, 5, 'Human watchtower upkeep must retain its normal rate');
    if (worldViewer) {
      await page.waitForFunction(() => document.documentElement.dataset.worldViewer === 'ready');
      const result = await page.evaluate(async () => {
        const viewer = window.__worldViewer, state = viewer?.state, renderer = viewer?.renderer;
        if (!state?.units.length || !state.buildings.length) throw new Error('Viewer initial world is empty');
        const { isMapRevealed, presentationFog } = await import('/src/game/fog.ts');
        const { visibleReliefStamps, reliefImage, MIN_RELIEF_WIDTH } = await import('/src/game/relief-art.ts');
        const relief = visibleReliefStamps(state.world, 0, 0, state.world.width, state.world.height);
        const fog = presentationFog(state), top = renderer.screenPoint({ x: 0, y: 0 });
        const bottom = renderer.screenPoint({ x: state.world.width, y: state.world.height });
        return { fonts: document.documentElement.dataset.fonts, revealed: isMapRevealed(state) && fog.explored.every(Boolean),
          paused: state.paused && state.time === 0, fits: top.x >= 0 && top.y >= 0 && bottom.x <= renderer.width && bottom.y <= renderer.height,
          sprites: renderer.renderStats.sprites, menu: !!document.querySelector('.frontend'),
          parameters: state.world.generationParameters,
          reliefCount: relief.length,
          miniatureRelief: relief.filter(stamp => stamp.width < MIN_RELIEF_WIDTH).length,
          referenceHills: relief.filter(stamp => stamp.style >= 3).length,
          foothills: relief.filter(stamp => stamp.style >= 3 && stamp.slot < 4).length,
          interiorHills: relief.filter(stamp => stamp.style >= 3 && stamp.slot >= 8).length,
          stretchedHills: relief.filter(stamp => {
            if (stamp.style < 3) return false;
            const image = reliefImage(stamp.style, stamp.slot, stamp.palette);
            return !image || image.width !== stamp.width * 16 || image.height !== stamp.height * 16;
          }).length,
          displayedDensity: Number(document.querySelector('[data-parameter="islandDensity"]').value) };
      });
      assert.equal(result.fonts, 'ready');
      assert.ok(result.revealed, 'Viewer map must be fully revealed');
      assert.ok(result.paused, 'Viewer must keep the initial world frozen');
      assert.ok(result.fits, 'Whole map must fit on the first screen');
      assert.ok(result.sprites > 0, 'Viewer renderer must paint the world');
      assert.equal(result.menu, false, 'Viewer must start without the menu');
      assert.ok(result.reliefCount > 0, 'World must retain substantial hills and mountains');
      assert.equal(result.miniatureRelief, 0, 'World must not shrink relief below its native foothill size');
      assert.ok(result.referenceHills > 0 && result.foothills > 0 && result.interiorHills > 0,
        'Reference hills must graduate from small foothills to larger interior silhouettes');
      assert.equal(result.stretchedHills, 0, 'Reference hills must use whole native pixel dimensions');
      assert.equal(result.parameters.islandDensity, 1.8, 'Viewer must use the game archipelago preset');
      assert.equal(result.displayedDensity, result.parameters.islandDensity, 'Controls must show the generated settings');
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/world-viewer.png' });
      if (captureHills) {
        // Photograph the initial procedural terrain while the viewer stays frozen.
        const hills = await page.evaluate(async () => {
          const { state, renderer } = window.__worldViewer;
          const { visibleReliefStamps } = await import('/src/game/relief-art.ts');
          const stamps = visibleReliefStamps(state.world, 0, 0, state.world.width, state.world.height);
          const bins = new Map();
          for (const stamp of stamps) {
            if (stamp.style < 3 || stamp.palette !== 'grassland') continue;
            const x = stamp.x + stamp.width / 2, y = stamp.y + stamp.height / 2;
            const key = `${Math.floor(x / 12)}:${Math.floor(y / 12)}`;
            const bin = bins.get(key) || { count: 0, score: 0, x: 0, y: 0 };
            bin.count++; bin.score += stamp.width; bin.x += x; bin.y += y;
            bins.set(key, bin);
          }
          const focus = [...bins.values()].sort((a, b) => b.score - a.score)[0];
          if (!focus) throw new Error('No grassy reference range to capture');
          renderer.camera = { x: focus.x / focus.count, y: focus.y / focus.count };
          renderer.zoom = 2; renderer.draw(state, 0);
          return { referenceHills: stamps.filter(stamp => stamp.style >= 3).length,
            foothills: stamps.filter(stamp => stamp.style >= 3 && stamp.slot < 4).length,
            interiorHills: stamps.filter(stamp => stamp.style >= 3 && stamp.slot >= 8).length,
            paused: state.paused && state.time === 0 };
        });
        assert.ok(hills.paused, 'Hill capture must not advance the game');
        await page.screenshot({ path: 'output/startup/reference-hills.png' });
        console.log(`Reference hills: ${JSON.stringify(hills)}`);
      }
      if (captureAI) {
        // Photograph the initial AI city in the frozen viewer, without gameplay.
        await page.evaluate(() => {
          const { state, renderer } = window.__worldViewer;
          const city = state.buildings.find(building => building.kind === 'palace' && building.faction > 0 && building.villageId === undefined);
          renderer.camera = { x: city.x + 1, y: city.y + 1 };
          renderer.zoom = 1.4; renderer.draw(state, 0);
        });
        await page.screenshot({ path: 'output/startup/ai-start.png' });
      }
      if (captureUI) {
        // Render the real frontend over the frozen viewer for UI screenshots.
        // This never starts a scenario or drives gameplay.
        await page.evaluate(async () => {
          const { Frontend } = await import('/src/ui/frontend.ts');
          const host = document.createElement('div'); document.body.append(host);
          const preview = new Frontend(host, () => {});
          preview.show('scenarios');
          const sandbox = host.querySelector('[data-select-scenario="sandbox"]');
          sandbox.focus(); sandbox.click();
          await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
          window.__startupUI = preview;
        });
        await page.screenshot({ path: 'output/startup/sandbox.png' });
        await page.evaluate(() => window.__startupUI.loading('Loading', '', .67));
        const text = await page.locator('.frontend-loading.menu-sheet').evaluate(element => {
          const visible = element.cloneNode(true);
          // Clipped screen-reader labels are included by browser innerText.
          visible.querySelectorAll('.frontend-loading-accessible,progress').forEach(node => node.remove());
          return visible.textContent;
        });
        assert.equal(text.trim(), '67%', 'Loading must show only the percentage beside the spinner');
        await page.screenshot({ path: 'output/startup/loading.png' });
      }
      if (captureArms) await captureArmsPreview(page);
      return;
    }
    await page.getByRole('button', { name: 'Continue as guest', exact: true }).waitFor();
    await page.evaluate(() => {
      const game = window.__game;
      if (!game?.state.units.length || !game.state.buildings.length) throw new Error('Initial world is empty');
      if (document.documentElement.dataset.fonts !== 'ready') throw new Error('Game fonts are not ready');
      window.__startup = { frames: 0, time: game.state.time };
      const draw = game.renderer.draw;
      game.renderer.draw = function (...args) { draw.apply(this, args); window.__startup.frames++; };
      game.state.paused = false;
      game.replaceState(game.state);
    });
    await page.waitForFunction(() => window.__startup.frames >= 2
      && window.__game.state.time > window.__startup.time);
    const painted = await page.evaluate(() => {
      const renderer = window.__game.renderer;
      const sample = document.createElement('canvas'); sample.width = sample.height = 16;
      const context = sample.getContext('2d');
      context.drawImage(renderer.snapshot(), 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return renderer.renderStats.sprites > 0 && colors.size > 1;
    });
    assert.ok(painted, 'World renderer produced an empty or uniform frame');
    if (captureMenu) {
      await page.setViewportSize({ width: 1280, height: 960 });
      await page.evaluate(async () => {
        window.__game.state.paused = true;
        const { Frontend } = await import('/src/ui/frontend.ts');
        const host = document.createElement('div'); document.body.append(host);
        const preview = new Frontend(host, () => {});
        preview.setSession(true, false); preview.show('main');
        await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
        window.__menuReview = { preview, host };
      });
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/main-menu-account.png' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: 'output/startup/main-menu-account-mobile.png' });
      await page.evaluate(() => { window.__menuReview.host.remove(); });
    }
    if (captureArms) await captureArmsPreview(page);
    if (captureOffensive) await captureOffensivePreview(page);
    if (captureBuildings) await captureBuildingPreview(page);
    if (captureCannonFire) await captureCannonFirePreview(page);
    if (captureShellImpact) await captureShellImpactPreview(page);
    if (captureMeadow) await captureMeadowPreview(page);
    if (captureMilitary) {
      // Use a separate frozen state and renderer for visual review. No scenario
      // is started, no gameplay input is sent, and no save is changed.
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.evaluate(async () => {
        window.__game.state.paused = true;
        const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
        const { Renderer } = await import('/src/game/renderer.ts');
        const { BuildingActivityPopup } = await import('/src/ui/building-activity.ts');
        const { constructionEdges } = await import('/src/game/builders.ts');
        const { setMapRevealed } = await import('/src/game/fog.ts');
        const state = await createScenarioGame('musketry-deathmatch');
        state.paused = true; setMapRevealed(state, true);
        const faction = state.factions.find(faction => faction.id === 0);
        const academy = state.buildings.find(building => building.faction === 0 && building.kind === 'militaryAcademy');
        const leader = state.units.find(unit => unit.faction === 0 && unit.kind === 'leader');
        if (!academy || !leader) throw new Error('Military scenario lacks its academy or Leader');
        const host = document.createElement('div');
        Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
        host.innerHTML = '<canvas style="width:100%;height:520px;display:block"></canvas><canvas hidden></canvas><section class="building-activity" role="dialog" aria-labelledby="building-activity-title" hidden></section>';
        document.body.append(host);
        const [canvas, minimap] = host.querySelectorAll('canvas');
        const renderer = new Renderer(canvas, minimap); await renderer.initialize();
        renderer.follow = false;
        renderer.camera = { x: state.world.width / 2, y: state.world.height / 2 };
        renderer.zoom = Math.min(1400 / (state.world.width * 32), 900 / (state.world.height * 32));
        renderer.draw(state, 0);
        window.__militaryReview = { state, renderer, host, academy, leader, faction, BuildingActivityPopup, constructionEdges };
      });
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/musketry-deathmatch.png', clip: { x: 0, y: 0, width: 1440, height: 520 } });
      await page.evaluate(() => {
        const { state, renderer, host, academy, leader, faction, BuildingActivityPopup, constructionEdges } = window.__militaryReview;
        host.querySelector('canvas').style.height = '100%'; renderer.resize();
        faction.formationType = 'wide';
        const edge = constructionEdges(state, academy)[0];
        if (!edge) throw new Error('Military Academy has no accessible entrance');
        leader.x = edge.x; leader.y = edge.y; leader.inside = undefined;
        leader.facing = 0;
        renderer.camera = { x: academy.x + 2, y: academy.y + 2.5 }; renderer.zoom = 2;
        renderer.draw(state, 0);
        const popup = new BuildingActivityPopup(host.querySelector('section'), () => state,
          point => renderer.screenPoint(point), () => ({ width: renderer.width, height: renderer.height }), () => {}, () => {});
        popup.toggle(academy); window.__militaryReview.popup = popup;
      });
      await page.screenshot({ path: 'output/startup/military-academy.png' });
    }
  })()]);
  clearTimeout(timer);
  if (captureArt) {
    const { captureRuntimeArtReview } = await import('../tools/runtime-art/verify.mjs');
    await captureRuntimeArtReview(browser, server.resolvedUrls.local[0]);
  }
  console.log(`PASS startup: ${worldViewer ? 'world viewer, full reveal, frozen world, fit camera and screenshot' : 'browser imports, assets, fonts, simulation and world rendering'} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
} catch (error) {
  await mkdir('output/startup', { recursive: true });
  await Promise.allSettled([
    writeFile('output/startup/error.log', [error.stack || String(error), ...errors].join('\n')),
    page?.screenshot({ path: 'output/startup/failure.png', timeout: 2000 }),
  ]);
  throw error;
} finally {
  clearTimeout(timer);
  await browser?.close();
  await server.close();
}
