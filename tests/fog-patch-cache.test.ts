import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateFog } from '../src/game/fog';
import { sightDistance } from '../src/game/sight';
import { markWorldChanged } from '../src/game/world-revisions';
import type { GameState, Unit } from '../src/game/types';

vi.mock('../src/game/sight', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/game/sight')>();
    return { ...actual, sightDistance: vi.fn(actual.sightDistance) };
});
beforeEach(() => { vi.mocked(sightDistance).mockClear(); });

function fixture(): GameState {
    const unit = (id: number, x: number): Unit => ({ id, kind: 'leader', faction: 0, x, y: 18.5,
        hp: 100, morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0,
        lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
    return {
        world: { width: 80, height: 36, seed: 'fog-patches', source: 'test', spawns: [], revision: 0,
            tiles: Array.from({ length: 80 * 36 }, (_, i) => ({ terrain: 'grassland',
                overlay: [12, 42, 67].includes(i % 80) ? 'forest' : 'none', elevation: .3,
                moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
        units: [unit(1, 10.5), unit(2, 40.5), unit(3, 65.5), unit(4, 10.5)], buildings: [], fields: [], factions: [],
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'fog-patches', rngState: 1,
    };
}

function expectFreshVisibility(state: GameState): void {
    const incremental = updateFog(state), fresh = updateFog(structuredClone(state));
    expect(incremental.visible).toEqual(fresh.visible);
    expect(incremental.owned).toEqual(fresh.owned);
    expect(incremental.explored).toEqual(fresh.explored);
}

describe('local sight-patch invalidation', () => {
    it('rechecks only sources near a journaled woodland edit while preserving the complete sight union', () => {
        const state = fixture(); updateFog(state); vi.mocked(sightDistance).mockClear();
        const cell = 18 * state.world.width + 12;
        state.world.tiles[cell].overlay = 'none'; markWorldChanged(state.world, 'sight', [cell]);
        updateFog(state);
        const calls = vi.mocked(sightDistance).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        expect(new Set(calls.map(call => call[1].x))).toEqual(new Set([10.5]));
        expectFreshVisibility(state);
        // Removing one of two identical sources must keep the shared patch;
        // removing the second must remove it without underflowing coverage.
        state.units[0].hp = 0; expectFreshVisibility(state);
        state.units[3].hp = 0; expectFreshVisibility(state);
        state.units[2].x = 10.5; expectFreshVisibility(state);
    });

    it('keeps distant patches after an outside edit and refreshes changed high-ground reach exactly', () => {
        const state = fixture(); updateFog(state); vi.mocked(sightDistance).mockClear();
        state.world.tiles[1].overlay = 'forest'; markWorldChanged(state.world, 'sight', [1]);
        updateFog(state); expect(sightDistance).not.toHaveBeenCalled(); expectFreshVisibility(state);
        const cell = 18 * state.world.width + 40;
        state.world.tiles[cell].reliefLevel = 1; markWorldChanged(state.world, 'geometry', [cell]);
        expectFreshVisibility(state);
    });

    it('retains distant patch identities across cosmetic history followed by a local sight edit', () => {
        const state = fixture();
        const before = updateFog(state) as ReturnType<typeof updateFog> & { patches: ReadonlyMap<string, number[]> };
        const oldPatches = new Map(before.patches);
        vi.mocked(sightDistance).mockClear();
        for (let i = 0; i < 1100; i++) markWorldChanged(state.world, 'appearance', [18 * 80 + 42, 18 * 80 + 67]);
        const cell = 18 * 80 + 12;
        state.world.tiles[cell].overlay = 'none'; markWorldChanged(state.world, 'sight', [cell]);
        const after = updateFog(state) as typeof before;
        expect(new Set(vi.mocked(sightDistance).mock.calls.map(call => call[1].x))).toEqual(new Set([10.5]));
        expect([...oldPatches].filter(([key, cells]) => after.patches.get(key) === cells)).toHaveLength(2);
        expectFreshVisibility(state);
    });

    it('revalidates all source patches for unlocated edits and accumulated journal overflow', () => {
        const state = fixture(); updateFog(state); vi.mocked(sightDistance).mockClear();
        state.world.tiles[18 * state.world.width + 12].overlay = 'none';
        markWorldChanged(state.world, 'sight'); updateFog(state);
        expect(new Set(vi.mocked(sightDistance).mock.calls.map(call => call[1].x))).toEqual(new Set([10.5, 40.5, 65.5]));
        expectFreshVisibility(state);
        // Force this consumer's cursor out of the bounded tile journal.
        for (let i = 0; i < 1025; i++) markWorldChanged(state.world, 'sight', [i % state.world.tiles.length]);
        state.world.tiles[18 * state.world.width + 42].overlay = 'none';
        markWorldChanged(state.world, 'sight', [18 * state.world.width + 42]);
        expectFreshVisibility(state);
    });
});
