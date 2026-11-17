import { describe, expect, it } from 'vitest';
import { sightDistance } from '../src/game/sight';
import { territorySightCosts } from '../src/game/territory-sight';
import type { Point, World } from '../src/game/types';

function fixture(): World {
    return { width: 48, height: 38, revision: 0, seed: 'territory-ray-geometry', source: 'test', spawns: [],
        tiles: Array.from({ length: 48 * 38 }, (_, index) => ({ terrain: index % 7 ? 'grassland' : 'lake',
            overlay: index % 11 === 0 ? 'forest' : index % 19 === 0 ? 'jungle' : 'none',
            elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) };
}

function compare(world: World, origin: Point, radius: number, previous?: Float64Array, changed?: readonly number[]): Float64Array {
    const left = Math.max(0, Math.floor(origin.x - radius)), right = Math.min(world.width - 1, Math.floor(origin.x + radius));
    const top = Math.max(0, Math.floor(origin.y - radius)), bottom = Math.min(world.height - 1, Math.floor(origin.y + radius));
    const actual = territorySightCosts(world, origin, radius, left, top, right, bottom, previous, changed)!;
    expect(actual).toBeDefined();
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const squared = (x + .5 - origin.x) ** 2 + (y + .5 - origin.y) ** 2;
        const distance = sightDistance(world, origin, x + .5, y + .5, radius);
        const expected = world.tiles[y * world.width + x] && squared <= radius * radius && distance <= radius ? distance : Infinity;
        expect(actual[(y - top) * (right - left + 1) + x - left]).toBe(expected);
    }
    return actual;
}

describe('retained exact territory ray geometry', () => {
    it('matches scalar DDA samples exactly for building centers, world edges, woodland and open water', () => {
        const world = fixture();
        for (const origin of [{ x: .5, y: .5 }, { x: 1, y: 1 }, { x: 24.5, y: 19.5 }, { x: 25, y: 20 }, { x: 47.5, y: 37.5 }])
            for (const radius of [3.25, 6.5, 16.25, 22.1]) compare(world, origin, radius);
    });

    it('reads live cover across raw edits and different worlds without changing earlier samples', () => {
        const world = fixture(), origin = { x: 20.5, y: 20.5 };
        const before = compare(world, origin, 6.5), copied = before.slice();
        for (const tile of world.tiles) tile.overlay = 'none';
        const cleared = compare(world, origin, 6.5);
        expect(cleared).not.toEqual(before); expect(before).toEqual(copied);
        compare(fixture(), origin, 6.5);
    });

    it('recomputes every ray crossing a dirty tile, including rays previously blocked before that tile', () => {
        const world = fixture(), origin = { x: 20.5, y: 20.5 }, radius = 16.25;
        let previous = compare(world, origin, radius);
        for (const cells of [[20 * 48 + 21], [20 * 48 + 20], [18 * 48 + 19, 17 * 48 + 18], [0], [25 * 48 + 29]]) {
            const copy = previous.slice();
            for (const cell of cells) world.tiles[cell].overlay = world.tiles[cell].overlay === 'none' ? 'forest' : 'none';
            const current = compare(world, origin, radius, previous, cells);
            expect(previous).toEqual(copy);
            previous = current;
        }
    });

    it('falls back for arbitrary editor positions and unbounded radii', () => {
        const world = fixture();
        expect(territorySightCosts(world, { x: 20.1, y: 20.5 }, 6.5, 14, 14, 27, 27)).toBeUndefined();
        expect(territorySightCosts(world, { x: 20, y: 20 }, 33, 0, 0, 47, 37)).toBeUndefined();
        expect(territorySightCosts(world, { x: -1, y: 20 }, 6.5, 0, 14, 6, 27)).toBeUndefined();
    });
});
