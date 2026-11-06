import { afterEach, describe, expect, it, vi } from 'vitest';
import * as construction from '../src/game/construction';
import { entityStore } from '../src/game/entity-store';
import type { FogView } from '../src/game/fog';
import { ridgeQuads } from '../src/game/ridge-art';
import { ridgeIsLedge } from '../src/game/ridges';
import type { RoadLinks } from '../src/game/road-sprites';
import { wallCliffGroundMask, wallCliffJoins, wallCliffKey, wallLinksWithCliffs, type WallCliffJoin } from '../src/game/wall-cliffs';
import type { Building, GameState, Terrain, Tile, World } from '../src/game/types';
import { recordNativeFrame } from './helpers/native-renderer';
import { punyAtlas } from './puny-atlas';

const atlas = punyAtlas();
const links = (mask = 0): RoadLinks => ({ north: !!(mask & 1), east: !!(mask & 2), south: !!(mask & 4), west: !!(mask & 8) });
const wall = (x: number, y: number, kind: Building['kind'] = 'wall'): Building =>
    ({ id: 1, kind, faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });

function plateau(terrain: Terrain = 'grassland'): World {
    const width = 22, height = 22;
    const world: World = { width, height, seed: 'wall-cliffs', source: 'fixture', spawns: [], revision: 0,
        tiles: Array.from({ length: width * height }, (): Tile => ({ terrain, overlay: 'none', elevation: .4,
            moisture: .5, food: 2, production: 1, gold: 0, variation: 0 })) };
    for (let y = 5; y <= 17; y++) for (let x = 5; x <= 17; x++) world.tiles[y * width + x].ridge = 1;
    return world;
}

const approaches = [
    { side: 'south', wall: [11, 4], cliff: [11, 5], inside: [11, 6], opposite: 'north' },
    { side: 'west', wall: [18, 11], cliff: [17, 11], inside: [16, 11], opposite: 'east' },
    { side: 'north', wall: [11, 18], cliff: [11, 17], inside: [11, 16], opposite: 'south' },
    { side: 'east', wall: [4, 11], cliff: [5, 11], inside: [6, 11], opposite: 'west' },
] as const;

function sourcePixel(join: WallCliffJoin, x: number, y: number): number[] {
    const quad = join.quads.find(q => x >= q.dx && x < q.dx + 8 && y >= q.dy && y < q.dy + 8)!;
    const at = ((quad.sy + y - quad.dy) * atlas.width + quad.sx + x - quad.dx) * 4;
    return Array.from(atlas.data.slice(at, at + 4));
}

function frameFixture() {
    const world = plateau(), building = wall(11, 4);
    const state: GameState = { world, units: [], buildings: [building], factions: [], fields: [], time: 1, tick: 0,
        paused: true, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
        diplomacy: null, gameOver: false, victory: false, seed: 'wall-cliffs', rngState: 1 };
    const fog: FogView = { width: world.width, height: world.height, visible: new Uint8Array(world.tiles.length).fill(1),
        explored: Array(world.tiles.length).fill(1), sources: [], buildings: [...state.buildings], fields: [], revision: 1, explorationRevision: 1 };
    return { state, fog, building };
}

afterEach(() => vi.restoreAllMocks());

describe('wall contacts with native ledges', () => {
    it.each(['wall', 'palisade'] as const)('joins %s from both the low approach and upper floor on every side', kind => {
        const world = plateau(), before = JSON.stringify(world);
        for (const approach of approaches) {
            const [x, y] = approach.wall, [cx, cy] = approach.cliff, [ix, iy] = approach.inside;
            expect(wallCliffJoins(wall(x, y, kind), world, links())).toEqual([
                { x: cx, y: cy, side: approach.side, quads: ridgeQuads(world, cx, cy) },
            ]);
            expect(wallCliffJoins(wall(ix, iy, kind), world, links())).toEqual([
                { x: cx, y: cy, side: approach.opposite, quads: ridgeQuads(world, cx, cy) },
            ]);
        }
        expect(JSON.stringify(world)).toBe(before);
    });

    it('joins the second tier from the first tier without drawing down into a lower ledge', () => {
        const world = plateau();
        for (let y = 9; y <= 13; y++) for (let x = 9; x <= 13; x++) world.tiles[y * world.width + x].ridgeTier = 2;
        const low = wall(11, 8), high = wall(11, 10);
        expect(wallCliffJoins(low, world, links()).map(join => [join.x, join.y, join.side])).toEqual([[11, 9, 'south']]);
        expect(wallCliffJoins(high, world, links()).map(join => [join.x, join.y, join.side])).toEqual([[11, 9, 'north']]);
        // A taller shelf can stand beside the outside boundary of the lower one.
        // The lower tier's edge must not become a bridge down from the high wall.
        world.tiles[6 * world.width + 11].ridgeTier = 2;
        expect(ridgeIsLedge(world, 11, 5)).toBe(true);
        expect(wallCliffJoins(wall(11, 6), world, links()).some(join => join.y === 5)).toBe(false);
    });

    it('ignores stairs, flat summits, diagonal contact, destroyed walls and construction pegs', () => {
        const world = plateau(), building = wall(11, 4);
        world.tiles[5 * world.width + 11].stair = 'south';
        expect(wallCliffJoins(building, world, links())).toEqual([]);
        delete world.tiles[5 * world.width + 11].stair;
        expect(wallCliffJoins(wall(11, 11), world, links())).toEqual([]);
        expect(wallCliffJoins(wall(4, 4), world, links())).toEqual([]);
        expect(wallCliffJoins({ ...building, hp: 0 }, world, links())).toEqual([]);
        expect(wallCliffJoins({ ...building, construction: { startedAt: 0, duration: 10 } }, world, links())).toEqual([]);
        expect(wallCliffJoins({ ...building, kind: 'house' }, world, links())).toEqual([]);
        expect(wallCliffJoins(wall(0, 0), world, links())).toEqual([]);
    });

    it('does not reveal unknown neighboring cliffs', () => {
        const world = plateau(), building = wall(11, 4);
        expect(wallCliffJoins(building, world, links(), () => false)).toEqual([]);
        expect(wallCliffJoins(building, world, links(), (x, y) => x === 11 && y === 5)).toHaveLength(1);
    });

    it('continues an arm or free end but adds no T junction to a parallel wall run', () => {
        const world = plateau(), building = wall(11, 4);
        expect(wallCliffJoins(building, world, links(10))).toEqual([]);
        expect(wallCliffJoins(building, world, links(4))).toEqual([]);
        expect(wallCliffJoins(building, world, links(1))).toHaveLength(1);
        expect(wallCliffJoins(building, world, links(8))).toHaveLength(1);
        expect(wallCliffJoins(building, world, links(9))).toHaveLength(1);
        const network = links(9), before = { ...network }, joins = wallCliffJoins(building, world, network);
        expect(wallLinksWithCliffs(network, joins)).toEqual(links(13));
        expect(network).toEqual(before);
    });
});

describe('native cliff occlusion masks', () => {
    it('reaches the recessed north face and never resurfaces on grass beyond the cliff', () => {
        const world = plateau();
        const join = wallCliffJoins(wall(11, 4), world, links())[0], mask = wallCliffGroundMask(join, atlas);
        expect(sourcePixel(join, 8, 12)).toEqual([133, 166, 67, 255]);
        for (let y = 0; y < 9; y++) expect(mask[y * 16 + 8]).toBe(1);
        for (let y = 9; y < 16; y++) expect(mask[y * 16 + 8]).toBe(0);
        const reverse = wallCliffJoins(wall(11, 6), world, links())[0], inside = wallCliffGroundMask(reverse, atlas);
        expect(inside[15 * 16 + 8]).toBe(1);
        expect(inside[12 * 16 + 8]).toBe(1);
        expect(inside[11 * 16 + 8]).toBe(0);
        expect(inside[8]).toBe(0);
    });

    it('keeps the exact approach-side pixels on both side faces and the south face', () => {
        const world = plateau();
        const west = wallCliffGroundMask(wallCliffJoins(wall(4, 11), world, links())[0], atlas);
        expect(Array.from(west.slice(8 * 16, 9 * 16))).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        const east = wallCliffGroundMask(wallCliffJoins(wall(18, 11), world, links())[0], atlas);
        expect(Array.from(east.slice(8 * 16, 9 * 16))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
        const south = wallCliffGroundMask(wallCliffJoins(wall(11, 18), world, links())[0], atlas);
        expect(Array.from({ length: 16 }, (_, y) => south[y * 16 + 8])).toEqual([...Array(13).fill(0), 1, 1, 1]);
        expect(Array.from({ length: 16 }, (_, y) => south[y * 16 + 3])).toEqual([...Array(14).fill(0), 1, 1]);
        const innerSouth = wallCliffGroundMask(wallCliffJoins(wall(11, 16), world, links())[0], atlas);
        expect(Array.from({ length: 16 }, (_, y) => innerSouth[y * 16 + 8])).toEqual([1, ...Array(15).fill(0)]);
    });

    it('covers the authored green shadow at the cliff foot while retaining the first stone pixel', () => {
        const world = plateau(), join = wallCliffJoins(wall(11, 18), world, links())[0];
        const mask = wallCliffGroundMask(join, atlas);
        // These opaque grass shadows formerly left a 4–6 screen-pixel gap at
        // the native 2× scale even though the stone wall reaches its tile edge.
        expect(sourcePixel(join, 8, 15)).toEqual([124, 149, 58, 255]);
        expect(sourcePixel(join, 8, 14)).toEqual([118, 142, 54, 255]);
        expect(sourcePixel(join, 8, 13)).toEqual([95, 108, 55, 255]);
        expect(sourcePixel(join, 9, 13)).toEqual([118, 142, 53, 255]);
        for (const [x, y] of [[8, 15], [8, 14], [8, 13], [9, 13]]) expect(mask[y * 16 + x]).toBe(1);
        expect(sourcePixel(join, 8, 12)).toEqual([84, 88, 51, 255]);
        expect(mask[12 * 16 + 8]).toBe(0);

        const corner = wallCliffJoins(wall(4, 17), world, links())[0], cornerMask = wallCliffGroundMask(corner, atlas);
        expect(sourcePixel(corner, 5, 12)).toEqual([127, 154, 61, 255]);
        expect(cornerMask[12 * 16 + 5]).toBe(1);
        expect(cornerMask[12 * 16 + 6]).toBe(1);
        expect(cornerMask[12 * 16 + 7]).toBe(0);
        expect(cornerMask[12 * 16 + 8]).toBe(0);
        // The lowest corner row contains only ground and ground shadow; there
        // is no rock for an arm to meet there, so it must remain empty.
        expect(Array.from(cornerMask.slice(15 * 16))).toEqual(Array(16).fill(0));
    });

    it('keeps the inner south corners from producing long triangular timber caps', () => {
        for (const mirrored of [false, true]) {
            const world = plateau(), removedX = mirrored ? 17 : 5;
            delete world.tiles[17 * world.width + removedX].ridge;
            const join = wallCliffJoins(wall(mirrored ? 15 : 7, 16), world, links())
                .find(candidate => candidate.side === (mirrored ? 'east' : 'west'))!;
            expect(join.side).toBe(mirrored ? 'east' : 'west');
            const mask = wallCliffGroundMask(join, atlas), depths = Array.from({ length: 16 }, (_, y) =>
                mask.slice(y * 16, y * 16 + 16).reduce((total, value) => total + value, 0));
            // The original first two rows extended 9 and 7 native pixels;
            // the wall body reaches this cliff in only 1–3 native pixels.
            expect(depths).toEqual([3, 3, 3, 3, 2, 2, 3, 1, 2, 2, 2, 1, 2, 3, 1, 2]);
        }
    });

    it('keeps inner corner cap and footing extensions compact in all four approach directions', () => {
        for (const [removedX, removedY, wallX, wallY, side, maxDepth] of [
            [5, 5, 7, 6, 'west', 5], [5, 5, 6, 7, 'north', 5],
            [17, 5, 15, 6, 'east', 5], [17, 5, 16, 7, 'north', 5],
            [5, 17, 7, 16, 'west', 3], [5, 17, 6, 15, 'south', 3],
            [17, 17, 15, 16, 'east', 3], [17, 17, 16, 15, 'south', 3],
        ] as const) {
            const world = plateau(); delete world.tiles[removedY * world.width + removedX].ridge;
            const join = wallCliffJoins(wall(wallX, wallY), world, links()).find(candidate => candidate.side === side)!;
            expect(join.side).toBe(side);
            const mask = wallCliffGroundMask(join, atlas), vertical = side === 'north' || side === 'south';
            const depths = Array.from({ length: 16 }, (_, across) => Array.from({ length: 16 }, (_, along) =>
                mask[vertical ? along * 16 + across : across * 16 + along]).reduce((total, value) => total + value, 0));
            expect(Math.max(...depths)).toBe(maxDepth);
        }
    });

    it('preserves one-pixel authored shoulders at straight contacts', () => {
        const world = plateau();
        const north = wallCliffGroundMask(wallCliffJoins(wall(11, 4), world, links())[0], atlas);
        expect(north[9 * 16 + 1]).toBe(1); expect(north[10 * 16 + 1]).toBe(0);
        const south = wallCliffGroundMask(wallCliffJoins(wall(11, 18), world, links())[0], atlas);
        expect(south[12 * 16 + 15]).toBe(1); expect(south[11 * 16 + 15]).toBe(0);
        const westInside = wallCliffGroundMask(wallCliffJoins(wall(6, 11), world, links())[0], atlas);
        expect(westInside[13]).toBe(1); expect(westInside[12]).toBe(0);
    });

    it('leaves corner rays empty when they miss the cliff instead of creating floating wall strips', () => {
        const world = plateau(), join = wallCliffJoins(wall(4, 5), world, links())[0];
        const mask = wallCliffGroundMask(join, atlas);
        expect(mask.some(value => value === 1)).toBe(true);
        expect(Array.from(mask.slice(8 * 16, 9 * 16))).toEqual(Array(16).fill(0));
        const ground = [[133, 166, 67, 255], [124, 149, 58, 255], [118, 142, 54, 255],
            [118, 142, 53, 255], [95, 108, 55, 255], [127, 154, 61, 255]];
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (mask[y * 16 + x])
            expect(ground).toContainEqual(sourcePixel(join, x, y));
    });

    it('uses the same geometry and cache entry for both terrain palettes and translated cliffs', () => {
        const grass = plateau(), desert = plateau('desert');
        for (const approach of approaches) {
            const [x, y] = approach.wall, a = wallCliffJoins(wall(x, y), grass, links())[0];
            const b = wallCliffJoins(wall(x, y), desert, links())[0];
            expect(wallCliffKey(a)).toBe(wallCliffKey(b));
            expect(wallCliffGroundMask(a, atlas)).toEqual(wallCliffGroundMask(b, atlas));
            expect(wallCliffKey({ ...a, x: a.x + 20, y: a.y + 30 })).toBe(wallCliffKey(a));
            expect(wallCliffKey({ ...a, side: approach.opposite })).not.toBe(wallCliffKey(a));
        }
    });
});

describe('wall cliff joins in the live compositor', () => {
    it.each(['wall', 'palisade'] as const)('draws the %s extension in the neighboring cell before its connected wall', kind => {
        const { state, fog, building } = frameFixture(); building.kind = kind;
        const frame = recordNativeFrame(state, { fog }), extensions = frame.sprites.filter(sprite => sprite.key.startsWith('wall-cliff:'));
        expect(extensions).toHaveLength(1);
        expect(extensions[0]).toMatchObject({ x: 11 * 32, y: 5 * 32, scale: 1, alpha: 1 });
        expect(extensions[0].key).toContain(`wall-cliff:${kind}:south:`);
        expect(frame.drawOrder.indexOf(extensions[0].key)).toBeLessThan(frame.drawOrder.indexOf('building'));
    });

    it('uses matching translucency for the placement ghost and its cliff extension', () => {
        const { state, fog } = frameFixture(); entityStore(state).buildings.replace([]); fog.buildings = []; state.buildMode = 'wall';
        vi.spyOn(construction, 'planConstruction').mockReturnValue({ ok: true, message: '', tiles: [{ x: 11, y: 4 }],
            cells: [{ x: 11, y: 4, ok: true, existing: false, message: '' }], skipped: 0, cost: 50,
            costs: { gold: 50, production: 0, food: 0 } });
        const frame = recordNativeFrame(state, { fog, buildPreview: [{ x: 11, y: 4 }] });
        const extensions = frame.sprites.filter(sprite => sprite.key.startsWith('wall-cliff:'));
        expect(extensions).toHaveLength(1); expect(extensions[0].alpha).toBe(.55);
        expect(frame.sprites.filter(sprite => sprite.key === 'building').map(sprite => sprite.alpha)).toEqual([.55]);
    });

    it('suppresses extensions into unexplored cliffs and during construction', () => {
        const { state, fog, building } = frameFixture();
        fog.visible[5 * state.world.width + 11] = 0; fog.explored[5 * state.world.width + 11] = 0;
        expect(recordNativeFrame(state, { fog }).sprites.some(sprite => sprite.key.startsWith('wall-cliff:'))).toBe(false);
        fog.explored[5 * state.world.width + 11] = 1;
        expect(recordNativeFrame(state, { fog }).sprites.some(sprite => sprite.key.startsWith('wall-cliff:'))).toBe(true);
        building.construction = { startedAt: 0, duration: 10 };
        expect(recordNativeFrame(state, { fog }).sprites.some(sprite => sprite.key.startsWith('wall-cliff:'))).toBe(false);
    });
});
