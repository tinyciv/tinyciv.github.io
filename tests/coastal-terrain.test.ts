import { describe, expect, it } from 'vitest';
import { rasterTerrain, terrainMinimapColor, terrainQuads } from '../src/game/terrain';
import { prepareWaterDepth, waterDepthAt, waterDepthField } from '../src/game/water-depth';
import { type Tile, type World } from '../src/game/types';
import { punyAtlas } from './puny-atlas';

const atlas = punyAtlas();
function world(width = 24, height = 16): World {
    return { width, height, seed: 'coastal-bands', source: 'test', spawns: [], tiles: Array.from({ length: width * height }, (_, i): Tile => ({
        terrain: i % width < 4 ? 'desert' : 'ocean', beach: i % width < 4 || undefined,
        overlay: 'none', elevation: .3, moisture: .4, food: 0, production: 0, gold: 0, variation: .2,
    })) };
}
const color = (sx: number, sy: number) => Array.from(atlas.data.subarray((sy * atlas.width + sx) * 4, (sy * atlas.width + sx) * 4 + 3));

describe('Puny World coastal water', () => {
    it('derives shelves and deep water from actual distance to land', () => {
        const w = world(), before = JSON.stringify(w), field = prepareWaterDepth(w);
        for (let x = 4; x < 24; x++) expect(waterDepthAt(w, x, 8)).toBe(x - 3);
        expect(Array.from(field.bands.slice(8 * 24 + 4, 8 * 24 + 12))).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
        expect([4, 7, 10].map(x => terrainMinimapColor(w, x, 8))).toEqual(['#2bc4a9', '#04a0b4', '#038aab']);
        expect(color(216, 184)).toEqual([43, 196, 169]);
        expect(color(296, 184)).toEqual([4, 160, 180]);
        expect(color(376, 184)).toEqual([3, 138, 171]);
        expect(JSON.stringify(w)).toBe(before);
    });

    it('keeps original grassy banks and derives river/lake water from the shared depth field', () => {
        const w = world();
        for (const t of w.tiles) if (t.beach) { t.beach = undefined; t.terrain = 'grassland'; }
        w.tiles[8 * 24 + 4].overlay = 'ford';
        w.tiles[8 * 24 + 4].terrain = 'river';
        w.tiles[8 * 24 + 16].terrain = 'lake';
        prepareWaterDepth(w);
        expect(terrainMinimapColor(w, 4, 7)).toBe('#2bc4a9');
        expect(terrainQuads(w, 4, 8).filter(q => q.dx === 0).every(q => q.sx >= 112 && q.sx < 192)).toBe(true);
        expect(terrainMinimapColor(w, 4, 8)).toBe('#2bc4a9');
        expect(terrainMinimapColor(w, 16, 8)).toBe('#038aab');
        expect(w.tiles[8 * 24 + 4].overlay).toBe('ford');
    });

    it('renders river mouths identically to coast water in every depth and animation frame', () => {
        const sea = world(), mixed = structuredClone(sea);
        for (let y = 0; y < mixed.height; y++) for (let x = 4; x < mixed.width; x++)
            mixed.tiles[y * mixed.width + x].terrain = ['river', 'coast', 'lake', 'ocean'][x % 4] as Tile['terrain'];
        for (let frame = 0; frame < 4; frame++) for (let y = 0; y < sea.height; y++) for (let x = 4; x < sea.width; x++) {
            expect(terrainQuads(mixed, x, y, frame)).toEqual(terrainQuads(sea, x, y, frame));
            expect(terrainMinimapColor(mixed, x, y)).toBe(terrainMinimapColor(sea, x, y));
        }
        expect(rasterTerrain(mixed, undefined, atlas)).toEqual(rasterTerrain(sea, undefined, atlas));
    });

    it('uses fully opaque native source rectangles for every shore shape in every animation frame', () => {
        const neighbors = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
        for (const kind of ['river', 'ocean'] as const) for (let mask = 0; mask < 256; mask++) {
            const w = world(3, 3);
            for (const t of w.tiles) { t.terrain = kind; t.beach = undefined; }
            neighbors.forEach(([x, y], bit) => {
                if (mask & (1 << bit)) { w.tiles[y * 3 + x].terrain = 'desert'; w.tiles[y * 3 + x].beach = true; }
            });
            prepareWaterDepth(w);
            for (let frame = 0; frame < 4; frame++) for (const q of terrainQuads(w, 1, 1, frame)) {
                for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
                    const alpha = atlas.data[((q.sy + y) * atlas.width + q.sx + x) * 4 + 3];
                    if (alpha !== 255) throw new Error(`${kind}, mask ${mask}, frame ${frame}: transparent native source ${q.sx + x},${q.sy + y}`);
                }
            }
        }
    });

    it('uses a matching sand palette right up to the sandy water bank', () => {
        const w = world(), raster = rasterTerrain(w, undefined, atlas), y = 8 * 16 + 8;
        const pixel = (x: number) => Array.from(raster.pixels.subarray((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 3));
        expect(pixel(4 * 16 - 1)).toEqual([201, 178, 102]);
        expect(pixel(4 * 16)).toEqual([201, 178, 102]);
        expect(raster.water[y * raster.width + 4 * 16]).toBe(0);
        expect(raster.water[y * raster.width + 4 * 16 + 8]).toBe(1);
    });

    it('joins beach sand seamlessly to adjacent inland desert and plains', () => {
        const w = world();
        for (let y = 0; y < w.height; y++) for (let x = 0; x < 3; x++) {
            w.tiles[y * w.width + x].beach = undefined;
            w.tiles[y * w.width + x].terrain = x === 2 ? 'plains' : 'desert';
        }
        const raster = rasterTerrain(w, undefined, atlas);
        for (let x = 16; x < 4 * 16; x++) {
            const at = ((8 * 16 + 8) * raster.width + x) * 4;
            expect(Array.from(raster.pixels.slice(at, at + 3))).toEqual([201, 178, 102]);
        }
    });

    it('keeps repeated sampling constant-time and invalidates manual coast edits during preparation', () => {
        const w = world(), field = prepareWaterDepth(w);
        for (let i = 0; i < 1000; i++) expect(waterDepthField(w)).toBe(field);
        w.tiles[8 * 24 + 16].terrain = 'grassland';
        const changed = prepareWaterDepth(w);
        expect(changed).not.toBe(field);
        expect(changed.distance[8 * 24 + 17]).toBe(1);
        expect(changed.bands[8 * 24 + 17]).toBe(0);
        expect(field.bands[8 * 24 + 17]).toBe(2);
        expect(prepareWaterDepth(w)).toBe(changed);
        w.revision = 1;
        expect(waterDepthField(w)).toBe(changed);
    });

    it('matches a full raster exactly for a cropped animated coast with all three depths', () => {
        const w = world();
        // A concave beach inlet exercises inward shoreline corners.
        w.tiles[7 * 24 + 4].terrain = 'desert'; w.tiles[7 * 24 + 4].beach = true;
        const full = rasterTerrain(w, undefined, atlas), region = { x: 3, y: 4, width: 12, height: 8 };
        const patch = rasterTerrain(w, region, atlas);
        for (let y = 0; y < patch.height; y++) {
            const start = ((y + region.y * 16) * full.width + region.x * 16);
            expect(patch.pixels.slice(y * patch.width * 4, (y + 1) * patch.width * 4)).toEqual(full.pixels.slice(start * 4, (start + patch.width) * 4));
            expect(patch.water.slice(y * patch.width, (y + 1) * patch.width)).toEqual(full.water.slice(start, start + patch.width));
        }
    });
});
