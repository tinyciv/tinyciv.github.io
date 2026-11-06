import { describe, expect, it } from 'vitest';
import { demolishBuildingsInArea, demolishIrrigationAt, cancelConstructionInArea } from '../src/game/area-tools';
import { territory } from '../src/game/borders';
import { entityStore } from '../src/game/entity-store';
import { synchronizeFarms } from '../src/game/farms';
import { buildingTerritoryOwner, buildingWithinBorders } from '../src/game/property-territory';
import { updateWallOwnership } from '../src/game/wall-ownership';
import type { Building, GameState, Unit } from '../src/game/types';

function fixture(): GameState {
    return {
        world: { width: 40, height: 30, seed: 'territory-ownership', source: 'test', spawns: [], revision: 0,
            tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
                moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
        buildings: [], units: [{ id: 1000, kind: 'leader', faction: 0, x: 7.5, y: 7.5, hp: 100,
            morale: 100, attack: 0, defense: 5, speed: 0, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
            moving: false, facing: 0, attackTime: 0 }],
        factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#38f', affinity: 0,
            relation: id === 0 ? 'self' : 'war', food: 1000, gold: 1000, production: 0, population: 5,
            culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false })),
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], raiderCamps: [], marauderPacks: [],
        selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
        seed: 'territory-ownership', rngState: 1,
    };
}
function add(state: GameState, kind: Building['kind'], faction: number, x: number, y: number): Building {
    const building: Building = { id: state.buildings.length + 1, kind, faction, x, y, hp: 100, maxHp: 100,
        capacity: kind === 'house' ? 4 : 0 };
    entityStore(state).buildings.add(building); return building;
}

describe('territory ownership', () => {
    it('claims an outlying farm on first border contact despite surviving former-owner support', () => {
        const state = fixture(); add(state, 'palace', 0, 5, 5);
        const farm = add(state, 'camp', 1, 11, 6); add(state, 'well', 1, 14, 6);
        synchronizeFarms(state);
        const crops = state.fields!; crops.forEach(field => { field.food = 9; field.expiresAt = 120; field.claimedBy = 88; });
        expect(buildingWithinBorders(state, farm, 0)).toBe(true);
        expect(buildingTerritoryOwner(state, farm)).toBe(0);
        expect(updateWallOwnership(state)).toBe(true);
        expect(farm.faction).toBe(0);
        expect(crops.every(field => field.faction === 0 && field.food === 9 && field.expiresAt === 120 && field.claimedBy === undefined)).toBe(true);
        expect(updateWallOwnership(state)).toBe(false);
    });

    it('preserves a farm cell inside its own borders beside a foreign-owned cell', () => {
        const state = fixture(); add(state, 'palace', 0, 5, 5); add(state, 'house', 1, 14, 6);
        const farm = add(state, 'camp', 1, 12, 6);
        const borders = territory(state), cells = [11, 12].map(x => borders.owners[6 * borders.width + x]);
        expect(cells).toContain(0); expect(cells).toContain(1);
        updateWallOwnership(state); expect(farm.faction).toBe(1);
    });

    it('transfers civilian buildings and unfinished orders but leaves defensive towers and posts loyal', () => {
        const state = fixture(); add(state, 'palace', 0, 5, 5);
        const library = add(state, 'library', 1, 8, 5), smith = add(state, 'blacksmith', 1, 8, 8);
        smith.construction = { startedAt: 0, duration: 90, builderId: 91, cleared: true };
        const defenses = ['guardPost', 'woodenTower', 'tower'].map((kind, i) => add(state, kind as Building['kind'], 1, 4 + i, 8));
        const outside = add(state, 'well', 1, 30, 20);
        state.time = 10; expect(updateWallOwnership(state)).toBe(true);
        expect(library.faction).toBe(0); expect(smith.faction).toBe(0);
        expect(smith.construction).toMatchObject({ pausedAt: 10, waitingForBuilder: true, cleared: false });
        expect(smith.construction.builderId).toBeUndefined();
        expect(defenses.every(building => building.faction === 1)).toBe(true); expect(outside.faction).toBe(1);
    });

    it('reconsiders cached ownership when culture expands without any new building', () => {
        const state = fixture(); add(state, 'palace', 0, 5, 5);
        const well = add(state, 'well', 1, 13, 6);
        expect(updateWallOwnership(state)).toBe(false); expect(well.faction).toBe(1);
        state.factions[0].culture = 100;
        expect(updateWallOwnership(state)).toBe(true); expect(well.faction).toBe(0);
        const revision = state.world.revision;
        expect(updateWallOwnership(state)).toBe(false); expect(state.world.revision).toBe(revision);
    });

    it('annexes an isolated house reached by a rival palace, while nearby own-city influence protects housing', () => {
        const state = fixture(); add(state, 'palace', 0, 5, 5);
        const isolated = add(state, 'house', 1, 10, 6);
        isolated.residents = 2;
        expect(updateWallOwnership(state)).toBe(true); expect(isolated.faction).toBe(0);
        expect(state.factions.map(faction => faction.population)).toEqual([7, 3]);
        add(state, 'palace', 1, 15, 5);
        const protectedHouse = add(state, 'house', 1, 12, 6);
        updateWallOwnership(state); expect(protectedHouse.faction).toBe(1);
    });

    it.each(['palace', 'house', 'monument'] as const)('does not exchange overlapping %s ownership back and forth', kind => {
        const state = fixture(), first = add(state, kind, 0, 5, 5), second = add(state, kind, 1, 7, 5);
        expect(updateWallOwnership(state)).toBe(true);
        const owners = [first.faction, second.faction];
        expect(owners).toEqual([0, 0]);
        for (let i = 0; i < 8; i++) {
            state.time++; expect(updateWallOwnership(state)).toBe(false);
            expect([first.faction, second.faction]).toEqual(owners);
        }
    });

    it('moves residents and palace workers with captured civilian property, without taking soldiers', () => {
        const state = fixture(); add(state, 'palace', 0, 5, 5);
        state.factions[0].culture = 300; state.factions[1].defeated = true;
        const palace = add(state, 'palace', 1, 8, 8); palace.unhousedResidents = 1;
        const house = add(state, 'house', 1, 8, 5); house.residents = 3;
        const worker: Unit = { ...state.units[0], id: 1001, kind: 'worker', faction: 1, home: palace.id, builder: true, buildSite: house.id };
        const soldier: Unit = { ...state.units[0], id: 1002, kind: 'warrior', faction: 1, home: palace.id };
        entityStore(state).units.add(worker, soldier);
        expect(updateWallOwnership(state)).toBe(true);
        expect([palace.faction, house.faction, worker.faction, soldier.faction]).toEqual([0, 0, 0, 1]);
        expect(state.factions.map(faction => faction.population)).toEqual([9, 1]);
        expect(palace.cultureAtFounding).toBe(300); expect(worker.buildSite).toBeUndefined();
        updateWallOwnership(state); expect(state.factions.map(faction => faction.population)).toEqual([9, 1]);
    });

    it('can demolish protected enemy defenses inside borders but cannot cancel their orders for a refund', () => {
        const state = fixture(); add(state, 'palace', 0, 5, 5); add(state, 'palace', 1, 30, 20);
        const tower = add(state, 'woodenTower', 1, 8, 8), post = add(state, 'guardPost', 1, 7, 8);
        post.construction = { startedAt: 0, duration: 90, paidGold: 200 };
        const outside = add(state, 'woodenTower', 1, 25, 20);
        const treasury = state.factions.map(faction => faction.gold);
        expect(cancelConstructionInArea(state, post, post).count).toBe(0);
        expect(demolishBuildingsInArea(state, { x: 7, y: 8 }, { x: 8, y: 8 })).toMatchObject({ count: 2, refund: 0 });
        expect(state.buildings).not.toContain(tower); expect(state.buildings).not.toContain(post);
        expect(state.factions.map(faction => faction.gold)).toEqual(treasury);
        expect(demolishBuildingsInArea(state, outside, outside).count).toBe(0);
        expect(state.buildings).toContain(outside);
    });

    it('demolishes a selected foreign ditch without removing its farm or neighboring road', () => {
        const state = fixture(); add(state, 'palace', 0, 5, 5); add(state, 'palace', 1, 30, 20);
        const ditch = add(state, 'irrigation', 1, 8, 8), road = add(state, 'road', 0, 9, 8), farm = add(state, 'camp', 0, 8, 8);
        synchronizeFarms(state);
        expect(demolishIrrigationAt(state, 8, 8)).toMatchObject({ count: 1, refund: 0 });
        expect(state.buildings).not.toContain(ditch); expect(state.buildings).toContain(road); expect(state.buildings).toContain(farm);
        expect(state.fields?.filter(field => field.camp === farm.id)).toHaveLength(1);
    });
});
