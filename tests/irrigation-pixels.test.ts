import { describe, expect, it } from 'vitest';
import { IRRIGATION_NATIVE_WIDTH, IRRIGATION_TERRAIN_BUFFER, irrigationChannelDistance, irrigationCropExcluded,
    irrigationMask, narrowIrrigationPixels } from '../src/game/irrigation-art';
import type { RoadLinks } from '../src/game/road-sprites';
import { punyAtlas } from './puny-atlas';

const ditch = punyAtlas(new URL('../public/assets/irrigation/ditch.png', import.meta.url));
const inlet = punyAtlas(new URL('../public/assets/irrigation/inlet.png', import.meta.url));
const narrowed = { ditch: narrowIrrigationPixels(ditch, 'ditch'), inlet: narrowIrrigationPixels(inlet, 'inlet') };
const links = (mask: number): RoadLinks => ({ north: !!(mask & 1), east: !!(mask & 2), south: !!(mask & 4), west: !!(mask & 8) });
const pixel = (kind: 'ditch' | 'inlet', tile: number, frame: number, x: number, y: number) => {
    const width = kind === 'ditch' ? ditch.width : inlet.width, at = ((frame * 16 + y) * width + tile * 16 + x) * 4;
    return Array.from(narrowed[kind].slice(at, at + 4));
};
// Every authored water color has blue > 100; olive bank colors have blue <= 79.
const water = (rgba: number[]) => rgba[3] > 0 && rgba[2] > 100;
const cardinal = [[0, -1], [1, 0], [0, 1], [-1, 0]];

describe('narrow native irrigation pixels', () => {
    it('preserves authored colors, binary transparency and all four animation frames', () => {
        for (const kind of ['ditch', 'inlet'] as const) {
            const source = kind === 'ditch' ? ditch : inlet, palette = new Set<string>();
            for (let at = 0; at < source.data.length; at += 4) palette.add(Array.from(source.data.slice(at, at + 4)).join(','));
            const animations = new Set<string>();
            for (let frame = 0; frame < 4; frame++) {
                const start = frame * 16 * source.width * 4, end = start + 16 * source.width * 4;
                animations.add(Buffer.from(narrowed[kind].slice(start, end)).toString('base64'));
                for (let at = start; at < end; at += 4) {
                    const rgba = Array.from(narrowed[kind].slice(at, at + 4));
                    expect([0, 255]).toContain(rgba[3]);
                    expect(palette.has(rgba.join(','))).toBe(true);
                }
            }
            expect(animations.size).toBe(4);
        }
    });

    it('keeps every arm connected to its junction without detached water pixels or extra exits', () => {
        for (let frame = 0; frame < 4; frame++) for (let mask = 1; mask < 16; mask++) {
            const waters = new Set<number>();
            for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (water(pixel('ditch', mask, frame, x, y))) waters.add(y * 16 + x);
            const queue = [7 * 16 + 7], connected = new Set(queue);
            expect(waters.has(queue[0]), `junction mask ${mask}, frame ${frame}`).toBe(true);
            for (let i = 0; i < queue.length; i++) for (const [dx, dy] of cardinal) {
                const x = queue[i] % 16 + dx, y = Math.floor(queue[i] / 16) + dy, next = y * 16 + x;
                if (x >= 0 && y >= 0 && x < 16 && y < 16 && waters.has(next) && !connected.has(next)) { connected.add(next); queue.push(next); }
            }
            expect(connected.size, `connected water mask ${mask}, frame ${frame}`).toBe(waters.size);
            for (const [bit, x, y] of [[1, 7, 0], [2, 15, 7], [4, 7, 15], [8, 0, 7]])
                expect(waters.has(y * 16 + x), `exit ${bit}, mask ${mask}, frame ${frame}`).toBe(!!(mask & bit));
        }
        expect(irrigationMask(links(0))).toBe(5);
        for (let frame = 0; frame < 4; frame++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
            expect(pixel('ditch', 0, frame, x, y)[3]).toBe(0);
    });

    it('keeps water edges aligned between every connected straight, turn and junction', () => {
        for (let frame = 0; frame < 4; frame++) for (let a = 1; a < 16; a++) for (let b = 1; b < 16; b++)
            for (let i = 0; i < 16; i++) {
                if ((a & 2) && (b & 8)) expect(water(pixel('ditch', a, frame, 15, i))).toBe(water(pixel('ditch', b, frame, 0, i)));
                if ((a & 4) && (b & 1)) expect(water(pixel('ditch', a, frame, i, 15))).toBe(water(pixel('ditch', b, frame, i, 0)));
            }
    });

    it('confines all banks to three native pixels and excludes a full neighboring terrain pixel from crops', () => {
        expect(IRRIGATION_NATIVE_WIDTH).toBe(3); expect(IRRIGATION_TERRAIN_BUFFER).toBe(1);
        for (let frame = 0; frame < 4; frame++) for (let mask = 1; mask < 16; mask++) {
            const directions = links(mask);
            for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (pixel('ditch', mask, frame, x, y)[3]) {
                expect(irrigationChannelDistance(directions, x + .5, y + .5, 7.5)).toBeLessThan(1.5);
                expect(irrigationCropExcluded(directions, x + .5, y + .5)).toBe(true);
                for (const [dx, dy] of cardinal) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < 16 && ny >= 0 && ny < 16)
                        expect(irrigationCropExcluded(directions, nx + .5, ny + .5), `buffer mask ${mask}, frame ${frame}, ${nx},${ny}`).toBe(true);
                }
            }
        }
        // The buffer is one native column on each side of a straight channel;
        // it does not expand into a wide empty strip beside the farmland.
        for (const x of [5, 9]) expect(irrigationCropExcluded(links(5), x + .5, 3.5)).toBe(true);
        for (const x of [4, 10]) expect(irrigationCropExcluded(links(5), x + .5, 3.5)).toBe(false);
    });

    it('joins every inlet rotation to the same narrow water profile at its landward edge', () => {
        for (let frame = 0; frame < 4; frame++) for (let direction = 0; direction < 4; direction++) {
            let occupied = 0;
            for (let i = 0; i < 16; i++) {
                const mouth = direction === 0 ? pixel('inlet', direction, frame, 15, i)
                    : direction === 1 ? pixel('inlet', direction, frame, i, 15)
                    : direction === 2 ? pixel('inlet', direction, frame, 0, i) : pixel('inlet', direction, frame, i, 0);
                const channel = direction % 2 === 0 ? pixel('ditch', 10, frame, 0, i) : pixel('ditch', 5, frame, i, 0);
                expect(water(mouth), `inlet ${direction}, frame ${frame}, cross-section ${i}`).toBe(water(channel));
                if (mouth[3]) occupied++;
            }
            expect(occupied).toBeGreaterThanOrEqual(2); expect(occupied).toBeLessThanOrEqual(3);
        }
    });
});
