import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [];
const output = 'scratch/2026-10-26-monuments-culture';
page.on('pageerror', error => errors.push(String(error)));
mkdirSync(output, { recursive: true });
try {
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
    if (await page.locator('#dialog').isVisible()) await page.keyboard.press('Escape');
    const result = await page.evaluate(async () => {
        const { MONUMENT_SPRITE } = await import('/src/game/monument-art.ts');
        const { TREASURE_SPRITE } = await import('/src/game/treasure.ts');
        const { drawBuilding } = await import('/src/game/sprites.ts');
        const { buildingIconUrl, icon } = await import('/src/ui/icons.ts');
        const { state, renderer } = window.__game;
        state.paused = true; state.time = 0; state.fields = []; state.particles = []; state.projectiles = []; state.bloodEffects = [];
        state.events = []; state.raiderCamps = []; state.marauderPacks = []; state.treeClearings = []; state.buildMode = null;
        state.gameOver = false; state.victory = false; state.diplomacy = null;
        state.world = { width: 40, height: 28, seed: 'original-props-art-qa', source: 'QA', spawns: [], revision: 0,
            tiles: Array.from({ length: 40 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) };
        const leader = { ...state.units.find(unit => unit.kind === 'leader' && unit.faction === 0),
            x: 12.5, y: 12.5, hp: 100, maxHp: 100, morale: 100, moving: false, attackTime: 0, inside: false, order: 'hold',
            destination: undefined, path: undefined, forcedAttack: undefined, target: undefined };
        window.__game.entities(state).units.replace([leader]);
        state.factions = [{ ...state.factions[0], id: 0, color: '#397cc6', population: 30, defeated: false, gold: 500 }];
        const monument = { id: 102, kind: 'monument', faction: 0, x: 14, y: 12, hp: 250, maxHp: 250, capacity: 0 };
        window.__game.entities(state).buildings.replace([{ id: 101, kind: 'palace', faction: 0, x: 9, y: 9, hp: 650, maxHp: 650, capacity: 0 }, monument,
            { id: 103, kind: 'house', faction: 0, x: 11, y: 15, hp: 100, maxHp: 100, capacity: 4, houseLevel: 2 }]);
        state.treasures = [{ id: 1, x: 17, y: 12 }]; state.fog = undefined;
        state.selected = monument.id; state.selectedType = 'building';
        renderer.follow = false; renderer.zoom = 2; renderer.camera = { x: 13.5, y: 12 };
        renderer.hover = null; renderer.buildPreview = []; renderer.moveMarker = null;
        // Capture the texture actually submitted by the native world compositor,
        // retaining the original transparent-pixel assertion rather than sampling
        // the chest after terrain and fog have been blended underneath it.
        const scene = renderer.gpu, paint = scene.art.paint.bind(scene.art);
        let chestArt;
        scene.art.paint = (key, ...args) => {
            const art = paint(key, ...args);
            if (key === 'treasure') chestArt = art;
            return art;
        };
        try { renderer.prepare(state); renderer.draw(state, 0); }
        finally { scene.art.paint = paint; }
        const chestInDisplayList = !!chestArt && scene.stage.children.some(sprite => sprite.texture === chestArt.texture);

        const canvas = (width, height = width) => { const element = document.createElement('canvas'); element.width = width; element.height = height; return element; };
        const worldSource = new Image(); worldSource.src = '/assets/puny-world/overworld.png'; await worldSource.decode();
        const dungeonSource = new Image(); dungeonSource.src = '/assets/puny-world/dungeon.png'; await dungeonSource.decode();
        const reference = (image, sprite, size) => {
            const c = canvas(size), context = c.getContext('2d'); context.imageSmoothingEnabled = false;
            context.drawImage(image, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, size, size);
            return context.getImageData(0, 0, size, size).data;
        };
        const opaque = pixels => pixels.filter((value, index) => index % 4 === 3 && value === 255).length;
        const art = canvas(32), ac = art.getContext('2d');
        drawBuilding(ac, monument, 0, 0, 32, 0, '#397cc6');
        const monumentPixels = ac.getImageData(0, 0, 32, 32).data, statueReference = reference(dungeonSource, MONUMENT_SPRITE, 32);
        const monumentMatches = monumentPixels.every((value, index) => value === statueReference[index]);
        ac.clearRect(0, 0, 32, 32); drawBuilding(ac, monument, 0, 0, 32, 0, '#ff0000');
        const stoneUnrecolored = ac.getImageData(0, 0, 32, 32).data.every((value, index) => value === monumentPixels[index]);

        const chestCanvas = canvas(32), cc = chestCanvas.getContext('2d');
        if (!chestInDisplayList) throw new Error('Visible treasure was not submitted to the native Pixi display list.');
        const { frame, source } = chestArt.texture, resolution = source.resolution;
        cc.imageSmoothingEnabled = false;
        cc.drawImage(source.resource, frame.x * resolution, frame.y * resolution, frame.width * resolution, frame.height * resolution, 0, 0, 32, 32);
        const chestPixels = cc.getImageData(0, 0, 32, 32).data, chestReference = reference(worldSource, TREASURE_SPRITE, 32);
        const chestMatches = chestPixels.every((value, index) => value === chestReference[index]);
        const oldGate = reference(dungeonSource, { x: 304, y: 272, width: 16, height: 16 }, 32);
        const differsFromOldGate = chestPixels.some((value, index) => value !== oldGate[index]);

        const portrait = new Image(); portrait.src = buildingIconUrl('monument', '#397cc6'); await portrait.decode();
        const portraitCanvas = canvas(64), pc = portraitCanvas.getContext('2d'); pc.drawImage(portrait, 0, 0);
        const portraitPixels = pc.getImageData(0, 0, 64, 64).data, portraitReference = reference(dungeonSource, MONUMENT_SPRITE, 64);
        const iconMatches = portraitPixels.every((value, index) => value === portraitReference[index]);
        return { monumentSource: MONUMENT_SPRITE, chestSource: TREASURE_SPRITE, monumentMatches, stoneUnrecolored,
            chestMatches, chestInDisplayList, differsFromOldGate, iconMatches, monumentOpaquePixels: opaque(monumentPixels), chestOpaquePixels: opaque(chestPixels),
            iconIsImage: icon('monument').startsWith('<img'), assetsReady: document.documentElement.dataset.assets };
    });
    assert.deepEqual(result.monumentSource, { x: 368, y: 288, width: 16, height: 16 });
    assert.deepEqual(result.chestSource, { x: 32, y: 464, width: 16, height: 16 });
    assert.equal(result.monumentMatches, true, 'World statue must retain every original Dungeon pixel');
    assert.equal(result.stoneUnrecolored, true, 'Neutral stone is identical for every faction');
    assert.equal(result.chestMatches, true, 'Treasure must use every original World closed-chest pixel');
    assert.equal(result.chestInDisplayList, true, 'Visible treasure must be submitted to the native Pixi display list');
    assert.equal(result.differsFromOldGate, true);
    assert.equal(result.iconMatches, true); assert.equal(result.iconIsImage, true);
    assert.ok(result.monumentOpaquePixels > 400 && result.chestOpaquePixels > 300);
    assert.equal(result.assetsReady, 'ready'); assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/monument-and-chest-in-game.png` });
    await page.keyboard.press('b');
    await page.locator('[data-build="monument"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-build="monument"] img.icon').count(), 0, 'Construction choices are text-only');
    assert.equal(await page.locator('[data-build="monument"] .action-label').innerText(), 'Monument');
    await page.screenshot({ path: `${output}/monument-build-menu.png` });
    writeFileSync(`${output}/art-report.json`, JSON.stringify(result, null, 2));
    console.log('PASS original World closed chest; original Dungeon statue; unchanged native pixels, neutral palette, HUD icon and startup asset loading');
    console.log(`Saved ${output}/monument-and-chest-in-game.png, monument-build-menu.png and art-report.json`);
} finally { await browser.close(); }
