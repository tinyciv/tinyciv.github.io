import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-02-late-game'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.routeWebSocket(/.*/, () => {}); // Isolated client: source saves cannot reset this test via hot reload.
const checks = [], errors = [], check = (name, passed, detail) => { checks.push({ name, passed: !!passed, detail }); console.log(name, passed); assert.ok(passed, JSON.stringify({ name, detail })); };
page.on('pageerror', error => errors.push(String(error)));
const settle = () => page.waitForTimeout(160), popup = page.locator('#building-activity');
const ready = () => page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', { timeout: 60000 });
async function advance(seconds) {
  await page.evaluate(seconds => { const s = __game.state; s.paused = false;
    for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += .1) __game.step(Math.min(.1, seconds - elapsed));
    s.paused = true;
  }, seconds); await settle();
}
async function openBuilding(kind) {
  if (await popup.isVisible()) await page.keyboard.press('Escape');
  await page.evaluate(async kind => {
    const s = __game.state, b = s.buildings.find(b => b.kind === kind && b.faction === 0), leader = s.units.find(u => u.kind === 'leader' && u.faction === 0);
    const { constructionEdges } = await import('/src/game/builders.ts'); const p = constructionEdges(s, b)[0];
    Object.assign(leader, p); delete leader.destination; delete leader.path;
    __game.renderer.camera = { x: b.x + 1, y: b.y + 1 }; __game.renderer.follow = false;
  }, kind); await settle();
  const point = await page.evaluate(kind => { const b = __game.state.buildings.find(b => b.kind === kind && b.faction === 0);
    return __game.renderer.screenPoint({ x: b.x + .55, y: b.y + .55 }); }, kind);
  await page.mouse.click(point.x, point.y); await popup.waitFor({ state: 'visible' }); await settle();
}
async function researchFits(width, height) {
  const box = await popup.evaluate(e => { const r = e.getBoundingClientRect(), tree = e.querySelector('.research-tree-scroll');
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, scrollWidth: tree.scrollWidth, clientWidth: tree.clientWidth,
      scrollHeight: tree.scrollHeight, clientHeight: tree.clientHeight }; });
  check(`sixteen technologies fit ${width}×${height} without scrolling`, box.left >= 0 && box.top >= 0 && box.right <= width
    && box.bottom <= height && box.scrollWidth <= box.clientWidth && box.scrollHeight <= box.clientHeight, box);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5174/', { waitUntil: 'networkidle' }); await ready();
  await page.locator('[data-view="single"]').click();
  check('advanced start is offered as an unchecked new-game option', await page.locator('[name="advanced-start"]').isVisible()
    && !await page.locator('[name="advanced-start"]').isChecked());
  await page.locator('[name="seed"]').fill('BTV-847'); await page.locator('[name="advanced-start"]').check();
  await page.locator('[data-form="single"] button[type="submit"]').click();
  await page.locator('#frontend').waitFor({ state: 'hidden', timeout: 60000 });
  const advanced = await page.evaluate(async () => {
    const s = __game.state; s.paused = true;
    const { BUILDABLE_KINDS, isRetinueMember } = await import('/src/game/types.ts');
    const own = s.buildings.filter(b => b.faction === 0 && b.hp > 0 && !b.construction);
    return { population: s.factions[0].population, retinue: s.units.filter(u => u.faction === 0 && isRetinueMember(u)).length,
      roles: Object.fromEntries(['warrior', 'archer', 'spearman', 'horseman'].map(kind => [kind, s.units.filter(u => u.faction === 0 && isRetinueMember(u) && u.kind === kind).length])), infantryDrill: s.factions[0].research?.levels.infantryDrill, missing: BUILDABLE_KINDS.filter(kind => !own.some(b => b.kind === kind)), buildings: own.length, world: [s.world.width, s.world.height], seed: s.seed };
  });
  check('generated fractal advanced start has 250 residents, 12 retinue and every building', advanced.population === 250
    && advanced.retinue === 12 && Object.values(advanced.roles).every(count => count === 3) && advanced.infantryDrill === 1 && advanced.missing.length === 0, advanced);
  await page.screenshot({ path: `${output}/advanced-start.png` });
  const seeded = await page.evaluate(async () => {
    const { createGame } = await import('/src/game/simulation.ts'); const { generateWorld } = await import('/src/world/generator.ts');
    const { BUILDABLE_KINDS, isRetinueMember } = await import('/src/game/types.ts');
    return ['CROWN', 'river-kingdom'].map(seed => {
      try { const s = createGame(generateWorld(seed), undefined, { advancedStart: true }); return { seed, population: s.factions[0].population,
        retinue: s.units.filter(u => u.faction === 0 && isRetinueMember(u)).length,
        missing: BUILDABLE_KINDS.filter(kind => !s.buildings.some(b => b.faction === 0 && b.kind === kind && !b.construction)) }; }
      catch (error) { return { seed, error: String(error) }; }
    });
  }); check('advanced setup also succeeds on two other generated landscapes', seeded.every(s => !s.error && s.population === 250 && s.retinue === 12 && !s.missing.length), seeded);
  await page.evaluate(() => { __game.state.paused = true; __game.state.factions[0].gold = 4321; __game.state.units.find(u => u.kind === 'leader' && u.faction === 0).hp = 93; });
  await page.keyboard.press('Escape'); await page.locator('[data-frontend-action="save"]').click();
  check('menu confirms the explicit save', (await page.locator('.frontend-status').textContent()).includes('saved'));
  await page.reload({ waitUntil: 'networkidle' }); await ready(); await settle();
  const restored = await page.evaluate(() => ({ gold: __game.state.factions[0].gold, hp: __game.state.units.find(u => u.kind === 'leader' && u.faction === 0).hp,
    paused: __game.state.paused, seed: __game.state.seed }));
  check('reload resumes the saved paused session directly without a menu', await page.locator('#frontend').isHidden()
    && restored.gold === 4321 && restored.hp === 93 && restored.paused && restored.seed === 'BTV-847', restored);
  const states = [await page.evaluate(() => __game.state.retinueStance)];
  const stance = page.locator('[data-hotbar-action="stance"]');
  for (let i = 0; i < 3; i++) { await stance.click(); states.push(await page.evaluate(() => __game.state.retinueStance)); }
  check('three rapid stance clicks are all accepted and complete a full cycle', new Set(states.slice(0, 3)).size === 3 && states[0] === states[3], states);

  // A small controlled city isolates UI/training/construction from ongoing raids.
  await page.evaluate(async () => {
    const { RESEARCH_BRANCHES } = await import('/src/game/research.ts'); const { updateFog } = await import('/src/game/fog.ts');
    const b = (id, kind, x, y, extra = {}) => ({ id, kind, faction: 0, x, y, hp: 650, maxHp: 650, capacity: 0, ...extra });
    const u = (id, kind, x, y) => ({ id, kind, faction: 0, x, y, hp: 100, maxHp: 100, morale: 100, attack: 17, defense: 5,
      speed: 3.6, range: kind === 'leader' ? 4 : 1.1, order: 'hold', retinueStance: 'hold', cooldown: 0, lastCombat: -60,
      lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0, home: 1 });
    const state = { world: { width: 50, height: 36, seed: 'late-game-browser', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: 1800 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) },
      buildings: [b(1, 'palace', 17, 18, { cityName: 'Roma', initialCity: true, capacity: 20, unhousedResidents: 20,
        populationGrowth: -1e9, governorPermissions: { farms: false, housing: false } }), b(2, 'library', 22, 14), b(3, 'archeryRange', 22, 19)],
      units: [u(10, 'leader', 21.5, 17.5), ...Array.from({ length: 6 }, (_, i) => u(11 + i, 'warrior', 19.5 + i % 3, 16.5 + Math.floor(i / 3)))],
      factions: [{ id: 0, name: 'Romans', color: '#ee3434', affinity: 100, relation: 'self', food: 10000, gold: 10000,
        population: 20, production: 0, culture: 10000, yields: { food: 0, gold: 17, production: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9,
        defeated: false, research: { focus: 'militaryTactics', levels: Object.fromEntries(RESEARCH_BRANCHES.map(r => [r.id, 1])), progress: {}, autoResearch: false } }],
      time: 10, tick: 0, paused: true, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [], fields: [],
      treeClearings: [], selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false, victoryContinued: true,
      seed: 'late-game-browser', rngState: 1, raiderCamps: [], marauderPacks: [], treasures: [], villages: [], retinueStance: 'hold',
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 } };
    __game.replaceState(state); updateFog(state); __game.renderer.prepare(state);
    __game.renderer.zoom = 1.6; __game.renderer.camera = { x: 21, y: 18 }; __game.renderer.follow = false;
  }); await settle();
  await openBuilding('library');
  check('library shows all 16 technology nodes', await page.locator('button.research-node').count() === 16);
  await page.locator('button[data-research="siegeEngines"]').click(); await settle();
  await researchFits(1440, 950); await page.screenshot({ path: `${output}/research-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await researchFits(390, 844); await page.screenshot({ path: `${output}/research-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 950 }); await settle(); await openBuilding('archeryRange');
  const spearmen = page.locator('[name="spearmen"]');
  check('Military tactics enables the spearman allocation control', await spearmen.isVisible() && await spearmen.isEnabled());
  await spearmen.fill('50'); await spearmen.dispatchEvent('input'); await spearmen.dispatchEvent('change'); await settle();
  check('spearman control changes the faction quota', await page.evaluate(() => __game.state.factions[0].spearmanFraction === .5));
  await page.screenshot({ path: `${output}/spearman-allocation.png` });
  await page.keyboard.press('Escape'); await advance(30);
  const trained = await page.evaluate(() => __game.state.units.filter(u => u.faction === 0 && u.kind === 'spearman').map(u => ({ hp: u.hp, defense: u.defense, range: u.range })));
  check('soldiers physically retrain into the chosen spearman quota', trained.length === 3 && trained.every(u => u.defense > 5 && u.range > 1.1), trained);
  await page.evaluate(() => { const leader = __game.state.units.find(u => u.id === 10); leader.x = 28.5; leader.y = 20.5;
    __game.renderer.camera = { x: 30, y: 20 }; }); await settle();
  await page.locator('[data-action="fortifications"]').click(); const build = page.locator('[data-build="ballista"]');
  check('ballista appears under Fortify with shortcut L and 300 gold price', await build.isVisible() && await build.isEnabled()
    && (await build.getAttribute('title')).includes('300') && (await build.getAttribute('aria-keyshortcuts')).includes('L'));
  const before = await page.evaluate(() => __game.state.factions[0].gold);
  await build.click(); const position = await page.evaluate(() => __game.renderer.screenPoint({ x: 30.5, y: 20.5 }));
  await page.mouse.click(position.x, position.y); await settle();
  const order = await page.evaluate(() => { const s = __game.state; return { gold: s.factions[0].gold, b: s.buildings.find(b => b.kind === 'ballista') }; });
  check('ballista placement debits 300 gold and starts its 30-second assembly', order.gold === before - 300 && order.b?.construction?.duration === 30, order);
  await page.keyboard.press('Escape'); await advance(31);
  check('ballista assembles without a civilian builder', await page.evaluate(() => { const b = __game.state.buildings.find(b => b.kind === 'ballista'); return b && !b.construction; }));
  await page.evaluate(async () => {
    const { entityStore } = await import('/src/game/entity-store.ts'); const s = __game.state;
    s.factions.push({ ...s.factions[0], id: 1, name: 'Enemy', relation: 'war', population: 0, defeated: true });
    entityStore(s).buildings.add({ id: 99999, kind: 'woodenTower', faction: 1, x: 38, y: 20, hp: 1000, maxHp: 1000, capacity: 0, attackCooldown: 1e9 });
    // Vite's timestamped module graph can differ from a test's dynamic import.
    // Re-import the editor state through the main graph's official boundary.
    __game.replaceState(s);
    const { updateFog } = await import('/src/game/fog.ts'); updateFog(s);
  }); await advance(.1);
  const shot = await page.evaluate(() => ({ shotAt: __game.state.buildings.find(b => b.kind === 'ballista').siegeShotAt,
    projectiles: __game.state.projectiles.map(p => ({ kind: p.kind, target: p.target })) }));
  check('completed ballista fires a real bolt at an enemy defense', shot.shotAt !== undefined && shot.projectiles.some(p => p.target === 99999), shot);
  await advance(.2); await page.screenshot({ path: `${output}/ballista-shot.png` });
  const projectileTrace = await page.evaluate(async () => {
    const { entityStore } = await import('/src/game/entity-store.ts'), { arrowLineClear } = await import('/src/game/arrows.ts');
    const { atWar } = await import('/src/game/simulation.ts'), s = __game.state, trace = []; s.paused = false;
    for (let i = 0; i < 20; i++) {
      const p = s.projectiles[0], target = entityStore(s).buildings.get(99999);
      trace.push({ time: s.time, hp: target?.hp, indexed: !!target, unitCollision: entityStore(s).units.get(99999),
        atWar: atWar(s, 0, 1), lineClear: p && arrowLineClear(s, p.start, p.end, p.target), projectile: p && { ...p } });
      __game.step(.1);
    } s.paused = true; return trace;
  }); await settle();
  const impact = await page.evaluate(() => ({ target: __game.state.buildings.find(b => b.id === 99999), time: __game.state.time,
    projectiles: __game.state.projectiles, gameOver: __game.state.gameOver, victory: __game.state.victory }));
  check('the bolt damages its target through the actual game loop', impact.target.hp < 1000, { ...impact, projectileTrace });
  check('no runtime errors', errors.length === 0, errors);
} finally {
  if (checks.at(-1)?.name !== 'no runtime errors') {
    console.log('Frontend:', await page.locator('#frontend').textContent().catch(() => 'unavailable'));
    await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  }
  writeFileSync(`${output}/browser-report.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close();
}
