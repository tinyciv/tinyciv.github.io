import { afterEach, describe, expect, it, vi } from 'vitest';
import * as construction from '../src/game/construction';
import * as irrigationArt from '../src/game/irrigation-art';
import { entityStore } from '../src/game/entity-store';
import type { FogView } from '../src/game/fog';
import type { Building, GameState, Tile } from '../src/game/types';
import { recordNativeFrame } from './helpers/native-renderer';

function fixture() {
    const ditch: Building = { id: 4, kind: 'irrigation', faction: 0, x: 6, y: 6, hp: 100, maxHp: 100, capacity: 0 };
    const state: GameState = { world: { width: 16, height: 16, seed: 'ditch-layering', source: 'fixture', spawns: [],
        tiles: Array.from({ length: 256 }, (): Tile => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
            moisture: .5, food: 2, production: 1, gold: 0, variation: 0 })) }, units: [], buildings: [ditch],
        factions: [], fields: [], time: 1, tick: 0, paused: true, speed: 1, events: [], particles: [], selected: null,
        selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'ditch-layering', rngState: 1 };
    const fog: FogView = { width: 16, height: 16, visible: new Uint8Array(256).fill(1), explored: Array(256).fill(1),
        sources: [], buildings: [...state.buildings], fields: [], revision: 1, explorationRevision: 1 };
    const tile = state.world.tiles[6 * 16 + 6];
    return { state, fog, tile, ditch };
}

afterEach(() => vi.restoreAllMocks());

describe('irrigation below trees', () => {
    it.each([
        { overlay: 'forest' }, { overlay: 'jungle' }, { palm: true }, { marsh: true },
    ] as Partial<Tile>[])('retains foliage above a ditch on the same tile: %j', terrain => {
        const { state, fog, tile, ditch } = fixture(); Object.assign(tile, terrain);
        const frame = recordNativeFrame(state, { fog });
        expect(frame.sprites.filter(sprite => sprite.key === 'vegetation')).toHaveLength(1);
        expect(frame.drawOrder.indexOf('vegetation')).toBeGreaterThan(frame.drawOrder.indexOf('building'));
        ditch.kind = 'road';
        expect(recordNativeFrame(state, { fog }).sprites.filter(sprite => sprite.key === 'vegetation')).toHaveLength(0);
    });

    it('keeps people behind or in front of ditch-side trees according to their footing', () => {
        const { state, fog, tile } = fixture(); tile.overlay = 'forest';
        entityStore(state).units.replace([{ id: 2, kind: 'worker', faction: 0, x: 6.5, y: 6.5, hp: 100, morale: 100,
            attack: 1, defense: 1, speed: 3, range: 1, order: 'hold', cooldown: 0, lastCombat: 0,
            moving: false, facing: 0, attackTime: 0 }]);
        let order = recordNativeFrame(state, { fog }).drawOrder;
        expect(order.indexOf('building')).toBeLessThan(order.indexOf('unit'));
        expect(order.indexOf('unit')).toBeLessThan(order.indexOf('vegetation'));
        state.units[0].y = 7;
        order = recordNativeFrame(state, { fog }).drawOrder;
        expect(order.indexOf('vegetation')).toBeLessThan(order.indexOf('unit'));
    });

    it('clips wheat around the channel but does not carve a stripe through orchard trunks and crowns', () => {
        const { state, fog } = fixture();
        const clip = vi.spyOn(irrigationArt, 'clipFarmAroundIrrigation').mockImplementation(() => {});
        fog.fields = [{ id: 10, camp: 11, faction: 0, x: 6, y: 6, planted: true, food: 0, nextHarvest: 60, observedAt: 1 }];
        recordNativeFrame(state, { fog, paintFieldMasks: true });
        expect(clip).toHaveBeenCalledTimes(1);
        clip.mockClear(); fog.fields[0].orchard = { startedAt: -150, readyAt: -30 };
        const frame = recordNativeFrame(state, { fog, paintFieldMasks: true });
        expect(clip).not.toHaveBeenCalled();
        expect(frame.drawOrder.indexOf('field')).toBeGreaterThan(frame.drawOrder.indexOf('building'));
    });

    it('paints a valid irrigation ghost once below trees and applies the preview channel to wheat', () => {
        const { state, fog, tile } = fixture(); entityStore(state).buildings.replace([]); fog.buildings = []; state.buildMode = 'irrigation'; tile.overlay = 'forest';
        vi.spyOn(construction, 'planConstruction').mockReturnValue({ ok: true, message: '', tiles: [{ x: 6, y: 6 }],
            cells: [{ x: 6, y: 6, ok: true, existing: false, message: '' }], skipped: 0, cost: 50,
            costs: { gold: 50, production: 0, food: 0 } });
        const options = { fog, buildPreview: [{ x: 6, y: 6 }], paintFieldMasks: true };
        let frame = recordNativeFrame(state, options);
        expect(frame.sprites.filter(sprite => sprite.key === 'building')).toHaveLength(1);
        expect(frame.sprites.find(sprite => sprite.key === 'building')!.alpha).toBe(.55);
        expect(frame.drawOrder.indexOf('building')).toBeLessThan(frame.drawOrder.indexOf('vegetation'));
        const clip = vi.spyOn(irrigationArt, 'clipFarmAroundIrrigation').mockImplementation(() => {});
        fog.fields = [{ id: 10, camp: 11, faction: 0, x: 6, y: 6, planted: true, food: 0, nextHarvest: 60, observedAt: 1 }];
        frame = recordNativeFrame(state, options);
        expect(clip).toHaveBeenCalledTimes(1);
        expect(frame.drawOrder.indexOf('building')).toBeLessThan(frame.drawOrder.indexOf('field'));
    });
});
