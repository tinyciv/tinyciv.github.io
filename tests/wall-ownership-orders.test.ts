import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { commandAttackAt, commandMove, recallRetinue, setRetinueStance, updateGame } from '../src/game/simulation';
import { distance, type Building, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const building = (id: number, kind: Building['kind'], faction: number, x: number, y: number): Building =>
    ({ id, kind, faction, x, y, hp: 1000, maxHp: 1000, capacity: 0 });
const soldier = (id: number, kind: 'leader' | 'warrior', x: number, y: number): Unit =>
    ({ id, kind, faction: 0, x, y, hp: 100, maxHp: 100, morale: 100, attack: 20, defense: 5,
        speed: 3.6, range: kind === 'leader' ? 4 : 1.2, order: 'follow', retinueStance: 'hold',
        cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });

function fixture(claimed: boolean) {
    const leader = soldier(1, 'leader', 10.5, 10.5), warrior = soldier(2, 'warrior', 10.5, 11.5);
    const wall = building(3, 'wall', 1, 14, 10), support = building(4, 'house', 1, 18, 9);
    const state: GameState = {
        world: { width: 32, height: 24, seed: 'claimed-wall-orders', source: 'test', spawns: [],
            tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
                moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
        units: [leader, warrior], buildings: [building(5, 'palace', 0, 2, 2), building(6, 'palace', 1, 28, 2), wall, support],
        factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#38f', affinity: 0, relation: id ? 'war' : 'self',
            food: 0, gold: 0, production: 0, population: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false })),
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], projectiles: [], fields: [], raiderCamps: [], marauderPacks: [],
        selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
        retinueStance: 'hold', seed: 'claimed-wall-orders', rngState: 1,
    };
    if (claimed) entityStore(state).buildings.add(building(7, 'well', 0, 11, 14));
    setRetinueStance(state, 'hold');
    return { state, leader, warrior, wall, support };
}
const advance = (state: GameState, seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 10); i++) updateGame(state, .1, idle);
};

describe('orders after wall ownership changes', () => {
    it.each([false, true])('returns a held attacker to its original post when the target becomes peaceful (claimed: %s)', claimed => {
        const { state, warrior, wall, support } = fixture(claimed), post = { x: warrior.x, y: warrior.y };
        expect(commandAttackAt(state, wall.x + .5, wall.y + .5)).toBe(true);
        advance(state, .6);
        expect(warrior.forcedAttack?.target).toBe(wall.id);
        expect(distance(warrior, post)).toBeGreaterThan(.5);
        const wallHealth = wall.hp;
        support.hp = 0;
        updateGame(state, .4, idle);
        expect(wall.faction).toBe(claimed ? 0 : -1);
        expect(warrior.forcedAttack).toBeUndefined();
        expect(warrior.attackReturn).toEqual(post);
        advance(state, 2);
        expect(distance(warrior, post)).toBeLessThan(.2);
        expect(warrior.retinueStance).toBe('hold'); expect(warrior.order).toBe('hold');
        expect(wall.hp).toBe(wallHealth); // In-flight throws also stop damaging the peaceful wall.
    });

    it.each([false, true])('resumes a pending recall and Leader destination after a wall changes owner (claimed: %s)', claimed => {
        const { state, leader, warrior, wall, support } = fixture(claimed);
        expect(commandMove(state, 6.5, 10.5)).toBe(true);
        recallRetinue(state);
        expect(commandAttackAt(state, wall.x + .5, wall.y + .5)).toBe(true);
        expect(warrior.forcedAttack?.previousRecallIssuedAt).toBe(0);
        expect(leader.forcedAttack?.previousDestination).toEqual({ x: 6.5, y: 10.5 });
        support.hp = 0;
        updateGame(state, .4, idle);
        expect(wall.faction).toBe(claimed ? 0 : -1);
        expect(leader.forcedAttack).toBeUndefined(); expect(leader.destination).toEqual({ x: 6.5, y: 10.5 });
        expect(warrior.forcedAttack).toBeUndefined(); expect(warrior.recallIssuedAt).toBe(0);
        expect(warrior.retinueStance).toBe('hold'); expect(warrior.recallReturnOrder).toBe('hold');
        advance(state, 5);
        expect(leader.destination).toBeUndefined(); expect(leader.x).toBeCloseTo(6.5, 1);
        expect(warrior.recallIssuedAt).toBeUndefined(); expect(warrior.order).toBe('hold');
        expect(warrior.retinueStance).toBe('hold');
    });
});
