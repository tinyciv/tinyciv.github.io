import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { MAX_UNIT_DEATHS, UNIT_DEATH_LIFETIME, recordUnitDeath, updateUnitDeaths } from '../src/game/death-effects';
import { updateGame } from '../src/game/simulation';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
    id, kind, faction, x, y, hp: 100, morale: 100, attack: 0, defense: 4, speed: 0,
    range: kind === 'leader' ? 4 : 1.1, order: 'hold', cooldown: 0, lastCombat: -60,
    moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
    id, kind, faction: 0, x, y, hp: 650, maxHp: 650, capacity: 0,
});
function fixture(): GameState {
    return { world: { width: 32, height: 24, seed: 'deaths', source: 'test', spawns: [],
        tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
        units: [unit(10, 'leader', 14.5, 12.5)], buildings: [building(1, 'palace', 3, 10)],
        factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
            production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null,
        selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'deaths', rngState: 1, fields: [],
        marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
        wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } };
}

describe('unit death snapshots', () => {
    it.each(['warrior', 'merchant'] as const)('records an actual melee %s death once before entity cleanup', kind => {
        const state = fixture(), attacker = unit(11, 'warrior', 20.5, 12.5), victim = unit(12, kind, 21.5, 12.5, -2);
        attacker.attack = 25; victim.hp = 1; victim.path = [{ x: 22, y: 12 }]; victim.cargoBatches = [{ amount: 1, expiresAt: 30 }];
        victim.moving = true; victim.attackTime = .2; victim.cargo = 3; victim.armorLevel = 2; victim.weaponLevel = 1;
        entityStore(state).units.add(attacker, victim); updateGame(state, .1, idle);
        expect(victim.hp).toBe(0); expect(state.units).not.toContain(victim);
        expect(state.unitDeaths).toHaveLength(1);
        const death = state.unitDeaths![0];
        expect(death).toMatchObject({ x: 21.5, y: 12.5, time: .1, color: '#191b22', unit: {
            id: victim.id, kind, hp: 0, damageFlashAt: .1, moving: false, attackTime: 0, cargo: 0, armorLevel: 2, weaponLevel: 1,
        } });
        expect(death.unit).not.toBe(victim); expect(death.unit.path).toBeUndefined(); expect(death.unit.cargoBatches).toBeUndefined();
        victim.x = 30; victim.facing = Math.PI;
        expect(death.unit.x).toBe(21.5); expect(death.unit.facing).toBe(0);
        recordUnitDeath(state, victim); updateGame(state, .2, idle);
        expect(state.unitDeaths).toHaveLength(1);
    });

    it('records projectile death at impact, with no hit flash on launch', () => {
        const state = fixture(), leader = state.units[0], victim = unit(12, 'warrior', 18.5, 12.5, -2);
        leader.attack = 25; victim.hp = 1; entityStore(state).units.add(victim);
        updateGame(state, .1, idle);
        expect(state.projectiles).toHaveLength(1); expect(state.unitDeaths ?? []).toHaveLength(0);
        expect(victim.damageFlashAt).toBeUndefined(); expect(leader.damageFlashAt).toBeUndefined();
        updateGame(state, .4, idle);
        expect(state.units).not.toContain(victim); expect(state.unitDeaths).toHaveLength(1);
        expect(state.unitDeaths![0].time).toBeCloseTo(victim.damageFlashAt!);
        expect(state.unitDeaths![0].unit.damageFlashAt).toBe(victim.damageFlashAt);
        updateGame(state, .2, idle); expect(state.unitDeaths).toHaveLength(1);
    });

    it('captures all supported people, preserving marauder appearance and faction color', () => {
        const state = fixture();
        const kinds = ['leader', 'warrior', 'archer', 'scout', 'militia', 'worker', 'merchant'] as const;
        for (const [i, kind] of kinds.entries()) recordUnitDeath(state, { ...unit(30 + i, kind, 5, 5), hp: 0, armorLevel: 2, order: 'work' });
        const marauder = { ...unit(40, 'warrior', 6, 5, -2), hp: 0, marauderPack: 8 };
        state.marauderPacks = [{ id: 8, name: 'Band', color: '#405536', home: { x: 6, y: 5 }, waypoint: { x: 6, y: 5 }, nextWanderAt: 100, targetFaction: 0 }];
        recordUnitDeath(state, marauder);
        expect(state.unitDeaths).toHaveLength(8);
        expect(state.unitDeaths![0]).toMatchObject({ color: '#3988ff', unit: { armorLevel: 2 } });
        expect(state.unitDeaths!.find(death => death.unit.kind === 'worker')!.unit.order).toBe('hold');
        expect(state.unitDeaths!.at(-1)).toMatchObject({ color: '#405536', unit: { marauderPack: 8 } });
        recordUnitDeath(state, { ...unit(99, 'boar', 7, 7), hp: 0 });
        recordUnitDeath(state, unit(100, 'warrior', 7, 7));
        expect(state.unitDeaths).toHaveLength(8);
    });

    it('excludes guard retirement, hidden removals, and route-closing merchant despawn', () => {
        const state = fixture(), guard = { ...unit(11, 'militia', 8, 8), hp: 0, guardRetired: true, inside: true }, hidden = { ...unit(12, 'worker', 8, 8), hp: 0, inside: true }, merchant = unit(13, 'merchant', 20, 20);
        entityStore(state).units.add(guard, hidden, merchant);
        state.tradeRoutes = [{ id: 50, faction: 0, origin: 999, partner: 998, target: 998, merchantId: merchant.id, nextDepartureAt: 100, distance: 0, journeys: 0 }];
        recordUnitDeath(state, guard); recordUnitDeath(state, hidden);
        updateGame(state, .1, idle);
        expect(merchant.hp).toBe(0); expect(state.units).not.toContain(merchant);
        expect(state.unitDeaths ?? []).toHaveLength(0);
    });

    it('bounds busy battles, allows reused numeric IDs, and expires on simulation time', () => {
        const state = fixture();
        expect(UNIT_DEATH_LIFETIME).toBeCloseTo(4.565, 12);
        for (let i = 0; i < MAX_UNIT_DEATHS + 20; i++) recordUnitDeath(state, { ...unit(i, 'warrior', 8, 8), hp: 0 });
        expect(state.unitDeaths).toHaveLength(MAX_UNIT_DEATHS); expect(state.unitDeaths![0].unit.id).toBe(20);
        recordUnitDeath(state, { ...unit(20, 'warrior', 8, 8), hp: 0 });
        expect(state.unitDeaths!.at(-1)!.unit.id).toBe(20);
        state.paused = true; updateGame(state, 20, idle);
        expect(state.time).toBe(0); expect(state.unitDeaths).toHaveLength(MAX_UNIT_DEATHS);
        const history = state.unitDeaths;
        state.time = UNIT_DEATH_LIFETIME - .001; updateUnitDeaths(state); expect(state.unitDeaths).toHaveLength(MAX_UNIT_DEATHS);
        state.time = UNIT_DEATH_LIFETIME; updateUnitDeaths(state); expect(state.unitDeaths).toHaveLength(0);
        expect(state.unitDeaths).toBe(history);
    });
});

describe('actual-health-loss flash clock', () => {
    it('does not flash a new unit, a blocked shot, or a zero-damage impact', () => {
        const state = fixture(), leader = state.units[0], victim = unit(12, 'warrior', 18.5, 12.5, -2);
        entityStore(state).units.add(victim); updateGame(state, .1, idle);
        expect(leader.damageFlashAt).toBeUndefined(); expect(victim.damageFlashAt).toBeUndefined();
        leader.attack = 25; updateGame(state, .1, idle);
        expect(state.projectiles).toHaveLength(1);
        entityStore(state).buildings.add(building(20, 'house', 16, 12)); updateGame(state, .4, idle);
        expect(victim.hp).toBe(100); expect(victim.damageFlashAt).toBeUndefined();
        entityStore(state).buildings.replace(state.buildings.filter(b => b.id !== 20));
        state.projectiles = [{ kind: 'arrow', x: 18, y: 12.5, start: { x: 18, y: 12.5 }, end: { x: 18.5, y: 12.5 }, attacker: 10, target: 12, faction: 0, damage: 0, elapsed: 0, duration: .01 }];
        updateGame(state, .1, idle);
        expect(victim.hp).toBe(100); expect(victim.damageFlashAt).toBeUndefined(); expect(state.unitDeaths ?? []).toHaveLength(0);
    });

    it('flashes surviving actual hits while building deaths produce no unit snapshot', () => {
        const state = fixture(), attacker = unit(11, 'warrior', 20.5, 12.5), victim = unit(12, 'warrior', 21.5, 12.5, -2);
        attacker.attack = 25; entityStore(state).units.add(attacker, victim); updateGame(state, .1, idle);
        expect(victim.hp).toBeLessThan(100); expect(victim.damageFlashAt).toBe(.1); expect(state.unitDeaths ?? []).toHaveLength(0);
        entityStore(state).units.retain(unit => unit !== victim); attacker.cooldown = 0;
        const house = { ...building(20, 'house', 21, 12), hp: 1, faction: -2 };
        entityStore(state).buildings.add(house); attacker.target = house.id;
        // The new structure becomes an acquired target on the next scan.
        for (let step = 0; step < 10 && house.hp > 0; step++) updateGame(state, .1, idle);
        expect(house.hp).toBe(0); expect(state.unitDeaths ?? []).toHaveLength(0);
        expect('damageFlashAt' in house).toBe(false);
    });
});
