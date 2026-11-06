import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MARSH_PLANTS, vegetationArtBounds, vegetationStump, vegetationVariant } from '../src/game/vegetation-art';
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
    it('installs all four approved cutouts with the full crown and lowered height', () => {
        const manifest = JSON.parse(readFileSync(new URL('../public/assets/vegetation/marsh/manifest.json', import.meta.url), 'utf8'));
        const { tile } = fixture(), variants = new Set<string>();
        for (const [i, asset] of manifest.assets.entries()) {
            const path = new URL(`../public/assets/vegetation/marsh/${asset.file}`, import.meta.url), bytes = readFileSync(path);
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
            const atlas = punyAtlas(path);
            expect([atlas.width, atlas.height]).toEqual([32, 48]);
            const alpha = new Set(Array.from(atlas.data).filter((_, index) => index % 4 === 3));
            expect([...alpha].sort()).toEqual([0, 255]);
            tile.variation = i / 0x1000000;
            const source = vegetationVariant(tile)!; variants.add(source.sheet);
            expect(MARSH_PLANTS).toContainEqual(source);
            expect(vegetationStump(tile)).toBeUndefined();
        }
        expect(variants.size).toBe(4);
        const bounds = vegetationArtBounds(tile);
        expect(bounds.width / 32).toBe(2);
        expect(bounds.height / 32).toBe(2.45);
        expect((bounds.y + bounds.height) / 32).toBe(15 / 16);
        expect(bounds.x + bounds.width / 2).toBe(16);
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
        const frame = recordNativeFrame({ ...state, units: [] }, { fog, width: 256, height: 128 });
        const plant = frame.sprites.find(s => s.key === 'vegetation');
        expect(plant).toBeDefined();
        const bounds = vegetationArtBounds(state.world.tiles[5 * 16 + 3]);
        expect(plant!.y).toBeGreaterThan(128);
        expect(plant!.y + bounds.y).toBeLessThan(128);
    });
});
