import type { FogView } from './fog';
import { visibleReliefStamps } from './relief-art';
import type { World } from './types';
import { worldRevisions } from './world-revisions';

const SCALE = 8, CLOSE_RADIUS = 1.5 * SCALE, FEATHER = .9 * SCALE, PAD = 4;
const DIAGONAL = Math.SQRT2;

/** Distance to the nearest marked sample, with bounded, linear raster passes. */
function distanceTo(mask: Uint8Array, marked: number, width: number, height: number, distance: Float32Array): void {
    for (let i = 0; i < mask.length; i++) distance[i] = mask[i] === marked ? 0 : Infinity;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        let d = distance[i];
        if (x) d = Math.min(d, distance[i - 1] + 1);
        if (y) {
            d = Math.min(d, distance[i - width] + 1);
            if (x) d = Math.min(d, distance[i - width - 1] + DIAGONAL);
            if (x + 1 < width) d = Math.min(d, distance[i - width + 1] + DIAGONAL);
        }
        distance[i] = d;
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        let d = distance[i];
        if (x + 1 < width) d = Math.min(d, distance[i + 1] + 1);
        if (y + 1 < height) {
            d = Math.min(d, distance[i + width] + 1);
            if (x) d = Math.min(d, distance[i + width - 1] + DIAGONAL);
            if (x + 1 < width) d = Math.min(d, distance[i + width + 1] + DIAGONAL);
        }
        distance[i] = d;
    }
}

/** Ground-only horizon reveal. Join nearby slopes, fill enclosed black holes,
 * and feather the resulting outline; no gameplay visibility is modified. */
export class ReliefFogArt {
    private canvas = document.createElement('canvas');
    private pixels?: ImageData;
    private support = new Uint8Array(0);
    private exterior = new Uint8Array(0);
    private queue = new Int32Array(0);
    private distance = new Float32Array(0);
    private key: readonly unknown[] = [];

    mask(world: World, fog: FogView, left: number, top: number, right: number, bottom: number,
        landmarkVisible: (cell: number) => boolean): HTMLCanvasElement {
        const key = [world, world.tiles, world.seed, worldRevisions(world).geometry, fog.sources, left, top, right, bottom];
        if (key.every((value, i) => value === this.key[i])) return this.canvas;
        this.key = key;
        const width = (right - left + PAD * 2) * SCALE, height = (bottom - top + PAD * 2) * SCALE;
        const count = width * height, ox = left - PAD, oy = top - PAD;
        if (this.support.length !== count || this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width; this.canvas.height = height;
            this.pixels = this.canvas.getContext('2d')!.createImageData(width, height);
            this.support = new Uint8Array(count); this.exterior = new Uint8Array(count);
            this.queue = new Int32Array(count); this.distance = new Float32Array(count);
        }
        const support = this.support, distance = this.distance;
        support.fill(0);
        const fill = (x: number, y: number, w: number, h: number) => {
            const x0 = Math.max(0, Math.floor((x - ox) * SCALE)), x1 = Math.min(width, Math.ceil((x + w - ox) * SCALE));
            const y0 = Math.max(0, Math.floor((y - oy) * SCALE)), y1 = Math.min(height, Math.ceil((y + h - oy) * SCALE));
            for (let row = y0; row < y1; row++) support.fill(1, row * width + x0, row * width + x1);
        };
        for (let y = Math.max(0, oy); y < Math.min(world.height, bottom + PAD); y++)
            for (let x = Math.max(0, ox); x < Math.min(world.width, right + PAD); x++) {
                const cell = y * world.width + x;
                if (world.tiles[cell].relief && landmarkVisible(cell)) fill(x, y, 1, 1);
            }
        for (const stamp of visibleReliefStamps(world, ox, oy, right + PAD, bottom + PAD))
            if (landmarkVisible(stamp.cell)) fill(stamp.x, stamp.y, stamp.width, stamp.height);

        // Closing bridges the spaces between staggered rows of hill artwork.
        distanceTo(support, 1, width, height, distance);
        for (let i = 0; i < count; i++) support[i] = Number(distance[i] <= CLOSE_RADIUS);
        // Preserve only exterior fog. Enclosed holes belong to the same patch.
        const exterior = this.exterior, queue = this.queue;
        exterior.fill(0);
        let head = 0, tail = 0;
        const visit = (i: number) => {
            if (!support[i] && !exterior[i]) { exterior[i] = 1; queue[tail++] = i; }
        };
        for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
        for (let y = 1; y < height - 1; y++) { visit(y * width); visit(y * width + width - 1); }
        while (head < tail) {
            const i = queue[head++], x = i % width;
            if (x) visit(i - 1);
            if (x + 1 < width) visit(i + 1);
            if (i >= width) visit(i - width);
            if (i + width < count) visit(i + width);
        }
        // Distance from exterior fog makes one rounded, soft outline instead of
        // feathering every individual tile or leaving rectangular stamp edges.
        distanceTo(exterior, 1, width, height, distance);
        const pixels = this.pixels!;
        for (let i = 0; i < count; i++) {
            const t = Math.max(0, Math.min(1, (distance[i] - CLOSE_RADIUS + FEATHER + SCALE * .5) / FEATHER));
            pixels.data[i * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t));
        }
        this.canvas.getContext('2d')!.putImageData(pixels, 0, 0);
        return this.canvas;
    }

    paintMask(c: CanvasRenderingContext2D, mask: HTMLCanvasElement, tileSize: number): void {
        c.imageSmoothingEnabled = true;
        c.drawImage(mask, PAD * SCALE, PAD * SCALE, mask.width - PAD * SCALE * 2, mask.height - PAD * SCALE * 2,
            0, 0, (mask.width / SCALE - PAD * 2) * tileSize, (mask.height / SCALE - PAD * 2) * tileSize);
    }
}
