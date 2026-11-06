import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const output = process.env.LEADER_QA_OUTPUT || 'scratch/2026-11-06-skill-card-controls';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const report = { checks: [], layouts: [], errors: [] };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass) throw new Error(`${name}: ${JSON.stringify(detail)}`);
};
const url = process.env.GAME_URL || 'http://127.0.0.1:5173/';
let page;
const settle = () => page.waitForTimeout(380);
const award = async amount => { await page.evaluate(async amount => {
  const { awardLeaderXp } = await import('/src/game/leader-progression.ts'); awardLeaderXp(__game.state, amount);
}, amount); await settle(); };
const leader = () => page.evaluate(() => structuredClone(__game.state.units.find(u => u.kind === 'leader' && u.faction === 0)));
const buy = skill => page.locator(`[data-leader-learn="${skill}"]`);
const popup = () => page.locator('#leader-skills');
const capture = async name => { await page.mouse.move(4, 200); await settle(); await page.screenshot({ path: `${output}/${name}.png` }); };
async function launch(width, height, mobile) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
  page = await context.newPage();
  await page.routeWebSocket('**', socket => socket.close());
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', undefined, { timeout: 90_000 });
  if (await page.locator('#frontend').isVisible()) {
    await page.locator('[data-view="single"]').click();
    await page.locator('[name="seed"]').fill('BTV-847');
    await page.locator('[data-form="single"] button[type="submit"]').click();
    await page.locator('#frontend').waitFor({ state: 'hidden', timeout: 60_000 });
  }
  await page.evaluate(() => { __game.state.paused = true; window.__skillCanvasClicks = 0;
    document.querySelector('#world').addEventListener('pointerdown', () => window.__skillCanvasClicks++); });
  await settle();
  return context;
}
async function inspectSkillCards(label) {
  const cards = [];
  for (const skill of ['power', 'guard', 'command', 'engineer', 'brace', 'discretion']) {
    await buy(skill).scrollIntoViewIfNeeded(); await settle();
    cards.push(await page.evaluate(skill => {
      const row = document.querySelector(`[data-leader-skill="${skill}"]`), button = row.querySelector('button');
      const panel = document.querySelector('#leader-skills').getBoundingClientRect(), rect = button.getBoundingClientRect();
      const text = [...row.querySelectorAll('strong,small,.leader-skill-copy > span')].filter(n => n.textContent).map(n => {
        const range = document.createRange(); range.selectNodeContents(n); const r = range.getBoundingClientRect(), b = n.getBoundingClientRect();
        return { text: n.textContent, fit: r.width <= b.width + 1, font: getComputedStyle(n).fontFamily };
      });
      return { skill, text, width: rect.width, height: rect.height,
        visible: rect.top >= panel.top && rect.bottom <= panel.bottom && rect.right <= panel.right && rect.left >= panel.left,
        reachable: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button,
        overflow: row.scrollWidth > row.clientWidth + 1 };
    }, skill));
  }
  check(`${label}: every card has a reachable 44px purchase button`, cards.every(c => c.visible && c.reachable && c.width >= 43 && c.height >= 43), cards);
  check(`${label}: effects and tech requirements fit in Pixel Operator`, cards.every(c => !c.overflow && c.text.every(t => t.fit && t.font.includes('Pixel Operator'))), cards);
  const bounds = await popup().boundingBox(), viewport = page.viewportSize();
  check(`${label}: panel fits on screen`, bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, bounds);
  await page.locator('.leader-advanced-skills').evaluate(e => e.scrollTop = 0);
  report.layouts.push({ label, bounds, cards });
}
async function controls(label, mobile) {
  await page.locator('[data-action="build"]').click(); await settle();
  const measure = () => page.evaluate(() => Object.fromEntries(['.special-actions', '.special-actions button', '.build-panel', '.build-actions button', '.hotbar', '.action-slot[data-hotbar-action]'].map(selector => {
    const e = document.querySelector(selector), r = e.getBoundingClientRect(); return [selector, { width: r.width, height: r.height }];
  })));
  const after = await measure();
  const beforePath = 'scratch/2026-11-06-skill-card-controls/mobile-controls-before.css';
  if (existsSync(beforePath)) {
    const old = await page.addStyleTag({ content: readFileSync(beforePath, 'utf8') + '\n@media(pointer:coarse){.special-actions,.build-panel,.build-panel.is-building-menu,.hotbar{transform:none}.hotbar{width:auto;left:12px;right:158px}}' });
    const before = await measure(); await old.evaluate(e => e.remove());
    check(`${label}: ${mobile ? 'action and build controls shrink by 30%' : 'desktop control dimensions are unchanged'}`, Object.keys(after).every(selector => {
      const a = after[selector], b = before[selector], scale = mobile ? .7 : 1;
      return Math.abs(a.width - b.width * scale) < 1 && Math.abs(a.height - b.height * scale) < 1;
    }), { before, after });
  }
  await capture(`${label}-build`);
  await page.locator('#close-build').click(); await settle();
  check(`${label}: smaller Build and close controls respond to actual clicks`, await page.locator('.build-panel').isHidden());
}
try {
  const desktop = await launch(1440, 900, false);
  await controls('desktop', false);
  await page.locator('.leader-xp-points').click();
  check('Every skill has its own + purchase; no Learn footer remains', await buy('power').innerText() === '+' && await page.locator('[data-leader-learn]').count() === 6 && await page.locator('.leader-skill-detail').count() === 0);
  check('No skill points disables every purchase', await page.locator('[data-leader-learn]:disabled').count() === 6);
  await capture('desktop-no-points');
  await page.keyboard.press('Escape'); await award(800);
  check('Level-up updates points without opening popup', await popup().isHidden() && await page.locator('.leader-xp-points').innerText() === '1');
  await page.locator('.leader-xp-points').click();
  check('Advanced skills show required technology and remain locked', await buy('engineer').isDisabled() && (await page.locator('[data-leader-skill="engineer"] .leader-skill-tech').innerText()).startsWith('Requires:'));
  const before = await leader(); await buy('power').click(); await settle(); const powered = await leader();
  check('A single + click learns Power, spends one point and updates its preview', powered.attack === before.attack + 2 && powered.leaderProgression.skills.power === 1 && powered.leaderProgression.skillPoints === 0
    && (await page.locator('[data-leader-skill="power"] .leader-skill-preview').innerText()).includes('→'));
  check('Purchase stays open without allowing overspending', await popup().isVisible() && await page.locator('[data-leader-learn]:disabled').count() === 6);
  await award(7200);
  await buy('power').click(); await settle(); await buy('power').click(); await settle();
  check('Maximum rank cannot be purchased again', await buy('power').isDisabled() && await buy('power').innerText() === '+' && (await leader()).leaderProgression.skills.power === 3);
  await buy('guard').click(); await settle();
  check('Guard purchases directly from its own card', (await leader()).leaderProgression.skills.guard === 1);
  await award(4000); await buy('command').click(); await settle();
  check('Command purchases directly from its own card', (await leader()).leaderProgression.skills.command === 1);
  await award(4800);
  await page.evaluate(() => { (__game.state.factions[0].research ??= { levels: {}, progress: {}, focus: 'wall' }).levels.metalTools = 1; }); await settle();
  await buy('engineer').click(); await settle();
  check('An unlocked technology skill purchases from its card', (await leader()).leaderProgression.skills.engineer === 1 && await buy('engineer').isDisabled());
  await inspectSkillCards('desktop'); await capture('desktop-skills');
  check('Skill card clicks never reach world canvas', await page.evaluate(() => window.__skillCanvasClicks === 0));
  const pending = await page.evaluate(async () => {
    const { LeaderProgressionUI } = await import('/src/ui/leader-progression.ts');
    const { initialLeaderProgression, awardLeaderXp, learnLeaderSkill } = await import('/src/game/leader-progression.ts');
    const state = structuredClone(__game.state), l = state.units.find(u => u.kind === 'leader' && u.faction === 0);
    l.leaderProgression = { ...initialLeaderProgression(), skillPoints: 2 };
    const rail = document.createElement('div'), panel = document.createElement('div'); let calls = 0, reject = false;
    const ui = new LeaderProgressionUI(rail, panel, () => state, () => { calls++; return reject ? { ok: false, message: 'Not connected to the match.' } : { ok: true, pending: true }; }, () => {}, () => {}, () => true);
    const button = id => panel.querySelector(`[data-leader-learn="${id}"]`);
    ui.open(); button('power').click(); button('power').click(); button('guard').click();
    const duplicateBlocked = calls === 1 && button('power').disabled && button('power').getAttribute('aria-busy') === 'true';
    ui.close(); ui.open(); const reopenBlocked = button('power').disabled;
    awardLeaderXp(state, 800); ui.refresh(); const unrelatedLevelBlocked = button('power').disabled;
    learnLeaderSkill(state, 'power'); ui.refresh(); const confirmed = !button('guard').disabled;
    reject = true; button('guard').click(); const rejectionShown = panel.querySelector('.leader-skill-status').textContent.includes('Not connected');
    ui.close(); awardLeaderXp(state, 1600); ui.refresh(); const stayedClosed = !ui.isOpen;
    return { duplicateBlocked, reopenBlocked, unrelatedLevelBlocked, confirmed, rejectionShown, stayedClosed };
  });
  check('Pending multiplayer purchases survive close/reopen and unrelated levels, then reconcile on rank confirmation', Object.values(pending).every(Boolean), pending);
  await desktop.close();
  for (const [width, height] of [[1044, 480], [844, 390]]) {
    const context = await launch(width, height, true), label = `mobile-${width}x${height}`;
    await controls(label, true); await award(800); await page.locator('.leader-xp-points').tap(); await settle();
    await inspectSkillCards(label); await capture(`${label}-skills`);
    await buy('guard').tap(); await settle();
    check(`${label}: tapping a skill + spends exactly one point`, (await leader()).leaderProgression.skills.guard === 1 && (await leader()).leaderProgression.skillPoints === 0);
    await capture(`${label}-purchased`);
    await page.locator('[data-leader-close]').tap();
    check(`${label}: close works`, await popup().isHidden());
    await context.close();
  }
  check('No browser runtime errors', report.errors.length === 0, report.errors);
} catch (error) {
  report.errors.push(String(error)); console.error(error); await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(`${output}/browser-report.json`, JSON.stringify(report, null, 2)); await browser.close();
}
