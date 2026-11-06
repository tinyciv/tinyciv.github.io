import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-03-irrigation-layering'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), checks = [], errors = [];
page.on('pageerror', error => errors.push(String(error))); await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
const check = (name, pass, data) => { checks.push({ name, pass: !!pass, data }); console.log(name, !!pass, JSON.stringify(data)); assert.ok(pass, name); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const pixels = await page.evaluate(async () => {
    const width = 36, height = 26, world = { width, height, seed: 'irrigation-layering-qa', source: 'isolated visual QA', spawns: [], revision: 1,
      tiles: Array.from({ length: width * height }, (_, cell) => ({ terrain: Math.floor(cell / width) === 4 ? 'river' : cell % width >= 22 ? 'desert' : 'grassland',
        overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 0, gold: 0, variation: cell % 11 / 11 })) };
    world.tiles[7 * width + 9].overlay = 'forest'; world.tiles[7 * width + 25].palm = true;
    let id = 100;
    const building = (kind, x, y, extra = {}) => ({ id: id++, kind, x, y, faction: 0, hp: 500, maxHp: 500, capacity: 0, ...extra });
    const buildings = [building('palace', 16, 18, { cityName: 'Roma', capacity: 20, unhousedResidents: 20, governorPermissions: { farms: false, housing: false } })], fields = [];
    for (const x of [9, 17, 25]) for (let y = 5; y <= 13; y++) buildings.push(building('irrigation', x, y));
    for (const center of [9, 17, 25]) for (let y = 8; y <= 10; y++) for (let x = center - 1; x <= center + 1; x++) {
      const orchard = center === 17 ? { startedAt: 0, readyAt: 120 } : undefined;
      const camp = building('camp', x, y, { orchard }); buildings.push(camp);
      fields.push({ id: id++, camp: camp.id, faction: 0, x, y, planted: true, food: 0, nextHarvest: 180, orchard });
    }
    const units = [9, 17, 25].map((x, index) => ({ id: 10 + index, kind: index === 1 ? 'leader' : 'scout', faction: 0, x: x + .5, y: 12.5,
      hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 4, speed: 0, range: 1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }));
    const base = { world, buildings, fields, units, factions: [{ id: 0, name: 'Romans', color: '#c94c4c', affinity: 100, relation: 'self', population: 20,
        food: 200, gold: 2000, production: 0, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
      time: 145, tick: 0, paused: true, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [], treasures: [], raiderCamps: [], marauderPacks: [], villages: [], treeClearings: [],
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 },
      selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, victoryContinued: true, seed: world.seed, rngState: 1,
      retinueStance: 'hold', movementMode: 'travel', traffic: {}, fog: { width, height, seed: world.seed, explored: Array(width * height).fill(1) } };
    const renderer = __game.renderer;
    function render(mode) {
      const state = structuredClone(base);
      if (mode === 'terrain' || mode === 'noTrees') { state.fields = []; state.buildings = state.buildings.filter(b => b.kind === 'palace'); }
      if (mode === 'noTrees') { state.world.tiles[7 * width + 9].overlay = 'none'; state.world.tiles[7 * width + 25].palm = false; }
      if (mode === 'noDitch') state.buildings = state.buildings.filter(b => b.kind !== 'irrigation');
      __game.replaceState(state); renderer.prepare(state); renderer.follow = false; renderer.camera = { x: 17.5, y: 9.8 }; renderer.zoom = 2;
      renderer.draw(state, 0); const canvas = renderer.gpu.snapshot(); return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    }
    const terrain = render('terrain'), bareTrees = render('noTrees'), fieldOnly = render('noDitch'), complete = render('complete');
    const color = (image, x, y) => {
      const point = renderer.screenPoint({ x, y }), at = (Math.floor(point.y) * image.width + Math.floor(point.x)) * 4;
      return Array.from(image.data.slice(at, at + 4));
    };
    const equal = (a, b) => a.every((v, i) => v === b[i]);
    const results = [9, 25].map(x => {
      let checked = 0, exact = 0, cropBeside = 0, water = 0; const palette = new Set();
      for (let y = 2; y < 14; y++) {
        for (const px of [5, 9]) { const point = [x + (px + .5) / 16, 9 + (y + .5) / 16], ground = color(terrain, ...point);
          checked++; if (equal(color(complete, ...point), ground)) exact++; palette.add(ground.slice(0, 3).join(',')); }
        for (const px of [3, 11]) { const point = [x + (px + .5) / 16, 9 + (y + .5) / 16]; if (!equal(color(complete, ...point), color(terrain, ...point))) cropBeside++; }
        const point = [x + 7.5 / 16, 9 + (y + .5) / 16]; if (!equal(color(complete, ...point), color(terrain, ...point))) water++;
      }
      return { terrain: x === 9 ? 'grassland' : 'desert', checked, exact, cropBeside, water, palette: [...palette] };
    });
    // A canopy or orchard's native center must match its no-ditch appearance;
    // this catches a channel being composited later over opaque crown pixels.
    const crowns = [[9, 7, 'forest'], [25, 7, 'palm'], [17, 9, 'orchard']].map(([x, y, kind]) => {
      let compared = 0, identical = 0;
      for (let py = 1; py < 11; py++) for (const px of [6, 7, 8]) {
        const point = [x + (px + .5) / 16, y + (py + .5) / 16], crown = color(fieldOnly, ...point), bare = color(kind === 'orchard' ? terrain : bareTrees, ...point);
        if (equal(crown, bare)) continue;
        compared++; if (equal(crown, color(complete, ...point))) identical++;
      }
      return { kind, compared, identical };
    });
    return { results, crowns };
  });
  for (const result of pixels.results) check(`${result.terrain} buffer exactly preserves underlying terrain and retains neighboring crops and water`,
    result.checked === result.exact && result.cropBeside > 10 && result.water === 12, result);
  for (const crown of pixels.crowns) check(`${crown.kind} canopy remains uncut above its ditch`, crown.compared > 10 && crown.identical === crown.compared, crown);
  await page.waitForTimeout(150); await page.screenshot({ path: `${output}/grass-desert-orchard.png` });
  await page.evaluate(() => { __game.renderer.camera = { x: 9.5, y: 9 }; __game.renderer.zoom = 4; __game.renderer.draw(__game.state, 0); });
  await page.screenshot({ path: `${output}/grass-close-up.png` });
  await page.evaluate(() => { __game.renderer.camera = { x: 25.5, y: 9 }; __game.renderer.zoom = 4; __game.renderer.draw(__game.state, 0); });
  await page.screenshot({ path: `${output}/desert-close-up.png` });
  check('no browser errors', errors.length === 0, errors);
} finally { writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
