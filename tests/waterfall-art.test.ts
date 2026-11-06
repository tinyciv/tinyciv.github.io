import { describe, expect, it } from 'vitest';
import { bankedRiverPixels, bankedRiverSprite, riverWaterPixel } from '../src/game/banked-river-art';
import { rasterTerrain, terrainMinimapColor, waterAnimationFrame, waterArtKey } from '../src/game/terrain';
import { prepareWaterDepth } from '../src/game/water-depth';
import { worldRevisions } from '../src/game/world-revisions';
import { tileAt, type World } from '../src/game/types';
import { punyAtlas } from './puny-atlas';

const atlas = punyAtlas(), sand = punyAtlas(new URL('../public/assets/puny-world/desert-ledges.png', import.meta.url));
function fixture(desert = false): World {
    const width = 9, height = 10;
    const world: World = { width, height, seed: 'waterfall-art', source: 'test', spawns: [],
        tiles: Array.from({ length: width * height }, (_, i) => ({
            terrain: desert ? 'desert' : 'grassland', overlay: 'none', elevation: .4,
            moisture: .4, food: 1, production: 1, gold: 0, variation: 0,
            ...(i % width >= 1 && i % width <= 7 && Math.floor(i / width) <= 4 ? { ridge: 1, ridgeTier: 1 as const } : {}),
        })) };
    for (let y = 0; y < height; y++) Object.assign(tileAt(world, 4, y)!, {
        terrain: 'river', riverArt: 'banked', creekGround: desert ? 'desert' : 'grassland', channelNext: (y + 1) * width + 4,
    });
    tileAt(world, 4, 4)!.waterfall = 'south';
    return world;
}

describe('approved Puny waterfall rendering', () => {
    it('uses the complete original 1A tile over the cliff and joins its ten-pixel channel', () => {
        const world = fixture(), fall = rasterTerrain(world, { x: 4, y: 4, width: 1, height: 1 }, atlas, sand);
        const expected: number[] = [];
        for (let y = 352; y < 368; y++) for (let x = 64; x < 80; x++)
            expected.push(...atlas.data.subarray((y * atlas.width + x) * 4, (y * atlas.width + x + 1) * 4));
        expect(fall.pixels).toEqual(Uint8ClampedArray.from(expected));
        const reach = rasterTerrain(world, { x: 4, y: 3, width: 1, height: 3 }, atlas, sand);
        let previous: number[] = [];
        for (let y = 0; y < 48; y++) {
            const wet = Array.from({ length: 16 }, (_, x) => x).filter(x => reach.water[y * 16 + x]);
            expect(wet.length).toBeGreaterThanOrEqual(9);
            if (previous.length) expect(wet.some(x => previous.includes(x))).toBe(true);
            previous = wet;
        }
        expect(bankedRiverSprite(world, 4, 3)).toEqual([0, 176, 16, 16]);
        expect(terrainMinimapColor(world, 4, 4)).toBe('#04a0b4');
    });

    it('keeps every native water pixel and full silhouette when matching desert cliff colors', () => {
        const recolored = bankedRiverPixels(atlas, true, sand), world = fixture(true);
        const colors = new Set<string>();
        for (let i = 0; i < sand.data.length; i += 4) if (sand.data[i + 3]) colors.add([...sand.data.subarray(i, i + 3)].join(','));
        let changed = 0;
        for (let frame = 0; frame < 4; frame++) for (let y = 352; y < 368; y++) for (let x = 64 + frame * 16; x < 80 + frame * 16; x++) {
            const i = (y * atlas.width + x) * 4, from = atlas.data.subarray(i, i + 4), to = recolored.data.subarray(i, i + 4);
            expect(to[3]).toBe(from[3]);
            if (riverWaterPixel(from[0], from[1], from[2])) expect(to).toEqual(from);
            else { expect(colors.has([...to.subarray(0, 3)].join(','))).toBe(true); changed += Number(from.some((v, c) => v !== to[c])); }
        }
        expect(changed).toBeGreaterThan(0);
        const raster = rasterTerrain(world, { x: 4, y: 4, width: 1, height: 1 }, atlas, sand);
        expect(raster.water).toEqual(rasterTerrain(fixture(), { x: 4, y: 4, width: 1, height: 1 }, atlas, sand).water);
    });

    it('advances all four waterfall frames before ordinary water advances once', () => {
        const world = fixture(), tile = tileAt(world, 4, 4)!, keys = new Set<string>();
        for (const [index, time] of [0, .101, .201, .301].entries()) {
            const frame = waterAnimationFrame(tile, time);
            expect(frame).toBe(index); expect(waterAnimationFrame(tileAt(world, 4, 3)!, time)).toBe(0);
            expect(bankedRiverSprite(world, 4, 4, frame)).toEqual([64 + index * 16, 352, 16, 16]);
            keys.add(waterArtKey(world, 4, 4, frame));
        }
        expect(keys.size).toBe(4); expect(waterAnimationFrame(tile, .401)).toBe(0);
    });

    it('invalidates direct-edit caches and excludes banked reaches from deep-water shading', () => {
        const world = fixture(), tile = tileAt(world, 4, 4)!;
        const before = worldRevisions(world).appearance, oldKey = waterArtKey(world, 4, 4);
        delete tile.waterfall;
        expect(worldRevisions(world).appearance).toBeGreaterThan(before);
        expect(waterArtKey(world, 4, 4)).not.toBe(oldKey);
        expect(prepareWaterDepth(world).signature[4 * world.width + 4]).toBe(0);
        delete tile.riverArt;
        expect(prepareWaterDepth(world).signature[4 * world.width + 4]).toBe(2);
    });

    it('repaints only a requested patch with exactly the same pixels and water mask as a full raster', () => {
        const world = fixture(true), full = rasterTerrain(world, undefined, atlas, sand);
        const region = { x: 3, y: 2, width: 3, height: 5 }, patch = rasterTerrain(world, region, atlas, sand);
        for (let y = 0; y < patch.height; y++) {
            const from = (region.y * 16 + y) * full.width + region.x * 16;
            expect(patch.pixels.subarray(y * patch.width * 4, (y + 1) * patch.width * 4)).toEqual(full.pixels.subarray(from * 4, (from + patch.width) * 4));
            expect(patch.water.subarray(y * patch.width, (y + 1) * patch.width)).toEqual(full.water.subarray(from, from + patch.width));
        }
    });
});
