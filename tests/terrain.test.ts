import { describe, expect, it } from 'vitest';
import { rasterTerrain as rasterPunyTerrain, terrainQuads } from '../src/game/terrain';
import { WATER, type Tile, type World } from '../src/game/types';
import { punyAtlas } from './puny-atlas';
const atlas = punyAtlas();
const rasterTerrain = (world: World, region?: { x: number; y: number; width: number; height: number }) => rasterPunyTerrain(world, region, atlas);

function fixture(seed = 'banks'): World {
    return {
        width: 12, height: 10, seed, source: 'test', spawns: [],
        tiles: Array.from({ length: 120 }, (_, i): Tile => ({
            terrain: i % 12 > 6 ? 'desert' : 'grassland', overlay: 'none',
            elevation: .4, moisture: .5, food: 1, production: 1, gold: 0, variation: .2,
        })),
    };
}

function components(mask: Uint8Array, width: number, height: number) {
    const labels = new Int32Array(mask.length);
    let count = 0;
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || labels[start]) continue;
        const pending = [start]; labels[start] = ++count;
        for (let read = 0; read < pending.length; read++) {
            const i = pending[read], x = i % width, y = Math.floor(i / width);
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const n = ny * width + nx;
                if (mask[n] && !labels[n]) { labels[n] = count; pending.push(n); }
            }
        }
    }
    return { labels, count };
}

describe('tile-local terrain ground', () => {
    it('uses only unmodified atlas pixels and native source quadrants', () => {
        const world = fixture(), raster = rasterTerrain(world);
        for (let ty = 0; ty < world.height; ty++) for (let tx = 0; tx < world.width; tx++) {
            for (const q of terrainQuads(world, tx, ty)) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
                const source = ((q.sy + y) * atlas.width + q.sx + x) * 4;
                const target = ((ty * 16 + q.dy + y) * raster.width + tx * 16 + q.dx + x) * 4;
                expect(raster.pixels.slice(target, target + 4)).toEqual(atlas.data.slice(source, source + 4));
                expect(raster.pixels[target + 3]).toBe(255);
            }
        }
    });

    it('keeps narrow river bends connected and diagonal water bodies separate', () => {
        for (const seed of ['banks', 'BTV-847', 'north', 'river crossing']) {
            const world = fixture(seed);
            const river = [[2, 0], [2, 1], [2, 2], [3, 2], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [5, 6], [6, 6], [7, 6], [7, 7], [7, 8], [7, 9]];
            const separate = [[9, 2], [10, 2], [9, 3], [10, 3], [9, 6], [10, 7]];
            for (const [x, y] of [...river, ...separate]) world.tiles[y * 12 + x].terrain = 'river';
            const before = JSON.stringify(world), raster = rasterTerrain(world);
            const grid = components(Uint8Array.from(world.tiles, t => Number(WATER.has(t.terrain))), 12, 10);
            const painted = components(raster.water, raster.width, raster.height);
            expect(painted.count).toBe(grid.count);
            const mapping = new Map<number, number>();
            for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) {
                const original = grid.labels[y * 12 + x], actual = painted.labels[(y * 16 + 8) * raster.width + x * 16 + 8];
                expect(Boolean(actual)).toBe(Boolean(original));
                if (original) {
                    if (!mapping.has(original)) mapping.set(original, actual);
                    expect(actual).toBe(mapping.get(original));
                }
            }
            expect(new Set(mapping.values()).size).toBe(grid.count);
            expect(JSON.stringify(world)).toBe(before);
        }
    });

    it('matches a full repaint exactly when clearing a farm with a small dirty rectangle', () => {
        const world = fixture();
        world.tiles[4 * 12 + 5].overlay = 'forest';
        world.tiles[4 * 12 + 6].overlay = 'jungle';
        const before = rasterTerrain(world);
        world.tiles[4 * 12 + 5].overlay = 'none';
        world.tiles[4 * 12 + 5].farm = 0;
        const full = rasterTerrain(world), region = { x: 2, y: 1, width: 7, height: 7 }, patch = rasterTerrain(world, region);
        for (let y = 0; y < full.height; y++) {
            if (y >= region.y * 16 && y < (region.y + region.height) * 16) {
                const start = (y * full.width + region.x * 16) * 4, length = patch.width * 4;
                const patchStart = (y - region.y * 16) * length;
                expect(patch.pixels.slice(patchStart, patchStart + length)).toEqual(full.pixels.slice(start, start + length));
                expect(full.pixels.slice(y * full.width * 4, start)).toEqual(before.pixels.slice(y * full.width * 4, start));
                expect(full.pixels.slice(start + length, (y + 1) * full.width * 4)).toEqual(before.pixels.slice(start + length, (y + 1) * full.width * 4));
            } else {
                expect(full.pixels.slice(y * full.width * 4, (y + 1) * full.width * 4)).toEqual(before.pixels.slice(y * full.width * 4, (y + 1) * full.width * 4));
            }
        }
        // Forest removal is visible in the scenery pass, not as a wash of
        // altered ground colors bleeding into surrounding tiles.
        expect(full.pixels).toEqual(before.pixels);
    });

    it('keeps dirty shoreline repaint pixels and farm clipping masks identical to a full repaint', () => {
        const world = fixture();
        world.tiles[4 * 12 + 5].farm = 0;
        world.tiles[4 * 12 + 6].terrain = 'river';
        world.tiles[5 * 12 + 6].terrain = 'river';
        const full = rasterTerrain(world), region = { x: 2, y: 1, width: 7, height: 7 };
        const patch = rasterTerrain(world, region);
        for (let y = 0; y < patch.height; y++) {
            const start = (y + region.y * 16) * full.width + region.x * 16;
            expect(patch.pixels.slice(y * patch.width * 4, (y + 1) * patch.width * 4)).toEqual(full.pixels.slice(start * 4, (start + patch.width) * 4));
            expect(patch.water.slice(y * patch.width, (y + 1) * patch.width)).toEqual(full.water.slice(start, start + patch.width));
        }
    });
});
