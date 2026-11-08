import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fog from '../src/game/fog';
import { resourceAtPoint } from '../src/game/resource-hit-testing';
import { buildResourceArtLayout, resourceObjectBounds } from '../src/game/resource-art';
import type { GameState } from '../src/game/types';

function fixture(): GameState {
    return { world: { width: 6, height: 6, seed: 'resource-clicks', source: 'test', spawns: [],
        tiles: Array.from({ length: 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .4,
            food: 3, production: 1, gold: 0, variation: 0 })) }, buildings: [], fields: [] } as unknown as GameState;
}
afterEach(() => vi.restoreAllMocks());
describe('resource sprite hit testing', () => {
    it('opens the tall olive from its visible crown and matches native art height', () => {
        vi.spyOn(fog, 'isVisible').mockReturnValue(true);
        const state = fixture(); Object.assign(state.world.tiles[3 * 6 + 2], { resource: 'olives', variation: 1 / 0x1000000 });
        expect(resourceObjectBounds(buildResourceArtLayout(state.world).get(20)!)).toMatchObject({ y: -32, height: 64 });
        expect(resourceAtPoint(state, { x: 2.5, y: 2.5 })).toEqual({ x: 2, y: 3 });
        expect(resourceAtPoint(state, { x: 2.5, y: 3.8 })).toEqual({ x: 2, y: 3 });
        state.world.tiles[20].variation = 0;
        expect(resourceAtPoint(state, { x: 2.5, y: 2.5 })).toBeUndefined();
        expect(resourceAtPoint(state, { x: 2.5, y: 3.5 })).toEqual({ x: 2, y: 3 });
    });
    it('selects the southern/frontmost resource where visible figures overlap', () => {
        vi.spyOn(fog, 'isVisible').mockReturnValue(true);
        const state = fixture(); Object.assign(state.world.tiles[20], { resource: 'olives', variation: 1 / 0x1000000 });
        state.world.tiles[14].resource = 'copper';
        expect(resourceAtPoint(state, { x: 2.5, y: 2.5 })).toEqual({ x: 2, y: 3 });
    });
    it('never selects hidden resources or resources covered by a building or field', () => {
        const sight = vi.spyOn(fog, 'isVisible').mockReturnValue(false);
        const state = fixture(); Object.assign(state.world.tiles[20], { resource: 'olives', variation: 1 / 0x1000000 });
        expect(resourceAtPoint(state, { x: 2.5, y: 2.5 })).toBeUndefined();
        sight.mockReturnValue(true);
        Object.assign(state, { buildings: [{ id: 1, kind: 'house', faction: 0, x: 2, y: 3, hp: 100, maxHp: 100, capacity: 10 }] });
        expect(resourceAtPoint(state, { x: 2.5, y: 2.5 })).toBeUndefined();
        state.buildings[0].kind = 'road';
        expect(resourceAtPoint(state, { x: 2.5, y: 2.5 })).toEqual({ x: 2, y: 3 });
        state.fields!.push({ id: 1, x: 2, y: 3, camp: 1, faction: 0, planted: true, food: 0, nextHarvest: 20 });
        expect(resourceAtPoint(state, { x: 2.5, y: 2.5 })).toBeUndefined();
    });
    it('rejects outside and non-finite points', () => {
        vi.spyOn(fog, 'isVisible').mockReturnValue(true);
        const state = fixture();
        for (const point of [{ x: -1, y: 2 }, { x: 6, y: 2 }, { x: 2, y: 6 }, { x: NaN, y: 2 }, { x: 2, y: Infinity }])
            expect(resourceAtPoint(state, point)).toBeUndefined();
    });
});
