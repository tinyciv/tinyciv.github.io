import { describe, expect, it } from 'vitest';
import { FOG_MASK_SCALE, FOG_MEMORY_ALPHA, FOG_RETURN_DELAY, FOG_RETURN_FADE, FOG_REVEAL_FADE, fogRenderMask, fogRevealMask, pointInSight, type FogRevealMask, type FogView } from '../src/game/fog';

function view(width = 8, height = 8): FogView {
    return { width, height, visible: new Uint8Array(width * height), explored: Array(width * height).fill(0), sources: [], buildings: [], fields: [], revision: 1, explorationRevision: 1 };
}
const sample = (mask: FogRevealMask, x: number, y: number): number => mask.alpha[Math.floor(y * mask.scale) * mask.width + Math.floor(x * mask.scale)];
function reveal(fog: FogView, left: number, top: number, right: number, bottom: number) {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) fog.visible[y * fog.width + x] = fog.explored[y * fog.width + x] = 1;
}

describe('pillowy fog presentation', () => {
    it('feathers inside known frontier cells while keeping interiors flat and unknown cells opaque', () => {
        const fog = view(); reveal(fog, 2, 2, 5, 5);
        const mask = fogRenderMask(fog), revealMask = fogRevealMask(fog);
        expect(mask.scale).toBe(FOG_MASK_SCALE);
        expect(sample(mask, 3.5, 3.5)).toBe(0);
        const edge = [2.01, 2.15, 2.28, 2.45, 2.55].map(x => sample(mask, x, 3.5));
        expect(edge[0]).toBe(255);
        expect(edge[1]).toBeGreaterThan(edge[2]); expect(edge[2]).toBeGreaterThan(0);
        expect(edge.slice(-2)).toEqual([0, 0]);
        for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
            const visible = pointInSight(fog, (x + .5) / mask.scale, (y + .5) / mask.scale);
            if (!visible) { expect(mask.alpha[y * mask.width + x]).toBe(255); expect(revealMask.alpha[y * mask.width + x]).toBe(0); }
        }
        // Softness never changes the logical visibility of any part of a cell.
        expect(pointInSight(fog, 2.001, 3.5)).toBe(true);
        expect(pointInSight(fog, 1.999, 3.5)).toBe(false);
    });

    it('rounds exposed corners without drawing seams between adjacent known cells', () => {
        const fog = view(); reveal(fog, 2, 2, 5, 5); const mask = fogRenderMask(fog);
        expect(sample(mask, 2.2, 2.2)).toBeGreaterThan(sample(mask, 2.2, 3.5));
        expect(sample(mask, 3.99, 3.5)).toBe(0); expect(sample(mask, 4.01, 3.5)).toBe(0);
        expect(sample(mask, 2.2, 2.2)).toBe(sample(mask, 5.8, 2.2));
        expect(sample(mask, 2.2, 2.2)).toBe(sample(mask, 2.2, 5.8));
    });

    it('retains flat shaded memory and softens the current sight boundary above it', () => {
        const fog = view(); fog.explored.fill(1); reveal(fog, 2, 2, 5, 5);
        const mask = fogRenderMask(fog);
        expect(sample(mask, .5, .5)).toBe(FOG_MEMORY_ALPHA);
        expect(sample(mask, 2.01, 3.5)).toBe(FOG_MEMORY_ALPHA);
        expect(sample(mask, 2.2, 3.5)).toBeLessThan(FOG_MEMORY_ALPHA);
        expect(sample(mask, 2.2, 3.5)).toBeGreaterThan(0);
        expect(sample(mask, 3.5, 3.5)).toBe(0);
    });

    it('keeps all hidden-side interpolation samples opaque, including diagonal holes', () => {
        const fog = view(); fog.visible.fill(1); fog.explored.fill(1);
        fog.visible[3 * fog.width + 3] = fog.explored[3 * fog.width + 3] = 0;
        const mask = fogRenderMask(fog);
        // Canvas bilinear sampling uses the four surrounding texel centers.
        const interpolated = (x: number, y: number): number => {
            const px = x * mask.scale - .5, py = y * mask.scale - .5, ix = Math.floor(px), iy = Math.floor(py), tx = px - ix, ty = py - iy;
            const at = (dx: number, dy: number) => mask.alpha[(iy + dy) * mask.width + ix + dx];
            return at(0, 0) * (1 - tx) * (1 - ty) + at(1, 0) * tx * (1 - ty) + at(0, 1) * (1 - tx) * ty + at(1, 1) * tx * ty;
        };
        for (const x of [3.0001, 3.01, 3.5, 3.99, 3.9999]) for (const y of [3.0001, 3.01, 3.5, 3.99, 3.9999])
            expect(interpolated(x, y)).toBeCloseTo(255, 10);
        expect(sample(mask, 2.9, 2.9)).toBeGreaterThan(sample(mask, 2.5, 2.5));
    });

    it('reuses buffers until a visibility or exploration revision changes and handles world edges', () => {
        const fog = view(); reveal(fog, 0, 0, 3, 3); const mask = fogRenderMask(fog), alpha = mask.alpha;
        expect(sample(mask, .01, .01)).toBe(0);
        expect(fogRenderMask(fog)).toBe(mask); expect(fogRevealMask(fog)).toBe(fogRevealMask(fog));
        fog.visible.fill(0); fog.revision++;
        expect(fogRenderMask(fog)).toBe(mask); expect(mask.alpha).toBe(alpha);
        expect(sample(mask, .5, .5)).toBe(FOG_MEMORY_ALPHA);
        fog.explored.fill(1); fog.explorationRevision++;
        expect(sample(fogRenderMask(fog), 7.5, 7.5)).toBe(FOG_MEMORY_ALPHA);
    });
});

describe('sticky fog presentation', () => {
    const advance = (fog: FogView, time: number) => { fog.presentationTime = time; return fogRenderMask(fog); };

    it('holds clear terrain before gradually returning memory fog without extending enemy sight', () => {
        const fog = view(); fog.presentationTime = 0; reveal(fog, 0, 0, 7, 7);
        const mask = fogRenderMask(fog), revision = mask.revision;
        fog.visible.fill(0); fog.revision++;
        expect(sample(advance(fog, .1), 3.5, 3.5)).toBe(0);
        expect(pointInSight(fog, 3.5, 3.5)).toBe(false);
        expect(sample(advance(fog, .1 + FOG_RETURN_DELAY - .05), 3.5, 3.5)).toBe(0);
        expect(mask.revision).toBe(revision);
        const middle = sample(advance(fog, .1 + FOG_RETURN_DELAY + FOG_RETURN_FADE / 2), 3.5, 3.5);
        expect(middle).toBeGreaterThan(0); expect(middle).toBeLessThan(FOG_MEMORY_ALPHA);
        expect(sample(advance(fog, .11 + FOG_RETURN_DELAY + FOG_RETURN_FADE), 3.5, 3.5)).toBe(FOG_MEMORY_ALPHA);
        expect(mask.revision).toBeGreaterThan(revision!);
    });

    it('does not pulse dark during repeated brief losses at a moving scout frontier', () => {
        const fog = view(); fog.presentationTime = 0; reveal(fog, 0, 0, 7, 7);
        const mask = fogRenderMask(fog), revision = mask.revision;
        for (let step = 1; step <= 20; step++) {
            fog.visible.fill(step % 2 ? 0 : 1); fog.revision++;
            expect(sample(advance(fog, step * .2), 3.5, 3.5)).toBe(0);
        }
        expect(mask.revision).toBe(revision);
    });

    it('reveals new sight smoothly and keeps paused or sub-frame calls stable', () => {
        const fog = view(); fog.presentationTime = 0; fog.explored.fill(1);
        const mask = fogRenderMask(fog);
        fog.visible.fill(1); fog.revision++;
        expect(sample(advance(fog, .1), 3.5, 3.5)).toBe(FOG_MEMORY_ALPHA);
        const middle = sample(advance(fog, .1 + FOG_REVEAL_FADE / 2), 3.5, 3.5), revision = mask.revision;
        expect(middle).toBeGreaterThan(0); expect(middle).toBeLessThan(FOG_MEMORY_ALPHA);
        expect(sample(advance(fog, .1 + FOG_REVEAL_FADE / 2), 3.5, 3.5)).toBe(middle);
        expect(sample(advance(fog, .1 + FOG_REVEAL_FADE / 2 + .001), 3.5, 3.5)).toBe(middle);
        expect(mask.revision).toBe(revision);
        expect(sample(advance(fog, .11 + FOG_REVEAL_FADE), 3.5, 3.5)).toBe(0);
    });

    it('clears every owned-cell sample immediately, including frontier corners', () => {
        const fog = view(); fog.presentationTime = 0;
        const mask = fogRenderMask(fog);
        fog.owned = new Uint8Array(64); fog.owned[3 * 8 + 3] = 1;
        fog.visible[3 * 8 + 3] = fog.explored[3 * 8 + 3] = 1;
        fog.revision++; fog.explorationRevision++;
        advance(fog, .1);
        for (let sy = 0; sy < mask.scale; sy++) for (let sx = 0; sx < mask.scale; sx++) {
            const i = (3 * mask.scale + sy) * mask.width + 3 * mask.scale + sx;
            expect(mask.alpha[i]).toBe(0); expect(fogRevealMask(fog).alpha[i]).toBe(255);
        }
        expect(sample(mask, 2.5, 3.5)).toBe(255);
    });

    it('limits animation updates despite continuously changing LOS but never delays a new owned claim', () => {
        const fog = view(); fog.presentationTime = 0; reveal(fog, 0, 0, 7, 7);
        const mask = fogRenderMask(fog);
        fog.visible.fill(0); fog.revision++; advance(fog, .05);
        const alpha = sample(advance(fog, 1.55), 3.5, 3.5), revision = mask.revision;
        expect(alpha).toBeGreaterThan(0);
        for (const delta of [.001, .01, .02, .03, .049]) {
            fog.visible[0] = Number(!fog.visible[0]); fog.revision++;
            expect(sample(advance(fog, 1.55 + delta), 3.5, 3.5)).toBe(alpha);
            expect(mask.revision).toBe(revision);
        }
        expect(sample(advance(fog, 1.60), 3.5, 3.5)).toBeGreaterThan(alpha);
        fog.owned = new Uint8Array(64); fog.owned[3 * 8 + 3] = 1;
        fog.visible[3 * 8 + 3] = 1; fog.ownershipRevision = 1; fog.revision++;
        expect(sample(advance(fog, 1.601), 3.5, 3.5)).toBe(0);
    });
});


describe('incremental fog mask updates', () => {
    it('matches a fresh full mask after local sight, memory and ownership edits', () => {
        const fog = view(28, 24); fog.owned = new Uint8Array(fog.visible.length);
        const mask = fogRenderMask(fog);
        let previous = mask.alpha.slice(), revision = mask.revision;
        for (let step = 0; step < 16; step++) {
            const x = 2 + step, y = 5 + step % 4, cell = y * fog.width + x;
            fog.visible[cell] = step % 3 ? 1 : 0;
            fog.explored[cell] = 1; fog.owned[cell] = Number(step % 4 === 0);
            if (fog.owned[cell]) fog.visible[cell] = 1;
            fog.revision++; fog.explorationRevision++;
            const next = fogRenderMask(fog);
            const fresh = fogRenderMask({ ...fog, visible: fog.visible.slice(), explored: [...fog.explored], owned: fog.owned.slice() });
            expect(next.alpha).toEqual(fresh.alpha);
            expect(next.previousRevision).toBe(revision);
            expect(next.dirtyCells!.length).toBeLessThanOrEqual(9);
            // A texture consumer can reconstruct the complete new mask from
            // only these cells, including neighboring softened corners.
            for (const index of next.dirtyCells!) {
                const cx = index % fog.width, cy = Math.floor(index / fog.width);
                for (let sy = 0; sy < next.scale; sy++) {
                    const offset = (cy * next.scale + sy) * next.width + cx * next.scale;
                    previous.set(next.alpha.subarray(offset, offset + next.scale), offset);
                }
            }
            expect(previous).toEqual(next.alpha);
            revision = next.revision;
        }
    });

    it('keeps texture revisions stable when source revisions do not change cell appearance', () => {
        const fog = view(); reveal(fog, 2, 2, 5, 5);
        const mask = fogRenderMask(fog), revision = mask.revision, alpha = mask.alpha.slice();
        fog.revision++;
        expect(fogRenderMask(fog).revision).toBe(revision);
        expect(mask.alpha).toEqual(alpha);
    });

    it('catches up when reveal-mask reads advance past a transition target revision', () => {
        const fog = view(16, 16); fog.presentationTime = 0; fogRenderMask(fog);
        reveal(fog, 2, 2, 4, 4); fog.revision++; fogRevealMask(fog);
        reveal(fog, 10, 10, 12, 12); fog.revision++; fogRevealMask(fog);
        fog.presentationTime = .1; fogRenderMask(fog);
        fog.presentationTime = .5;
        const result = fogRenderMask(fog);
        expect(result.alpha).toEqual(fogRenderMask({ ...fog, presentationTime: undefined }).alpha);
    });
});
