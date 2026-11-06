import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-01-mounted-tower-supports';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.keyboard.press('Escape');
  const result = await page.evaluate(async () => {
    const { drawBuilding } = await import('/src/game/sprites.ts');
    const { PixiScene } = await import('/src/game/pixi-scene.ts');
    const { indexBuildings, towerMountedOnWall } = await import('/src/game/renderer.ts');
    const { updateFog } = await import('/src/game/fog.ts');
    const make = (id, kind, x = 0, y = 0, extra = {}) => ({ id, kind, x, y, faction: 0, hp: 600, maxHp: 600, capacity: 0, ...extra });
    const tower = make(1, 'woodenTower'), horizontal = { north: false, east: true, south: false, west: true };
    const vertical = { north: true, east: false, south: true, west: false };
    const corner = { north: false, east: true, south: true, west: false };
    const canvas = (width, height) => { const c = document.createElement('canvas'); c.width = width; c.height = height; c.getContext('2d').imageSmoothingEnabled = false; return c; };
    const reference = (mounted, kind, links) => {
      const c = canvas(48, 72), ctx = c.getContext('2d');
      if (kind) drawBuilding(ctx, make(2, kind), 8, 32, 32, 0, '#ee3434', links);
      drawBuilding(ctx, tower, 8, 32, 32, 0, '#ee3434', undefined, undefined, mounted);
      return c;
    };
    const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const diff = (a, b) => { const left = pixels(a), right = pixels(b); return left.reduce((n, v, i) => n + Number(v !== right[i]), 0); };
    const standalone = reference(false), mounted = reference(true), normalPixels = pixels(standalone), mountedPixels = pixels(mounted);
    let standaloneLower = 0, mountedLower = 0;
    for (let y = 42; y < 72; y++) for (let x = 0; x < 48; x++) {
      standaloneLower += Number(normalPixels[(y * 48 + x) * 4 + 3] > 0);
      mountedLower += Number(mountedPixels[(y * 48 + x) * 4 + 3] > 0);
    }
    const comparison = canvas(900, 720), ctx = comparison.getContext('2d');
    ctx.fillStyle = '#162321'; ctx.fillRect(0, 0, 900, 720);
    ctx.fillStyle = '#f0dfb3'; ctx.font = 'bold 26px "Pixel Operator"'; ctx.fillText('Watchtowers mounted on walls', 30, 36);
    ctx.font = '20px "Pixel Operator"';
    ctx.fillStyle = '#bcc4b0'; ctx.fillText('Before', 300, 72); ctx.fillText('After', 530, 72); ctx.fillText('Standalone', 730, 72);
    const cases = [['Horizontal stone wall', 'wall', horizontal], ['Vertical stone wall', 'wall', vertical],
      ['Stone corner', 'wall', corner], ['Palisade', 'palisade', horizontal]];
    cases.forEach(([label, kind, links], row) => {
      const y = 100 + row * 150;
      ctx.fillStyle = '#d6d9bc'; ctx.fillText(label, 30, y + 60);
      for (const [column, image] of [reference(false, kind, links), reference(true, kind, links), standalone].entries()) {
        const x = 290 + column * 210;
        ctx.fillStyle = '#90a446'; ctx.fillRect(x - 8, y - 4, 112, 140);
        ctx.drawImage(image, x, y, 96, 144);
      }
    });
    const scene = new PixiScene(); await scene.initialize(document.createElement('canvas'), 144, 72, 1);
    const frame = [];
    for (const repeat of [false, true]) {
      scene.beginFrame();
      for (const [column, attached] of [false, true, false].entries()) scene.sprite(scene.art.building(tower, 0, '#ee3434', undefined, undefined, attached), column * 48 + 8, 32);
      scene.finishFrame(); const actual = pixels(scene.snapshot());
      let compared = 0, differences = 0;
      for (const [column, expected] of [normalPixels, mountedPixels, normalPixels].entries())
        for (let y = 0; y < 72; y++) for (let x = 0; x < 48; x++) {
          const a = (y * 48 + x) * 4, b = (y * 144 + column * 48 + x) * 4;
          if (expected[a + 3] !== 255) continue;
          compared++; if ([0, 1, 2].some(channel => expected[a + channel] !== actual[b + channel])) differences++;
        }
      frame.push({ repeat, compared, differences, stats: { ...scene.stats } });
    }
    scene.destroy();
    const buildings = [make(10, 'palace', 17, 16, { cityName: 'Roma', initialCity: true, capacity: 20, unhousedResidents: 20 }),
      make(11, 'woodenTower', 15, 11), make(12, 'woodenTower', 26, 13), make(13, 'woodenTower', 15, 20), make(14, 'woodenTower', 23, 20),
      make(15, 'woodenTower', 21, 15), make(16, 'guardPost', 20, 18)];
    let id = 100;
    for (let x = 12; x <= 18; x++) buildings.push(make(id++, 'wall', x, 11));
    for (let y = 10; y <= 16; y++) buildings.push(make(id++, 'wall', 26, y));
    for (let x = 15; x <= 18; x++) buildings.push(make(id++, 'wall', x, 20));
    for (let y = 20; y <= 22; y++) if (y !== 20) buildings.push(make(id++, 'wall', 15, y));
    for (let x = 21; x <= 26; x++) buildings.push(make(id++, 'palisade', x, 20));
    const state = {
      world: { width: 40, height: 32, seed: 'mounted-tower-art', source: 'isolated QA', spawns: [], revision: 1,
        tiles: Array.from({ length: 1280 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
          moisture: .7, food: 3, production: 1, gold: 0, variation: (i % 13) / 13 })) }, buildings,
      units: [{ id: 20, kind: 'leader', faction: 0, x: 19.5, y: 15, hp: 100, maxHp: 100, morale: 100,
        attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
        moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Romans', color: '#ee3434', affinity: 100, relation: 'self', food: 500,
        gold: 1000, population: 20, production: 0, culture: 10000, yields: { food: 0, gold: 20, production: 0 },
        nextRaid: Infinity, defeated: false }], time: 10, tick: 0, paused: true, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [], fields: [],
      treeClearings: [], selected: 20, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
      seed: 'mounted-tower-art', rngState: 1, raiderCamps: [], marauderPacks: [], treasures: [], villages: [],
      fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 }, roamingMaraudersVersion: 1,
    };
    __game.replaceState(state); updateFog(state); __game.renderer.prepare(state);
    __game.renderer.zoom = 1.6; __game.renderer.camera = { x: 19.5, y: 16 }; __game.renderer.follow = false;
    const index = indexBuildings(state.buildings), mountedIds = state.buildings.filter(b => towerMountedOnWall(b, index)).map(b => b.id);
    return { image: comparison.toDataURL(), standaloneLower, mountedLower, frame, mountedIds,
      standaloneUnchanged: diff(standalone, reference(false)) === 0 };
  });
  writeFileSync(`${output}/before-after.png`, Buffer.from(result.image.split(',')[1], 'base64')); delete result.image;
  assert.equal(result.mountedLower, 0); assert.ok(result.standaloneLower > 100);
  assert.equal(result.standaloneUnchanged, true); assert.deepEqual(result.mountedIds, [11, 12, 13, 14]);
  for (const frame of result.frame) { assert.ok(frame.compared > 100); assert.equal(frame.differences, 0); }
  await page.waitForTimeout(250); await page.screenshot({ path: `${output}/mounted-towers-in-game.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/browser-report.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ ...result, errors }, null, 2));
} finally { await browser.close(); }
