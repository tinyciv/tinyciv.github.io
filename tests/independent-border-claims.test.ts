import { describe, expect, it } from 'vitest';
import { territory, territoryClaimWithoutSource, territoryOwnerWithoutSource, UNCLAIMED } from '../src/game/borders';
import { entityStore } from '../src/game/entity-store';
import type { Building, GameState } from '../src/game/types';

const source = (id: number, faction: number, x: number, kind: Building['kind'] = 'house'): Building =>
    ({ id, faction, x, y: 10, kind, hp: 100, maxHp: 100, capacity: 0 });
function fixture(buildings: Building[]): GameState {
    return {
        world: { width: 30, height: 20, seed: 'independent-claims', source: 'test', spawns: [],
            tiles: Array.from({ length: 600 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
                moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
        units: [], buildings, factions: [0, 1, 2].map(id => ({ id, name: `City ${id}`, color: '#fff', affinity: 0,
            relation: id === 0 ? 'self' : 'war', food: 100, gold: 100, production: 0, population: 10,
            yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false })),
        time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false, events: [], particles: [],
        selected: null, selectedType: null, buildMode: null, diplomacy: null, seed: 'independent-claims', rngState: 1,
    };
}

describe('independent territorial claims', () => {
    it('exposes foreign pressure without changing normal primary ownership', () => {
        const state = fixture([source(1, 0, 8, 'monument'), source(2, 1, 10)]), borders = territory(state);
        expect(borders.owners[10 * 30 + 10]).toBe(1);
        expect(territoryOwnerWithoutSource(state, 10.5, 10.5, 2, borders)).toBe(0);
        expect(territoryClaimWithoutSource(state, 10.5, 10.5, 2, borders)).toEqual({ faction: 0, sourceId: 1, radius: 4 });
        expect(territoryOwnerWithoutSource(state, 10.5, 10.5, 1, borders)).toBe(1);
        expect(borders.sourceRadii.get(2)).toBe(3.25);
        expect(territory(state)).toBe(borders);
        expect(borders.owners[10 * 30 + 10]).toBe(1);
    });

    it('retains same-faction runner-up sources so neighboring homes protect one another', () => {
        const state = fixture([source(1, 0, 8, 'monument'), source(2, 1, 10), source(3, 1, 11)]);
        expect(territoryClaimWithoutSource(state, 10.5, 10.5, 2)).toEqual({ faction: 1, sourceId: 3, radius: 3.25 });
        expect(territoryOwnerWithoutSource(state, 10.5, 10.5, 2)).toBe(1);
    });

    it('replaces an earlier runner-up when a stronger independent claim arrives later', () => {
        const state = fixture([source(1, 0, 7), source(2, 1, 10), source(3, 2, 9)]);
        expect(territoryClaimWithoutSource(state, 10.5, 10.5, 2)).toEqual({ faction: 2, sourceId: 3, radius: 3.25 });
        entityStore(state).buildings.replace([...state.buildings].reverse());
        expect(territoryClaimWithoutSource(state, 10.5, 10.5, 2)).toEqual({ faction: 2, sourceId: 3, radius: 3.25 });
    });

    it('uses stable faction and source-ID tie breaks regardless of source traversal order', () => {
        const state = fixture([source(9, 1, 8), source(2, 0, 12), source(7, 2, 10)]), first = territory(state);
        expect(territoryClaimWithoutSource(state, 10.5, 10.5, 7, first)).toEqual({ faction: 0, sourceId: 2, radius: 3.25 });
        entityStore(state).buildings.replace([...state.buildings].reverse());
        const reversed = territory(state);
        expect(reversed.owners).toEqual(first.owners);
        expect(reversed.sourceIds).toEqual(first.sourceIds);
        expect(reversed.alternateOwners).toEqual(first.alternateOwners);
        expect(reversed.alternateSourceIds).toEqual(first.alternateSourceIds);

        const friendly = fixture([source(9, 0, 10), source(2, 0, 12)]), tied = territory(friendly);
        expect(tied.sourceIds[10 * 30 + 11]).toBe(2);
        expect(territoryClaimWithoutSource(friendly, 11.5, 10.5, 2, tied)).toEqual({ faction: 0, sourceId: 9, radius: 3.25 });
    });

    it('has no independent claimant for lone sources, unclaimed cells or out-of-bounds points', () => {
        const state = fixture([source(1, 0, 10)]), borders = territory(state);
        for (const [x, y] of [[10.5, 10.5], [0, 0], [-1, 10], [30, 10], [10, 20], [Number.NaN, 0]]) {
            expect(territoryOwnerWithoutSource(state, x, y, 1, borders)).toBe(UNCLAIMED);
            expect(territoryClaimWithoutSource(state, x, y, 1, borders)).toBeUndefined();
        }
    });
});
