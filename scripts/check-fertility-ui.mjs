import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'scratch/2026-11-06-fertility-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
const check = (name, result) => { assert.ok(result, name); checks.push(name); console.log(`PASS ${name}`); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5189');
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { timeout: 90000 });
  await page.evaluate(async () => {
    const { createGame, getLeader } = await import('/src/game/simulation.ts');
    const { entityStore } = await import('/src/game/entity-store.ts');
    const { initialLeaderProgression } = await import('/src/game/leader-progression.ts');
    const world = { width: 40, height: 32, seed: 'soil-ui', source: 'fixture', spawns: [{ x: 18.5, y: 14.5 }], tiles: Array.from({ length: 1280 }, (_, i) => ({ terrain: i % 40 >= 23 ? 'desert' : 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
    world.tiles[17 * 40 + 21].terrain = 'river';
    const s = createGame(world), leader = getLeader(s);
    s.time = 100; s.paused = true; s.factions[0].gold = 2000.45;
    Object.assign(leader, { x: 20.5, y: 16.5, hp: 82.35, attack: 25.75, defense: 5.25 });
    leader.leaderProgression = { ...initialLeaderProgression(), xp: 37.45 };
    entityStore(s).units.replace([leader]);
    const palace = s.buildings.find(b => b.kind === 'palace' && b.faction === 0);
    entityStore(s).buildings.replace([palace,
      { id: 900, kind: 'camp', faction: 0, x: 21, y: 16, hp: 12.5, maxHp: 100, capacity: 0 },
      { id: 901, kind: 'road', faction: 0, x: 22, y: 16, hp: 12.5, maxHp: 100, capacity: 0 },
      { id: 902, kind: 'irrigation', faction: 0, x: 23, y: 16, hp: 12.5, maxHp: 100, capacity: 0 },
      { id: 903, kind: 'blacksmith', faction: 0, x: 20, y: 15, hp: 487.65, maxHp: 500, capacity: 0 },
    ]);
    s.selectedType = 'building'; s.selected = 900;
    window.__game.replaceState(s);
    window.__game.renderer.camera = { x: 21, y: 16 };
    window.__game.renderer.follow = false; window.__game.renderer.zoom = 2;
  });
  await page.waitForTimeout(500);
  check('Farm card shows freshwater fertility and no HP', (await page.locator('#selection-stats').innerText()).includes('125%') && !(await page.locator('#selection-stats').innerText()).includes('HP'));
  check('Farm health track is hidden', await page.locator('.health-track').isHidden());
  await page.screenshot({ path: `${out}/farm-fertility-no-health.png` });
  for (const id of [901, 902]) {
    await page.evaluate(id => { window.__game.state.selected = id; }, id); await page.waitForTimeout(400);
    check(`${id === 901 ? 'Road' : 'Irrigation'} card hides HP`, !(await page.locator('#selection-stats').innerText()).includes('HP') && await page.locator('.health-track').isHidden());
  }
  check('Desert irrigation explains its greater yield benefit', (await page.locator('#selection-panel').getAttribute('title')).includes('3× on desert'));
  await page.evaluate(() => { const s = window.__game.state; s.selectedType = 'unit'; s.selected = s.units[0].id; }); await page.waitForTimeout(400);
  const unitStats = await page.locator('#selection-stats').innerText();
  check('Attackable unit shows whole HP, attack and defense', unitStats.includes('HP') && unitStats.includes('Attack') && unitStats.includes('Defense') && !/\d\.\d/.test(unitStats));
  check('Health track is visible for a unit', await page.locator('.health-track').isVisible());
  check('Fractional Leader XP is rounded for display', (await page.locator('.leader-xp-text').innerText()) === '37 / 800 XP');
  await page.screenshot({ path: `${out}/unit-rounded-stats.png` });
  const location = await page.evaluate(() => window.__game.renderer.screenPoint({ x: 20.5, y: 15.5 }));
  await page.mouse.click(location.x, location.y); await page.waitForTimeout(500);
  check('Blacksmith popup opens', await page.locator('.activity-upgrades').isVisible());
  const upgrades = await page.locator('.activity-upgrades').innerText();
  check('Blacksmith uses whole percentages', upgrades.includes('115%') && upgrades.includes('210%') && !/\d\.\d/.test(upgrades));
  await page.screenshot({ path: `${out}/blacksmith-integer-percentages.png` });
  const visibleCopy = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e instanceof HTMLElement && e.checkVisibility() && e.children.length === 0).map(e => `${e.innerText || ''} ${e.title || ''}`).join('\n'));
  check('Visible HUD and open popup contain no decimal numbers', !/\d\.\d/.test(visibleCopy));
  check('No runtime errors', errors.length === 0);
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify({ checks, errors }, null, 2));
}
