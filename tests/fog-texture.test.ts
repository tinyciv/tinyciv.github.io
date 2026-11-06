import { describe, expect, it } from 'vitest';
import { fogRenderMask, type FogView } from '../src/game/fog';
import { Renderer } from '../src/game/renderer';

function textureFixture() {
    const fog: FogView = { width: 20, height: 16, visible: new Uint8Array(320), explored: Array(320).fill(0),
        sources: [], buildings: [], fields: [], revision: 1, explorationRevision: 1 };
    let texture = new Uint8ClampedArray(0);
    const uploads: { x: number; y: number; width: number; height: number }[] = [];
    const context = {
        createImageData(width: number, height: number) {
            texture = new Uint8ClampedArray(width * height * 4);
            return { width, height, data: new Uint8ClampedArray(width * height * 4) };
        },
        putImageData(pixels: ImageData, _x: number, _y: number, x = 0, y = 0, width = pixels.width, height = pixels.height) {
            uploads.push({ x, y, width, height });
            for (let row = y; row < y + height; row++) {
                const start = (row * pixels.width + x) * 4;
                texture.set(pixels.data.subarray(start, start + width * 4), start);
            }
        },
    };
    const renderer = Object.assign(Object.create(Renderer.prototype), {
        fogCanvas: { width: 0, height: 0, getContext: () => context }, fogRevision: -1,
    }) as { prepareFog(fog: FogView): void };
    const assertTexture = () => {
        const alpha = fogRenderMask(fog).alpha;
        expect(Uint8ClampedArray.from(alpha, (_, i) => texture[i * 4 + 3])).toEqual(alpha);
    };
    const reveal = (x: number, y: number) => {
        fog.visible[y * fog.width + x] = fog.explored[y * fog.width + x] = 1;
        fog.revision++; fog.explorationRevision++;
    };
    return { fog, renderer, uploads, reveal, assertTexture };
}

describe('incremental fog texture uploads', () => {
    it('uploads only changed row spans while preserving the full image', () => {
        const { fog, renderer, uploads, reveal, assertTexture } = textureFixture();
        renderer.prepareFog(fog); assertTexture(); uploads.length = 0;
        reveal(5, 6); renderer.prepareFog(fog); assertTexture();
        expect(uploads).toHaveLength(3);
        expect(uploads.reduce((area, rect) => area + rect.width * rect.height, 0)).toBe(9 * 8 * 8);
        uploads.length = 0; renderer.prepareFog(fog);
        expect(uploads).toHaveLength(0);
    });

    it('fully catches up after skipped mask revisions and a replacement view', () => {
        const { fog, renderer, uploads, reveal, assertTexture } = textureFixture();
        renderer.prepareFog(fog); uploads.length = 0;
        reveal(5, 6); fogRenderMask(fog);
        reveal(12, 10); fogRenderMask(fog);
        renderer.prepareFog(fog); assertTexture();
        expect(uploads).toEqual([{ x: 0, y: 0, width: 160, height: 128 }]);
        uploads.length = 0;
        renderer.prepareFog({ ...fog });
        expect(uploads).toEqual([{ x: 0, y: 0, width: 160, height: 128 }]);
    });
});
