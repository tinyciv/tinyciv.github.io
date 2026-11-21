import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/game/renderer';
import { MarshRushPlacementCache } from '../src/game/marsh-rush-placement';
import { paintTerrain } from '../src/game/terrain';
import { markWorldChanged } from '../src/game/world-revisions';
import type { GameState, World } from '../src/game/types';

vi.mock('../src/game/terrain', async importOriginal => ({
    ...await importOriginal<typeof import('../src/game/terrain')>(), paintTerrain: vi.fn(),
}));

function fixture() {
    const world: World = { width: 6, height: 5, seed: 'minimap-cache', source: 'test', revision: 0, spawns: [],
        tiles: Array.from({ length: 30 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
            moisture: .5, food: 1, production: 1, gold: 0, variation: .5 })) };
    const fills: { x: number; y: number; color: string }[] = [];
    const context = { fillStyle: '', fillRect(x: number, y: number) { fills.push({ x, y, color: this.fillStyle }); } };
    const canvas = { width: 0, height: 0, getContext: () => context };
    const renderer = Object.assign(Object.create(Renderer.prototype), {
        miniature: canvas, miniatureColors: [], terrain: {}, marshRushes: new MarshRushPlacementCache(),
    }) as Renderer;
    const state = { world } as GameState;
    return { state, renderer, fills, canvas };
}

describe('cached minimap terrain', () => {
    it('observes only journaled cells for a local terrain appearance change', () => {
        const { state, renderer, fills } = fixture();
        let reads = 0;
        for (const tile of state.world.tiles) {
            const terrain = tile.terrain;
            Object.defineProperty(tile, 'terrain', { get() { reads++; return terrain; } });
        }
        renderer.prepare(state); fills.length = 0; reads = 0;
        state.world.tiles[8].beach = true; markWorldChanged(state.world, 'appearance', [8]);
        renderer.prepare(state);
        expect(fills).toEqual([{ x: 2, y: 1, color: '#c9b266' }]);
        expect(reads).toBeLessThan(3);
    });

    it('keeps unchanged terrain pixels on economic revisions and repaints cleared trees', () => {
        const { state, renderer, fills, canvas } = fixture();
        state.world.tiles[8].overlay = 'forest';
        renderer.prepare(state);
        expect(fills).toHaveLength(30);
        expect(fills.find(fill => fill.x === 2 && fill.y === 1)?.color).toBe('#648b60');
        fills.length = 0; state.world.revision!++; renderer.prepare(state);
        expect(fills).toHaveLength(0);
        expect([canvas.width, canvas.height]).toEqual([6, 5]);
        state.world.tiles[8].overlay = 'none'; state.world.revision!++; renderer.prepare(state);
        expect(fills).toEqual([{ x: 2, y: 1, color: '#85a643' }]);
    });

    it('updates plains and beaches, and repaints a replacement world even with matching dimensions', () => {
        const { state, renderer, fills } = fixture(); renderer.prepare(state); fills.length = 0;
        state.world.tiles[8].terrain = 'plains'; state.world.tiles[9].beach = true;
        state.world.revision!++; renderer.prepare(state);
        expect(fills).toEqual([{ x: 2, y: 1, color: '#c4b253' }, { x: 3, y: 1, color: '#c9b266' }]);
        fills.length = 0; state.world = { ...state.world }; renderer.prepare(state);
        expect(fills).toHaveLength(30);
    });

    it('passes actual terrain paint bounds to GPU chunks and skips invalidation when pixels are unchanged', () => {
        const { state, renderer } = fixture();
        const gpu = { resetWorld: vi.fn(), invalidateTerrain: vi.fn() };
        Object.assign(renderer, { gpu, terrain: { width: 6 * 32, height: 5 * 32 } });
        vi.mocked(paintTerrain).mockReturnValueOnce({ x: 2, y: 1, width: 3, height: 2 });
        renderer.prepare(state);
        expect(gpu.invalidateTerrain).toHaveBeenCalledExactlyOnceWith({ x: 64, y: 32, width: 96, height: 64 });
        gpu.invalidateTerrain.mockClear(); gpu.resetWorld.mockClear();
        markWorldChanged(state.world);
        renderer.prepare(state);
        expect(gpu.invalidateTerrain).not.toHaveBeenCalled();
        expect(gpu.resetWorld).not.toHaveBeenCalled();
    });

    it('invalidates separated painted regions without dirtying the GPU chunks between them', () => {
        const { state, renderer } = fixture();
        const gpu = { resetWorld: vi.fn(), invalidateTerrain: vi.fn() };
        Object.assign(renderer, { gpu, terrain: { width: 6 * 32, height: 5 * 32 } });
        vi.mocked(paintTerrain).mockReturnValueOnce({ x: 0, y: 0, width: 6, height: 5, regions: [
            { x: 0, y: 0, width: 2, height: 2 }, { x: 4, y: 3, width: 2, height: 2 },
        ] });
        renderer.prepare(state);
        expect(gpu.invalidateTerrain.mock.calls).toEqual([
            [{ x: 0, y: 0, width: 64, height: 64 }], [{ x: 128, y: 96, width: 64, height: 64 }],
        ]);
    });
});
