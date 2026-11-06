import { describe, expect, it } from 'vitest';
import { buildingInteractionHighlighted } from '../src/game/building-interaction-highlight';
import type { FogView } from '../src/game/fog';
import type { Building, GameState, NeutralVillage } from '../src/game/types';
import { recordNativeFrame } from './helpers/native-renderer';

function fixture() {
    const building = (id: number, kind: Building['kind'], x: number, y: number): Building =>
        ({ id, kind, faction: 4, villageId: 1, x, y, hp: 200, maxHp: 200, capacity: 0 });
    const buildings = [building(10, 'villageTent', 10, 10), building(11, 'villageTent', 12, 10), building(12, 'villageTent', 14, 10),
        building(13, 'house', 10, 13), building(14, 'guardPost', 13, 13), building(15, 'woodenTower', 16, 13)];
    const village: NeutralVillage = { id: 1, faction: 4, campId: 10, x: 10, y: 10, name: 'Willow tribe', identity: 'growers', relation: 'neutral',
        nextGrowthAt: 120, nextThinkAt: 0, nextRecruitAt: 120 };
    const state: GameState = {
        world: { width: 30, height: 30, seed: 'interaction-halos', source: 'test', spawns: [],
            tiles: Array.from({ length: 900 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) },
        units: [{ id: 1, kind: 'leader', faction: 0, x: 10.5, y: 23, hp: 100, morale: 100, attack: 25, defense: 5,
            speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
        buildings, villages: [village], factions: [], time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [],
        selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'interaction-halos', rngState: 1,
    };
    const fog: FogView = { width: 30, height: 30, visible: new Uint8Array(900).fill(1), explored: Array(900).fill(1),
        buildings, fields: [], sources: [], revision: 1, explorationRevision: 1 };
    return { state, buildings, village, fog };
}

describe('building interaction silhouettes', () => {
    it('outlines every visible village tent, house, guard post and tower beyond the local activity range', () => {
        const { state, buildings, village, fog } = fixture();
        for (const relation of ['neutral', 'trade', 'allied'] as const) {
            village.relation = relation;
            expect(buildings.map(building => buildingInteractionHighlighted(state, building, fog))).toEqual(Array(6).fill(true));
        }
        const halos = recordNativeFrame(state, { fog }).sprites.filter(sprite => sprite.key.startsWith('activity:'));
        expect(halos.map(sprite => [sprite.x, sprite.y])).toEqual(buildings.map(building => [building.x * 32, building.y * 32]));
    });

    it('does not give remembered or unexplored village buildings a live interaction outline', () => {
        const { state, buildings, fog } = fixture();
        fog.visible.fill(0);
        // Keep the remembered silhouettes in fog.buildings, as the compositor does.
        expect(recordNativeFrame(state, { fog }).sprites.filter(sprite => sprite.key.startsWith('activity:'))).toEqual([]);
        fog.explored.fill(0);
        expect(buildings.some(building => buildingInteractionHighlighted(state, building, fog))).toBe(false);
        fog.explored.fill(1); fog.visible[13 * 30 + 10] = 1;
        const halos = recordNativeFrame(state, { fog }).sprites.filter(sprite => sprite.key.startsWith('activity:'));
        expect(halos.map(sprite => [sprite.x, sprite.y])).toEqual([[320, 416]]);
    });

    it('suppresses hostile, destroyed, unfinished and orphaned village structures', () => {
        const { state, buildings, village, fog } = fixture(), house = buildings[3];
        village.relation = 'war'; expect(buildingInteractionHighlighted(state, house, fog)).toBe(false);
        village.relation = 'neutral'; village.destroyed = true; expect(buildingInteractionHighlighted(state, house, fog)).toBe(false);
        delete village.destroyed; buildings[0].hp = 0; expect(buildingInteractionHighlighted(state, house, fog)).toBe(false);
        buildings[0].hp = 200; house.hp = 0; expect(buildingInteractionHighlighted(state, house, fog)).toBe(false);
        house.hp = 200; house.construction = { startedAt: 0, duration: 10 };
        expect(buildingInteractionHighlighted(state, house, fog)).toBe(false);
        delete house.construction; house.villageId = 99; expect(buildingInteractionHighlighted(state, house, fog)).toBe(false);
        house.villageId = 1; state.gameOver = true; expect(buildingInteractionHighlighted(state, house, fog)).toBe(false);
    });

    it('retains local range rules for ordinary player activities and never outlines an unrelated enemy house', () => {
        const { state, buildings, fog } = fixture();
        const smithy: Building = { ...buildings[3], faction: 0, villageId: undefined, kind: 'blacksmith', x: 10, y: 21 };
        expect(buildingInteractionHighlighted(state, smithy, fog)).toBe(true);
        state.units[0].y = 25.01;
        expect(buildingInteractionHighlighted(state, smithy, fog)).toBe(false);
        expect(buildingInteractionHighlighted(state, { ...buildings[3], villageId: undefined }, fog)).toBe(false);
    });
});
