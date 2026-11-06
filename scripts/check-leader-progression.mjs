import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const output = process.env.LEADER_QA_OUTPUT || 'scratch/2026-11-02-leader-progression-implementation';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
await page.routeWebSocket(/.*/, () => {}); // Keep this isolated QA session stable during source edits.
const report = { checks: [], layouts: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.stack || String(error)));
page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) report.errors.push(`HTTP ${response.status()} ${response.url()}`); });
const check = (name, pass, detail) => { report.checks.push({ name, pass: Boolean(pass), ...(pass || detail === undefined ? {} : { detail }) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };
const settle = () => page.waitForTimeout(220);
const popup = page.locator('#leader-skills');
const learn = page.locator('[data-leader-learn]');
const leader = () => page.evaluate(() => { const state = window.__game.state; return structuredClone(state.units.find(unit => unit.kind === 'leader' && unit.faction === (state.playerFaction ?? 0))); });
const award = async amount => { await page.evaluate(async amount => { const { awardLeaderXp } = await import('/src/game/leader-progression.ts'); awardLeaderXp(window.__game.state, amount); }, amount); await settle(); };
const pick = async skill => { await page.locator(`[data-leader-skill="${skill}"]`).click(); await settle(); };
async function fixture() {
  if (await popup.isVisible()) await page.locator('[data-leader-close]').click();
  await page.evaluate(() => {
    const game = window.__game;
    const state = structuredClone(window.__leaderQaInitial);
    state.paused = true; state.gameOver = false; state.victory = false;
    const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === 0);
    state.selected = leader.id; state.selectedType = 'unit'; state.buildMode = null; state.diplomacy = null;
    game.replaceState(state); game.renderer.center(state);
  });
  await settle();
}
async function capture(name) { await page.mouse.move(10, 90); await settle(); await page.screenshot({ path: `${output}/${name}.png` }); }
async function layout(width, height) {
  await page.setViewportSize({ width, height }); await settle();
  if (!(await popup.isVisible())) await page.locator('.leader-xp-open').click();
  const controls = [];
  for (const skill of ['power', 'guard', 'command']) {
    await pick(skill);
    controls.push(await page.evaluate(skill => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      const panel = rect('#leader-skills'), close = rect('[data-leader-close]'), learn = rect('[data-leader-learn]');
      const inside = box => box.left >= panel.left && box.right <= panel.right && box.top >= panel.top && box.bottom <= panel.bottom
        && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
      const receivesPointer = (box, selector) => Boolean(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(selector));
      return { skill, panel, close, learn, fit: inside(close) && inside(learn),
        reachable: receivesPointer(close, '[data-leader-close]') && receivesPointer(learn, '[data-leader-learn]') };
    }, skill));
  }
  check(`${width}×${height}: close and Learn stay visible for every skill`, controls.every(control => control.fit && control.reachable), controls);
  if (width >= 1024) await pick('power');
  const measured = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const panel = document.querySelector('#leader-skills');
    const text = [...panel.querySelectorAll('h2,strong,span,button')].filter(node => node.children.length === 0 && node.textContent.trim()).map(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const r = range.getBoundingClientRect(), box = node.getBoundingClientRect();
      return { text: node.textContent.trim(), fits: r.left >= box.left - 1 && r.right <= box.right + 1, font: getComputedStyle(node).fontFamily, rect: r.toJSON(), box: box.toJSON() };
    });
    return { width: innerWidth, height: innerHeight, xp: rect('#leader-xp'), hotbar: rect('.hotbar'), popup: rect('#leader-skills'),
      points: rect('.leader-xp-points'), minimap: rect('.minimap-panel'), actions: rect('.special-actions'),
      overflow: panel.scrollWidth > panel.clientWidth + 1, scrollable: panel.scrollHeight > panel.clientHeight + 1, text,
      horizontalPageOverflow: document.documentElement.scrollWidth > innerWidth,
      fontLoaded: document.fonts.check('16px "Pixel Operator"') };
  });
  report.layouts.push({ ...measured, text: measured.text.map(({ text, fits, font }) => ({ text, fits, font })), controls });
  check(`${width}×${height}: XP rail sits above action slots`, measured.xp.bottom <= measured.hotbar.top - 3, measured);
  check(`${width}×${height}: rail and points stay on screen`, measured.xp.left >= 0 && measured.xp.right <= width && measured.points.top >= 0 && measured.points.bottom <= height, measured);
  check(`${width}×${height}: popup stays on screen and above rail`, measured.popup.left >= 0 && measured.popup.right <= width && measured.popup.top >= 0 && measured.popup.bottom <= measured.xp.top, measured);
  check(`${width}×${height}: popup has no horizontal overflow`, !measured.overflow && !measured.horizontalPageOverflow, measured);
  check(`${width}×${height}: all popup text fits its element`, measured.text.every(text => text.fits), measured.text.filter(text => !text.fits));
  check(`${width}×${height}: all text uses loaded Pixel Operator`, measured.fontLoaded && measured.text.every(text => text.font.includes('Pixel Operator')), measured.text.map(({ text, font }) => ({ text, font })));
  await capture(`leader-skills-${width}x${height}`);
  await page.locator('[data-leader-close]').click();
  check(`${width}×${height}: close works and focuses game`, !(await popup.isVisible()) && await page.evaluate(() => document.activeElement?.id === 'world'));
  await page.locator('.leader-xp-points').click();
  check(`${width}×${height}: skill point badge reopens popup`, await popup.isVisible());
}

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', { timeout: 90_000 });
  if (await page.locator('#frontend').isVisible()) {
    await page.locator('[data-view="single"]').click();
    await page.locator('[name="seed"]').fill('BTV-847');
    await page.locator('[data-form="single"] button[type="submit"]').click();
    await page.locator('#frontend').waitFor({ state: 'hidden', timeout: 60_000 });
  }
  await page.evaluate(() => {
    window.__game.state.paused = true;
    window.__leaderQaInitial = structuredClone(window.__game.state);
    window.__leaderQaPointerDown = 0;
    document.querySelector('#world').addEventListener('pointerdown', () => window.__leaderQaPointerDown++);
  });
  await fixture();
  check('New leader displays level 1, zero XP and zero points', (await page.locator('.leader-level-badge').innerText()) === '1' && (await page.locator('.leader-xp-text').innerText()) === '0 / 100 XP' && (await page.locator('.leader-xp-points').innerText()) === '0');
  await page.locator('.leader-xp-points').click();
  check('Zero-point badge opens skill inspection', await popup.isVisible());
  check('Learn is disabled without skill points', await learn.isDisabled());
  await page.keyboard.press('Escape');
  check('Escape closes popup and returns focus to game', !(await popup.isVisible()) && await page.evaluate(() => document.activeElement?.id === 'world'));
  await award(80);
  check('Partial XP updates rail without opening popup', (await page.locator('.leader-xp-text').innerText()) === '80 / 100 XP' && !(await popup.isVisible()));
  const beforeLevel = await leader();
  await award(20);
  const afterLevel = await leader();
  check('Level up updates the point indicator without opening the popup or stealing focus', !(await popup.isVisible())
    && (await page.locator('.leader-xp-points').innerText()) === '1'
    && await page.locator('.leader-xp-points').getAttribute('aria-expanded') === 'false'
    && await page.evaluate(() => document.activeElement?.id === 'world'));
  check('Level up adds HP, Attack and one spendable point', afterLevel.maxHp === beforeLevel.maxHp + 10 && afterLevel.attack === beforeLevel.attack + 1 && afterLevel.leaderProgression.skillPoints === 1, { beforeLevel, afterLevel });
  await page.locator('.leader-xp-points').click();
  check('Point indicator opens the updated level-two popup on demand', await popup.isVisible()
    && (await page.locator('.leader-skills-level').innerText()) === 'Level 2'
    && await page.locator('.leader-xp-points').getAttribute('aria-expanded') === 'true');
  await page.locator('.leader-xp-points').click();
  check('Clicking the point indicator again closes the popup', !(await popup.isVisible())
    && await page.locator('.leader-xp-points').getAttribute('aria-expanded') === 'false');
  await page.locator('.leader-xp-points').click();
  await pick('power'); await learn.click(); await settle();
  const powered = await leader();
  check('Learn Power changes base attack, rank, point and pips', powered.attack === afterLevel.attack + 2 && powered.leaderProgression.skills.power === 1 && powered.leaderProgression.skillPoints === 0 && await page.locator('[data-leader-skill="power"] .earned').count() === 1, powered);
  check('Popup remains open after learning; no points cannot be overspent', await popup.isVisible() && await learn.isDisabled());
  await award(900);
  check('An already-open popup stays open and refreshes after another level up', await popup.isVisible()
    && (await page.locator('.leader-skills-level').innerText()) === `Level ${(await leader()).leaderProgression.level}`);
  await pick('power'); await learn.click(); await settle(); await learn.click(); await settle();
  const maxPower = await leader();
  check('Power caps at three ranks and disables Learn', maxPower.leaderProgression.skills.power === 3 && await learn.isDisabled() && (await learn.innerText()) === 'Max rank', maxPower.leaderProgression);
  await pick('guard'); const beforeGuard = await leader(); await learn.click(); await settle();
  const guarded = await leader();
  check('Guard increases defense and spends one point', guarded.defense === beforeGuard.defense + 1 && guarded.leaderProgression.skills.guard === 1 && guarded.leaderProgression.skillPoints === beforeGuard.leaderProgression.skillPoints - 1);
  await award(500); await pick('command'); await learn.click(); await settle();
  const commanded = await leader();
  check('Command gains one retinue rank', commanded.leaderProgression.skills.command === 1 && (await page.locator('.leader-detail-stat').innerText()).includes('1'), commanded.leaderProgression);
  check('UI clicks do not reach the world canvas', await page.evaluate(() => window.__leaderQaPointerDown === 0));
  const persistence = await page.evaluate(async () => {
    const { parseGameSave } = await import('/src/game/game-save.ts');
    const saved = parseGameSave(localStorage.getItem('tinyciv-save-v3'));
    const unit = saved.units.find(unit => unit.kind === 'leader' && unit.faction === 0);
    const now = window.__game.state.units.find(unit => unit.kind === 'leader' && unit.faction === 0);
    return { saved: unit.leaderProgression, now: now.leaderProgression, stats: unit.attack === now.attack && unit.defense === now.defense && unit.maxHp === now.maxHp };
  });
  check('Learn persists progression and stat bonuses in actual save', JSON.stringify(persistence.saved) === JSON.stringify(persistence.now) && persistence.stats, persistence);
  await fixture(); await award(100); await award(200);
  check('Repeated level ups keep the popup closed while points accumulate', !(await popup.isVisible())
    && (await page.locator('.leader-xp-points').innerText()) === '2');
  await award(480); await page.locator('.leader-xp-points').click();
  await pick('power'); await learn.click(); await settle(); await pick('guard'); await learn.click(); await settle(); await pick('power');
  await capture('leader-skills-desktop-power');
  for (const [width, height] of [[1600, 1000], [1440, 900], [1024, 768], [390, 844], [320, 700], [844, 390]]) await layout(width, height);
  await page.setViewportSize({ width: 1600, height: 1000 }); await fixture();
  await page.locator('.leader-xp-open').click();
  await page.evaluate(() => { const game = window.__game; game.state.units.find(unit => unit.kind === 'leader' && unit.faction === 0).hp = 0; }); await settle();
  check('Leader death hides XP rail and closes popup', !(await page.locator('#leader-xp').isVisible()) && !(await popup.isVisible()));
  check('No browser runtime or asset errors', report.errors.length === 0, report.errors);
} catch (error) {
  report.errors.push(error.stack || String(error)); check('Browser check completes', false, String(error));
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  writeFileSync(`${output}/browser-report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
if (report.checks.some(check => !check.pass) || report.errors.length) process.exitCode = 1;
