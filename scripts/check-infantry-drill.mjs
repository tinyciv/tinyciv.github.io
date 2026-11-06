import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = process.env.QA_OUTPUT || 'scratch/2026-11-03-infantry-drill';
mkdirSync(output, { recursive: true });
const checks = [], errors = [];
const check = (label, pass, data) => { checks.push({ label, pass: !!pass, data }); console.log(label, !!pass, data ? JSON.stringify(data) : ''); assert.ok(pass, label); };
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => errors.push(String(error)));
await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
const settle = () => page.waitForTimeout(180);
const formation = page.locator('[data-hotbar-action="formation"]');
async function createGame(advanced, seed) {
  if (!(await page.locator('[data-view="single"]').isVisible())) { await page.locator('#world').focus(); await page.keyboard.press('Escape'); }
  await page.locator('[data-view="single"]').click();
  await page.locator('[data-form="single"] [name="seed"]').fill(seed);
  await page.locator('[name="advanced-start"]').setChecked(advanced);
  if (advanced) await page.screenshot({ path: `${output}/advanced-start-menu.png` });
  await page.locator('[data-form="single"] button[type="submit"]').click();
  await page.waitForFunction(seed => window.__game?.state.seed === seed && document.querySelector('#frontend').hidden, seed, { timeout: 120000 });
  await page.evaluate(() => { __game.state.paused = true; __game.state.banditIntensity = 0; });
  await settle();
}
async function armyState() {
  return page.evaluate(async () => {
    const s = __game.state, { isRetinueMember } = await __liveImport('/src/game/types.ts'), { personFrame } = await __liveImport('/src/game/unit-sprites.ts');
    const leader = s.units.find(u => u.kind === 'leader' && u.faction === 0), troops = s.units.filter(u => u.faction === 0 && u.hp > 0 && isRetinueMember(u));
    return { population: s.factions[0].population, advanced: s.advancedStart, tech: s.factions[0].research?.levels.infantryDrill,
      counts: troops.reduce((all, u) => { all[u.kind] = (all[u.kind] || 0) + 1; return all; }, {}), count: troops.length,
      formation: leader?.infantryFormation, stance: s.retinueStance, movementMode: s.movementMode, time: s.time,
      leader: { x: leader.x, y: leader.y, facing: leader.facing, sprite: personFrame(leader, s.time) },
      recalls: troops.map(u => u.recallIssuedAt ?? null), ids: troops.map(u => u.id) };
  });
}
async function simulate(seconds) {
  await page.evaluate(seconds => {
    const s = __game.state; s.paused = false;
    for (let t = 0; t < seconds - 1e-7; t += .05) __game.step(Math.min(.05, seconds - t));
    s.paused = true;
  }, seconds); await settle();
}
async function liveWait(seconds) {
  const time = await page.evaluate(() => __game.state.time);
  await page.waitForFunction(({time,seconds}) => __game.state.time >= time + seconds, {time,seconds}, {timeout:15000});
}
async function continuousRotationChecks() {
  await page.locator('#world').focus();
  const before = await armyState();
  await page.evaluate(() => { __game.state.paused = false; });
  await page.keyboard.down('q'); await liveWait(.28); const short = await armyState();
  await liveWait(.42);
  const cue = await page.evaluate(async () => {
    const { infantryRotationAlpha } = await __liveImport('/src/game/infantry-drill.ts');
    const s = __game.state, leader = s.units.find(u => u.kind === 'leader' && u.faction === 0);
    return { alpha: infantryRotationAlpha(leader, s.time), heading: leader.infantryFormation.heading };
  });
  check('held rotation shows a translucent advance direction arrow', cue.alpha > .3 && cue.alpha < .6, cue);
  await page.screenshot({ path: `${output}/rotation-advance-arrow.png` });
  await page.keyboard.up('q'); const left = await armyState();
  check('held Q rotates continuously by duration instead of a quarter-turn', short.formation.heading < before.formation.heading - .15
    && left.formation.heading < short.formation.heading - .2 && Math.abs((before.formation.heading-left.formation.heading) % (Math.PI/2)) > .1,
    { before: before.formation.heading, short: short.formation.heading, long: left.formation.heading });
  check('Leader facing and native sprite row follow the held rotation', Math.abs(left.leader.facing-left.formation.heading)<1e-6
    && left.leader.sprite.row !== before.leader.sprite.row, { before: before.leader, after: left.leader });
  await page.screenshot({ path: `${output}/continuous-left-turn.png` });
  await liveWait(.6); const released = await armyState();
  const cueAfterRelease = await page.evaluate(async () => {
    const { infantryRotationAlpha } = await __liveImport('/src/game/infantry-drill.ts');
    const s = __game.state, leader = s.units.find(u => u.kind === 'leader' && u.faction === 0);
    return infantryRotationAlpha(leader, s.time);
  });
  check('advance direction arrow fades away after rotation stops', cueAfterRelease === 0);
  await page.screenshot({ path: `${output}/rotation-arrow-released.png` });
  check('releasing Q stops at its arbitrary angle without snapping back', Math.abs(released.formation.heading-left.formation.heading)<1e-6);
  await page.keyboard.down('e'); await liveWait(.35); await page.keyboard.up('e'); const right = await armyState();
  check('held E turns right without changing stance or recall state', right.formation.heading > released.formation.heading+.2
    && right.stance===before.stance && JSON.stringify(right.recalls)===JSON.stringify(before.recalls));
  await page.keyboard.down('q'); await page.keyboard.down('e'); const both = await armyState();
  await liveWait(.35); const stopped = await armyState(); await page.keyboard.up('q'); await page.keyboard.up('e');
  check('holding Q and E together cancels rotation', Math.abs(stopped.formation.heading-both.formation.heading)<1e-6);
  const strafeStart = await armyState(); await page.keyboard.down('d'); await liveWait(.35); await page.keyboard.up('d'); const strafeEnd = await armyState();
  const h=strafeStart.formation.heading, lateral=(strafeEnd.leader.x-strafeStart.leader.x)*-Math.sin(h)+(strafeEnd.leader.y-strafeStart.leader.y)*Math.cos(h);
  check('D still strafes in the rotated local direction without turning', lateral>.2 && Math.abs(strafeEnd.formation.heading-h)<1e-6, { lateral, heading: h });
  await page.keyboard.down('q'); await liveWait(.15); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); const blurred=await armyState();
  await liveWait(.3); check('window blur immediately clears held rotation', Math.abs((await armyState()).formation.heading-blurred.formation.heading)<1e-6);
  await page.keyboard.up('q');
  await page.keyboard.down('e'); await liveWait(.15); await page.keyboard.press('Space'); const paused=await armyState();
  await page.keyboard.press('Space'); await liveWait(.3);
  check('pause and resume do not resume a previously held turn', Math.abs((await armyState()).formation.heading-paused.formation.heading)<1e-6);
  await page.keyboard.up('e');
  await page.keyboard.down('q'); await liveWait(.15); await page.keyboard.press('Escape'); const menu=await armyState();
  await page.locator('[data-frontend-action="resume"]').click(); await liveWait(.3);
  check('opening and closing the game menu clears held rotation', Math.abs((await armyState()).formation.heading-menu.formation.heading)<1e-6);
  await page.keyboard.up('q'); await page.locator('#world').focus();
  await page.keyboard.down('e'); await liveWait(.15); await page.keyboard.press('3'); await page.keyboard.press('3'); const retoggled=await armyState();
  await liveWait(.3); check('toggling formation off clears held rotation before reactivation', Math.abs((await armyState()).formation.heading-retoggled.formation.heading)<1e-6);
  await page.keyboard.up('e'); await page.evaluate(() => { __game.state.paused=true; });
  await settle();
}
async function marchThroughGeneratedCity() {
  const route = await page.evaluate(async () => {
    const s = __game.state, leader = s.units.find(u => u.kind === 'leader' && u.faction === 0);
    const { infantryPointClear } = await __liveImport('/src/game/infantry-drill.ts');
    const { findPath } = await __liveImport('/src/game/pathfinding.ts');
    const candidates = [];
    for (let y = Math.max(4, Math.floor(leader.y) - 32); y < Math.min(s.world.height - 4, leader.y + 32); y++)
      for (let x = Math.max(4, Math.floor(leader.x) - 32); x < Math.min(s.world.width - 4, leader.x + 32); x++) {
        const goal = { x: x + .5, y: y + .5 }, distance = Math.hypot(goal.x - leader.x, goal.y - leader.y);
        if (distance < 14 || distance > 30) continue;
        let clear = true;
        for (let dy = -3; dy <= 3 && clear; dy++) for (let dx = -3; dx <= 3; dx++) {
          const point = { x: goal.x + dx, y: goal.y + dy }, tile = s.world.tiles[Math.floor(point.y) * s.world.width + Math.floor(point.x)];
          if (!tile || !['grassland','desert','plains'].includes(tile.terrain) || !['none','road'].includes(tile.overlay) || !infantryPointClear(s, point, 0)) { clear = false; break; }
        }
        if (clear) candidates.push({ goal, distance });
      }
    candidates.sort((a,b) => a.distance - b.distance);
    for (const candidate of candidates.slice(0, 60)) {
      const path = findPath(s, leader, candidate.goal, 0, false);
      if (!path.length || Math.hypot(path.at(-1).x - candidate.goal.x, path.at(-1).y - candidate.goal.y) > .1) continue;
      __game.renderer.follow = false; __game.renderer.camera = candidate.goal; __game.renderer.zoom = 1.4;
      return { start: { x: leader.x, y: leader.y }, goal: candidate.goal, path: path.length, point: __game.renderer.screenPoint(candidate.goal) };
    }
    return { candidates: candidates.length };
  });
  check('generated advanced city has a reachable open clearing for the march', !!route.goal, route);
  await settle(); await page.mouse.click(route.point.x, route.point.y, { button: 'right' }); await settle();
  const observations = [];
  for (let elapsed = 5; elapsed <= 150; elapsed += 5) {
    await simulate(5);
    const snapshot = await page.evaluate(async goal => {
      const s = __game.state, { isRetinueMember } = await __liveImport('/src/game/types.ts'), { infantryFormationGoal } = await __liveImport('/src/game/infantry-drill.ts');
      const leader = s.units.find(u => u.kind === 'leader' && u.faction === 0), troops = s.units.filter(u => u.faction === 0 && u.hp > 0 && isRetinueMember(u));
      const positions = troops.map(u => { const slot = infantryFormationGoal(s, u); return { id: u.id, kind: u.kind, x: u.x, y: u.y, goal: slot, error: slot ? Math.hypot(u.x-slot.x,u.y-slot.y) : null, order: u.order, inside: u.inside }; });
      return { time: s.time, count: troops.length, leader: { x: leader.x, y: leader.y }, leaderDistance: Math.hypot(goal.x-leader.x,goal.y-leader.y),
        mode: leader.infantryFormation?.mode, maxError: Math.max(...positions.map(u => u.error ?? 999)), positions };
    }, route.goal);
    observations.push(snapshot); console.log('generated city march', elapsed, snapshot.leaderDistance.toFixed(2), snapshot.mode, snapshot.maxError.toFixed(2));
    if (snapshot.leaderDistance < .1 && snapshot.mode === 'rectangle' && snapshot.maxError < .15 && snapshot.count === 12) break;
  }
  const last = observations.at(-1);
  writeFileSync(`${output}/generated-city-march.json`, JSON.stringify({ route, observations }, null, 2));
  await page.evaluate(goal => { __game.renderer.camera = goal; __game.renderer.zoom = 2.7; __game.renderer.follow = false; }, route.goal);
  await settle(); await page.screenshot({ path: `${output}/generated-city-reformed.png` });
  check('all 12 soldiers cross the generated city and reform tightly in open terrain', last.count === 12 && last.leaderDistance < .1 && last.mode === 'rectangle' && last.maxError < .15,
    { elapsed: last.time, count: last.count, leaderDistance: last.leaderDistance, mode: last.mode, maxError: last.maxError });
}
async function libraryLayout(label) {
  const metrics = await page.evaluate(() => {
    const popup = document.querySelector('#building-activity').getBoundingClientRect(), node = document.querySelector('[data-research="infantryDrill"]').getBoundingClientRect(),
      detail = document.querySelector('.research-detail').getBoundingClientRect(), scroll = document.querySelector('.research-tree-scroll');
    return { popup: { x: popup.x, y: popup.y, w: popup.width, h: popup.height }, fits: popup.x >= 0 && popup.y >= 0 && popup.right <= innerWidth && popup.bottom <= innerHeight,
      overlaps: node.x < detail.right && node.right > detail.x && node.y < detail.bottom && node.bottom > detail.y, scroll: scroll.scrollHeight - scroll.clientHeight,
      title: document.querySelector('.research-tech')?.textContent, nodeText: document.querySelector('[data-research="infantryDrill"]').textContent };
  });
  check(`Infantry Drill research fits ${label} without scrolling or detail overlap`, metrics.fits && !metrics.overlaps && metrics.scroll <= 1, metrics);
  await page.screenshot({ path: `${output}/research-${label}.png` });
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { timeout: 60000 });
  await page.evaluate(() => { window.__liveImport = async pathname => { const resource = [...performance.getEntriesByType('resource')].reverse().find(e => new URL(e.name).pathname === pathname); return import(resource?.name ?? pathname); }; });
  await createGame(false, 'infantry-drill-normal-ui');
  const normal = await armyState();
  check('ordinary generated game starts with 20 residents and Formation 3 research-locked', normal.population === 20 && !normal.tech && await formation.isDisabled() && await formation.locator('.hotbar-lock').isVisible(), normal);
  await page.locator('#world').focus(); await page.keyboard.press('3'); await settle();
  check('unresearched keyboard 3 cannot activate formation', !(await armyState()).formation?.active);
  await page.screenshot({ path: `${output}/normal-locked.png` });

  await createGame(true, 'infantry-drill-advanced-ui');
  const advanced = await armyState();
  check('actual advanced creation UI produces 250 residents and 3 of every soldier type', advanced.population === 250 && advanced.count === 12 && ['warrior','archer','spearman','horseman'].every(kind => advanced.counts[kind] === 3), advanced);
  check('advanced game already researches Infantry Drill and enables slot 3', advanced.tech === 1 && await formation.isEnabled() && !(await formation.locator('.hotbar-lock').isVisible()));
  await formation.click(); await settle();
  check('clicking action 3 forms ranks and shows active styling', (await armyState()).formation?.active && await formation.getAttribute('aria-pressed') === 'true');
  await simulate(8);
  await page.screenshot({ path: `${output}/advanced-formation.png` });
  await marchThroughGeneratedCity();

  await continuousRotationChecks();
  const before = await armyState();
  await page.keyboard.press('2'); await settle(); const stance = await armyState();
  check('2 still changes stance while formation stays active', stance.stance !== before.stance && stance.formation?.active);
  await page.keyboard.press('1'); await settle(); const recall = await armyState();
  check('1 still recalls while formation stays active', recall.recalls.some(time => time !== null) && recall.formation?.active);
  await page.keyboard.press('Shift'); await settle(); const movement = await armyState();
  check('Shift changes the separate legacy movement mode without releasing formation', movement.movementMode !== recall.movementMode && movement.formation?.active);
  await page.keyboard.down('3'); await page.keyboard.down('3'); await page.keyboard.up('3'); await settle();
  check('repeated 3 keydown toggles only once', !(await armyState()).formation?.active);
  const loose = await armyState(); await page.keyboard.press('q'); await settle();
  check('Q restores the original stance action outside formation', (await armyState()).stance !== loose.stance);
  await page.waitForTimeout(1050);
  await page.evaluate(() => { for (const u of __game.state.units) u.recallIssuedAt = undefined; });
  await page.keyboard.press('e'); await settle();
  check('E restores the original recall action outside formation', (await armyState()).recalls.some(time => time !== null));

  const libraryPoint = await page.evaluate(() => {
    const s = __game.state, library = s.buildings.find(b => b.faction === 0 && b.kind === 'library'), leader = s.units.find(u => u.faction === 0 && u.kind === 'leader');
    s.factions[0].research.levels.infantryDrill = 0; s.factions[0].research.focus = 'militaryTactics'; s.factions[0].research.autoResearch = false;
    delete s.factions[0].research.paid?.infantryDrill; s.factions[0].research.progress.infantryDrill = 0;
    Object.assign(leader, { x: library.x + .5, y: library.y + 2.5, order: 'hold', path: undefined, destination: undefined });
    __game.renderer.follow = false; __game.renderer.camera = { x: library.x + .5, y: library.y + .5 }; __game.renderer.zoom = 1.5;
    return __game.renderer.screenPoint({ x: library.x + .55, y: library.y + .55 });
  }); await settle();
  await page.mouse.click(libraryPoint.x, libraryPoint.y); await page.locator('#building-activity').waitFor({ state: 'visible' });
  await page.locator('[data-research="infantryDrill"]').click(); await settle();
  const research = await page.evaluate(async () => { const { researchStatus } = await __liveImport('/src/game/research.ts'); const status = researchStatus(__game.state, 0); return { focus: status.focus, required: status.required, cost: status.cost, details: document.querySelector('.research-detail').textContent }; });
  check('Infantry Drill is selectable and payable after Military Tactics', research.focus === 'infantryDrill' && await page.locator('.research-start').isEnabled() && research.cost === 200 && research.required === 60, research);
  await libraryLayout('desktop');
  await page.setViewportSize({ width: 750, height: 500 }); await settle(); await libraryLayout('compact');
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle();
  const gold = await page.evaluate(() => __game.state.factions[0].gold);
  await page.locator('.research-start').click(); await settle();
  check('starting Infantry Drill charges 200 gold once', await page.evaluate(gold => __game.state.factions[0].gold === gold - 200 && __game.state.factions[0].research.paid.infantryDrill, gold));
  check('browser completes without runtime errors', errors.length === 0, errors);
} finally {
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
