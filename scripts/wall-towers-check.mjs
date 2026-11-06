import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = 'scratch/2026-10-27-wall-tower-integration';
mkdirSync(out, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const report = await page.evaluate(async () => {
    const { buildAt, validateBuildAt, cancelConstruction, moveUnit, BUILD_COSTS, selectAt, updateGame } = await import('/src/game/simulation.ts');
    const { ensureBuilders, updateBuilder } = await import('/src/game/builders.ts');
    const { updateConstruction } = await import('/src/game/structures.ts');
    const { canWalk } = await import('/src/game/pathfinding.ts');
    const { removeBuildings } = await import('/src/game/construction-cancellation.ts');
    const { updateFog } = await import('/src/game/fog.ts');
    const { buildingAtPoint } = await import('/src/game/hit-testing.ts');
    const { Renderer, indexBuildings, buildingConnections } = await import('/src/game/renderer.ts');
    window.__game.state.paused = true;
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const building = (kind, x, y, id, extra = {}) => ({ id, kind, faction: 0, x, y, hp: kind === 'woodenTower' ? 600 : 225, maxHp: kind === 'woodenTower' ? 600 : 225, capacity: 0, armor: kind === 'woodenTower' ? 6 : 2, ...extra });
    const unit = (id, kind, x, y, faction = 0) => ({ id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: kind === 'leader' ? 25 : 0, defense: 4, speed: 0, range: kind === 'leader' ? 4 : 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
    const fixture = () => {
      const state = {
        world: { width: 32, height: 24, seed: 'wall-tower-integration', source: 'QA', spawns: [], revision: 0, tiles: Array.from({ length: 768 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: ((i * 13) % 100) / 100 })) },
        buildings: [building('palace', 6, 10, 1, { hp: 650, maxHp: 650 })],
        units: [{ ...unit(2, 'leader', 14.5, 12.5), speed: 3.6 }],
        factions: [{ id: 0, name: 'Blue', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 2000, production: 0, population: 30, culture: 10000, growth: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
        time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [], fields: [], treeClearings: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'wall-tower-integration', rngState: 1, marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: 10000, waves: 0, pressureVersion: 1 }, treasures: [],
      };
      updateFog(state); return state;
    };
    const advance = (state, predicate, seconds = 90) => {
      for (let step = 0; step < seconds * 10 && !predicate(); step++) {
        state.time += .1; updateConstruction(state); ensureBuilders(state);
        for (const worker of state.units) if (worker.builder && worker.hp > 0) updateBuilder(state, worker, .1, moveUnit);
      }
      check(predicate(), 'Real builders did not complete independent wall/tower orders');
    };
    const order = (state, kind) => {
      const previous = new Set(state.buildings.map(b => b.id)), result = buildAt(state, kind, 12, 8);
      check(result.ok, `${kind} shared-tile placement rejected: ${result.message}`);
      return state.buildings.find(b => !previous.has(b.id) && b.kind === kind);
    };
    const result = { orders: [], cancellation: [], independence: [], gates: [], selection: [], joins: [], preview: [], renderOrder: [], combat: {}, renders: [] };
    for (const kinds of [['wall', 'woodenTower'], ['woodenTower', 'wall']]) for (const simultaneous of [false, true]) {
      const state = fixture(), first = order(state, kinds[0]);
      if (!simultaneous) advance(state, () => !first.construction);
      const second = order(state, kinds[1]);
      check(state.factions[0].gold === 2000 - BUILD_COSTS.wall.gold - BUILD_COSTS.woodenTower.gold, 'Both normal costs must be charged exactly once');
      check(!validateBuildAt(state, 'wall', 12, 8).ok && !validateBuildAt(state, 'woodenTower', 12, 8).ok, 'Duplicate layers must be rejected');
      advance(state, () => !first.construction && !second.construction);
      check(!canWalk(state, 12.5, 8.5, 0), 'Completed pair must block movement');
      result.orders.push({ order: kinds.join(' → '), simultaneous, seconds: state.time, paidGold: 2000 - state.factions[0].gold });
      for (const removedKind of ['wall', 'woodenTower']) {
        const copy = { ...state, buildings: state.buildings.map(b => ({ ...b })), units: [], world: { ...state.world } };
        const removed = copy.buildings.find(b => b.kind === removedKind), survivor = copy.buildings.find(b => b.kind === (removedKind === 'wall' ? 'woodenTower' : 'wall'));
        removed.hp = 0;
        check(survivor.hp > 0 && !canWalk(copy, 12.5, 8.5, 0), 'Destroying one layer must preserve the survivor and occupancy');
        removeBuildings(copy, new Set([removed.id]));
        check(copy.buildings.includes(survivor) && !canWalk(copy, 12.5, 8.5, 0), 'Removing one layer must preserve the other solid entity');
        result.independence.push({ removed: removedKind, survivor: survivor.kind, solid: true });
      }
    }
    for (const kinds of [['wall', 'woodenTower'], ['woodenTower', 'wall']]) {
      const state = fixture(), first = order(state, kinds[0]); advance(state, () => !first.construction);
      const second = order(state, kinds[1]), canceled = cancelConstruction(state, second.id);
      check(canceled.ok && canceled.refund === BUILD_COSTS[second.kind].gold, 'Queued layer must cancel and refund independently');
      check(state.buildings.includes(first) && !state.buildings.includes(second) && !canWalk(state, 12.5, 8.5, 0), 'Canceling the second layer must keep completed host');
      result.cancellation.push({ kept: first.kind, canceled: second.kind, refund: canceled.refund });
    }
    for (const construction of [undefined, { startedAt: 0, duration: 4, waitingForBuilder: true }]) {
      const state = fixture(); window.__game.entities(state).buildings.add(building('wall', 12, 8, 20), building('road', 12, 8, 21, { construction }));
      check(!validateBuildAt(state, 'woodenTower', 12, 8).ok, 'A tower must not seal a completed or queued gate');
      result.gates.push({ queuedRoad: !!construction, towerRejected: true });
    }
    const gates = fixture(); window.__game.entities(gates).buildings.add(building('wall', 12, 8, 20), building('woodenTower', 12, 8, 21), building('road', 11, 8, 22));
    check(!validateBuildAt(gates, 'road', 12, 8).ok, 'Road must not turn a tower cell into a misleading gate');
    const make = (width, height = width) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').imageSmoothingEnabled = false; return canvas; };
    const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
    const render = async (state, { width = 768, height = 320, zoom = 2, camera = { x: 16.5, y: 8.4 }, preview = null } = {}) => {
      const canvas = document.createElement('canvas'), mini = make(32); canvas.width = width; canvas.height = height; canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; mini.style.width = mini.style.height = '32px'; document.body.append(canvas, mini);
      const renderer = new Renderer(canvas, mini); await renderer.initialize(); renderer.follow = false; renderer.zoom = zoom; renderer.camera = camera; renderer.hover = preview; renderer.buildPreview = preview ? [preview] : [];
      renderer.draw(state, 0); const snapshot = await renderer.snapshot(); renderer.destroy(); canvas.remove(); mini.remove(); return snapshot;
    };
    const scene = fixture(); window.__game.entities(scene).buildings.add(building('woodenTower', 12, 8, 20), building('wall', 12, 8, 21), building('wall', 11, 8, 22), building('wall', 13, 8, 23),
      building('wall', 16, 8, 30), building('woodenTower', 16, 8, 31), building('wall', 16, 7, 32), building('wall', 16, 9, 33),
      building('woodenTower', 20, 8, 40), building('wall', 20, 8, 41), building('wall', 20, 7, 42), building('wall', 21, 8, 43));
    window.__game.entities(scene).units.add(unit(90, 'warrior', 12.5, 10.5), unit(91, 'worker', 20.5, 10.5)); scene.fog = undefined; updateFog(scene);
    const before = await render(scene), after = await render({ ...scene, buildings: [...scene.buildings].reverse() });
    const orderDifference = diff(pixels(before), pixels(after)); check(orderDifference === 0, 'Rendering must be independent of wall/tower creation order');
    result.renderOrder.push({ differentBytes: orderDifference }); result.renders.push({ name: 'completed-wall-towers.png', data: before.toDataURL() });
    const indexed = indexBuildings(scene.buildings);
    for (const [id, expected] of [[21, { north: false, east: true, south: false, west: true }], [30, { north: true, east: false, south: true, west: false }], [41, { north: true, east: true, south: false, west: false }]]) {
      const wall = scene.buildings.find(b => b.id === id), links = buildingConnections(wall, indexed, scene.world);
      check(JSON.stringify(links) === JSON.stringify(expected), 'Mounted wall must retain all neighboring wall joins'); result.joins.push({ wall: id, links });
    }
    for (const reverse of [false, true]) for (const pendingKind of [null, 'wall', 'woodenTower', 'both']) {
      const state = fixture(), wall = building('wall', 12, 8, 20), tower = building('woodenTower', 12, 8, 21);
      if (pendingKind === 'wall' || pendingKind === 'both') wall.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
      if (pendingKind === 'woodenTower' || pendingKind === 'both') tower.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
      window.__game.entities(state).buildings.add(...(reverse ? [tower, wall] : [wall, tower])); state.fog = undefined; updateFog(state);
      const towerY = tower.construction ? 8.2 : 7.65;
      for (const [x, y, expected] of [[12.5, towerY, tower], [12.5, 8.8, wall]]) {
        check(buildingAtPoint(state, { x, y })?.id === expected.id, `Independent ${expected.kind} hit test failed for ${pendingKind}, reverse=${reverse}`);
        selectAt(state, x, y); check(state.selected === expected.id && state.selectedType === 'building', 'Game pointer selection must select the hit layer');
        result.selection.push({ reverse, pendingKind, kind: expected.kind, x, y });
      }
    }
    for (const [hostKind, previewKind] of [['wall', 'woodenTower'], ['woodenTower', 'wall']]) {
      const state = fixture(); window.__game.entities(state).buildings.add(building(hostKind, 12, 8, 20), building('wall', 11, 8, 21), building('wall', 13, 8, 22));
      state.buildMode = previewKind; state.fog = undefined; updateFog(state);
      check(validateBuildAt(state, previewKind, 12, 8).ok, 'Shared-tile preview must be valid');
      result.preview.push({ hostKind, previewKind, valid: true });
      result.renders.push({ name: `preview-${previewKind}-on-${hostKind}.png`, data: (await render(state, { width: 384, height: 224, camera: { x: 12.5, y: 8.4 }, preview: { x: 12, y: 8 } })).toDataURL() });
    }
    const combat = fixture(); combat.paused = false; combat.units[0].x = 3.5; combat.units[0].y = 18.5;
    window.__game.entities(combat).buildings.add(building('wall', 12, 8, 20), building('woodenTower', 12, 8, 21), building('wall', 13, 8, 22));
    const victim = unit(50, 'warrior', 15.5, 8.5, -2); window.__game.entities(combat).units.add(victim); combat.fog = undefined; updateFog(combat);
    const idle = { up: false, down: false, left: false, right: false };
    updateGame(combat, .1, idle);
    const shot = combat.projectiles.find(projectile => projectile.attacker === 21 && projectile.target === victim.id);
    check(!!shot, 'Completed wall-mounted tower must fire its usual javelin');
    updateGame(combat, .4, idle); check(victim.hp < 100, 'Javelin must hit across the co-located and neighboring walls');
    result.combat = { attacker: shot.attacker, target: victim.id, startHeight: shot.startHeight, damage: 100 - victim.hp };
    const live = fixture(); window.__game.entities(live).buildings.add(building('woodenTower', 12, 8, 20), building('wall', 12, 8, 21), building('wall', 11, 8, 22), building('wall', 13, 8, 23));
    window.__game.replaceState(live); const renderer = window.__game.renderer; renderer.follow = false; renderer.zoom = 3; renderer.camera = { x: 12.5, y: 8.4 }; renderer.hover = null; renderer.buildPreview = [];
    selectAt(window.__game.state, 12.5, 7.65);
    return result;
  });
  await page.waitForFunction(() => document.querySelector('#selection-name').textContent.includes('tower'));
  await page.screenshot({ path: `${out}/selection-tower.png` });
  await page.evaluate(async () => { const { selectAt } = await import('/src/game/simulation.ts'); selectAt(window.__game.state, 12.5, 8.8); });
  await page.waitForFunction(() => document.querySelector('#selection-name').textContent === 'Wall');
  await page.screenshot({ path: `${out}/selection-wall.png` });
  for (const render of report.renders) writeFileSync(`${out}/${render.name}`, Buffer.from(render.data.split(',')[1], 'base64'));
  report.renders = report.renders.map(({ name }) => name); report.errors = errors; assert.deepEqual(errors, []); report.pass = true;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log('PASS wall/tower shared placement, real builders, cancellation, independent occupancy/selection, wall joins, rendering order, previews and firing.');
} finally { await browser.close(); }
