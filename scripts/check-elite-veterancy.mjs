import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = 'scratch/2026-10-31-veterancy-bolts';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage(), checks = [], errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const url = message.location().url || '';
  if (url.endsWith('/favicon.ico') && message.text().includes('404')) return;
  if (url.endsWith('/@vite/client') && message.text().includes('[vite] failed to connect to websocket')) return;
  errors.push(`${message.text()} ${url}`.trim());
});
// Do not let concurrent source editing replace our isolated fixture midway.
await page.routeWebSocket('**', socket => socket.close());
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
};
const settle = () => page.waitForTimeout(220);
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && ['ready', 'error'].includes(document.documentElement.dataset.assets));
  check('Game assets and runtime initialize', await page.evaluate(() => document.documentElement.dataset.assets === 'ready'), errors);
  if (await page.locator('#dialog').isVisible()) await page.keyboard.press('Escape');
  const balance = await page.evaluate(async () => {
    const { veterancy, VETERANCY_NAMES, unitDamage, unitDefense, incomingUnitDamage } = await import('/src/game/veterancy.ts');
    const regular = { kind: 'warrior', attack: 17, defense: 4, kills: 0 };
    const elite = { ...regular, kills: 500 }, hardened = { ...regular, kills: 250 };
    return { names: [0, 10, 100, 250, 500].map(kills => VETERANCY_NAMES[veterancy({ kills })]),
      thresholds: [249, 250, 499, 500].map(kills => veterancy({ kills })),
      baseline: unitDamage(regular, 4), eliteOutgoing: unitDamage(elite, 4), eliteIncoming: incomingUnitDamage(elite, unitDamage(regular, unitDefense(elite))),
      hardenedOutgoing: unitDamage(hardened, 4), hardenedDefense: unitDefense(hardened) };
  });
  check('All five rank names and 250/500 thresholds match', balance.names.join(',') === 'Untrained,Regular,Veteran,Hardened,Elite'
    && balance.thresholds.join(',') === '2,3,3,4', balance);
  check('Elite deals 130% more actual damage and receives 85% less', Math.abs(balance.eliteOutgoing / balance.baseline - 2.3) < 1e-10
    && Math.abs(balance.eliteIncoming / balance.baseline - .15) < 1e-10, balance);
  check('Hardened retains the former Elite attack and armor', balance.hardenedOutgoing === 17.5 && balance.hardenedDefense === 12, balance);
  await page.evaluate(async () => {
    const { updateFog } = await import('/src/game/fog.ts');
    const game = window.__game;
    const world = { width: 48, height: 36, seed: 'veterancy-lineup', source: 'in-game QA fixture', spawns: [], revision: 0,
      tiles: Array.from({ length: 48 * 36 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: ((i * 17) % 31) / 31 })) };
    const soldier = (id, x, y, kills, hp = 100) => ({ id, kind: 'warrior', faction: 0, x, y, kills, hp, maxHp: 100, morale: 100,
      attack: 17, defense: 4, speed: 3.96, range: 1.1, order: 'follow', cooldown: 0, lastCombat: -60,
      moving: false, facing: Math.PI / 2, attackTime: 0, retinueStance: 'aggressive' });
    const ranks = [0, 10, 100, 250, 500];
    const units = [ { ...soldier(10, 20.5, 22.5, 0), kind: 'leader', attack: 25, defense: 5, range: 4 },
      ...ranks.map((kills, index) => soldier(20 + index, 14.5 + index * 3, 16.5, kills)),
      ...ranks.map((kills, index) => ({ ...soldier(30 + index, 14.5 + index * 3, 19.5, kills, 65), order: 'hold', retinueStance: 'hold' })) ];
    const building = (id, kind, x, y) => ({ id, kind, faction: 0, x, y, hp: 650, maxHp: 650, capacity: kind === 'palace' ? 4 : 4 });
    game.replaceState({ ...game.state, world, buildings: [{ ...building(1, 'palace', 19, 24), cityName: 'Roma' },
      building(2, 'house', 16, 24), building(3, 'house', 23, 24)], units,
      factions: [{ id: 0, name: 'Roma', color: '#c94c4c', affinity: 100, relation: 'self', food: 500, gold: 500, production: 0, population: 20, culture: 10000,
        yields: { food: 8, gold: 19, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
      villages: [], wildlife: undefined, retinueSquads: [], forbiddenZones: undefined, fields: [], treasures: [], raiderCamps: [], marauderPacks: [],
      tradeRoutes: [], traffic: {}, campRoads: {}, treeClearings: [], projectiles: [], bloodEffects: [], casualties: [],
      time: 5, tick: 0, paused: true, speed: 1, gameOver: false, victory: false, victoryContinued: false, events: [], particles: [],
      selected: 24, selectedType: 'unit', buildMode: null, diplomacy: null, fog: undefined, retinueStance: 'aggressive', movementMode: 'travel' });
    updateFog(game.state); game.renderer.prepare(game.state);
    game.renderer.follow = false; game.renderer.camera = { x: 20.5, y: 19.5 }; game.renderer.zoom = 2.35;
  });
  await settle();
  const rankArt = await page.evaluate(async () => {
    const { drawVeterancy } = await import('/src/game/veterancy.ts');
    const { state } = window.__game;
    return [0, 10, 100, 250, 500].map(kills => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
      const ctx = canvas.getContext('2d');
      drawVeterancy(ctx, { ...state.units[1], kills }, 32, 32, 32);
      const pixels = ctx.getImageData(0, 0, 96, 96).data;
      let left = 96, top = 96, right = -1, bottom = -1, count = 0;
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (pixels[(y * 96 + x) * 4 + 3] > 100) {
        count++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      return { kills, left, top, right, bottom, count, image: canvas.toDataURL() };
    });
  });
  check('Untrained has no badge and four promoted ranks have distinct artwork', rankArt[0].count === 0
    && rankArt.slice(1).every(result => result.count > 10) && new Set(rankArt.slice(1).map(result => result.image)).size === 4, rankArt.map(({ image, ...rest }) => rest));
  check('Rank markers fit inside their rendering atlas bounds', rankArt.slice(1).every(result => result.left >= 32 && result.right < 64 && result.top >= 16 && result.bottom < 64), rankArt.map(({ image, ...rest }) => rest));
  const brightCore = await page.evaluate(async () => {
    const { drawRankMarker } = await import('/src/game/veterancy-art.ts');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    drawRankMarker(canvas.getContext('2d'), 4, 32, 32, 32, '3A');
    return canvas.toDataURL();
  });
  check('Elite uses the selected Bright core artwork', rankArt[4].image === brightCore);
  const details = await page.locator('#selection-panel').getAttribute('title');
  check('Selected Elite exposes rank and resistance in its tooltip', /Elite/.test(details) && /85%/.test(details), details);
  const eliteName = await page.locator('#selection-name').textContent();
  check('Selected unit remains identifiable', /warrior|elite/i.test(eliteName), eliteName);
  const eliteUi = await page.evaluate(() => {
    const rank = document.querySelector('.selection-rank'), resistance = document.querySelector('.selection-defense-value small');
    const panel = document.querySelector('#selection-panel').getBoundingClientRect();
    const contained = node => { const rect = node?.getBoundingClientRect(); return !!rect && rect.left >= panel.left && rect.right <= panel.right && rect.top >= panel.top && rect.bottom <= panel.bottom; };
    return { rank: rank?.textContent, resistance: resistance?.textContent, contained: contained(rank) && contained(resistance) };
  });
  check('Elite rank and damage resistance remain visible inside the selection panel', eliteUi.rank === 'Elite' && eliteUi.resistance === '−85%' && eliteUi.contained, eliteUi);
  await page.screenshot({ path: `${output}/veterancy-in-game.png` });
  await page.evaluate(() => { window.__game.state.selected = 23; }); await settle();
  const hardenedTitle = await page.locator('#selection-panel').getAttribute('title');
  check('Hardened name is exposed at 250 kills', /Hardened/.test(hardenedTitle), hardenedTitle);
  await page.evaluate(() => { window.__game.state.selected = 24; }); await settle();
  check('No runtime or game asset errors', errors.length === 0, errors);
  // The gallery is a separate, offline document using production badge and unit artwork.
  const gallery = await context.newPage(), galleryErrors = [], externalRequests = [];
  gallery.on('pageerror', error => galleryErrors.push(String(error)));
  gallery.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
  await gallery.goto(pathToFileURL(resolve(output, 'index.html')).href, { waitUntil: 'load' });
  await gallery.waitForFunction(() => document.documentElement.dataset.assets === 'ready');
  check('Standalone gallery loads all six options offline', await gallery.locator('.option').count() === 6 && externalRequests.length === 0, externalRequests);
  check('Gallery opens on Bright core and labels it as the in-game style', await gallery.evaluate(() => window.__boltPreview.choice === '3A'
    && document.querySelector('#chosen').textContent === '3A · Bright core'
    && document.querySelector('#current-style').textContent.includes('3A · Bright core')));
  const variantImages = [];
  for (const id of ['1A', '1B', '2A', '2B', '3A', '3B']) {
    await gallery.locator(`[data-variant="${id}"]`).click();
    variantImages.push(await gallery.evaluate(() => ({ choice: window.__boltPreview.choice, image: document.querySelector('#lineup').toDataURL() })));
  }
  check('Each thunderbolt choice updates the rank lineup', variantImages.map(item => item.choice).join(',') === '1A,1B,2A,2B,3A,3B'
    && new Set(variantImages.map(item => item.image)).size === 6, variantImages.map(item => item.choice));
  await gallery.locator('[data-variant="3A"]').click();
  await gallery.locator('#options').screenshot({ path: `${output}/thunderbolt-options.png` });
  await gallery.screenshot({ path: `${output}/thunderbolt-gallery.png`, fullPage: true });
  const grass = await gallery.locator('#crowd').evaluate(canvas => canvas.toDataURL());
  await gallery.locator('#sand').check();
  check('Desert preview changes the terrain', grass !== await gallery.locator('#crowd').evaluate(canvas => canvas.toDataURL()));
  await gallery.locator('#animate').check(); await gallery.waitForTimeout(250); await gallery.locator('#animate').uncheck();
  await gallery.locator('#zoom').evaluate(input => { input.value = '2.5'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  check('Scale control updates to 2.5×', await gallery.locator('#zoom-value').textContent() === '2.5×');
  await gallery.setViewportSize({ width: 390, height: 844 });
  check('Gallery fits a narrow screen without document overflow', await gallery.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await gallery.screenshot({ path: `${output}/thunderbolt-mobile.png`, fullPage: true });
  check('Gallery has no browser errors', galleryErrors.length === 0, galleryErrors);
  writeFileSync(`${output}/browser-report.json`, JSON.stringify({ checks, errors, galleryErrors, balance, rankArt: rankArt.map(({ image, ...rest }) => rest) }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/qa-failure.png` });
  writeFileSync(`${output}/browser-report.json`, JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
