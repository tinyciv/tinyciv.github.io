import { WATER, type Tile } from './types';

const TILE_PIXELS = 16;
export const ROCKY_DEPOSIT_VARIANTS = 8;
const VARIANT_MASK = ROCKY_DEPOSIT_VARIANTS - 1;
const ATLAS_WIDTH = TILE_PIXELS * ROCKY_DEPOSIT_VARIANTS;
let groundPixels: Uint8ClampedArray;
let groundImage: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadRockyDepositArt(): Promise<void> {
    return loading ??= (async () => {
        const image = new Image();
        image.src = `${import.meta.env.BASE_URL}assets/resources/ore-formations/rocky-deposits.webp`;
        await image.decode();
        if (image.naturalWidth !== ATLAS_WIDTH || image.naturalHeight !== 2 * TILE_PIXELS)
            throw new Error('Invalid rocky deposit atlas');
        const canvas = document.createElement('canvas');
        canvas.width = ATLAS_WIDTH;
        canvas.height = TILE_PIXELS;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        groundPixels = context.getImageData(0, 0, ATLAS_WIDTH, TILE_PIXELS).data;
        groundImage = image;
    })();
}

/** Broken slate on the floor of dry stone quarries. */
export function rockyGroundVariant(tile: Tile): number {
    if (tile.resource !== 'stone' || tile.creek || tile.relief
        || WATER.has(tile.terrain)) return -1;
    return Math.floor(tile.variation * ROCKY_DEPOSIT_VARIANTS) & VARIANT_MASK;
}

export function drawRockyGround(c: CanvasRenderingContext2D, variant: number, size: number): void {
    if (groundImage) c.drawImage(groundImage, variant * TILE_PIXELS, 0, TILE_PIXELS, TILE_PIXELS, 0, 0, size, size);
}

/** Paint only opaque rock pixels, leaving the original terrain between chips. */
export function paintRockyGround(pixels: Uint8ClampedArray, offset: number, width: number, variant: number): void {
    if (!groundPixels) return;
    for (let y = 0; y < TILE_PIXELS; y++) for (let x = 0; x < TILE_PIXELS; x++) {
        const source = (y * ATLAS_WIDTH + variant * TILE_PIXELS + x) * 4;
        if (!groundPixels[source + 3]) continue;
        const target = offset + (y * width + x) * 4;
        pixels[target] = groundPixels[source];
        pixels[target + 1] = groundPixels[source + 1];
        pixels[target + 2] = groundPixels[source + 2];
    }
}
