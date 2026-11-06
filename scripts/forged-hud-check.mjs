import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// Fresh browser state: this check does not touch a user's live session or save.
const output = process.env.HUD_OUTPUT || 'scratch/2026-11-01-retinue-and-world-updates';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const report = { checks: [], layouts: [], errors: [] };
page.on('pageerror', error => { report.errors.push(error.stack || String(error)); console.log('PAGE ERROR', error.stack || String(error)); });
page.on('response', response => {
  if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
    report.errors.push(`HTTP ${response.status()} ${response.url()}`);
});
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const near = (a, b, tolerance = .05) => Math.abs(a - b) < tolerance;
const settle = () => page.waitForTimeout(200);
const bounds = selector => page.locator(selector).boundingBox();
const clearButton = () => page.locator('[data-action="clear"]');
const visibleBuildButtons = () => page.locator('[data-build]:visible');
const capture = async name => {
  await page.mouse.move(800, 80);
  await settle();
  await page.screenshot({ path: `${output}/${name}.png` });
};

async function fixture() {
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { updateFog } = await import('/src/game/fog.ts');
    const { queueConstruction } = await import('/src/game/structures.ts');
    const { RESEARCH_BRANCHES } = await import('/src/game/research.ts');
    const game = window.__game;
    const world = { width: 48, height: 36, seed: 'forged-hud-browser', source: 'HUD browser fixture', spawns: [], revision: 0,
      tiles: Array.from({ length: 48 * 36 }, (_, i) => {
        const x = i % 48, y = Math.floor(i / 48);
        return { terrain: x === 8 || x === 9 ? 'river' : 'grassland',
          overlay: x > 10 && (y < 8 || y > 26) && (x * 7 + y * 3) % 5 === 0 ? 'forest' : 'none',
          elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .3 };
      }) };
    world.tiles[14 * 48 + 20].overlay = 'forest';
    const unit = (id, kind, x, y) => ({ id, kind, faction: 0, x, y, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: kind === 'leader' ? 4 : 1, order: kind === 'leader' ? 'hold' : 'follow',
      cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, retinueStance: 'aggressive' });
    const buildings = [
      { id: 1, kind: 'palace', faction: 0, x: 16, y: 17, hp: 650, maxHp: 650, capacity: 0, cityName: 'Willowhearth', governorPermissions: { farms: false, housing: false } },
      { id: 101, kind: 'house', faction: 0, x: 18, y: 13, hp: 200, maxHp: 200, capacity: 4 },
      { id: 102, kind: 'house', faction: 0, x: 22, y: 13, hp: 200, maxHp: 200, capacity: 4 },
      { id: 103, kind: 'woodenTower', faction: 0, x: 26, y: 18, hp: 600, maxHp: 600, capacity: 0, armor: 6, range: 6, attack: 12.5 },
      { id: 104, kind: 'house', faction: 0, x: 24, y: 13, hp: 200, maxHp: 200, capacity: 4 },
    ];
    queueConstruction(buildings[2], 5, 125);
    game.replaceState({ ...game.state, world, buildings,
      units: [unit(2, 'leader', 22.5, 18.5), unit(3, 'warrior', 20.5, 19.5), unit(4, 'warrior', 21.5, 20.5)],
      factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 3000, production: 0,
        population: 40, culture: 10000, growth: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9,
        nextRetinueAt: 1e9, defeated: false, research: { focus: 'wall', levels: Object.fromEntries(RESEARCH_BRANCHES.map(branch => [branch.id, 1])), progress: {} } }],
      time: 5, tick: 0, paused: true, speed: 1, gameOver: false, victory: false, events: [], particles: [], projectiles: [], bloodEffects: [],
      fields: [], treasures: [], raiderCamps: [], marauderPacks: [], villages: [], tradeRoutes: [], treeClearings: [], treeStumps: [],
      forbiddenZones: { cells: [], revision: 0 }, roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 },
      wildlife: { herds: [], nextRespawnAt: 1e9, sequence: 0, targetHerds: 0 },
      selected: 2, selectedType: 'unit', buildMode: null, diplomacy: null, seed: world.seed, rngState: 1,
      fog: undefined, retinueStance: 'aggressive', movementMode: 'travel', traffic: {}, campRoads: {} });
    const fog = updateFog(game.state); fog.visible.fill(1); fog.explored.fill(1); fog.revision++; fog.explorationRevision++;
    game.renderer.prepare(game.state); game.renderer.follow = false; game.renderer.camera = { x: 22, y: 18 }; game.renderer.zoom = 1.7;
    window.__hudPointerDown = 0;
    if (!window.__hudListenerInstalled) {
      document.querySelector('#world').addEventListener('pointerdown', () => window.__hudPointerDown++);
      window.__hudListenerInstalled = true;
    }
  });
  await settle();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-hotbar-action]')].every(button => !button.disabled));
}

async function selectionStats(name, combat = true) {
  const result = await page.locator('#selection-panel').evaluate(panel => {
    const stats = panel.querySelector('#selection-stats');
    return { text: stats.innerText.replace(/\s+/g, ' ').trim(), rows: [...stats.children].map(child => child.innerText.trim()),
      portrait: !!panel.querySelector('#portrait img, #portrait canvas, #portrait svg, #portrait .icon'),
      textAll: panel.innerText, health: !!panel.querySelector('.health-track'), box: panel.getBoundingClientRect().toJSON() };
  });
  check(`${name} selection has ${combat ? 'HP, Attack and Defense' : 'HP only'}`, result.rows.length === (combat ? 3 : 1)
    && /HP/i.test(result.text) && /Attack/i.test(result.text) === combat && /Defense/i.test(result.text) === combat
    && !/retinue|morale|range|capacity|population/i.test(result.textAll), result);
  check(`${name} selection retains a portrait and health bar`, result.portrait && result.health, result);
  return result;
}

async function resourceValues() {
  return page.locator('.resources .resource').evaluateAll(resources => resources.map(resource => {
    const values = resource.querySelector('.resource-values'), container = values.getBoundingClientRect();
    const total = values.querySelector('strong'), totalBox = total.getBoundingClientRect();
    const rate = resource.querySelector('#food-yield, #gold-yield, #culture-rate');
    const rateStyle = rate && getComputedStyle(rate), rateBox = rate?.getBoundingClientRect();
    const color = rateStyle?.color.match(/[\d.]+/g)?.map(Number) ?? [];
    const texts = [...values.children].filter(child => child.getClientRects().length && child.textContent.trim()).map(child => {
      const range = document.createRange(); range.selectNodeContents(child);
      const text = range.getBoundingClientRect();
      return { text: child.textContent.trim(), fits: text.left >= container.left - 1 && text.right <= container.right + 1
        && text.top >= container.top - 1 && text.bottom <= container.bottom + 1, bounds: text.toJSON() };
    });
    return { name: resource.className, text: texts.map(item => item.text).join(' '), total: total.textContent,
      title: resource.title, accessible: resource.getAttribute('aria-label'),
      fits: texts.length > 0 && texts.every(item => item.fits), texts,
      rate: rate ? { text: rate.textContent, visible: rateBox.width > 0 && rateBox.height > 0 && rateStyle.visibility !== 'hidden',
        beside: rateBox.left >= totalBox.right - 1 && Math.abs((rateBox.top + rateBox.bottom) - (totalBox.top + totalBox.bottom)) <= 3,
        smaller: parseFloat(rateStyle.fontSize) < parseFloat(getComputedStyle(total).fontSize), color,
        positiveColor: color[1] > color[0] && color[1] > color[2], negativeColor: color[0] > color[1] && color[0] > color[2] } : null };
  }));
}

async function advanceResourceStocks(food, gold, culture, seconds = 5) {
  await page.evaluate(async ({ food, gold, culture, seconds }) => {
    const state = window.__game.state;
    state.time += seconds;
    const { grantIncome } = await import('/src/game/resource-income.ts');
    grantIncome(state.factions[0], { food, gold, culture });
    state.factions[0].gold -= 25.2; // Spending in the same frame cannot cancel the receipt.
  }, { food, gold, culture, seconds });
  await settle();
}

async function verifyPopup(width, menu = 'build') {
  const desired = menu === 'build'
    ? ['road', 'irrigation', 'camp', 'house', 'bridge', 'well', 'monument', 'blacksmith', 'archeryRange', 'scoutLodge', 'library', 'palace']
    : ['wall', 'woodenTower', 'guardPost'];
  const details = await visibleBuildButtons().evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(), label = button.querySelector('.action-label'), key = button.querySelector('kbd');
    const l = label?.getBoundingClientRect(), k = key?.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { kind: button.dataset.build, text: button.innerText, box: rect.toJSON(),
      hasArt: !!button.querySelector('img, svg, canvas, .icon'), hasPrice: !!button.querySelector('.build-price'),
      keyTopRight: !!k && k.right <= rect.right + 1 && k.left >= rect.x + rect.width * .55 && k.top <= rect.y + rect.height * .42,
      labelFits: !!l && l.left >= rect.left - 1 && l.right <= rect.right + 1 && l.bottom <= rect.bottom + 1 && label.scrollWidth <= label.clientWidth + 1,
      hit: hit === button || button.contains(hit) };
  }));
  check(`${width}px ${menu} contains the expected text-only choices`, details.map(d => d.kind).join(',') === desired.join(',')
    && details.every(d => !d.hasArt && !d.hasPrice), details);
  check(`${width}px ${menu} shortcut letters are top-right and labels fit`, details.every(d => d.keyTopRight && d.labelFits && d.hit), details);
  const panel = await bounds('#build-panel');
  check(`${width}px ${menu} popup is compact and on-screen`, panel && panel.width <= Math.min(width, 340) && panel.height <= 300
    && panel.x >= -1 && panel.x + panel.width <= width + 1 && panel.y >= 0, panel);
  if (menu === 'build') {
    const rows = new Set(details.map(d => Math.round(d.box.y))), cols = new Set(details.map(d => Math.round(d.box.x)));
    check(`${width}px Build has three columns and four rows`, rows.size === 4 && cols.size === 3, { rows: [...rows], cols: [...cols] });
    const title = await page.locator('#build-panel').evaluate(panel => [...panel.querySelectorAll('h1,h2,h3,.build-title')].filter(el => el.getClientRects().length && el.innerText.trim()).map(el => el.innerText));
    check(`${width}px Build popup has no title text`, title.length === 0, title);
  }
}

async function verifyMinimap(width) {
  const click = await page.evaluate(async () => {
    const { createMinimapProjection, worldToMinimap, minimapToWorld } = await import('/src/game/minimap.ts');
    const game = window.__game, canvas = document.querySelector('#minimap'), box = canvas.getBoundingClientRect();
    const inset = Math.min(canvas.clientWidth, canvas.clientHeight) * (1 - Math.SQRT1_2) / 2;
    const projection = createMinimapProjection(game.state.fog.explored, game.state.world.width, game.state.world.height, canvas.clientWidth - 2 * inset, canvas.clientHeight - 2 * inset);
    projection.x += inset; projection.y += inset;
    const target = { x: projection.world.x + projection.world.width * .56, y: projection.world.y + projection.world.height * .44 };
    const p = worldToMinimap(target, projection);
    const screen = { x: Math.floor(box.x + p.x / canvas.clientWidth * box.width), y: Math.floor(box.y + p.y / canvas.clientHeight * box.height) };
    const expected = minimapToWorld({ x: (screen.x - box.x) * canvas.clientWidth / box.width, y: (screen.y - box.y) * canvas.clientHeight / box.height }, projection);
    return { screen, expected, selected: game.state.selected, downs: window.__hudPointerDown };
  });
  await page.mouse.click(click.screen.x, click.screen.y);
  const after = await page.evaluate(() => ({ camera: window.__game.renderer.camera, follow: window.__game.renderer.follow,
    selected: window.__game.state.selected, downs: window.__hudPointerDown }));
  check(`${width}px minimap click maps correctly without world click-through`, near(after.camera.x, click.expected.x)
    && near(after.camera.y, click.expected.y) && !after.follow && after.selected === click.selected && after.downs === click.downs, { click, after });
  await page.evaluate(() => { window.__game.renderer.camera = { x: 22, y: 18 }; });
}

async function verifyMinimapControls(width, height) {
  await page.setViewportSize({ width, height }); await settle();
  await page.evaluate(() => { window.__game.renderer.zoom = 1.4; window.__game.renderer.follow = false; });
  await page.keyboard.press('Home');
  const home = await page.evaluate(() => {
    const game = window.__game, leader = game.state.units.find(unit => unit.faction === 0 && unit.kind === 'leader');
    return { follow: game.renderer.follow, camera: game.renderer.camera, leader: { x: leader.x, y: leader.y } };
  });
  check(`${width}px Home still centers on and follows the leader`, home.follow && near(home.camera.x, home.leader.x)
    && near(home.camera.y, home.leader.y), home);
  const buttons = await page.locator('.minimap-control').evaluateAll(elements => elements.map(button => {
    const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { id: button.id, text: button.textContent.trim(), label: button.getAttribute('aria-label'), box: box.toJSON(),
      hit: hit === button || button.contains(hit), onScreen: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight };
  }));
  check(`${width}px minimap controls show correctly labeled plus and minus glyphs`, buttons.length === 2
    && buttons[0].id === 'minimap-zoom-in' && buttons[0].text === '+' && buttons[0].label === 'Zoom in'
    && buttons[1].id === 'minimap-zoom-out' && buttons[1].text === '-' && buttons[1].label === 'Zoom out', buttons);
  check(`${width}px minimap zoom buttons have separate, reachable hitboxes`, buttons.length === 2
    && buttons.every(button => button.hit && button.onScreen && button.box.width > 0 && button.box.height > 0)
    && buttons[0].box.right < buttons[1].box.left, buttons);
  const limits = await page.evaluate(async () => {
    const { MIN_ZOOM, MAX_ZOOM } = await import('/src/game/renderer.ts');
    return { min: MIN_ZOOM, max: MAX_ZOOM };
  });
  const zoomState = () => page.evaluate(() => ({ zoom: window.__game.renderer.zoom,
    plusDisabled: document.querySelector('#minimap-zoom-in').disabled,
    minusDisabled: document.querySelector('#minimap-zoom-out').disabled, focus: document.activeElement?.id }));
  const plus = page.locator('#minimap-zoom-in'), minus = page.locator('#minimap-zoom-out');
  await plus.click();
  const firstPlus = await zoomState();
  await minus.click();
  const firstMinus = await zoomState();
  check(`${width}px clicking plus and minus changes zoom and restores canvas focus`, near(firstPlus.zoom, 1.55)
    && near(firstMinus.zoom, 1.4) && firstPlus.focus === 'world' && firstMinus.focus === 'world', { firstPlus, firstMinus });
  const zoomIn = [];
  for (let i = 0; i < 20 && await plus.isEnabled(); i++) { await plus.click(); zoomIn.push(await zoomState()); }
  const atMax = await zoomState();
  check(`${width}px repeated plus clicks clamp at maximum and disable only plus`, zoomIn.length > 1
    && zoomIn.every((state, i) => state.zoom > (i ? zoomIn[i - 1].zoom : firstMinus.zoom) && state.zoom <= limits.max)
    && near(atMax.zoom, limits.max) && atMax.plusDisabled && !atMax.minusDisabled, { limits, zoomIn });
  const plusBox = await plus.boundingBox();
  await page.mouse.click(plusBox.x + plusBox.width / 2, plusBox.y + plusBox.height / 2);
  check(`${width}px disabled plus remains clamped on a real pointer click`, near((await zoomState()).zoom, limits.max));
  await minus.click();
  const reverseFromMax = await zoomState();
  check(`${width}px minus reverses maximum zoom and re-enables plus`, near(reverseFromMax.zoom, limits.max - .15)
    && !reverseFromMax.plusDisabled && !reverseFromMax.minusDisabled && reverseFromMax.focus === 'world', reverseFromMax);
  const zoomOut = [];
  for (let i = 0; i < 20 && await minus.isEnabled(); i++) { await minus.click(); zoomOut.push(await zoomState()); }
  const atMin = await zoomState();
  check(`${width}px repeated minus clicks clamp at minimum and disable only minus`, zoomOut.length > 1
    && zoomOut.every((state, i) => state.zoom < (i ? zoomOut[i - 1].zoom : reverseFromMax.zoom) && state.zoom >= limits.min)
    && near(atMin.zoom, limits.min) && atMin.minusDisabled && !atMin.plusDisabled, { limits, zoomOut });
  const minusBox = await minus.boundingBox();
  await page.mouse.click(minusBox.x + minusBox.width / 2, minusBox.y + minusBox.height / 2);
  check(`${width}px disabled minus remains clamped on a real pointer click`, near((await zoomState()).zoom, limits.min));
  await plus.click();
  const reverseFromMin = await zoomState();
  check(`${width}px plus reverses minimum zoom and re-enables minus`, near(reverseFromMin.zoom, limits.min + .15)
    && !reverseFromMin.plusDisabled && !reverseFromMin.minusDisabled && reverseFromMin.focus === 'world', reverseFromMin);
}

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && ['ready', 'error'].includes(document.documentElement.dataset.assets));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.assets), 'ready');
  if (await page.locator('#dialog').isVisible()) await page.keyboard.press('Escape');
  await fixture();
  await advanceResourceStocks(29.6, 12.6, 2.7);

  for (const [width, height] of [[1600, 1000], [1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height }); await settle();
    const layout = await page.evaluate(() => {
      const rect = element => element.getBoundingClientRect().toJSON();
      const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
      const slots = [...document.querySelectorAll('.hotbar .action-slot')];
      const actions = [...document.querySelectorAll('[data-action]')].filter(visible);
      const mini = document.querySelector('.minimap-panel'), map = document.querySelector('#minimap');
      const time = [...document.querySelectorAll('.time-controls button')].filter(visible);
      return { width: innerWidth, height: innerHeight, minimap: rect(mini), minimapRadius: getComputedStyle(mini).borderRadius,
        canvasRadius: getComputedStyle(map).borderRadius, selection: rect(document.querySelector('#selection-panel')),
        slots: slots.map(button => ({ text: button.querySelector('kbd').textContent.trim(), box: rect(button), cssHeight: parseFloat(getComputedStyle(button).height), disabled: button.disabled, art: !!button.querySelector('.hotbar-art'), keyBox: { border: getComputedStyle(button.querySelector('kbd')).borderWidth, background: getComputedStyle(button.querySelector('kbd')).backgroundColor, shadow: getComputedStyle(button.querySelector('kbd')).boxShadow } })),
        actions: actions.map(button => ({ action: button.dataset.action, label: button.innerText.replace(/\s+/g, ' ').trim(), box: rect(button) })),
        resources: document.querySelector('.resources').innerText, resourceBox: rect(document.querySelector('.resources')),
        resourceItems: [...document.querySelectorAll('.resources .resource')].map(resource => ({ name: resource.className, box: rect(resource) })),
        controls: time.map(button => ({ text: button.innerText, box: rect(button) })), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    report.layouts.push(layout);
    const onScreen = box => box.x >= -1 && box.y >= -1 && box.right <= width + 1 && box.bottom <= height + 1;
    check(`${width}px minimap is circular at bottom-left`, near(layout.minimap.width, layout.minimap.height, 2)
      && layout.minimap.x <= 30 && height - layout.minimap.bottom <= 30
      && [layout.minimapRadius, layout.canvasRadius].some(radius => radius.includes('50%') || parseFloat(radius) >= layout.minimap.width * .4), layout.minimap);
    check(`${width}px selection is top-right and compact`, onScreen(layout.selection) && width - layout.selection.right <= 30
      && layout.selection.y < height * .25 && layout.selection.width <= 300 && layout.selection.height <= 170, layout.selection);
    check(`${width}px ten numbered slots stay at bottom`, layout.slots.map(slot => slot.text).join(',') === '1,2,3,4,5,6,7,8,9,10'
      && layout.slots.every(slot => onScreen(slot.box) && slot.box.y > height * .65
        && (width < 760 ? slot.box.bottom <= layout.minimap.y + 1 : height - slot.box.bottom <= 40)), layout.slots);
    check(`${width}px only Recall and Stance have icons and are enabled`, layout.slots.every((slot, i) => slot.art === (i < 2) && slot.disabled === (i >= 2)), layout.slots);
    check(`${width}px slot numbers have no separate boxes`, layout.slots.every(slot => slot.keyBox.border === '0px' && slot.keyBox.background === 'rgba(0, 0, 0, 0)' && slot.keyBox.shadow === 'none'), layout.slots.map(slot => slot.keyBox));
    check(`${width}px action slots use the approved two-thirds height`, layout.slots.length === 10
      && layout.slots.every(slot => near(slot.cssHeight, 120 * 2 / 3)), layout.slots.map(slot => slot.cssHeight));
    check(`${width}px only four special commands are visible`, layout.actions.length === 4
      && layout.actions.map(action => action.action).join(',') === 'build,fortifications,clear,forbid'
      && layout.actions.every(action => onScreen(action.box) && action.box.y > height * .65), layout.actions);
    const bottomBoxes = [layout.minimap, ...layout.slots.map(slot => slot.box), ...layout.actions.map(action => action.box)];
    const intersections = bottomBoxes.flatMap((a, i) => bottomBoxes.slice(i + 1).filter(b =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
    check(`${width}px bottom controls do not overlap`, intersections.length === 0, intersections);
    check(`${width}px resources show icons and numbers without words`, !/Food|Gold|Population|Culture/i.test(layout.resources), layout.resources);
    const resourceText = await resourceValues(), rates = resourceText.filter(item => item.rate);
    check(`${width}px resources show rounded gross income over the last 30 game seconds`, rates.map(item => item.rate.text).join('|') === '(+30)|(+13)|(+3)', resourceText);
    check(`${width}px resource changes are smaller, colored and beside the totals`, rates.every(item => item.rate.visible && item.rate.beside && item.rate.smaller)
      && rates[0].rate.positiveColor && rates[1].rate.positiveColor && rates[2].rate.positiveColor, rates);
    check(`${width}px resource descriptions explain the observed history window`, rates.every(item => /income over last 5 game seconds/.test(item.title)
      && /over last 5 game seconds/.test(item.accessible) && /collecting a 30-second history/.test(item.title)), rates);
    check(`${width}px resource totals and changes fit their value containers`, resourceText.every(item => item.fits), resourceText);
    check(`${width}px all four resource values remain inside the visible strip`, layout.resourceItems.length === 4
      && layout.resourceItems.every(item => item.box.left >= layout.resourceBox.left - 1 && item.box.right <= layout.resourceBox.right + 1), layout.resourceItems);
    check(`${width}px HUD has no horizontal overflow and controls stay on-screen`, !layout.overflow && onScreen(layout.resourceBox)
      && layout.controls.every(control => onScreen(control.box)), layout);
    const menu = layout.controls.find(control => /Menu/.test(control.text)), pause = await bounds('#pause'), speed = await bounds('#speed');
    check(`${width}px Menu is left of playback and speed`, !!menu && menu.box.right <= pause.x + 1 && pause.x + pause.width <= speed.x + 1, { menu, pause, speed });
    await selectionStats(`${width}px Leader`);
    await verifyMinimap(width);
    await capture(`leader-${width}`);
    await page.keyboard.press('b'); await settle(); await verifyPopup(width);
    await capture(`build-open-${width}`);
    await page.locator('#close-build').click();
    check(`${width}px popup close button works`, !(await page.locator('#build-panel').isVisible()));
    await page.keyboard.press('f'); await settle(); await verifyPopup(width, 'fortifications');
    await page.keyboard.press('Escape'); await settle();
  }

  await page.evaluate(() => {
    const game = window.__game;
    game.replaceState({ ...game.state,
      factions: game.state.factions.map(faction => ({ ...faction, food: 12345648, gold: 87654334, culture: 23456786, population: 1234 })),
      buildings: game.state.buildings.map(building => ({ ...building, capacity: building.kind === 'palace' ? 5678 : 0 })) });
  });
  await settle();
  check('Replacing the settlement establishes a fresh resource-change baseline', (await resourceValues()).filter(item => item.rate).every(item => item.rate.text === '(+0)'));
  await advanceResourceStocks(30, -13, 3);
  for (const [width, height] of [[1600, 1000], [1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height }); await settle();
    const resourceText = await resourceValues();
    check(`${width}px large resource text and changes fit their value containers`, resourceText.map(item => item.text).join('|') === '12345678 (+30)|87654321 (-13)|1234 / 5678|23456789 (+3)'
      && resourceText.every(item => item.fits), resourceText);
  }
  await capture('large-resource-values-390');
  await advanceResourceStocks(0, 0, 0, 31);
  check('Stock changes expire after 30 game seconds', (await resourceValues()).filter(item => item.rate).every(item => item.rate.text === '(+0)'));
  await advanceResourceStocks(.49, -.49, .49);
  check('Tiny resource changes round to zero without a negative-zero label', (await resourceValues()).filter(item => item.rate).every(item => item.rate.text === '(+0)'));
  await advanceResourceStocks(0, -7, 0, 0);
  check('Gold spent while paused still updates the resource change', (await resourceValues()).find(item => /\bgold\b/.test(item.name)).rate.text === '(-7)');

  await page.setViewportSize({ width: 1600, height: 1000 }); await fixture();
  // Unassigned slots must not retain the old build shortcuts.
  for (const menuOpen of [false, true]) {
    if (menuOpen) await page.keyboard.press('b');
    for (const key of ['3', '4', '5', '6', '7', '8', '9', '0']) await page.keyboard.press(key);
    check(`Empty hotbar digits do not start construction (${menuOpen ? 'Build open' : 'closed'})`, await page.evaluate(() => window.__game.state.buildMode === null));
    await page.keyboard.press('Escape');
  }
  const beforeSlot = await page.evaluate(() => ({ selected: window.__game.state.selected, downs: window.__hudPointerDown }));
  const firstSlot = await page.locator('.action-slot[data-slot="3"]').boundingBox();
  assert.ok(firstSlot, 'Empty third action slot is required');
  await page.mouse.click(firstSlot.x + firstSlot.width / 2, firstSlot.y + firstSlot.height / 2);
  const afterSlot = await page.evaluate(() => ({ selected: window.__game.state.selected, downs: window.__hudPointerDown }));
  check('Empty action-slot click does not reach the world', JSON.stringify(beforeSlot) === JSON.stringify(afterSlot), { beforeSlot, afterSlot });

  for (const input of ['click', 'keyboard']) {
    await fixture();
    const before = await page.evaluate(() => ({ selected: window.__game.state.selected, downs: window.__hudPointerDown }));
    if (input === 'click') await page.locator('[data-hotbar-action="stance"]').click();
    else await page.keyboard.press('2');
    check(`Slot 2 ${input} cycles stance`, await page.evaluate(() => window.__game.state.retinueStance === 'defensive'));
    await page.evaluate(() => { for (const unit of window.__game.state.units.filter(unit => unit.kind === 'warrior')) {
      unit.target = 999; unit.path = [{ x: 30, y: 20 }]; unit.forcedAttack = true;
    } });
    if (input === 'click') await page.locator('[data-hotbar-action="recall"]').click();
    else await page.keyboard.press('1');
    check(`Slot 1 ${input} recalls without changing stance`, await page.evaluate(() => window.__game.state.retinueStance === 'defensive'
      && window.__game.state.units.filter(unit => unit.kind === 'warrior').every(unit => !unit.target && !unit.path && !unit.forcedAttack && unit.recallIssuedAt === 5)));
    const after = await page.evaluate(() => ({ selected: window.__game.state.selected, downs: window.__hudPointerDown }));
    check(`Hotbar ${input} preserves selection and does not reach the world`, JSON.stringify(before) === JSON.stringify(after), { before, after });
  }
  await fixture();
  await page.evaluate(() => { window.__game.state.selected = 101; window.__game.state.selectedType = 'building'; });
  await settle(); await selectionStats('House', false); await capture('house-selected');
  await fixture();

  await page.keyboard.press('b'); await page.keyboard.press('g');
  check('B then G still selects Farm', await page.evaluate(() => window.__game.state.buildMode === 'camp'));
  await page.keyboard.press('f'); await page.keyboard.press('t');
  check('F then T still selects Wood tower', await page.evaluate(() => window.__game.state.buildMode === 'woodenTower'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('q');
  check('Q still cycles retinue stance', await page.evaluate(() => window.__game.state.retinueStance === 'defensive'));
  await page.evaluate(() => {
    for (const unit of window.__game.state.units.filter(unit => unit.kind === 'warrior')) {
      unit.target = 999; unit.path = [{ x: 30, y: 20 }]; unit.forcedAttack = true;
    }
  });
  await page.keyboard.press('e');
  const recall = await page.evaluate(() => window.__game.state.units.filter(unit => unit.kind === 'warrior').map(unit => ({ target: unit.target, path: unit.path,
    forcedAttack: unit.forcedAttack, recalled: unit.recallIssuedAt, order: unit.order })));
  check('E still recalls warriors and clears combat orders', recall.every(unit => unit.target === undefined && !unit.path
    && !unit.forcedAttack && unit.recalled === 5 && unit.order === 'follow'), recall);
  for (const [key, axis, direction] of [['w', 'y', -1], ['a', 'x', -1], ['s', 'y', 1], ['d', 'x', 1]]) {
    await page.keyboard.press('b');
    const before = await page.evaluate(() => { const state = window.__game.state, leader = state.units.find(unit => unit.id === 2); state.paused = false; return { x: leader.x, y: leader.y }; });
    await page.keyboard.down(key); await page.waitForTimeout(180); await page.keyboard.up(key);
    const after = await page.evaluate(() => { const state = window.__game.state, leader = state.units.find(unit => unit.id === 2); state.paused = true; return { x: leader.x, y: leader.y }; });
    check(`${key.toUpperCase()} still moves the leader with Build open`, (after[axis] - before[axis]) * direction > .02, { before, after });
    await page.keyboard.press('Escape');
  }

  // Actual input path, not direct clearArea invocation: one drag must apply all three operations.
  await fixture();
  await page.keyboard.press('c'); await settle();
  check('C activates the unified Clear tool', await clearButton().getAttribute('aria-pressed') === 'true');
  const drag = await page.evaluate(() => {
    const game = window.__game;
    return { start: game.renderer.screenPoint({ x: 17.9, y: 12.9 }), end: game.renderer.screenPoint({ x: 22.9, y: 14.9 }), gold: game.state.factions[0].gold };
  });
  for (const point of [drag.start, drag.end]) assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, point), 'world', 'Clear fixture must hit canvas');
  await page.mouse.move(drag.start.x, drag.start.y); await page.mouse.down();
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 12 }); await settle();
  await page.screenshot({ path: `${output}/clear-preview.png` });
  await page.mouse.up(); await settle();
  const cleared = await page.evaluate(() => ({ ids: window.__game.state.buildings.map(building => building.id),
    gold: window.__game.state.factions[0].gold, trees: window.__game.state.treeClearings }));
  check('Clear drag removes completed structure and cancels queued construction', !cleared.ids.includes(101) && !cleared.ids.includes(102)
    && cleared.ids.includes(104) && cleared.ids.includes(1), cleared);
  check('Clear refunds only the unfinished site and marks the tree', cleared.gold === drag.gold + 125
    && cleared.trees.some(tree => tree.x === 20 && tree.y === 14), { beforeGold: drag.gold, ...cleared });
  await capture('clear-result');
  await page.keyboard.press('Escape');

  await page.locator('[data-action="forbid"]').click();
  const forbidDrag = await page.evaluate(() => ({ start: window.__game.renderer.screenPoint({ x: 28.2, y: 21.2 }),
    end: window.__game.renderer.screenPoint({ x: 29.8, y: 22.8 }) }));
  const dragForbidden = async () => {
    await page.mouse.move(forbidDrag.start.x, forbidDrag.start.y); await page.mouse.down();
    await page.mouse.move(forbidDrag.end.x, forbidDrag.end.y, { steps: 6 }); await page.mouse.up(); await settle();
  };
  await dragForbidden();
  check('Forbid button marks the dragged rectangle', await page.evaluate(() => window.__game.state.forbiddenZones.cells.length === 4));
  await dragForbidden();
  check('Dragging from inside a forbidden area erases it', await page.evaluate(() => window.__game.state.forbiddenZones.cells.length === 0));
  await page.keyboard.press('Escape');

  await page.evaluate(() => { window.__game.state.selected = 103; window.__game.state.selectedType = 'building'; });
  await settle(); await selectionStats('Wood tower'); await capture('tower-selected');

  await page.evaluate(() => {
    const game = window.__game, leader = game.state.units.find(unit => unit.id === 2);
    const archerId = Math.max(...game.state.units.map(unit => unit.id), ...game.state.buildings.map(building => building.id)) + 100;
    const archer = { ...leader, id: archerId, kind: 'archer', x: 23.5, y: 18.5, hp: 100 * 2 / 3, maxHp: 100 * 2 / 3,
      attack: 20, defense: 2.5, range: 4, order: 'hold' };
    game.replaceState({ ...game.state, units: [...game.state.units, archer], selected: archer.id, selectedType: 'unit' });
  });
  await settle();
  const archerHealth = await page.locator('#selection-panel').evaluate(panel => {
    const row = panel.querySelector('#selection-stats > span'), rowBox = row.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
    const bar = panel.querySelector('.health-track');
    return { text: row.innerText.replace(/\s+/g, ' ').trim(), now: Number(bar.getAttribute('aria-valuenow')),
      max: Number(bar.getAttribute('aria-valuemax')), fits: rowBox.left >= panelBox.left && rowBox.right <= panelBox.right
        && row.scrollWidth <= row.clientWidth + 1 };
  });
  check('Fractional archer health renders as HP 67 / 67 and fits the compact card', /^HP\s+67\s*\/\s*67$/.test(archerHealth.text) && archerHealth.fits, archerHealth);
  check('Fractional archer health accessibility values stay within bounds', archerHealth.now > 0 && archerHealth.now <= archerHealth.max
    && near(archerHealth.now, 100 * 2 / 3) && near(archerHealth.max, 100 * 2 / 3), archerHealth);
  await capture('archer-fractional-health');

  await page.locator('.time-controls button').filter({ hasText: /Menu/ }).click(); await settle();
  const menuVisible = await page.locator('#dialog').isVisible();
  check('Menu opens a usable dialog', menuVisible && await page.locator('#dialog button:visible').count() >= 2);
  await capture('game-menu');
  const controls = page.locator('#dialog button').filter({ hasText: /Controls|Help/ });
  if (await controls.count()) {
    await controls.first().click(); await settle();
    check('Menu Controls opens help content', /Controls/.test(await page.locator('#dialog').innerText()));
  }
  await page.keyboard.press('Escape');
  check('Escape closes Menu/help and restores the game', !(await page.locator('#dialog').isVisible()));
  await page.locator('#pause').click();
  check('Playback button resumes simulation', await page.evaluate(() => !window.__game.state.paused));
  await page.locator('#pause').click();
  check('Playback button pauses simulation', await page.evaluate(() => window.__game.state.paused));
  await page.locator('#speed').click();
  check('Speed button changes simulation speed', await page.evaluate(() => window.__game.state.speed === 2));
  await page.locator('#speed').click(); await page.locator('#speed').click();
  await verifyMinimapControls(1600, 1000);
  await verifyMinimapControls(390, 844);
  check('No runtime browser errors', report.errors.length === 0, report.errors);
} catch (error) {
  report.errors.push(error.stack || String(error));
  check('Browser check completes', false, String(error));
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  writeFileSync(`${output}/browser-report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
if (report.checks.some(check => !check.pass) || report.errors.length) process.exitCode = 1;
