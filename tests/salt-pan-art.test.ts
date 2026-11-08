import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSaltPan, saltPanJoinMask } from '../src/game/salt-pan-art';
import * as saltArt from '../src/game/salt-pan-art';
import * as punyArt from '../src/game/puny-world';
import { paintTerrain, rasterTerrain } from '../src/game/terrain';
import type { World } from '../src/game/types';
import { punyAtlas } from './puny-atlas.js';

const ground = punyAtlas(), salt = punyAtlas(new URL('../public/assets/resources/salt-pan-joins.png', import.meta.url));
function fixture(cells: [number, number][]): World {
    const world: World = { width: 7, height: 7, seed: 'salt-pan', source: 'test', spawns: [],
        tiles: Array.from({ length: 49 }, () => ({ terrain: 'desert', overlay: 'none', elevation: .2,
            moisture: .2, variation: .2, food: 0, production: 1, gold: 0 })) };
    for (const [x, y] of cells) world.tiles[y * 7 + x].resource = 'salt';
    return world;
}
const pixel = (mask: number, x: number, y: number) => {
    const i = (((mask >> 4) * 16 + y) * salt.width + (mask & 15) * 16 + x) * 4;
    return [...salt.data.slice(i, i + 4)];
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('joined dry salt pans', () => {
    it('connects edges, keeps diagonal-only pans separate and retains inward corners', () => {
        expect(saltPanJoinMask(fixture([[2, 2], [3, 3]]), 2, 2)).toBe(0);
        const elbow = fixture([[2, 2], [3, 2], [2, 3]]);
        expect(saltPanJoinMask(elbow, 2, 2)).toBe(6);
        elbow.tiles[3 * 7 + 3].resource = 'salt';
        expect(saltPanJoinMask(elbow, 2, 2)).toBe(38);
        const boundary = fixture([[0, 0], [1, 0], [0, 1]]);
        expect(saltPanJoinMask(boundary, 0, 0)).toBe(6);
        expect(saltPanJoinMask(boundary, -1, 0)).toBe(0);
        expect(saltPanJoinMask(boundary, 6, 6)).toBe(0);
    });

    it('does not connect across water, creeks or cliff faces', () => {
        const world = fixture([[2, 2], [3, 2]]), original = { ...world.tiles[2 * 7 + 3] };
        expect(saltPanJoinMask(world, 2, 2)).toBe(2);
        for (const change of [{ terrain: 'coast' as const }, { ridge: 1 }, { creek: true }, { stair: 'north' as const }]) {
            const neighbor = world.tiles[2 * 7 + 3] = { ...original, ...change };
            expect(isSaltPan(neighbor)).toBe(false);
            expect(saltPanJoinMask(world, 2, 2)).toBe(0);
        }
    });

    it('has a borderless fully opaque interior and transparent outside corners', () => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(pixel(255, x, y)[3]).toBe(255);
        // Isolated cells, narrow strips and all corner combinations remain visible.
        for (let mask = 0; mask < 256; mask++) expect(pixel(mask, 8, 8)[3]).toBe(255);
        expect(pixel(0, 0, 0)[3]).toBe(0);
        // An L-shaped patch needs a different inside corner from a solid block.
        expect(Array.from({ length: 64 }, (_, i) => pixel(6, 8 + i % 8, 8 + Math.floor(i / 8))))
            .not.toEqual(Array.from({ length: 64 }, (_, i) => pixel(38, 8 + i % 8, 8 + Math.floor(i / 8))));
        expect(new Set(Array.from({ length: 16 }, (_, y) => pixel(255, 0, y)[3]))).toEqual(new Set([255]));
    });

    it('produces identical pixels for a clipped repaint and the complete connected patch', () => {
        const world = fixture([[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [1, 3], [2, 3], [3, 3]]);
        const full = rasterTerrain(world, undefined, ground, undefined, salt);
        const bounds = { x: 2, y: 1, width: 3, height: 4 }, partial = rasterTerrain(world, bounds, ground, undefined, salt);
        for (let y = 0; y < partial.height; y++) {
            const from = ((bounds.y * 16 + y) * full.width + bounds.x * 16) * 4;
            expect(partial.pixels.slice(y * partial.width * 4, (y + 1) * partial.width * 4))
                .toEqual(full.pixels.slice(from, from + partial.width * 4));
        }
        expect(full.water.every(value => value === 0)).toBe(true);
        const plain = rasterTerrain(fixture([]), undefined, ground);
        // Clear corners reveal actual ground, with no baked sand-colored square.
        const corner = ((1 * 16) * full.width + 1 * 16) * 4;
        expect(full.pixels.slice(corner, corner + 4)).toEqual(plain.pixels.slice(corner, corner + 4));
        const center = ((1 * 16 + 8) * full.width + 1 * 16 + 8) * 4;
        expect(full.pixels.slice(center, center + 4)).not.toEqual(plain.pixels.slice(center, center + 4));
    });

    it('invalidates neighboring terrain joins when salt is added or removed', () => {
        vi.spyOn(punyArt, 'punyWorldPixels').mockReturnValue(ground);
        vi.spyOn(saltArt, 'saltPanPixels').mockReturnValue(salt);
        const context = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: false };
        const canvas = () => ({ width: 0, height: 0, getContext: () => context });
        vi.stubGlobal('document', { createElement: canvas });
        const surface = canvas() as unknown as HTMLCanvasElement, world = fixture([[2, 2]]);
        paintTerrain(surface, world);
        expect(paintTerrain(surface, world)).toBeUndefined();
        world.tiles[2 * 7 + 3].resource = 'salt';
        expect(paintTerrain(surface, world)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
        delete world.tiles[2 * 7 + 3].resource;
        expect(paintTerrain(surface, world)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
    });
});
