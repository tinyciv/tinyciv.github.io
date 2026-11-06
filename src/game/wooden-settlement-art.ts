import { loadPunyWorld, punyWorldPixels, type PunyPixels } from './puny-world';
import { NATIVE_BUILDINGS, recolorPunyBuildingPixels } from './puny-building-art';

export const WOODEN_SETTLEMENT_SIZE = [32, 32] as const;
export const WOODEN_SETTLEMENT_ANCHOR = [16, 32] as const;
/** Roof pixels recolored in approved 4B; neutral shadows and timber stay untouched. */
const ROOF_ROWS: readonly (readonly [number, readonly (readonly [number, number])[]])[] = [
    [0, [[6, 1], [15, 2], [25, 1]]],
    [1, [[5, 3], [14, 4], [24, 3]]],
    [2, [[5, 3], [13, 6], [24, 3]]],
    [3, [[4, 5], [12, 8], [23, 5]]],
    [4, [[3, 7], [11, 10], [22, 7]]],
    [5, [[3, 7], [11, 10], [22, 7]]],
    [6, [[2, 7], [10, 12], [23, 7]]],
    [7, [[2, 4], [7, 1], [9, 14], [24, 1], [26, 4]]],
    [8, [[2, 3], [9, 14], [27, 3]]],
    [9, [[2, 2], [8, 16], [28, 2]]],
    [10, [[8, 7], [17, 7]]],
    [11, [[8, 6], [18, 6]]],
    [12, [[8, 5], [19, 5]]],
    [13, [[8, 4], [20, 4]]],
    [14, [[9, 2], [21, 2]]],
    [15, [[9, 1], [22, 1]]],
    [16, [[6, 1], [25, 1]]],
    [17, [[5, 3], [24, 3]]],
    [18, [[5, 3], [24, 3]]],
    [19, [[4, 5], [15, 2], [23, 5]]],
    [20, [[3, 7], [15, 2], [22, 7]]],
    [21, [[3, 7], [14, 4], [22, 7]]],
    [22, [[2, 9], [13, 6], [21, 9]]],
    [23, [[2, 4], [7, 4], [13, 6], [21, 4], [26, 4]]],
    [24, [[2, 3], [8, 3], [12, 8], [21, 3], [27, 3]]],
    [25, [[2, 2], [9, 2], [12, 8], [21, 2], [28, 2]]],
    [26, [[12, 3], [17, 3]]],
    [27, [[12, 2], [18, 2]]],
];
export const WOODEN_SETTLEMENT_ROOF_PIXELS: readonly number[] = Object.freeze(ROOF_ROWS.flatMap(([y, runs]) =>
    runs.flatMap(([x, width]) => Array.from({ length: width }, (_, offset) => y * 32 + x + offset))));
function normalizedColor(color: string): string {
    const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(color);
    return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
        : /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : '#3988ff';
}

/** Use the matching Puny keep pixels for faction shading. The approved 4B
 * geometry matches that keep exactly; only the reviewed thatch mask is tinted. */
export function recolorWoodenSettlementPixels(source: PunyPixels, atlas: PunyPixels, color: string): PunyPixels {
    if (source.width !== 32 || source.height !== 32) throw new RangeError('Invalid wooden settlement cell.');
    const data = new Uint8ClampedArray(source.data);
    const target = recolorPunyBuildingPixels(atlas, NATIVE_BUILDINGS.palace.rect, normalizedColor(color));
    for (const pixel of WOODEN_SETTLEMENT_ROOF_PIXELS) {
        const offset = pixel * 4;
        data.set(target.data.subarray(offset, offset + 3), offset);
    }
    return { width: 32, height: 32, data };
}

let source: PunyPixels | undefined;
let loading: Promise<void> | undefined;
const sprites = new Map<string, HTMLCanvasElement>();
export function loadWoodenSettlementArt(): Promise<void> {
    return loading ??= (async () => {
        await loadPunyWorld();
        const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/buildings/wooden-settlement.png`;
        await image.decode();
        if (image.naturalWidth !== 32 || image.naturalHeight !== 32) throw new Error('Invalid wooden settlement artwork.');
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
        const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0);
        source = { width: 32, height: 32, data: c.getImageData(0, 0, 32, 32).data };
    })();
}

export function drawWoodenSettlement(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
    if (!source) return;
    const faction = normalizedColor(color);
    let sprite = sprites.get(faction);
    if (!sprite) {
        sprite = document.createElement('canvas'); sprite.width = 32; sprite.height = 32;
        const context = sprite.getContext('2d')!, pixels = context.createImageData(32, 32);
        pixels.data.set(recolorWoodenSettlementPixels(source, punyWorldPixels()!, faction).data);
        context.putImageData(pixels, 0, 0); sprites.set(faction, sprite);
    }
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(sprite, x, y, size, size); c.restore();
}
