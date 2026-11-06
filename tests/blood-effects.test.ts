import { recordNativeFrame } from './helpers/native-renderer';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { BLOOD_EFFECT_DURATION, MAX_BLOOD_EFFECTS, recordBloodHit, updateBloodEffects } from '../src/game/blood-effects';
import { updateGame } from '../src/game/simulation';
import type { FogView } from '../src/game/fog';
import type { BloodEffect, Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
    id, kind, faction, x, y, hp: 100, morale: 100, attack: 0, defense: 4,
    speed: 0, range: kind === 'leader' ? 4 : 1.1, order: 'hold', cooldown: 0,
    lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
    id, kind, x, y, faction: 0, hp: 650, maxHp: 650, capacity: 0,
});
function fixture(): GameState {
    return { world: { width: 32, height: 24, seed: 'blood', source: 'test', spawns: [],
        tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
        units: [unit(10, 'leader', 14.5, 12.5)], buildings: [building(1, 'palace', 3, 10)],
        factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
            production: 500, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'blood', rngState: 1, fields: [],
        marauderPacks: [], fogRaids: { nextAt: 1000, waves: 0 } };
}

describe('blood impact events', () => {
    it('bursts on actual melee damage, preserves fatal contact, and expires in a quarter second', () => {
        const state = fixture(), attacker = unit(11, 'warrior', 20.5, 12.5), victim = unit(12, 'warrior', 21.5, 12.5, -2);
        attacker.attack = 25; victim.hp = 1; entityStore(state).units.add(attacker, victim);
        updateGame(state, .1, idle);
        expect(victim.hp).toBe(0);
        expect(state.units).not.toContain(victim);
        expect(state.bloodEffects).toHaveLength(1);
        expect(state.bloodEffects![0]).toMatchObject({ x: 21.5, y: 12.5, elapsed: 0 });
        expect(state.particles.filter(particle => particle.kind !== 'damage').map(particle => particle.text)).toEqual(['+6 gold']);
        expect(state.particles.filter(particle => particle.kind === 'damage')).toMatchObject([{ text: '-1' }]);
        updateGame(state, .3, idle);
        expect(state.bloodEffects).toHaveLength(0);
    });

    it('waits for a javelin to land instead of creating blood on the throw', () => {
        const state = fixture(), leader = state.units[0], victim = unit(12, 'warrior', 18.5, 12.5, -2);
        leader.attack = 25; entityStore(state).units.add(victim);
        updateGame(state, .1, idle);
        expect(state.projectiles).toHaveLength(1);
        expect(state.bloodEffects ?? []).toHaveLength(0);
        updateGame(state, .2, idle);
        expect(victim.hp).toBe(100);
        expect(state.bloodEffects ?? []).toHaveLength(0);
        updateGame(state, .2, idle);
        expect(victim.hp).toBe(85.3);
        expect(state.bloodEffects).toHaveLength(1);
        expect(state.particles).toMatchObject([{ kind: 'damage', text: '-15' }]);
    });

    it('produces no blood for a blocked javelin or a building strike', () => {
        const state = fixture(), leader = state.units[0], victim = unit(12, 'warrior', 18.5, 12.5, -2);
        leader.attack = 25; entityStore(state).units.add(victim);
        updateGame(state, .1, idle);
        entityStore(state).buildings.add(building(20, 'house', 16, 12));
        updateGame(state, .4, idle);
        expect(victim.hp).toBe(100);
        expect(state.bloodEffects ?? []).toHaveLength(0);
        entityStore(state).buildings.replace(state.buildings.slice(0, -1)); entityStore(state).units.replace(state.units.slice(0, -1)); leader.cooldown = 0;
        const house = building(21, 'house', 18, 12); house.faction = -2; entityStore(state).buildings.add(house); leader.target = house.id;
        updateGame(state, .5, idle);
        expect(house.hp).toBeLessThan(house.maxHp);
        expect(state.bloodEffects ?? []).toHaveLength(0);
    });

    it('bounds busy battles and freezes effects while the simulation is paused', () => {
        const state = fixture(), victim = unit(12, 'warrior', 18.5, 12.5, -2);
        for (let i = 0; i < MAX_BLOOD_EFFECTS * 2; i++) recordBloodHit(state, victim, state.units[0]);
        expect(state.bloodEffects).toHaveLength(MAX_BLOOD_EFFECTS);
        state.paused = true; updateGame(state, 1, idle);
        expect(state.bloodEffects![0].elapsed).toBe(0);
        updateBloodEffects(state, BLOOD_EFFECT_DURATION);
        expect(state.bloodEffects).toHaveLength(0);
    });
});

const fog: FogView = { width: 30, height: 30, visible: Uint8Array.from({ length: 900 }, (_, i) => Math.hypot(i % 30 + .5 - 5, Math.floor(i / 30) + .5 - 5) <= 2.35 ? 1 : 0), explored: Array(900).fill(1),
    sources: [{ x: 5, y: 5, radius: 3 }], buildings: [], fields: [], revision: 1, explorationRevision: 1 };
const effect = (options: Partial<BloodEffect> = {}): BloodEffect => ({ x: 5, y: 5, height: .43, angle: 0, elapsed: 0, ...options });
function render(effects: BloodEffect[], view = fog) {
    const state = fixture(); state.bloodEffects = effects;
    return recordNativeFrame(state, { fog: view }).rects.filter(rect => ['#7d2024', '#cf4440'].includes(rect.color))
        .map(({ x, y, width: w, height: h, alpha }) => ({ x, y, w, h, alpha }));
}

describe('blood impact drawing', () => {
    it('draws a small moving burst at torso height, then fades out', () => {
        const initial = render([effect()]), later = render([effect({ elapsed: .2 })]);
        expect(initial).toHaveLength(5);
        expect(initial.every(pixel => pixel.w <= 2 && pixel.h === 1 && pixel.y < 160)).toBe(true);
        expect(later.every(pixel => pixel.alpha < 1 && pixel.alpha > 0)).toBe(true);
        expect(later).not.toEqual(initial);
        expect(render([effect({ elapsed: BLOOD_EFFECT_DURATION })])).toHaveLength(0);
    });

    it('hides unsighted combat even on explored land and checks feet rather than raised pixels', () => {
        expect(render([effect({ x: 15, y: 15 }), effect({ x: 5, y: 7.5 })])).toHaveLength(0);
        expect(render([effect({ x: 25, y: 25 })], { ...fog, sources: [{ x: 25, y: 25, radius: 3 }] })).toHaveLength(0);
    });
});
