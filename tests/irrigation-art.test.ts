import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildingAtPoint } from '../src/game/hit-testing';
import { irrigationChannelDistance, irrigationConnections, irrigationMask } from '../src/game/irrigation-art';
import { buildingConnections, indexBuildings } from '../src/game/renderer';
import type { Building, GameState, World } from '../src/game/types';

const structure = (id: number, kind: Building['kind'], x: number, y: number): Building => ({ id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
const world = (): World => ({ width: 16, height: 16, seed: 'irrigation-art', source: 'test', spawns: [],
    tiles: Array.from({ length: 256 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) });

describe('irrigation art connections', () => {
    it('joins cardinal completed ditches and water, without joining an unrelated road or unfinished ditch', () => {
        const w = world(), center = structure(1, 'irrigation', 6, 6), north = structure(2, 'irrigation', 6, 5), east = structure(3, 'irrigation', 7, 6), south = structure(4, 'road', 6, 7);
        east.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
        w.tiles[6 * 16 + 5].terrain = 'river';
        const index = indexBuildings([center, north, east, south]);
        expect(buildingConnections(center, index, w)).toEqual({ north: true, east: false, south: false, west: true });
        expect(buildingConnections(center, index, w, () => false).west).toBe(false);
        delete east.construction;
        expect(irrigationMask(buildingConnections(center, index, w))).toBe(11);
        north.hp = 0;
        expect(irrigationMask(buildingConnections(center, index, w))).toBe(10);
    });

    it('renders an isolated ditch visibly and keeps click geometry aligned with bends', () => {
        const isolated = irrigationConnections({ x: 6, y: 6 }, () => [], world());
        expect(irrigationMask(isolated)).toBe(5);
        expect(irrigationChannelDistance(isolated, 8, 1)).toBe(0);
        expect(irrigationChannelDistance(isolated, 2, 8)).toBe(6);
        const bend = { north: true, east: true, south: false, west: false };
        expect(irrigationChannelDistance(bend, 8, 2)).toBe(0);
        expect(irrigationChannelDistance(bend, 14, 8)).toBe(0);
        expect(irrigationChannelDistance(bend, 2, 14)).toBeGreaterThan(3);
    });
});

describe('selecting irrigation on farmland', () => {
    function fixture(): GameState {
        return { world: world(), buildings: [structure(1, 'camp', 6, 6), structure(2, 'irrigation', 6, 6)], fields: [],
            units: [], factions: [], time: 0, tick: 0, seed: 'irrigation-art', rngState: 1,
            paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
            buildMode: null, diplomacy: null, gameOver: false, victory: false };
    }
    it('selects the ditch line and grain separately, regardless of farm insertion order', () => {
        const state = fixture(), farm = state.buildings[0], ditch = state.buildings[1];
        for (const buildings of [[farm, ditch], [ditch, farm]]) {
            entityStore(state).buildings.replace(buildings);
            expect(buildingAtPoint(state, { x: 6.5, y: 6.2 })).toBe(ditch);
            expect(buildingAtPoint(state, { x: 6.1, y: 6.5 })).toBe(farm);
        }
    });
    it('selects a crossing deck as road, while the exposed water still selects irrigation', () => {
        const state = fixture(), ditch = state.buildings[1], road = structure(3, 'road', 6, 6);
        entityStore(state).buildings.add(road);
        expect(buildingAtPoint(state, { x: 6.5, y: 6.5 })).toBe(road);
        expect(buildingAtPoint(state, { x: 6.5, y: 6.1 })).toBe(ditch);
    });
    it('keeps queued ditches selectable for cancellation and ignores demolished ditches', () => {
        const state = fixture(), ditch = state.buildings[1];
        ditch.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
        expect(buildingAtPoint(state, { x: 6.1, y: 6.1 })).toBe(ditch);
        ditch.hp = 0;
        expect(buildingAtPoint(state, { x: 6.5, y: 6.5 })).toBe(state.buildings[0]);
    });
});
