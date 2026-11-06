import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = 'scratch/2026-11-04-continuous-science'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error))); await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
const check = (name, passed, detail) => { checks.push({ name, passed: !!passed, detail }); console.log(passed ? 'PASS' : 'FAIL', name, JSON.stringify(detail)); assert.ok(passed, name); };
const settle = () => page.waitForTimeout(220), node = id => page.locator(`.research-node[data-research="${id}"]`);
const slider = page.locator('[name="research-allocation"]'), prioritize = page.locator('.research-prioritize');
const status = () => page.evaluate(async () => (await __researchImport('/src/game/research.ts')).researchStatus(__game.state, 0));
const income = async (gold, release = true) => {
  await page.evaluate(async ({ gold, release }) => {
    const { grantIncome } = await __researchImport('/src/game/resource-income.ts');
    const { updateResearch } = await __researchImport('/src/game/research.ts');
    const s = __game.state; grantIncome(s.factions[0], { gold }, s);
    if (release) { const paused = s.paused; s.paused = false; updateResearch(s, 1000); s.paused = paused; }
  }, { gold, release }); await settle();
};
async function open() { const p = await page.evaluate(() => __game.renderer.screenPoint({ x: 20.55, y: 14.55 })); await page.mouse.click(p.x, p.y); await page.locator('#building-activity').waitFor({ state: 'visible' }); await settle(); }
async function setShare(percent) { await slider.focus(); await page.keyboard.press('Home'); for (let i = 0; i < percent / 5; i++) await page.keyboard.press('ArrowRight'); await settle(); }
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.evaluate(async () => {
    window.__researchImport = async path => { const loaded = [...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === path); return import(loaded?.name ?? path); };
    const width = 48, height = 32, world = { width, height, seed: 'income-research-qa', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .7, food: 3, production: 1, gold: 0, variation: i % 13 / 13 })) };
    const building = (id, kind, x, y) => ({ id, kind, faction: 0, x, y, hp: 750, maxHp: 750, capacity: 0 });
    const s = { world, buildings: [{ ...building(1, 'palace', 15, 11), cityName: 'Roma', capacity: 20, unhousedResidents: 20, governorPermissions: { farms: false, housing: false } }, building(3, 'library', 20, 14)],
      units: [{ id: 500, kind: 'leader', faction: 0, x: 20.5, y: 16.5, hp: 100, maxHp: 100, morale: 100, attack: 20, defense: 5, speed: 3.6, range: 4, order: 'hold', retinueStance: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Roma', color: '#c94c4c', affinity: 100, relation: 'self', food: 300, gold: 2000, production: 0, population: 20, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
      time: 0, tick: 0, paused: true, speed: 1, gameOver: false, victory: false, events: [], particles: [], projectiles: [], bloodEffects: [], fields: [], treasures: [], raiderCamps: [], marauderPacks: [], treeClearings: [], villages: [],
      roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0,
      selected: 500, selectedType: 'unit', buildMode: null, diplomacy: null, seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(s); __game.renderer.prepare(s); __game.renderer.follow = false; __game.renderer.camera = { x: 21, y: 15 }; __game.renderer.zoom = 1.65;
  });
  await settle(); await open();
  const graph = await page.evaluate(async () => (await __researchImport('/src/game/research.ts')).RESEARCH_BRANCHES.map(branch => ({ id: branch.id, prerequisites: branch.prerequisites })));
  const expectedEdges = graph.flatMap(branch => branch.prerequisites.map(from => `${from}:${branch.id}`)).sort();
  const actualEdges = await page.locator('.research-edge').evaluateAll(edges => edges.map(edge => `${edge.dataset.from}:${edge.dataset.to}`).sort());
  check('all technologies and every prerequisite connector are present', await page.locator('.research-node').count() === graph.length && JSON.stringify(expectedEdges) === JSON.stringify(actualEdges), { nodes: graph.length, edges: actualEdges.length });
  const panelSize=await page.locator('#building-activity').boundingBox();
  check('desktop research popup is larger',panelSize.width>=1300&&panelSize.height>=680,panelSize);
  check('Science costs use beakers without conversion or treasury prose', await page.locator('.research-node-price .science-icon').count() === graph.length && !/\bRP\b|research points|1 gold|treasury/.test(await page.locator('.activity-research').textContent()));
  const scroller = page.locator('.research-tree-scroll');
  await scroller.hover(); await page.mouse.wheel(0, 280); await settle();
  const panned = await scroller.evaluate(e => e.scrollLeft);
  check('ordinary mouse wheel pans the tree horizontally', panned > 200, panned);
  await settle(); check('HUD refresh does not recenter a manually panned tree', await scroller.evaluate(e => e.scrollLeft) === panned);
  await scroller.evaluate(e => { e.scrollLeft = 0; });
  await node('woodenTower').focus(); await page.keyboard.press('End');
  check('keyboard navigation reveals the last technology', await node('horsebackRiding').evaluate(e => { const r=e.getBoundingClientRect(), s=e.closest('.research-tree-scroll').getBoundingClientRect(); return document.activeElement===e && r.left>=s.left && r.right<=s.right; }));
  await page.keyboard.press('Home');
  check('income share starts at 25% and cheapest eligible research is selected', await slider.inputValue() === '25' && (await status()).focus === 'woodenTower' && await page.locator('.research-default').isVisible());
  check('old payment and autoresearch controls are absent', await page.locator('.research-start,[name="auto-research"]').count() === 0 && !/Start research|Awaiting payment|Funded/.test(await page.locator('.activity-research').textContent()));
  await node('urbanPlanning').click(); await prioritize.click(); await settle();
  let s = await status(); check('distant priority automatically resolves its first prerequisite', s.priorities.join() === 'urbanPlanning' && s.focus === 'woodenTower' && /Fortification first/.test(await page.locator('.research-plan').textContent()), { priorities: s.priorities, focus: s.focus });
  await node('reinforcedDefenses').click(); await prioritize.click(); await settle();
  s = await status(); check('multiple priorities are ordered without spending savings', s.priorities.join() === 'reinforcedDefenses,urbanPlanning' && s.focus === 'woodenTower' && await page.evaluate(() => __game.state.factions[0].gold) === 2000);
  await page.locator('[data-priority="urbanPlanning"]').click(); await settle();
  check('inspecting a queued goal does not change priority', (await status()).priorities[0] === 'reinforcedDefenses' && await page.locator('.research-tech').textContent() === 'Urban Planning');
  await prioritize.click(); await settle(); check('queued goal can be promoted to first', (await status()).priorities.join() === 'urbanPlanning,reinforcedDefenses');
  await page.locator('.research-remove').click(); await settle(); check('removing a priority returns to the next queued goal', (await status()).priorities.join() === 'reinforcedDefenses' && (await status()).focus === 'woodenTower');
  const box = await slider.boundingBox();
  await page.evaluate(() => { window.__sliderIdentity = document.querySelector('[name="research-allocation"]'); });
  await page.mouse.move(box.x + 7 + (box.width - 14) * .25, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 7 + (box.width - 14) * .6, box.y + box.height / 2, { steps: 8 }); await page.waitForTimeout(450);
  const dragging = await slider.inputValue();
  check('HUD refresh preserves the active drag and native slider identity', dragging === '60' && await page.evaluate(() => document.querySelector('[name="research-allocation"]') === __sliderIdentity && document.activeElement === __sliderIdentity), dragging);
  await page.mouse.up(); await settle(); check('release commits the dragged allocation', (await status()).allocation === .6);
  await setShare(50); check('keyboard slider adjustment commits 50%', (await status()).allocation === .5 && await slider.inputValue() === '50');
  const allocationBeforeSpace = await slider.inputValue(); await page.keyboard.press('Space'); await settle();
  check('Space toggles pause while the library slider is focused', await page.evaluate(() => !__game.state.paused));
  await page.keyboard.press('Space'); await settle(); check('Space does not alter the focused slider', await page.evaluate(() => __game.state.paused) && await slider.inputValue() === allocationBeforeSpace);
  await page.keyboard.press('='); await settle(); check('unshifted equals increases speed while the slider is focused', await page.evaluate(() => __game.state.speed === 2));
  await page.keyboard.press('-'); await settle(); check('minus decreases speed while the slider is focused', await page.evaluate(() => __game.state.speed === 1));
  const goldBefore = await page.evaluate(() => __game.state.factions[0].gold), firstCost = (await status()).required;
  await income(firstCost, false);
  check('new income reserves paid Science without an instant progress jump', (await status()).progress === 0 && await page.locator('.research-toolbar-percent').textContent() === '0%');
  const percentages = [];
  for (let percent = 1; percent <= 50; percent++) {
    await page.evaluate(async () => {
      const { updateResearch } = await __researchImport('/src/game/research.ts'), state = __game.state;
      state.paused = false; updateResearch(state, .6); state.paused = true;
    });
    await settle(); percentages.push(await page.locator('.research-toolbar-percent').textContent());
  }
  check('funded research shows every percentage in sequence instead of jumping with receipts', percentages.every((value, index) => value === `${index + 1}%`), percentages);
  s = await status();
  check('actual income funds research and credits only the remainder to the treasury', Math.abs(s.progress - firstCost / 2) < 1e-8 && await page.evaluate(() => __game.state.factions[0].gold) === goldBefore + firstCost / 2, { progress: s.progress, required: s.required });
  check('toolbar displays the active prerequisite and its live percentage', await page.locator('.research-toolbar-name').textContent() === 'Fortification' && await page.locator('.research-toolbar-percent').textContent() === '50%');
  await income(1); await node('woodenTower').click(); await settle();
  const fractionalPercent = `${Math.floor((await status()).progress / (await status()).required * 100)}%`;
  check('fractional income updates tree and toolbar percentages before earning a whole point', await page.locator('.research-percentage').textContent() === fractionalPercent && await page.locator('.research-toolbar-percent').textContent() === fractionalPercent, fractionalPercent);
  await node('reinforcedDefenses').click(); await settle(); await page.screenshot({ path: `${out}/research-desktop.png` });
  await scroller.evaluate(e => { e.scrollLeft = 0; }); await page.screenshot({ path: `${out}/research-desktop-start.png` });
  await page.setViewportSize({ width:1900, height:900 }); await page.locator('#building-activity').evaluate(e => { e.style.width='1764px'; }); await settle();
  await page.locator('.research-board').screenshot({ path: `${out}/research-full-tree.png` });
  await page.locator('#building-activity').evaluate(e => { e.style.width=''; }); await page.setViewportSize({ width:1440, height:900 }); await settle();
  s = await status(); await income((s.required - s.progress) * 2); check('completion automatically advances to the next prerequisite', (await status()).focus === 'wall');
  await income((await status()).required * 2); check('deeper priority proceeds through Bronze Working', (await status()).focus === 'blacksmith');
  await income((await status()).required * 2); check('priority proceeds through Metal Tools', (await status()).focus === 'metalTools');
  await income((await status()).required * 2); check('completed prerequisites lead directly to the requested goal', (await status()).focus === 'reinforcedDefenses');
  await income((await status()).required * 2); s = await status(); check('finished priority clears and cheapest available selection resumes', s.priorities.length === 0 && s.focus === 'irrigation');
  await setShare(0); const pausedResearch = await status(); await income(100);
  check('0% allocation retains research progress and reports paused research', (await status()).progress === pausedResearch.progress && await page.locator('#research-toolbar').evaluate(e => e.classList.contains('is-inactive') && /Paused/.test(e.title)));
  await setShare(100); const allResearchGold = await page.evaluate(() => __game.state.factions[0].gold); await income(5);
  check('100% allocation diverts the full new receipt without spending existing gold', await page.evaluate(() => __game.state.factions[0].gold) === allResearchGold && (await status()).progress === pausedResearch.progress + 5);
  await setShare(25);
  await node('reinforcedDefenses').focus(); await page.keyboard.press('ArrowUp'); check('tree arrow-key navigation preserves its column', await node('urbanPlanning').evaluate(e => e === document.activeElement));
  await page.keyboard.press('Enter'); await settle(); check('keyboard activation inspects without adding a priority', await page.locator('.research-tech').textContent() === 'Urban Planning' && (await status()).priorities.length === 0);
  await page.evaluate(() => { __game.state.factions[0].villageBonuses = { research: .15 }; }); await settle();
  const scholarship = await page.locator('.activity-research').evaluate(e => ({ costs: [...e.querySelectorAll('.research-node-price')].map(node => node.textContent),
    labels: [e.innerText, ...[...e.querySelectorAll('[title],[aria-label],[aria-valuetext]')].map(node => node.title + ' ' + node.getAttribute('aria-label') + ' ' + node.getAttribute('aria-valuetext')), document.querySelector('#research-toolbar').title] }));
  check('scholar discounts use compact Science costs throughout labels and tooltips', scholarship.costs.every(cost => /^\d+(\.\d)?$/.test(cost.trim())) && scholarship.labels.every(label => !/\d+\.\d{2,}/.test(label)), scholarship.costs);
  await page.evaluate(() => { delete __game.state.factions[0].villageBonuses; }); await settle();
  for (const viewport of [{ width: 900, height: 700 }, { width: 800, height: 700 }, { width: 750, height: 500 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await settle(); const failures = [];
    for (const id of await page.locator('.research-node').evaluateAll(nodes => nodes.map(e => e.dataset.research))) {
      await node(id).click();
      const metrics = await page.locator('#building-activity').evaluate(e => { const r = e.getBoundingClientRect(), d = e.querySelector('.research-detail'), t = e.querySelector('.research-tree-scroll'); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, panelOverflow: e.scrollHeight - e.clientHeight, detailOverflow: d.scrollHeight - d.clientHeight, treeOverflow: t.scrollHeight - t.clientHeight }; });
      if (metrics.left < 0 || metrics.right > viewport.width + 1 || metrics.top < 0 || metrics.bottom > viewport.height + 1 || metrics.panelOverflow > 1 || metrics.detailOverflow > 1 || metrics.treeOverflow > 1) failures.push({ id, ...metrics });
    }
    check(`all technology details fit without vertical scrolling at ${viewport.width}×${viewport.height}`, failures.length === 0, failures);
    const pan = await scroller.evaluate(e => { e.scrollLeft = e.scrollWidth; return { left:e.scrollLeft, max:e.scrollWidth-e.clientWidth, overflow:e.scrollHeight-e.clientHeight }; });
    check(`all stages remain horizontally reachable at ${viewport.width}px`, pan.left > 0 && Math.abs(pan.left-pan.max)<=1 && pan.overflow<=1, pan);
    const cardOverflow = await page.locator('.research-node').evaluateAll(nodes => nodes.flatMap(e => { const r=e.getBoundingClientRect(); return [...e.querySelectorAll('.research-node-copy strong,.research-node-price,.research-node-state')].filter(child=>{const c=child.getBoundingClientRect();return c.width>0&&c.height>0&&(c.top<r.top||c.bottom>r.bottom||c.left<r.left||c.right>r.right);}).map(child=>({id:e.dataset.research,child:child.className,text:child.textContent})); }));
    check(`technology titles and costs fit inside cards at ${viewport.width}px`, cardOverflow.length===0, cardOverflow);
    const toolbar = await page.locator('#research-toolbar').evaluate(e => {
      const r = e.getBoundingClientRect(), others = ['.resources', '.time-controls', '#building-activity'].map(selector => document.querySelector(selector).getBoundingClientRect());
      return { width: r.width, overlaps: others.some(b => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) };
    });
    check(`toolbar remains readable without overlapping controls at ${viewport.width}px`, toolbar.width >= 150 && !toolbar.overlaps, toolbar);
    await node('traditionalMedicine').click(); await page.screenshot({ path: `${out}/research-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.keyboard.press('Escape'); await settle();
  check('Escape closes the library and leaves the toolbar visible', await page.locator('#building-activity').isHidden() && await page.locator('#research-toolbar').isVisible());
  await page.screenshot({ path: `${out}/research-toolbar.png` });
  check('no browser errors', errors.length === 0, errors);
} finally { writeFileSync(`${out}/checks.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
