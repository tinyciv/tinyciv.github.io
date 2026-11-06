import { describe, expect, it } from 'vitest';
import { recordNativeFrame } from './helpers/native-renderer';
import type { FogView } from '../src/game/fog';
import type { GameState, Unit } from '../src/game/types';

function fixture() {
    const unit: Unit = { id: 1, kind: 'warrior', faction: 0, x: 6.5, y: 6.5, hp: 100, morale: 100,
        attack: 25, defense: 5, speed: 3, range: 1, order: 'hold', cooldown: 0, lastCombat: 0,
        lastDamagedAt: 0, moving: false, facing: 0, attackTime: 0 };
    const state: GameState = { world: { width: 16, height: 16, seed: 'combat-art', source: 'fixture', spawns: [],
        tiles: Array.from({ length: 256 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
            moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
        units: [unit], buildings: [], factions: [], fields: [{ id: 1, camp: 1, faction: 0, x: 6, y: 6, planted: true, food: 0, nextHarvest: 0 }],
        time: .08, tick: 0, paused: true, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'combat-art', rngState: 1 };
    const fog: FogView = { width: 16, height: 16, visible: new Uint8Array(256).fill(1), explored: Array(256).fill(1),
        sources: [], buildings: [], fields: state.fields!.map(field => ({ ...field, observedAt: 0 })), revision: 1, explorationRevision: 1 };
    return { state, unit, fog };
}

describe('combat effects in the world compositor', () => {
    it('flashes only an actual hit and lets the same wheat foreground cover body and red mask', () => {
        const { state, unit, fog } = fixture();
        expect(recordNativeFrame(state, { fog }).sprites.some(s => s.key === 'unit-damage')).toBe(false);
        unit.damageFlashAt = 0;
        const frame = recordNativeFrame(state, { fog }).sprites;
        const base = frame.findIndex(s => s.key === 'unit'), mask = frame.findIndex(s => s.key === 'unit-damage');
        expect(frame[mask].alpha).toBeCloseTo(.22);
        expect(frame[mask]).toMatchObject({ x: frame[base].x, y: frame[base].y, scale: frame[base].scale });
        expect(mask).toBeGreaterThan(base);
        expect(frame.findIndex(s => s.key.startsWith('wheat-front:'))).toBeGreaterThan(mask);
        state.time = .16;
        expect(recordNativeFrame(state, { fog }).sprites.some(s => s.key === 'unit-damage')).toBe(false);
    });

    it('replaces every unit with the opaque fall and immediate decay poses, then clears the ground', () => {
        const { state: original, unit, fog } = fixture();
        const state: GameState = { ...original, units: [], unitDeaths: [{ unit: { ...unit, hp: 0 }, x: unit.x, y: unit.y, time: 0, color: '#3988ff' }] };
        const starts = [0, .08, .175, .28, .375, .465, .565, .765, 1.165, 1.765, 2.565, 3.515, 4.565];
        for (const kind of ['leader', 'warrior', 'archer', 'scout', 'militia', 'worker', 'merchant'] as const) {
            state.unitDeaths![0].unit.kind = kind;
            for (let i = 0; i < 12; i++) for (const age of [starts[i], (starts[i] + starts[i + 1]) / 2, starts[i + 1] - .000001]) {
                state.time = age;
                const frame = recordNativeFrame(state, { fog }).sprites;
                const death = frame.filter(s => s.key.startsWith('unit-death:'));
                expect(death).toHaveLength(1);
                expect(death[0]).toMatchObject({ key: `unit-death:${i}`, alpha: 1 });
                expect(frame.some(s => s.key === 'unit' || s.key === 'unit-damage')).toBe(false);
                expect(frame.findIndex(s => s.key.startsWith('wheat-front:'))).toBeGreaterThan(frame.indexOf(death[0]));
            }
        }
        // Stale snapshots must not draw any remains even before the next simulation cleanup.
        for (const age of [4.565, 5, 29]) {
            state.time = age;
            expect(recordNativeFrame(state, { fog }).sprites.some(s => s.key.startsWith('unit-death:'))).toBe(false);
        }
    });

    it('hides even friendly remains once their ground location leaves current sight', () => {
        const { state: original, unit, fog } = fixture();
        const state: GameState = { ...original, units: [], time: 1, unitDeaths: [{ unit: { ...unit, hp: 0 }, x: unit.x, y: unit.y, time: 0, color: '#3988ff' }] };
        expect(recordNativeFrame(state, { fog }).sprites.some(s => s.key === 'unit-death:7')).toBe(true);
        fog.visible.fill(0);
        expect(recordNativeFrame(state, { fog }).sprites.some(s => s.key.startsWith('unit-death:'))).toBe(false);
    });
});
