import { invalidateNavigation } from '../src/game/pathfinding';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { cultureLevel, culturePerSecond, nextCultureThreshold, updateCulture, MONUMENT_CULTURE_PER_SECOND, SETTLEMENT_CULTURE_PER_SECOND } from '../src/game/culture';
import { borderRadius, territory } from '../src/game/borders';
import { updateGame } from '../src/game/simulation';
import type { Building, GameState } from '../src/game/types';

function fixture(withSettlement = false): GameState {
    return { world: { width: 32, height: 24, seed: 'culture', source: 'test', revision: 1, spawns: [],
        tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 0, production: 0, gold: 0, variation: .3 })) },
        units: [{ id: 1, kind: 'leader', faction: 0, x: 7.5, y: 12.5, hp: 100, morale: 100, attack: 17.5, defense: 4, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -100, moving: false, facing: 0, attackTime: 0 }],
        buildings: withSettlement ? [{ id: 2, kind: 'palace', faction: 0, x: 5, y: 10, hp: 650, maxHp: 650, capacity: 0 }] : [],
        factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#3988ff', affinity: 0, relation: id ? 'peace' : 'self', food: 50, gold: 0, production: 0,
            population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false })),
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], treasures: [],
        marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
        selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'culture', rngState: 1 };
}
function monument(state: GameState, faction = 0): Building {
    const result: Building = { id: state.buildings.length + 10, kind: 'monument', faction, x: 14 + state.buildings.length, y: 10, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(result); return result;
}

describe('culture and expansion thresholds', () => {
    it('grows settlement borders slowly without monuments, independently of population', () => {
        const state = fixture(true), before = territory(state);
        expect(culturePerSecond(state, 0)).toBe(SETTLEMENT_CULTURE_PER_SECOND);
        updateCulture(state, 499);
        expect(cultureLevel(state.factions[0].culture)).toBe(0);
        expect(territory(state)).toBe(before);
        state.factions[0].population = 1000;
        updateCulture(state, 1);
        expect(state.factions[0].culture).toBeCloseTo(100);
        expect(territory(state).revision).toBe(before.revision + 1);
    });

    it('adds each completed city and monument once, stopping new culture when captured or destroyed', () => {
        const state = fixture(true), original = state.buildings[0];
        const second = { ...original, id: 20, x: 20 };
        entityStore(state).buildings.add(second); monument(state);
        expect(culturePerSecond(state, 0)).toBeCloseTo(.4 + MONUMENT_CULTURE_PER_SECOND);
        second.construction = { startedAt: 0, duration: 90 };
        expect(culturePerSecond(state, 0)).toBeCloseTo(.2 + MONUMENT_CULTURE_PER_SECOND);
        delete second.construction; second.faction = 1;
        updateCulture(state, 10);
        expect(state.factions[1].culture).toBeCloseTo(2);
        second.hp = 0; updateCulture(state, 10);
        expect(state.factions[1].culture).toBeCloseTo(2);
        state.factions[0].defeated = true;
        expect(culturePerSecond(state, 0)).toBe(0);
    });

    it('does not grow independent village borders through faction culture', () => {
        const state = fixture(true); state.factions[0].villageId = 1;
        monument(state); updateCulture(state, 500);
        expect(state.factions[0].culture ?? 0).toBe(0);
    });

    it.each([[0, 0, 100], [99.999, 0, 100], [100, 1, 300], [299.999, 1, 300], [300, 2, 600], [600, 3, 1000], [1000, 4, 1500], [505000, 100, 515100]])
    ('maps %s accumulated culture to level %s and next threshold %s', (amount, level, next) => {
        expect(cultureLevel(amount)).toBe(level);
        expect(nextCultureThreshold(amount)).toBe(next);
        expect(borderRadius('monument', amount)).toBeCloseTo(4 + level * 1.3);
    });

    it('handles missing, negative and non-finite inputs without capping ordinary expansion', () => {
        for (const value of [undefined, -1, NaN, Infinity, -Infinity]) {
            expect(cultureLevel(value)).toBe(0); expect(nextCultureThreshold(value)).toBe(100);
        }
        expect(cultureLevel(50050000)).toBe(1000);
        expect(Number.isFinite(cultureLevel(Number.MAX_VALUE))).toBe(true);
        expect(Number.isFinite(nextCultureThreshold(Number.MAX_VALUE))).toBe(true);
    });

    it('adds fractional simulated time for every completed living monument, independently by faction', () => {
        const state = fixture(); monument(state); monument(state); monument(state, 1);
        expect(MONUMENT_CULTURE_PER_SECOND).toBe(2 / 3);
        expect(culturePerSecond(state, 0)).toBeCloseTo(4 / 3); expect(culturePerSecond(state, 1)).toBeCloseTo(2 / 3);
        expect(culturePerSecond(state, 99)).toBe(0);
        updateCulture(state, .125); updateCulture(state, .375);
        expect(state.factions[0].culture).toBeCloseTo(2 / 3); expect(state.factions[1].culture).toBeCloseTo(1 / 3);
        state.factions[0].population = 1000;
        updateCulture(state, .5);
        expect(state.factions[0].culture).toBeCloseTo(4 / 3);
    });

    it('ignores pending, paused, destroyed and non-monument buildings and inactive factions', () => {
        const state = fixture(), pending = monument(state), paused = monument(state), dead = monument(state);
        pending.construction = { startedAt: 0, duration: 10, waitingForBuilder: true };
        paused.construction = { startedAt: 0, duration: 10, pausedAt: 0 };
        dead.hp = 0; monument(state, 99); monument(state, 1); state.factions[1].defeated = true;
        expect(culturePerSecond(state, 0)).toBe(0); expect(culturePerSecond(state, 1)).toBe(0);
        updateCulture(state, 10);
        expect(state.factions[0].culture).toBeUndefined(); expect(state.factions[1].culture).toBeUndefined();
        delete pending.construction; updateCulture(state, .5);
        expect(state.factions[0].culture).toBeCloseTo(1 / 3);
    });

    it('retains earned culture after destruction and sends later production to a new owner', () => {
        const state = fixture(), building = monument(state);
        updateCulture(state, 450);
        expect(state.factions[0].culture).toBe(300); expect(cultureLevel(state.factions[0].culture)).toBe(2);
        const expanded = territory(state);
        building.faction = 1; updateCulture(state, 37.5);
        expect(state.factions[0].culture).toBe(300); expect(state.factions[1].culture).toBe(25);
        building.hp = 0; updateCulture(state, 1000);
        expect(state.factions[0].culture).toBe(300); expect(state.factions[1].culture).toBe(25);
        expect(territory(state)).not.toBe(expanded);
        expect(borderRadius('palace', state.factions[0].culture)).toBeCloseTo(7 * 1.3);
    });

    it('reuses the border map between thresholds during sustained production', () => {
        const state = fixture(); monument(state); const first = territory(state);
        for (let i = 0; i < 149; i++) { updateCulture(state, 1); expect(territory(state)).toBe(first); }
        updateCulture(state, 1); const second = territory(state);
        expect(second.revision).toBe(first.revision + 1);
        updateCulture(state, 299); expect(territory(state)).toBe(second);
        updateCulture(state, 1); expect(territory(state).revision).toBe(second.revision + 1);
    });

    it('reaches expansion thresholds consistently across repeated fractional steps', () => {
        const fine = fixture(), coarse = fixture(); monument(fine); monument(coarse);
        for (let frame = 0; frame < 1500; frame++) updateCulture(fine, .1);
        updateCulture(coarse, 150);
        expect(fine.factions[0].culture).toBe(coarse.factions[0].culture);
        expect(cultureLevel(fine.factions[0].culture)).toBe(1);
        // A later transfer or deliberate edit must not inherit stale rounding.
        fine.factions[0].culture = 299.5; updateCulture(fine, .75);
        expect(fine.factions[0].culture).toBe(300); expect(cultureLevel(fine.factions[0].culture)).toBe(2);
    });

    it('rejects invalid time deltas and keeps accumulated values finite', () => {
        const state = fixture(); monument(state); state.factions[0].culture = 42;
        for (const dt of [0, -1, NaN, Infinity, -Infinity]) updateCulture(state, dt);
        expect(state.factions[0].culture).toBe(42);
        state.factions[0].culture = NaN; updateCulture(state, .5); expect(state.factions[0].culture).toBeCloseTo(1 / 3);
        state.factions[0].culture = Number.MAX_VALUE; updateCulture(state, Number.MAX_VALUE);
        expect(state.factions[0].culture).toBe(Number.MAX_VALUE);
    });

    it('uses the full simulation clock, including pause, speed and monument ownership changes', () => {
        const state = fixture(true), building = monument(state), idle = { up: false, down: false, left: false, right: false };
        state.paused = true; updateGame(state, .5, idle); expect(state.factions[0].culture ?? 0).toBe(0);
        state.paused = false; state.speed = 2; updateGame(state, .25, idle);
        expect(state.factions[0].culture).toBeCloseTo(1 / 3 + .1);
        // Ownership is sampled at 3 Hz; total production remains continuous
        // and the new owner receives the monument rate after that sample.
        building.faction = 1; invalidateNavigation(state); updateGame(state, .25, idle);
        expect(state.factions[0].culture! + state.factions[1].culture!).toBeCloseTo(2 / 3 + .2);
        expect(state.factions[1].culture).toBeGreaterThan(0);
        const oldOwner = state.factions[0].culture!, newOwner = state.factions[1].culture!;
        updateGame(state, .25, idle);
        expect(state.factions[0].culture! - oldOwner).toBeCloseTo(.1);
        expect(state.factions[1].culture! - newOwner).toBeCloseTo(1 / 3);
    });
});
