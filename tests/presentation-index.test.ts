import { describe, expect, it } from 'vitest';
import { PresentationIndex } from '../src/game/presentation-index';
import type { Building, FarmFieldMemory } from '../src/game/types';
import type { FogView } from '../src/game/fog';

const building = (id: number, x: number, y: number, kind: Building['kind'] = 'house'): Building =>
    ({ id, x, y, kind, faction: 0, hp: 100, maxHp: 100, capacity: 5 });
const view = (buildings: Building[], fields: FarmFieldMemory[] = []): FogView => ({ width: 100, height: 100, buildings, fields } as FogView);

describe('observed presentation indexes', () => {
    it('retains all indexes and viewport results without reading unchanged snapshots', () => {
        let reads = 0;
        const b = building(1, 5, 5), fog = view([b]);
        Object.defineProperty(b, 'x', { get: () => { reads++; return 5; } });
        const index = new PresentationIndex(); index.update(fog);
        const cells = index.buildings, roads = index.roads, fields = index.fields;
        const visible = index.inViewport(0, 10, 0, 10);
        reads = 0;
        for (let frame = 0; frame < 120; frame++) {
            index.update(fog);
            expect(index.inViewport(0, 10, 0, 10)).toBe(visible);
        }
        expect(reads).toBe(0);
        expect(index.buildings).toBe(cells); expect(index.roads).toBe(roads); expect(index.fields).toBe(fields);
    });

    it('preserves shared footprints, road membership, viewport boundaries and snapshot order', () => {
        const tower = building(1, 8, 8, 'tower'), wall = building(2, 8, 8, 'wall');
        const palace = building(3, 2, 2, 'palace'), road = building(4, 9, 8, 'road');
        const dead = { ...building(5, 5, 5), hp: 0 }, far = building(6, 90, 90);
        const index = new PresentationIndex(); index.update(view([tower, palace, far, wall, road, dead]));
        expect(index.buildings.get('8,8')).toEqual([tower, wall]);
        expect(index.buildings.get('3,3')).toEqual([palace]);
        expect(index.buildings.has('5,5')).toBe(false);
        expect(index.roads).toEqual(new Set([809]));
        expect(index.inViewport(2, 9, 2, 8)).toEqual([tower, palace, wall, road, dead]);
    });

    it('uses new observations while retaining hidden snapshots and crop observation timestamps', () => {
        const hidden = building(1, 2, 2), observed = building(2, 3, 3);
        const field = { id: 3, x: 4, y: 4, observedAt: 10 } as FarmFieldMemory;
        const fog = view([hidden, observed], [field]), index = new PresentationIndex(); index.update(fog);
        field.observedAt = 11;
        index.update(fog);
        expect(index.fields.get('4,4')!.observedAt).toBe(11);
        const replacement = { ...observed, hp: 40 };
        fog.buildings = [hidden, replacement]; fog.fields = [];
        index.update(fog);
        expect(index.buildings.get('2,2')![0]).toBe(hidden);
        expect(index.buildings.get('3,3')![0]).toBe(replacement);
        expect(index.fields.size).toBe(0);
        fog.buildings = [hidden]; index.update(fog);
        expect(index.buildings.has('3,3')).toBe(false);
    });
});
