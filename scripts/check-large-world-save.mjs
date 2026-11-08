import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'scratch/2026-11-07-large-world-save';
await mkdir(output, { recursive: true });
const checks = [], errors = [];
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', error => errors.push(String(error)));
const ready = async () => page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', undefined, { timeout: 120_000 });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5197/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await ready();
  const before = await page.evaluate(async () => {
    const { readStoredGame } = await import('/src/game/game-storage.ts');
    const { parseGameSave } = await import('/src/game/game-save.ts');
    const game = window.__game, state = game.state;
    state.paused = true; state.seed = 'LARGE-WORLD-PERSISTENCE';
    state.world.tiles[0].saveProbe = { tiny: Number.MIN_VALUE, huge: Number.MAX_VALUE, precise: 1.2345678901234567, text: 'grove 🌲' };
    game.replaceState(state);
    state.factions[0].gold = 321;
    const first = game.save();
    state.factions[0].gold = 654;
    const second = game.save();
    const results = await Promise.all([first, second]);
    const serialized = await readStoredGame(), restored = parseGameSave(serialized);
    return { results, size: serialized.length, width: state.world.width, height: state.world.height,
      gold: restored.factions[0].gold, world: JSON.stringify(restored.world), units: JSON.stringify(restored.units),
      probe: restored.world.tiles[0].saveProbe };
  });
  assert.deepEqual(before.results, [true, true]);
  assert(before.size > 5 * 1024 * 1024, 'production save must exercise storage above localStorage quota');
  assert(before.width >= 320 && before.height >= 256);
  assert.equal(before.gold, 654);
  checks.push(`Saved ${before.size} characters from ${before.width}×${before.height} world; latest overlapping save wins`);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await ready();
  const after = await page.evaluate(() => ({ seed: __game.state.seed, paused: __game.state.paused,
    gold: __game.state.factions[0].gold, world: JSON.stringify(__game.state.world), units: JSON.stringify(__game.state.units),
    probe: __game.state.world.tiles[0].saveProbe, active: !document.querySelector('.game-area').classList.contains('frontend-active') }));
  assert.equal(after.seed, 'LARGE-WORLD-PERSISTENCE'); assert.equal(after.gold, 654);
  assert.equal(after.paused, true); assert.equal(after.active, true);
  assert.equal(after.world, before.world); assert.equal(after.units, before.units); assert.deepEqual(after.probe, before.probe);
  checks.push('Reload auto-loads the paused settlement with exact terrain, units and extreme/precise numeric metadata');
  await page.screenshot({ path: `${output}/reloaded.png` });
  const failedWrite = await page.evaluate(async () => {
    const { readStoredGame } = await import('/src/game/game-storage.ts');
    const previous = await readStoredGame(), original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota exhausted', 'QuotaExceededError'); };
    let result;
    try { __game.state.factions[0].gold = 999; result = await __game.save(); }
    finally { IDBObjectStore.prototype.put = original; }
    return { result, preserved: await readStoredGame() === previous };
  });
  assert.deepEqual(failedWrite, { result: false, preserved: true });
  checks.push('Failed writes report failure and retain the last committed save');
  assert.deepEqual(errors, []); checks.push('No browser runtime errors');
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, bytes: before.size }, null, 2));
  console.log(JSON.stringify({ checks, errors, bytes: before.size }, null, 2));
} finally { await browser.close(); }
