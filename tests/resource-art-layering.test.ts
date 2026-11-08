import { describe, expect, it } from 'vitest';
import { recordNativeFrame } from './helpers/native-renderer';
import type { FogView } from '../src/game/fog';
import type { GameState, RegionalResource } from '../src/game/types';

function fixture(resource: RegionalResource) {
    const state: GameState = { world: { width: 16, height: 16, seed: 'resource-layers', source: 'test', spawns: [],
        tiles: Array.from({ length: 256 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
            moisture: .5, food: 2, production: 1, gold: 0, variation: 0 })) },
        units: [{ id: 2, kind: 'worker', faction: 0, x: 6.5, y: 6.5, hp: 50, morale: 100, attack: 0, defense: 0,
            speed: 3, range: 0, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
        buildings: [{ id: 4, kind: 'road', faction: 0, x: 6, y: 6, hp: 100, maxHp: 100, capacity: 0 }],
        factions: [], fields: [], time: 1, tick: 0, paused: true, speed: 1, events: [], particles: [], selected: null,
        selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'resource-layers', rngState: 1 };
    Object.assign(state.world.tiles[6 * 16 + 6], { resource, resourceDeveloped: true, resourceGroup: 1 });
    const fog: FogView = { width: 16, height: 16, visible: new Uint8Array(256).fill(1), explored: Array(256).fill(1),
        sources: [], buildings: [...state.buildings], fields: [], revision: 1, explorationRevision: 1 };
    return { state, fog };
}

describe('resource work ground layers', () => {
    it('keeps developed salt beds beneath real roads and workers', () => {
        const { state, fog } = fixture('salt');
        const order = recordNativeFrame(state, { fog }).drawOrder;
        const bed = order.findIndex(key => key.startsWith('resource:salt:'));
        expect(bed).toBeGreaterThanOrEqual(0);
        expect(bed).toBeLessThan(order.indexOf('building'));
        expect(bed).toBeLessThan(order.indexOf('unit'));
        expect(order.findIndex(key => key.startsWith('resource-fence:') && key.endsWith(':true'))).toBeGreaterThan(order.indexOf('unit'));
    });

    it('sorts olive canopies and quarry rocks by footing so a worker can stand in front', () => {
        for (const resource of ['olives', 'stone'] as const) {
            const { state, fog } = fixture(resource);
            let order = recordNativeFrame(state, { fog }).drawOrder;
            expect(order.indexOf('unit')).toBeLessThan(order.findIndex(key => key.startsWith(`resource:${resource}:`)));
            state.units[0].y = 7.05;
            order = recordNativeFrame(state, { fog }).drawOrder;
            expect(order.findIndex(key => key.startsWith(`resource:${resource}:`))).toBeLessThan(order.indexOf('unit'));
        }
    });
});
