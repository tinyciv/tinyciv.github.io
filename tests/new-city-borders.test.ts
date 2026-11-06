import { describe, expect, it } from 'vitest';
import { borderCultureAt, cityBorderCulture, insideOwnBorders, territory } from '../src/game/borders';
import { cultureLevel } from '../src/game/culture';
import { entityStore } from '../src/game/entity-store';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { updateConstruction } from '../src/game/structures';
import type { Building, GameState } from '../src/game/types';

const building = (id: number, kind: Building['kind'], x: number, y: number): Building =>
    ({ id, kind, faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
function fixture(): GameState {
    return {
        world: { width: 110, height: 50, seed: 'city-culture', source: 'test', spawns: [],
            tiles: Array.from({ length: 5500 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
                moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
        units: [], buildings: [{ ...building(1, 'palace', 15, 24), cultureAtFounding: 0 },
            { ...building(2, 'palace', 75, 24), cultureAtFounding: 10000 }],
        factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self',
            food: 100, gold: 100, production: 0, population: 10, culture: 10000,
            yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
        time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false, events: [], particles: [],
        selected: null, selectedType: null, buildMode: null, diplomacy: null, seed: 'city-culture', rngState: 1,
    };
}

describe('new cities inherit limited culture', () => {
    it('caps inherited culture at one expansion without shrinking established cities', () => {
        const state = fixture();
        expect(cityBorderCulture(10000, 10000)).toBe(100);
        expect(cityBorderCulture(10000, 0)).toBe(10000);
        expect(insideOwnBorders(state, 0, 36.5, 25.5)).toBe(true);
        expect(insideOwnBorders(state, 0, 83.5, 25.5)).toBe(true);
        expect(insideOwnBorders(state, 0, 84.5, 25.5)).toBe(false);
        expect(insideOwnBorders(state, 0, 96.5, 25.5)).toBe(false);
    });

    it('grows at local thresholds even when the faction culture level has not changed', () => {
        const state = fixture(), first = territory(state), factionLevel = cultureLevel(state.factions[0].culture);
        state.factions[0].culture = 10199;
        expect(territory(state)).toBe(first);
        state.factions[0].culture = 10200;
        expect(cultureLevel(state.factions[0].culture)).toBe(factionLevel);
        expect(cityBorderCulture(state.factions[0].culture, 10000)).toBe(300);
        expect(territory(state).revision).toBe(first.revision + 1);
        expect(insideOwnBorders(state, 0, 84.5, 25.5)).toBe(true);
        expect(insideOwnBorders(state, 0, 85.5, 25.5)).toBe(false);
    });

    it('uses the nearest friendly city for houses, monuments and their placement previews', () => {
        const state = fixture();
        entityStore(state).buildings.add(building(3, 'house', 78, 24), building(4, 'monument', 79, 25));
        expect(borderCultureAt(state, 0, 79.5, 25.5)).toBe(100);
        expect(borderCultureAt(state, 0, 18.5, 25.5)).toBe(10000);
        expect(insideOwnBorders(state, 0, 84.5, 25.5)).toBe(true);
        expect(insideOwnBorders(state, 0, 85.5, 25.5)).toBe(false);
        // Neither a young-city house nor a monument may import the distant
        // capital's much wider culture radius immediately after placement.
        expect(insideOwnBorders(state, 0, 95.5, 25.5)).toBe(false);
    });

    it('starts the culture clock at completion, excluding culture earned while construction was queued', () => {
        const state = fixture(), palace = state.buildings[1];
        palace.construction = { startedAt: 0, duration: 90 };
        expect(insideOwnBorders(state, 0, 76.5, 25.5)).toBe(false);
        state.factions[0].culture = 20000; state.time = 90;
        expect(updateConstruction(state)).toBe(true);
        expect(palace.cultureAtFounding).toBe(20000);
        expect(palace.construction).toBeUndefined();
        expect(insideOwnBorders(state, 0, 83.5, 25.5)).toBe(true);
        expect(insideOwnBorders(state, 0, 84.5, 25.5)).toBe(false);
    });

    it('observes changed foundation culture and preserves local culture across save/load', () => {
        const state = fixture(), before = territory(state);
        state.buildings[1].cultureAtFounding = 9800;
        expect(territory(state).revision).toBe(before.revision + 1);
        expect(insideOwnBorders(state, 0, 84.5, 25.5)).toBe(true);
        const restored = parseGameSave(serializeGameSave(state));
        expect(restored.buildings[1].cultureAtFounding).toBe(9800);
        expect(territory(restored).owners).toEqual(territory(state).owners);
    });

    it('never borrows more culture than the faction owns', () => {
        expect(cityBorderCulture(75, 75)).toBe(75);
        expect(cityBorderCulture(20, 10000)).toBe(20);
        expect(cityBorderCulture(undefined, 10000)).toBe(0);
        expect(cityBorderCulture(Number.NaN, 10000)).toBe(0);
    });
});
