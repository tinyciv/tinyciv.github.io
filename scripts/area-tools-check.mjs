import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-10-31-unified-area-tools';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const checks = [], errors = [], report = { checks, errors };
page.on('pageerror', error => errors.push(String(error)));
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ` ${JSON.stringify(detail)}`}`); };
const settle = () => page.waitForTimeout(210);
const screen = point => page.evaluate(point => window.__game.renderer.screenPoint(point), point);
const worldMouse = async (point, action = 'move') => {
  const p = await screen(point);
  assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, p), 'world', 'World input must not hit a HUD overlay');
  await page.mouse[action](p.x, p.y); return p;
};
const drag = async (start, end, screenshot) => {
  await worldMouse(start); await page.mouse.down();
  const target = await screen(end); await page.mouse.move(target.x, target.y, { steps: 12 });
  await settle();
  if (screenshot) await page.screenshot({ path: `${output}/${screenshot}.png` });
  await page.mouse.up(); await settle();
};
const dragButton = async (tool, target) => {
  const button = await page.locator(`[data-action="${tool}"]`).boundingBox();
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2); await page.mouse.down();
  const p = await screen(target); await page.mouse.move(p.x, p.y, { steps: 24 });
  await settle(); await page.mouse.up(); await settle();
};
async function fixture(buildings = [], trees = []) {
  await page.keyboard.press('Escape');
  await page.evaluate(async ({ buildings, trees }) => {
    const { updateFog } = await import('/src/game/fog.ts');
    const { queueConstruction } = await import('/src/game/structures.ts');
    const game = window.__game;
    const world = { width: 48, height: 36, seed: `area-${Math.random()}`, source: 'browser fixture', spawns: [], revision: 0,
      tiles: Array.from({ length: 48 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .3 })) };
    for (const tree of trees) world.tiles[tree.y * world.width + tree.x].overlay = 'forest';
    const leader = { id: 2, kind: 'leader', faction: 0, x: 20.5, y: 18.5, hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
    const faction = (id, name) => ({ id, name, color: id ? '#ff4938' : '#3988ff', affinity: id ? 0 : 100, relation: id ? 'war' : 'self',
      food: 500, gold: 1000, production: 0, population: 5, culture: 0, growth: 0,
      yields: { food: 11.3, gold: 19.7, production: 0 }, nextRaid: 1e9, defeated: false });
    game.replaceState({ ...game.state,  world, buildings: [
      { id: 1, kind: 'palace', faction: 0, x: 14, y: 17, hp: 650, maxHp: 650, capacity: 0, cityName: 'Ashford' },
      // Keep a rival realm alive while its individual buildings are cleared.
      { id: 900, kind: 'palace', faction: 1, x: 40, y: 30, hp: 650, maxHp: 650, capacity: 0, cityName: 'Rival' }],
      units: [leader], factions: [faction(0, 'Test'), faction(1, 'Enemy')], time: 5, tick: 0, paused: true, speed: 1, gameOver: false,
      victory: false, events: [], particles: [], projectiles: [], fields: [], treasures: [], raiderCamps: [], marauderPacks: [],
      treeClearings: [], treeStumps: [], forbiddenZones: { cells: [], revision: 0 }, villages: [], tradeRoutes: [],
      roamingMaraudersVersion: 1, selected: 2, selectedType: 'unit', buildMode: null, diplomacy: null,
      seed: world.seed, rngState: 1, fog: undefined, retinueStance: 'aggressive', movementMode: 'travel', traffic: {}, campRoads: {}  });
    for (const spec of buildings) {
      const building = { id: spec.id, kind: spec.kind ?? 'house', faction: spec.faction ?? 0, x: spec.x, y: spec.y,
        hp: 160, maxHp: 160, capacity: spec.kind === 'house' || !spec.kind ? 4 : 0 };
      if (spec.pending) queueConstruction(building, game.state.time, spec.paid ?? 125);
      if (spec.partial) { queueConstruction(building, 0, spec.paid ?? 40); building.construction.waitingForBuilder = false; }
      window.__game.entities(game.state).buildings.add(building);
    }
    updateFog(game.state); game.renderer.prepare(game.state);
    game.renderer.follow = false; game.renderer.camera = { x: 20, y: 18 }; game.renderer.zoom = 1.5;
  }, { buildings, trees });
  await settle();
}
const snapshot = () => page.evaluate(() => ({ ids: window.__game.state.buildings.map(b => b.id),
  gold: window.__game.state.factions[0].gold, trees: window.__game.state.treeClearings,
  status: document.querySelector('#build-status').textContent }));
async function tilePixels(point) {
  const clip = await page.evaluate(point => {
    const game = window.__game, p = game.renderer.screenPoint(point), size = 32 * game.renderer.zoom;
    return { x: Math.round(p.x - size / 2), y: Math.round(p.y - size / 2), width: Math.round(size), height: Math.round(size) };
  }, point);
  // Read the rendered browser pixels: the world canvas may use WebGL/Pixi and
  // cannot provide a 2D context. Decode only this tile-sized screenshot.
  const png = await page.screenshot({ clip });
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
    const pixels = Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
    bitmap.close(); return pixels;
  }, [...png]);
}
const differentPixels = (a, b) => a.reduce((n, value, i) => n + Number(i % 4 === 0 && (value !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])), 0);

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5176/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await fixture([{ id: 10, x: 18, y: 14, pending: true }, { id: 11, x: 20, y: 16, kind: 'woodenTower', partial: true, paid: 40 },
    { id: 12, x: 18, y: 16 }, { id: 13, x: 20, y: 14, pending: true, faction: 1 }, { id: 14, x: 22, y: 16, pending: true }]);
  const rates = await page.locator('.resource.food, .resource.gold').evaluateAll(elements => elements.map(element => element.title));
  check('Resource tooltips round positive income rates to whole numbers', JSON.stringify(rates) === JSON.stringify(['Food · +11 per 30 seconds', 'Gold · +20 per 30 seconds']), rates);
  await page.evaluate(() => { window.__game.state.factions[0].yields = { food: -.3, gold: -1.6, production: 0 }; }); await settle();
  const negativeRates = await page.locator('.resource.food, .resource.gold').evaluateAll(elements => elements.map(element => element.title));
  check('Resource tooltips round negative rates without showing negative zero', JSON.stringify(negativeRates) === JSON.stringify(['Food · +0 per 30 seconds', 'Gold · -2 per 30 seconds']), negativeRates);
  await page.locator('[data-action="clear"]').click();
  await drag({ x: 18.5, y: 14.5 }, { x: 20.5, y: 16.5 }, 'clear-mixed-rectangle');
  let result = await snapshot();
  check('Clear cancels both unfinished friendly sites with proportional refund', !result.ids.includes(10) && !result.ids.includes(11) && result.gold === 1151, result);
  check('Same Clear rectangle removes completed and foreign in-border property while preserving outside sites', !result.ids.includes(12) && !result.ids.includes(13) && result.ids.includes(14), result);
  await drag({ x: 18.5, y: 14.5 }, { x: 20.5, y: 16.5 });
  check('Repeating Clear never refunds a site twice', (await snapshot()).gold === 1151);

  await fixture([{ id: 10, x: 18, y: 14 }, { id: 11, x: 20, y: 16, pending: true }, { id: 12, x: 20, y: 14, faction: 1 }, { id: 13, x: 22, y: 16 }]);
  const foreignWithinBorders = await page.evaluate(async () => {
    const { buildingWithinBorders } = await import('/src/game/property-territory.ts');
    const state = window.__game.state;
    return buildingWithinBorders(state, state.buildings.find(building => building.id === 12), 0);
  });
  check('Completed rival house establishes a claim outside player borders', !foreignWithinBorders);
  await page.keyboard.press('c');
  await drag({ x: 20.5, y: 16.5 }, { x: 18.5, y: 14.5 }, 'clear-reverse-rectangle');
  result = await snapshot();
  check('Reverse Clear rectangle removes completed structures and refunds only queued friendly work', !result.ids.includes(10) && !result.ids.includes(11) && result.gold === 1125, result);
  check('Clear preserves foreign property outside player borders and buildings outside the rectangle', result.ids.includes(12) && result.ids.includes(13), result);

  await fixture([{ id: 10, x: 18, y: 14, pending: true }, { id: 11, x: 20, y: 16, pending: true }]);
  await dragButton('clear', { x: 18.5, y: 14.5 }); result = await snapshot();
  check('Dragging Clear directly to construction cancels only its drop target and refunds unused gold', !result.ids.includes(10) && result.ids.includes(11) && result.gold === 1125, result);
  await fixture([{ id: 10, x: 18, y: 14 }, { id: 11, x: 20, y: 16 }]);
  await dragButton('clear', { x: 18.5, y: 14.5 }); result = await snapshot();
  check('Dragging Clear directly to a completed building removes only its drop target without refund', !result.ids.includes(10) && result.ids.includes(11) && result.gold === 1000, result);
  await page.screenshot({ path: `${output}/direct-tool-drop.png` });

  const trees = [];
  for (let y = 13; y <= 15; y++) for (let x = 17; x <= 19; x++) trees.push({ x, y });
  trees.push({ x: 20, y: 15 });
  await fixture([], trees);
  await page.locator('[data-action="clear"]').click();
  await drag({ x: 17.5, y: 13.5 }, { x: 19.5, y: 15.5 }, 'clear-trees-rectangle'); result = await snapshot();
  check('clear-tree rectangle marks all nine cells including off-line corners', result.trees.length === 9
    && result.trees.some(p => p.x === 17 && p.y === 15) && result.trees.some(p => p.x === 19 && p.y === 13), result);
  check('clear-tree drag leaves trees outside the rectangle unmarked', !result.trees.some(p => p.x === 20), result);

  await fixture([], [{ x: 17, y: 13 }, { x: 18, y: 13 }, { x: 19, y: 13 }]);
  await page.locator('[data-action="forbid"]').click();
  await drag({ x: 17.5, y: 13.5 }, { x: 18.5, y: 13.5 }, 'forbid-tree-area');
  check('Forbid marks both cells in a horizontal rectangle', await page.evaluate(() => window.__game.state.forbiddenZones.cells.length === 2));
  await page.keyboard.press('c');
  await drag({ x: 17.5, y: 13.5 }, { x: 19.5, y: 13.5 }); result = await snapshot();
  check('Clear skips forbidden trees while marking the eligible tree in the same drag', result.trees.length === 1 && result.trees[0].x === 19, result);
  await page.locator('[data-action="forbid"]').click();
  await drag({ x: 17.5, y: 13.5 }, { x: 18.5, y: 13.5 });
  check('Dragging Forbid from inside a zone allows that area again', await page.evaluate(() => window.__game.state.forbiddenZones.cells.length === 0));
  await page.keyboard.press('c');
  await drag({ x: 17.5, y: 13.5 }, { x: 19.5, y: 13.5 }); result = await snapshot();
  check('Clear marks newly allowed trees without duplicating the earlier order', result.trees.length === 3, result);

  const curtain = [];
  for (let y = 8; y <= 28; y++) for (let x = 22; x <= 26; x++) curtain.push({ x, y });
  await fixture([{ id: 10, kind: 'road', x: 26, y: 18 }], curtain);
  const fogBefore = await page.evaluate(async () => {
    const { updateFog, isVisible } = await import('/src/game/fog.ts');
    const state = window.__game.state, fog = updateFog(state);
    return { visible: isVisible(state, 27.5, 18.5), explored: fog.explored[18 * 48 + 27], count: fog.explored.reduce((n, x) => n + x, 0) };
  });
  check('fog fixture target begins unobserved and unexplored', !fogBefore.visible && !fogBefore.explored, fogBefore);
  await page.mouse.move(10, 10); await settle();
  const fogPixels = await tilePixels({ x: 27.5, y: 18.5 });
  await page.locator('[data-action="build"]').click(); await page.locator('[data-build="road"]').click();
  await worldMouse({ x: 27.5, y: 18.5 }); await settle();
  const previewPixels = await tilePixels({ x: 27.5, y: 18.5 });
  const previewStatus = await page.locator('#build-status').textContent();
  check('a legal footprint is drawn over fog', differentPixels(fogPixels, previewPixels) > 100 && !previewStatus.includes('Cannot'), { changed: differentPixels(fogPixels, previewPixels), previewStatus });
  await page.screenshot({ path: `${output}/fog-road-preview.png` });
  await worldMouse({ x: 27.5, y: 18.5 }, 'click');
  await page.keyboard.press('Escape'); await page.mouse.move(10, 10); await settle();
  const queuedPixels = await tilePixels({ x: 27.5, y: 18.5 });
  const fogAfter = await page.evaluate(async () => {
    const { updateFog, isVisible } = await import('/src/game/fog.ts');
    const state = window.__game.state, fog = updateFog(state);
    return { visible: isVisible(state, 27.5, 18.5), explored: fog.explored[18 * 48 + 27], count: fog.explored.reduce((n, x) => n + x, 0),
      order: state.buildings.find(b => b.x === 27 && b.y === 18), gold: state.factions[0].gold };
  });
  check('clicking in fog queues the road and pays its normal cost', !!fogAfter.order?.construction && fogAfter.gold === 998, fogAfter);
  check('queued footprint remains drawn over fog after leaving build mode', differentPixels(fogPixels, queuedPixels) > 10, { changed: differentPixels(fogPixels, queuedPixels) });
  check('preview and queued footprint do not reveal fog or add explored tiles', !fogAfter.visible && !fogAfter.explored && fogAfter.count === fogBefore.count, { before: fogBefore, after: fogAfter });
  await page.screenshot({ path: `${output}/fog-road-queued.png` });
  check('no browser runtime errors', errors.length === 0, errors);
} finally {
  writeFileSync(`${output}/area-tools-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
assert.equal(checks.filter(check => !check.pass).length, 0, 'Area-tool browser checks failed; inspect the report');
