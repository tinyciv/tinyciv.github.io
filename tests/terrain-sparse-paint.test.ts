import { afterEach, describe, expect, it, vi } from 'vitest';
import { paintTerrain, rasterTerrain } from '../src/game/terrain';
import { markWorldChanged, worldChangesSince } from '../src/game/world-revisions';
import type { Tile, World } from '../src/game/types';

vi.mock('../src/game/puny-world', async () => {
    const { punyAtlas } = await import('./puny-atlas');
    const atlas = punyAtlas();
    return { drawPuny: vi.fn(), punyWorldPixels: () => atlas, punyDesertLedgePixels: () => undefined };
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
    const world: World = { width: 32, height: 24, revision: 0, seed: 'sparse-paint', source: 'test', spawns: [],
        tiles: Array.from({ length: 32 * 24 }, (_, i): Tile => ({ terrain: i % 32 < 2 ? 'lake' : 'grassland',
            overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: (i % 9) / 9 })) };
    const draws: { x: number; y: number; width: number; height: number }[] = [];
    let pixels = new Uint8ClampedArray(world.width * world.height * 16 * 16 * 4);
    // Keep the native-resolution pixels before the renderer's nearest 2x scale.
    vi.stubGlobal('document', { createElement: () => {
        const low = { width: 0, height: 0, pixels: new Uint8ClampedArray(), getContext: () => ({
            createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: (image: { data: Uint8ClampedArray }) => { low.pixels = new Uint8ClampedArray(image.data); },
        }) };
        return low;
    } });
    const canvas = { width: 0, height: 0, getContext: () => ({ imageSmoothingEnabled: false,
        drawImage(low: { width: number; height: number; pixels: Uint8ClampedArray }, x: number, y: number, width: number, height: number) {
            draws.push({ x: x / 32, y: y / 32, width: width / 32, height: height / 32 });
            for (let row = 0; row < low.height; row++) {
                const source = row * low.width * 4, target = ((y / 2 + row) * world.width * 16 + x / 2) * 4;
                pixels.set(low.pixels.subarray(source, source + low.width * 4), target);
            }
        },
    }) } as unknown as HTMLCanvasElement;
    paintTerrain(canvas, world); draws.length = 0;
    return { world, canvas, draws, pixels: () => pixels, cursor: worldChangesSince(world).revision };
}

describe('sparse terrain repainting', () => {
    it('keeps distant farm edits local and matches a fresh complete raster byte for byte', () => {
        const { world, canvas, draws, pixels, cursor } = fixture();
        const cells = [5 * world.width + 4, 5 * world.width + 5, 18 * world.width + 25];
        for (const cell of cells) world.tiles[cell].farm = 0;
        markWorldChanged(world, 'appearance', cells);
        const changed = paintTerrain(canvas, world, worldChangesSince(world, cursor));
        expect(changed?.regions).toEqual([
            { x: 3, y: 4, width: 4, height: 3 }, { x: 24, y: 17, width: 3, height: 3 },
        ]);
        expect(draws).toEqual(changed?.regions);
        expect(draws.reduce((area, rect) => area + rect.width * rect.height, 0)).toBe(21);
        expect(pixels()).toEqual(rasterTerrain(world).pixels);
    });

    it('retains exact pixels for clipped edge edits and a new coastline', () => {
        const { world, canvas, pixels, cursor } = fixture();
        const cells = [0, world.width - 1, world.tiles.length - 1];
        world.tiles[0].terrain = 'grassland';
        world.tiles[cells[1]].farm = 0; world.tiles[cells[2]].farm = 0;
        markWorldChanged(world, 'geometry', cells);
        paintTerrain(canvas, world, worldChangesSince(world, cursor));
        expect(pixels()).toEqual(rasterTerrain(world).pixels);
    });
});
