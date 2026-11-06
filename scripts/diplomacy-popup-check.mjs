import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], report = {};
page.on('pageerror', error => errors.push(String(error)));
const output = 'scratch/2026-10-26-borders-enclosure-fog';
mkdirSync(output, { recursive: true });
const commands = () => page.evaluate(() => window.__game.state.units.filter(unit => unit.faction === 0).map(unit => ({
    id: unit.id, order: unit.order, target: unit.target ?? null, destination: unit.destination ?? null, forcedAttack: unit.forcedAttack ?? null,
})));
const status = () => page.evaluate(() => ({ paused: window.__game.state.paused, relation: window.__game.state.factions[1].relation,
    dialog: !document.querySelector('#dialog').hidden, diplomacy: window.__game.state.diplomacy })) ;
const clickWorld = async point => {
    const screen = await page.evaluate(point => {
        const { renderer } = window.__game, rect = renderer.canvas.getBoundingClientRect(), screen = renderer.screenPoint(point);
        return { x: rect.left + screen.x, y: rect.top + screen.y };
    }, point);
    await page.mouse.click(screen.x, screen.y, { button: 'right' });
};
const fixture = async (paused = true) => {
    await page.keyboard.press('Escape');
    return page.evaluate(async paused => {
        const { renderer } = window.__game;
        const { updateFog } = await import('/src/game/fog.ts');
        const { warDeclarationTargetAt } = await import('/src/game/simulation.ts');
        const { buildingArtTop } = await import('/src/game/types.ts');
        const person = (id, kind, x, y) => ({ id, kind, faction: 0, x, y, hp: 100, maxHp: 100, morale: 100, attack: 20, defense: 0,
            speed: 0, range: kind === 'leader' ? 4 : 1.1, order: 'hold', retinueStance: 'hold', cooldown: 0, lastCombat: -60,
            lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 });
        const building = (id, kind, faction, x, y) => ({ id, kind, faction, x, y, hp: 650, maxHp: 650, capacity: 0 });
        const fresh = { world: { width: 56, height: 36, seed: 'diplomacy-popup-qa', source: 'QA', spawns: [], revision: 0,
            tiles: Array.from({ length: 56 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) },
            units: [person(10, 'leader', 10.5, 12.5), person(11, 'warrior', 9.5, 13.5), person(12, 'warrior', 11.5, 13.5)],
            buildings: [building(1001, 'palace', 0, 6, 10), building(1002, 'house', 1, 16, 12), building(1003, 'woodenTower', 1, 18, 9),
                building(1004, 'palace', 1, 45, 28), building(1005, 'house', 0, 8, 9)],
            factions: [0, 1].map(id => ({ id, name: id ? 'Redwater' : 'Player', color: id ? '#ce4740' : '#397cc6', affinity: id ? 60 : 100,
                relation: id ? 'peace' : 'self', food: 500, gold: 500, production: 0, population: 0, growth: 0,
                yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false })),
            time: 0, tick: 0, paused, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [],
            selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'diplomacy-popup-qa', rngState: 1,
            fields: [], raiderCamps: [], marauderPacks: [], treasures: [], treeClearings: [], fogRaids: { nextAt: 1000, waves: 0, pressureVersion: 2 },
            roamingMaraudersVersion: 1, retinueStance: 'hold', movementMode: 'travel' };
        fresh.units[0].destination = { x: 10.5, y: 14.5 };
        const state = fresh; window.__game.replaceState(state);
        renderer.follow = false; renderer.camera = { x: 14, y: 12 }; renderer.zoom = 1.5;
        renderer.hover = null; renderer.buildPreview = []; renderer.moveMarker = null;
        updateFog(state); renderer.prepare(state); renderer.draw(state, 0);
        const tower = state.buildings.find(building => building.id === 1003), upper = { x: tower.x + .5, y: tower.y + buildingArtTop(tower) + .15 };
        return { house: { x: 16.5, y: 12.5 }, towerUpper: upper,
            houseTarget: warDeclarationTargetAt(state, 16.5, 12.5)?.id, towerTarget: warDeclarationTargetAt(state, upper.x, upper.y)?.id,
            palaceDistance: Math.hypot(10.5 - 46, 12.5 - 29) };
    }, paused);
};
const openHouse = async point => {
    await clickWorld(point);
    await page.locator('#dialog:not([hidden])').waitFor();
    assert.equal(await page.locator('#dialog-title').textContent(), 'Declare war?');
    assert.equal(await page.locator('#declare-war').textContent(), 'Declare War');
    assert.equal(await page.locator('#dialog-body strong').textContent(), 'Redwater');
    assert.equal((await status()).paused, true);
};

try {
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5176/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
    const targets = await fixture();
    assert.equal(targets.houseTarget, 1002); assert.equal(targets.towerTarget, 1003); assert.ok(targets.palaceDistance > 30);
    const original = await commands();
    await openHouse(targets.house);
    assert.deepEqual(await commands(), original, 'Opening diplomacy does not issue orders');
    await page.screenshot({ path: `${output}/diplomacy-declare-war.png` });
    await page.locator('#cancel-war').click();
    assert.deepEqual(await status(), { paused: true, relation: 'peace', dialog: false, diplomacy: null });
    assert.deepEqual(await commands(), original);
    await openHouse(targets.towerUpper);
    assert.equal(await page.evaluate(() => window.__game.state.selected), 1003, 'Upper tower artwork selects its actual structure');
    await page.keyboard.press('Escape');
    assert.deepEqual(await status(), { paused: true, relation: 'peace', dialog: false, diplomacy: null });
    assert.deepEqual(await commands(), original);
    report.pausedCancelAndTowerEscape = true;

    const active = await fixture(false), activeCommands = await commands();
    await openHouse(active.house); await page.keyboard.press('Escape');
    assert.deepEqual(await status(), { paused: false, relation: 'peace', dialog: false, diplomacy: null });
    assert.deepEqual(await commands(), activeCommands);
    await openHouse(active.house); await page.locator('#cancel-war').click();
    assert.equal((await status()).paused, false); assert.deepEqual(await commands(), activeCommands);
    await openHouse(active.house); await page.locator('#declare-war').click();
    assert.deepEqual(await status(), { paused: false, relation: 'war', dialog: false, diplomacy: null });
    assert.deepEqual(await commands(), activeCommands, 'Confirming war does not order an attack');
    const savedImmediately = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('tinyciv-save-v3')).state;
        return { relation: saved.factions[1].relation, paused: saved.paused, forcedAttacks: saved.units.filter(unit => unit.forcedAttack).length };
    });
    assert.deepEqual(savedImmediately, { relation: 'war', paused: false, forcedAttacks: 0 });
    await page.evaluate(() => { window.__game.state.paused = true; });
    await clickWorld(active.house);
    const attack = await page.evaluate(() => ({ dialog: !document.querySelector('#dialog').hidden,
        targets: window.__game.state.units.filter(unit => unit.faction === 0).map(unit => unit.forcedAttack?.target) }));
    assert.equal(attack.dialog, false); assert.deepEqual(attack.targets, [1002, 1002, 1002]);
    report.activeCancelEscapeConfirmAndNextAttack = true; report.savedImmediately = savedImmediately;

    const invalid = [];
    for (const condition of ['friendly', 'raider', 'hidden', 'destroyed', 'confederated', 'defeated']) {
        await fixture();
        const point = await page.evaluate(async condition => {
            const { state, renderer } = window.__game, house = state.buildings.find(building => building.id === 1002);
            if (condition === 'friendly') house.faction = 0;
            if (condition === 'raider') house.faction = -2;
            if (condition === 'hidden') { house.x = 38; house.y = 20; renderer.camera = { x: 38.5, y: 20.5 }; }
            if (condition === 'destroyed') house.hp = 0;
            if (condition === 'confederated') state.factions[1].relation = 'confederated';
            if (condition === 'defeated') state.factions[1].defeated = true;
            renderer.draw(state, 0);
            const point = { x: house.x + .5, y: house.y + .5 };
            const { warDeclarationTargetAt } = await import('/src/game/simulation.ts');
            return { ...point, target: warDeclarationTargetAt(state, point.x, point.y)?.id ?? null };
        }, condition);
        assert.equal(point.target, null, `${condition} is not a diplomatic target`);
        await clickWorld(point); assert.equal((await status()).dialog, false, `${condition} opens no popup`);
        invalid.push(condition);
    }
    report.invalidTargets = invalid;

    const stale = await fixture(); await openHouse(stale.house);
    await page.evaluate(() => { const house = window.__game.state.buildings.find(building => building.id === 1002); house.x = 38; house.y = 20; });
    await page.locator('#declare-war').click();
    assert.equal((await status()).relation, 'peace'); assert.equal((await status()).dialog, true);
    assert.match(await page.locator('#war-result').textContent(), /no longer visible/i);
    await page.locator('#cancel-war').click();
    report.staleTargetRevalidated = true;

    const paused = await fixture(); await openHouse(paused.house); await page.locator('#declare-war').click();
    assert.deepEqual(await status(), { paused: true, relation: 'war', dialog: false, diplomacy: null });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
    assert.deepEqual(await status(), { paused: true, relation: 'war', dialog: false, diplomacy: null });
    report.pausedConfirmAndReload = true;
    assert.deepEqual(errors, []);
    writeFileSync(`${output}/diplomacy-popup-report.json`, JSON.stringify(report, null, 2));
    console.log('PASS actual right-click house/tower dialogs; Cancel/Escape preserve peace, orders and pause; confirmation persists war without autoattack; next click attacks; invalid/stale targets stay safe');
    console.log(`Saved ${output}/diplomacy-declare-war.png and diplomacy-popup-report.json`);
} finally { await browser.close(); }
