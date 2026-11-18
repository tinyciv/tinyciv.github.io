import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { vegetationArtBounds, vegetationStump, vegetationVariant } from '../src/game/vegetation-art';
import { MarshRushBand, MarshRushPlacementCache } from '../src/game/marsh-rush-placement';
import { markWorldChanged, worldChangesSince } from '../src/game/world-revisions';
import type { FogView } from '../src/game/fog';
import type { GameState, Tile, Unit } from '../src/game/types';
import { recordNativeFrame } from './helpers/native-renderer';
import { punyAtlas } from './puny-atlas.js';

function fixture(x = 6, y = 6) {
    const unit: Unit = { id: 1, kind: 'worker', faction: 0, x: x + .5, y: y + .5, hp: 100,
        morale: 100, attack: 1, defense: 1, speed: 3, range: 1, order: 'hold', cooldown: 0,
        lastCombat: 0, moving: false, facing: 0, attackTime: 0 };
    const state: GameState = { world: { width: 16, height: 16, seed: 'marsh-art', source: 'fixture', spawns: [],
        tiles: Array.from({ length: 256 }, (): Tile => ({ terrain: 'grassland', overlay: 'none', elevation: .1,
            moisture: .9, food: 3, production: 1, gold: 0, variation: 0 })) }, units: [unit], buildings: [],
        factions: [], fields: [], time: 1, tick: 0, paused: true, speed: 1, events: [], particles: [],
        selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
        seed: 'marsh-art', rngState: 1 };
    const tile = state.world.tiles[y * 16 + x]; tile.marsh = true; tile.biome = 'wetland';
    const fog: FogView = { width: 16, height: 16, visible: new Uint8Array(256).fill(1), explored: Array(256).fill(1),
        sources: [], buildings: [], fields: [], revision: 1, explorationRevision: 1 };
    return { state, unit, tile, fog };
}

describe('approved marsh plants in the game compositor', () => {
    it('uses the approved atlas and anchors all four bands at the same footing', () => {
        const manifest = JSON.parse(readFileSync(new URL('../public/assets/vegetation/marsh/rushes-source.json', import.meta.url), 'utf8'));
        const path = new URL('../public/assets/vegetation/marsh/rushes.png', import.meta.url);
        expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(manifest.sha256);
        const atlas = punyAtlas(path), { tile } = fixture();
        expect([atlas.width, atlas.height]).toEqual([112, 96]);
        const bands = [MarshRushBand.Low, MarshRushBand.Middle, MarshRushBand.High, MarshRushBand.Tall];
        for (const [i, band] of bands.entries()) {
            const rush = { band, left: true, right: false, shootVariant: 0 };
            const source = vegetationVariant(tile, rush)!;
            const bounds = vegetationArtBounds(tile, 32, rush);
            expect([source.sheet, source.y, source.width]).toEqual(['rushes', [0, 16, 32, 64][i], 16]);
            expect([bounds.x, bounds.width, bounds.height]).toEqual([-16, 48, i < 2 ? 48 : 96]);
            expect(bounds.y + bounds.height).toBe(30);
        }
        expect(vegetationStump(tile)).toBeUndefined();
    });

    it('updates the fringe and side shoots after a localized marsh clearing', () => {
        const { state } = fixture(), { world } = state, cache = new MarshRushPlacementCache();
        world.revision = 0;
        for (let y = 2; y <= 10; y++) for (let x = 2; x <= 10; x++) world.tiles[y * 16 + x].marsh = true;
        let changes = worldChangesSince(world);
        cache.refresh(world, changes);
        expect(cache.get(world, 6, 6)).toMatchObject({ band: MarshRushBand.Tall, left: false, right: false });
        const far = cache.get(world, 10, 9);
        const cleared = 6 * 16 + 5;
        delete world.tiles[cleared].marsh;
        markWorldChanged(world, 'appearance', [cleared]);
        changes = worldChangesSince(world, changes.revision);
        cache.refresh(world, changes);
        expect(cache.get(world, 6, 6)?.band).toBe(MarshRushBand.Low);
        expect(cache.get(world, 5, 6)).toBeUndefined();
        expect(cache.get(world, 10, 9)).toBe(far);
    });

    it('covers units behind the reeds and lets units cross in front of the footing', () => {
        const { state, unit, fog } = fixture();
        let frame = recordNativeFrame(state, { fog }).sprites;
        expect(frame.findIndex(s => s.key === 'vegetation')).toBeGreaterThan(frame.findIndex(s => s.key === 'unit'));
        unit.y = 7;
        frame = recordNativeFrame(state, { fog }).sprites;
        expect(frame.findIndex(s => s.key === 'vegetation')).toBeLessThan(frame.findIndex(s => s.key === 'unit'));
    });

    it('respects hidden anchors and occupied roads, buildings and farm fields', () => {
        const { state, tile, fog } = fixture();
        const visiblePlants = () => recordNativeFrame(state, { fog }).sprites.filter(s => s.key === 'vegetation');
        expect(visiblePlants()).toHaveLength(1);
        fog.explored[6 * 16 + 6] = 0;
        expect(visiblePlants()).toHaveLength(0);
        fog.explored[6 * 16 + 6] = 1;
        for (const kind of ['road', 'house'] as const) {
            fog.buildings = [{ id: 1, kind, faction: 0, x: 6, y: 6, hp: 100, maxHp: 100, capacity: 0 }];
            expect(visiblePlants(), kind).toHaveLength(0);
        }
        fog.buildings = [{ id: 1, kind: 'irrigation', faction: 0, x: 6, y: 6, hp: 100, maxHp: 100, capacity: 0 }];
        expect(visiblePlants()).toHaveLength(1);
        fog.buildings = [];
        fog.fields = [{ id: 1, camp: 1, faction: 0, x: 6, y: 6, planted: true, food: 0, nextHarvest: 100, observedAt: 1 }];
        expect(visiblePlants()).toHaveLength(0);
        fog.fields = []; tile.terrain = 'coast';
        expect(vegetationVariant(tile)).toBeUndefined();
        expect(visiblePlants()).toHaveLength(0);
    });

    it('keeps a visible crown whose ground anchor is below the viewport', () => {
        const { state, fog } = fixture(3, 5);
        for (const index of [5 * 16 + 2, 5 * 16 + 4, 4 * 16 + 3, 6 * 16 + 3]) state.world.tiles[index].terrain = 'coast';
        const frame = recordNativeFrame({ ...state, units: [] }, { fog, width: 256, height: 128 });
        const plant = frame.sprites.find(s => s.key === 'vegetation');
        expect(plant).toBeDefined();
        const bounds = vegetationArtBounds(state.world.tiles[5 * 16 + 3]);
        expect(plant!.y).toBeGreaterThan(128);
        expect(plant!.y + bounds.y).toBeLessThan(128);
    });
});
