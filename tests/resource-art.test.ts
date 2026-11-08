import { describe, expect, it } from 'vitest';
import { buildResourceArtLayout, drawResourceObject, drawSaltFields, resourceHasObject, ResourceArtMemory } from '../src/game/resource-art';
import { southernResourceCell } from '../src/game/resource-worksite';
import type { RegionalResource, World } from '../src/game/types';

function fixture(resource: RegionalResource, cells: [number, number][], developed = true): World {
    const world: World = { width: 10, height: 8, seed: 'resource-art', source: 'test', spawns: [], revision: 0,
        tiles: Array.from({ length: 80 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .4,
            food: 3, production: 1, gold: 0, variation: .5 })) };
    for (const [x, y] of cells) Object.assign(world.tiles[y * 10 + x], { resource, resourceDeveloped: developed, resourceGroup: 1 });
    return world;
}

describe('developed resource composition', () => {
    it('places one mine per connected developed component without replacing the remaining ore', () => {
        const world = fixture('copper', [[1, 1], [2, 1], [1, 2], [2, 2], [5, 2], [5, 3]]);
        const layout = [...buildResourceArtLayout(world).values()];
        expect(layout.filter(item => item.worksite)).toHaveLength(2);
        expect(layout.filter(item => !item.worksite)).toHaveLength(4);
        expect(layout.every(item => item.fences === 0 && item.road === 0)).toBe(true);
        expect([...buildResourceArtLayout(world)].filter(([, art]) => art.worksite).map(([cell]) => cell)).toEqual([21, 35]);
        world.tiles[2 * 10 + 2].resourceDeveloped = false;
        expect(buildResourceArtLayout(world).get(22)!.worksite).toBe(false);
    });
    it('puts metal entrances on the southern edge, centered deterministically within that row', () => {
        const world = fixture('iron', [[2, 1], [2, 2], [1, 3], [2, 3], [3, 3]]);
        expect([...buildResourceArtLayout(world)].filter(([, art]) => art.worksite).map(([cell]) => cell)).toEqual([32]);
        expect(southernResourceCell([31, 33, 22, 12], 10)).toBe(31);
        expect(southernResourceCell([12, 22, 33, 31], 10)).toBe(31);
        expect(southernResourceCell([], 10)).toBeUndefined();
    });
    it('leaves developed quarry stones exposed with no mine or fence', () => {
        const layout = buildResourceArtLayout(fixture('stone', [[2, 2], [3, 2], [2, 3], [3, 3]]));
        expect([...layout.values()].every(art => art.developed && resourceHasObject(art) && !art.worksite && !art.fences && !art.road)).toBe(true);
    });
    it('fences only the developed grove perimeter, including partially worked boundaries', () => {
        const world = fixture('olives', [[2, 2], [3, 2], [2, 3], [3, 3]]);
        const layout = buildResourceArtLayout(world);
        expect(layout.get(22)!.fences).toBe(9); // north/west
        expect(layout.get(23)!.fences).toBe(3); // north/east
        expect(layout.get(32)!.fences).toBe(12); // south/west
        expect(layout.get(33)!.fences).toBe(6); // south/east
        expect(layout.get(32)!.gate).toBe(4);
        expect([...layout.values()].filter(art => art.gate)).toHaveLength(1);
        expect([...layout.values()].some(item => item.worksite)).toBe(false);
        world.tiles[33].resourceDeveloped = false;
        const partial = buildResourceArtLayout(world);
        expect(partial.get(23)!.fences & 4).toBe(4);
        expect(partial.get(32)!.fences & 2).toBe(2);
        expect(partial.get(33)!.fences).toBe(0);
    });
    it('preserves separate deposits even when two different group identities touch', () => {
        const world = fixture('iron', [[2, 2], [3, 2]]); world.tiles[23].resourceGroup = 2;
        expect([...buildResourceArtLayout(world).values()].filter(item => item.worksite)).toHaveLength(2);
    });
    it('keeps a salt approach inside the patch and opens exactly one perimeter gate', () => {
        const world = fixture('salt', [[2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [2, 4], [3, 4]]);
        const layout = buildResourceArtLayout(world);
        expect([...layout.values()].filter(art => art.worksite)).toHaveLength(0);
        expect([...layout.values()].every(resourceHasObject)).toBe(true);
        expect([...layout.values()].filter(art => art.gate)).toHaveLength(1);
        const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        for (const [cell, art] of layout) for (let side = 0; side < 4; side++) if (art.road & 1 << side) {
            if (art.gate & 1 << side) { expect(art.fences & 1 << side).toBeTruthy(); continue; }
            const [dx, dy] = directions[side], next = layout.get(cell + dy * 10 + dx);
            expect(next?.road && next.road & 1 << ((side + 2) % 4)).toBeTruthy();
        }
        expect([...layout.values()].some(art => art.road)).toBe(true);
    });
    it('draws lightly shaded, rounded salt beds on the native pixel grid without any door image', () => {
        const pixels = new Uint8Array(16 * 16), rects: number[][] = [], images: unknown[] = [];
        const context = { fillStyle: '', fillRect(x: number, y: number, width: number, height: number) {
            rects.push([x, y, width, height]);
            for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) pixels[row * 16 + col] = 1;
        }, drawImage(...args: unknown[]) { images.push(args); } } as unknown as CanvasRenderingContext2D;
        drawSaltFields(context, 0, 0, 16);
        expect(context.fillStyle).toBe('#e7dac6');
        expect(rects.flat().every(Number.isInteger)).toBe(true);
        expect(pixels[2 * 16 + 2]).toBe(0); // rounded corner
        expect(pixels[2 * 16 + 4]).toBe(1);
        expect(pixels[4 * 16 + 2]).toBe(1);
        expect(pixels[8 * 16 + 8]).toBe(1);
        expect(pixels.filter(Boolean)).toHaveLength(132);
        const salt = buildResourceArtLayout(fixture('salt', [[2, 2]])).get(22)!;
        drawResourceObject(context, salt, 0, 0, 16);
        expect(images).toHaveLength(0);
        expect(rects).toHaveLength(6);
        drawResourceObject(context, { ...salt, developed: false }, 0, 0, 16);
        expect(rects).toHaveLength(6);
    });
    it('does not reveal development in explored fog until it is observed', () => {
        const world = fixture('olives', [[2, 2], [3, 2]], false), visible = new Uint8Array(80), memory = new ResourceArtMemory();
        visible[22] = 1;
        expect(memory.observe(world, visible, 1, 0).get(22)!.developed).toBe(false);
        world.tiles[22].resourceDeveloped = world.tiles[23].resourceDeveloped = true; world.revision!++;
        const first = memory.observe(world, visible, 1, 0);
        expect(first.get(22)!.developed).toBe(true); expect(first.get(23)!.developed).toBe(false);
        visible[22] = 0; visible[23] = 1;
        const second = memory.observe(world, visible, 2, 0);
        expect(second.get(22)!.developed).toBe(true); expect(second.get(23)!.developed).toBe(true);
    });
});
