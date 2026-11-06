import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(String(error)));
const output = 'scratch/2026-10-26-borders-enclosure-fog';
mkdirSync(output, { recursive: true });
try {
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
    const result = await page.evaluate(async () => {
        const { state, renderer } = window.__game;
        const { loadTreasureArt, updateTreasureChests, TREASURE_SPRITE } = await import('/src/game/treasure.ts');
        const { updateFog } = await import('/src/game/fog.ts');
        const { territory, insideOwnBorders } = await import('/src/game/borders.ts');
        const { regenerateUnits } = await import('/src/game/unit-health.ts');
        const { Renderer } = await import('/src/game/renderer.ts');
        await loadTreasureArt();
        state.paused = true; state.time = 30; state.particles = []; state.events = []; state.fields = []; state.buildMode = null;
        state.selected = null; state.selectedType = null; state.raiderCamps = []; state.marauderPacks = [];
        state.world = { width: 48, height: 32, seed: 'territory-treasure-qa', source: 'QA', spawns: [],
            tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) };
        const leader = { ...state.units.find(unit => unit.kind === 'leader' && unit.faction === 0),
            x: 16.5, y: 12.5, hp: 100, maxHp: 100, morale: 100, moving: false, attackTime: 0, inside: false, lastDamagedAt: 0 };
        window.__game.entities(state).units.replace([leader]);
        for (let y = 0; y < 32; y++) state.world.tiles[y * 48 + 14].terrain = 'river';
        state.factions = [0, 1].map(id => ({ ...state.factions[0], id, color: id ? '#d4413e' : '#397cc6', population: 10, defeated: false, gold: 50 }));
        window.__game.entities(state).buildings.replace([{ id: 101, kind: 'palace', faction: 0, x: 11, y: 12, hp: 650, maxHp: 650, capacity: 0 },
            { id: 102, kind: 'house', faction: 0, x: 9, y: 20, hp: 100, maxHp: 100, capacity: 4 },
            { id: 103, kind: 'house', faction: 1, x: 37, y: 10, hp: 100, maxHp: 100, capacity: 4 }]);
        state.treasures = [{ id: 1, x: 20, y: 12 }, { id: 2, x: 36, y: 25 }];
        state.fog = undefined; renderer.follow = false; renderer.zoom = 1.5; renderer.camera = { x: 17, y: 14 };
        renderer.hover = null; renderer.buildPreview = []; renderer.moveMarker = null;
        renderer.prepare(state); renderer.draw(state, 0);
        const initial = (await renderer.snapshot()).toDataURL();
        state.treasures[1].x++;
        state.factions[1].population = 20;
        renderer.draw(state, 0);
        const hiddenStable = initial === (await renderer.snapshot()).toDataURL();

        const fog = updateFog(state), borders = territory(state);
        // Capture the actual native display list with and without the relevant
        // objects, then verify compositing against the original atlas pixels.
        const canvas = document.createElement('canvas'), mini = document.createElement('canvas');
        canvas.width = 48 * 32; canvas.height = 32 * 32; mini.width = mini.height = 32;
        canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
        mini.style.width = mini.style.height = '32px'; document.body.append(canvas, mini);
        const qa = structuredClone(state), native = new Renderer(canvas, mini);
        await native.initialize(); native.follow = false; native.zoom = 1; native.camera = { x: 24, y: 16 };
        const qaBorders = territory(qa), paths = qaBorders.paths, treasures = qa.treasures;
        const capture = async () => { native.draw(qa, 0); return await native.snapshot(); };
        let art, chest, hiddenChest, nativeChestMatches, bp, borderPixels = 0, softenedPixels = 0, whiteInteriors = 0, factionInteriors = 0;
        const colors = new Set();
        try {
            qaBorders.paths = []; qa.treasures = [];
            const background = await capture();
            qa.treasures = treasures;
            const withoutBorders = await capture();
            const source = new Image(); source.src = '/assets/puny-world/overworld.png'; await source.decode();
            const reference = document.createElement('canvas'); reference.width = reference.height = 32;
            const rc = reference.getContext('2d'); rc.imageSmoothingEnabled = false;
            rc.drawImage(background, 20 * 32, 12 * 32, 32, 32, 0, 0, 32, 32);
            rc.drawImage(source, TREASURE_SPRITE.x, TREASURE_SPRITE.y, 16, 16, 0, 0, 32, 32);
            chest = withoutBorders.getContext('2d').getImageData(20 * 32, 12 * 32, 32, 32).data;
            const referencePixels = rc.getImageData(0, 0, 32, 32).data;
            nativeChestMatches = chest.every((value, index) => value === referencePixels[index]);
            const hidden = withoutBorders.getContext('2d').getImageData(37 * 32, 25 * 32, 32, 32).data;
            const hiddenBackground = background.getContext('2d').getImageData(37 * 32, 25 * 32, 32, 32).data;
            hiddenChest = hidden.map((value, index) => Math.abs(value - hiddenBackground[index]));
            qaBorders.paths = paths; art = await capture();
            const foreground = art.getContext('2d').getImageData(0, 0, art.width, art.height).data;
            const backgroundPixels = withoutBorders.getContext('2d').getImageData(0, 0, art.width, art.height).data;
            bp = new Uint8ClampedArray(foreground.length);
            const stripes = [[255, 248, 229], [57, 124, 198]];
            for (let i = 0; i < foreground.length; i += 4) {
                if (foreground[i] === backgroundPixels[i] && foreground[i + 1] === backgroundPixels[i + 1] && foreground[i + 2] === backgroundPixels[i + 2]) continue;
                let best;
                for (let stripe = 0; stripe < stripes.length; stripe++) {
                    const rgb = stripes[stripe], delta = rgb.map((value, channel) => value - backgroundPixels[i + channel]);
                    const square = delta.reduce((sum, value) => sum + value * value, 0);
                    if (!square) continue;
                    const opacity = Math.max(0, Math.min(1, delta.reduce((sum, value, channel) => sum + value * (foreground[i + channel] - backgroundPixels[i + channel]), 0) / square));
                    const error = delta.reduce((sum, value, channel) => sum + (foreground[i + channel] - backgroundPixels[i + channel] - value * opacity) ** 2, 0);
                    if (!best || error < best.error) best = { opacity, error, stripe, rgb };
                }
                if (!best) continue;
                bp.set([...best.rgb, Math.round(best.opacity * 255)], i);
                borderPixels++; if (bp[i + 3] < 190) softenedPixels++;
                colors.add(`${bp[i]},${bp[i + 1]},${bp[i + 2]},${bp[i + 3]}`);
                if (best.error < 4 && Math.abs(best.opacity - .75) < .01) {
                    if (best.stripe === 0) whiteInteriors++; else factionInteriors++;
                }
            }
        } finally { qaBorders.paths = paths; native.destroy(); canvas.remove(); mini.remove(); }

        const alpha = (x, y) => bp[(Math.floor(y) * art.width + Math.floor(x)) * 4 + 3];
        const riverClaimed = borders.owners[12 * 48 + 14] === 0;
        const riverBankPixels = [14, 15].map(x => Array.from({ length: 4 }, (_, offset) => alpha(x * 32 - 2 + offset, 12.5 * 32))).flat();
        const lineCandidates = borders.paths.filter(path => path.edge.faction === 0).map(({ edge }) =>
            Array.from({ length: 12 }, (_, offset) => edge.horizontal
                ? alpha((edge.x + .625) * 32, edge.y * 32 - 6 + offset)
                : alpha(edge.x * 32 - 6 + offset, (edge.y + .625) * 32)));
        const lineSamples = lineCandidates.sort((a, b) => Math.max(...b) - Math.max(...a))[0] ?? [];
        const lineOpacity = Math.max(0, ...lineSamples);
        // A3px line centered on an integer coordinate has two full pixels and
        // two half-covered pixels. Integrate coverage rather than count pixels.
        const lineThickness = lineOpacity ? lineSamples.reduce((sum, value) => sum + value, 0) / lineOpacity : 0;
        const curvedCorners = borders.paths.filter(path => path.from || path.to).length;
        const beforeGold = state.factions[0].gold; leader.x = 20.5; leader.y = 12.5;
        updateTreasureChests(state); updateTreasureChests(state);
        const collection = { amount: state.factions[0].gold - beforeGold, collected: state.treasures[0].collected, labels: state.particles.map(particle => particle.text) };
        state.particles = []; leader.hp = 50; leader.x = 28.5; leader.y = 25.5;
        regenerateUnits(state, 1); const outsideHp = leader.hp;
        leader.x = 14.5; leader.y = 12.5; regenerateUnits(state, 1); const homeHp = leader.hp;
        // Restore the discovered chest view for the reviewable screenshot.
        leader.x = 16.5; leader.y = 12.5; leader.hp = 100; state.treasures[0].collected = false;
        renderer.draw(state, 0);
        return { hiddenStable, nativeChestMatches, chestPixels: chest.filter((_, index) => index % 4 === 3 && chest[index]).length,
            hiddenChestEmpty: hiddenChest.every(value => value === 0), borderPixels, borderColors: [...colors], softenedPixels, whiteInteriors, factionInteriors, riverClaimed, riverBankPixels, lineOpacity, lineThickness, curvedCorners, borderEdges: borders.edges.length,
            owned: insideOwnBorders(state, 0, 14.5, 12.5), outsideHp, homeHp, collection };
    });
    writeFileSync(`${output}/borders-report.json`, JSON.stringify(result, null, 2));
    assert.equal(result.hiddenStable, true, 'Hidden chest movement and unseen rival growth must not affect pixels');
    assert.equal(result.nativeChestMatches, true, 'Treasure must retain every original atlas pixel');
    assert.ok(result.chestPixels > 200); assert.equal(result.hiddenChestEmpty, true);
    assert.ok(result.borderPixels > 100);
    assert.ok(result.whiteInteriors > 0 && result.factionInteriors > 0, 'Both stripe colors have75% opacity in their interiors');
    assert.ok(Math.abs(result.lineOpacity - 191) <= 3, `Native border compositing preserves75% opacity: ${result.lineOpacity}`);
    assert.ok(Math.abs(result.lineThickness - 3) < .15, 'The native32px tile has a3px border,25% thinner than before');
    assert.ok(result.curvedCorners > 0 && result.softenedPixels > 0, 'Contours contain actual rounded transitions');
    assert.equal(result.riverClaimed, true); assert.ok(result.riverBankPixels.every(alpha => alpha === 0), 'An enclosed river has no internal bank outline');
    assert.deepEqual(result.collection, { amount: 200, collected: true, labels: ['+200 gold'] });
    assert.equal(result.owned, true); assert.equal(result.outsideHp, 50); assert.equal(result.homeHp, 52.4);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/borders-river-treasure.png` });
    console.log('PASS native Puny treasure pixels, fog concealment, single +200 pickup, rounded thinner translucent borders, enclosed rivers and healing within own territory');
    console.log(`Saved ${output}/borders-river-treasure.png and borders-report.json`);
} finally { await browser.close(); }
