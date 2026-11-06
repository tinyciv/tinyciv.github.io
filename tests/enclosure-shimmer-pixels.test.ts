import { describe, expect, it, vi } from 'vitest';
import { ENCLOSURE_SHIMMER, forEachEnclosureShimmerSpan, type PalaceEnclosures } from '../src/game/enclosures';
import type { FogView } from '../src/game/fog';
import type { GameState } from '../src/game/types';

describe('retained enclosure shimmer sweep', () => {
    it.each([0, 1, 6, 20])('preserves every approved two-pixel alpha at time %s', time => {
        const width = 8, height = 8, cells = Array.from({ length: width * height }, (_, index) => index);
        const enclosures: PalaceEnclosures = { width, height, cells, regions: [{ faction: 0, palaces: [1], cells }], byFaction: new Map() };
        const visible = new Uint8Array(cells.length).fill(1); visible[13] = 0;
        const fog = { width, height, visible } as FogView;
        const pixels = new Uint8Array(width * 16 * height * 16), expected = new Uint8Array(pixels.length);
        const exp = vi.spyOn(Math, 'exp');
        forEachEnclosureShimmerSpan({} as GameState, fog, 0, 0, 32, time, undefined, (x, y, span, _height, alpha) => {
            for (let dx = 0; dx < span; dx += 2) pixels[y / 2 * width * 16 + (x + dx) / 2] = Math.round(alpha * 255);
        }, enclosures);
        // Shared diagonals use hundreds of exponentials instead of 16,384
        // separate wash calculations, plus individual glint calculations.
        expect(exp.mock.calls.length).toBeLessThan(600);
        exp.mockRestore();
        const animationTime = time * ENCLOSURE_SHIMMER.speed;
        const min = -(height * 32 - 2) / Math.SQRT2, max = (width * 32 - 2) / Math.SQRT2;
        const span = max - min + 56, start = 28 + (max - min) * .3;
        const front = min - 28 + ((animationTime * 42 + start) % span + span) % span;
        const gaussian = (distance: number, width: number) => Math.abs(distance) > width * 3 ? 0 : Math.exp(-.5 * (distance / width) ** 2);
        // Evaluate the original approved formula independently at each sample.
        for (let y = 0; y < height * 32; y += 2) for (let x = 0; x < width * 32; x += 2) {
            if (!visible[Math.floor(y / 32) * width + Math.floor(x / 32)]) continue;
            let hash = Math.imul(x + 91, 374761393) ^ Math.imul(y + 17, 668265263);
            hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
            const delta = (x - y) / Math.SQRT2 - front, seed = (hash % 997) / 997;
            const wash = .045 * gaussian(delta, 34);
            const spark = hash % 31 === 0 ? .38 * gaussian(delta, 20) * (.65 + .35 * Math.sin(animationTime * 3.2 + seed * 6.28) ** 2) : 0;
            expected[y / 2 * width * 16 + x / 2] = Math.round(Math.min(.78, (wash + spark) * ENCLOSURE_SHIMMER.intensity) * 255);
        }
        expect(pixels).toEqual(expected);
    });
});
