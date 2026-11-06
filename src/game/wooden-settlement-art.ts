import { loadPunyWorld, punyWorldPixels, type PunyPixels } from './puny-world';
import { NATIVE_BUILDINGS, recolorPunyBuildingPixels } from './puny-building-art';

export const WOODEN_SETTLEMENT_SIZE = [32, 34] as const;
export const WOODEN_SETTLEMENT_ANCHOR = [16, 32] as const;
const SOURCE_BLUE = '#3988ff';
/** Reviewed native roof spans from the approved 1B export; timber and alpha are excluded. */
const ROOF_ROWS: readonly (readonly [number, readonly (readonly [number, number])[]])[] = [
    [0, [[6, 1], [15, 2], [25, 1]]],
    [1, [[5, 3], [14, 4], [24, 3]]],
    [2, [[4, 5], [13, 6], [23, 5]]],
    [3, [[3, 7], [12, 8], [22, 7]]],
    [4, [[2, 28]]],
    [5, [[2, 28]]],
    [6, [[2, 28]]],
    [7, [[2, 4], [7, 18], [26, 4]]],
    [8, [[2, 3], [8, 16], [27, 3]]],
    [9, [[2, 2], [8, 16], [28, 2]]],
    [10, [[8, 7], [17, 7]]],
    [11, [[8, 6], [18, 6]]],
    [12, [[8, 5], [19, 5]]],
    [13, [[8, 4], [20, 4]]],
    [14, [[8, 3], [21, 3]]],
    [15, [[8, 2], [22, 2]]],
    [16, [[6, 1], [8, 1], [23, 1], [25, 1]]],
    [17, [[5, 3], [24, 3]]],
    [18, [[4, 5], [23, 5]]],
    [19, [[3, 7], [15, 2], [22, 7]]],
    [20, [[2, 9], [14, 4], [21, 9]]],
    [21, [[2, 9], [13, 6], [21, 9]]],
    [22, [[2, 9], [12, 8], [21, 9]]],
    [23, [[2, 4], [7, 4], [12, 8], [21, 4], [26, 4]]],
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
        : /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : SOURCE_BLUE;
}

/** Pure roof recoloring. Source blue is byte-exact; all other factions share
 * the existing Puny house ramp while preserving every nonroof and alpha byte. */
export function recolorWoodenSettlementPixels(source: PunyPixels, atlas: PunyPixels, color: string): PunyPixels {
    if (source.width !== 32 || source.height !== 34) throw new RangeError('Invalid wooden settlement cell.');
    const data = new Uint8ClampedArray(source.data), faction = normalizedColor(color);
    if (faction === SOURCE_BLUE) return { width: 32, height: 34, data };
    const rect = NATIVE_BUILDINGS.houses[2].rect;
    const blue = recolorPunyBuildingPixels(atlas, rect, SOURCE_BLUE), target = recolorPunyBuildingPixels(atlas, rect, faction);
    const shades = new Map<string, { blue: number[]; target: number[] }>();
    for (let pixel = 0; pixel < blue.teamMask.length; pixel++) if (blue.teamMask[pixel]) {
        const offset = pixel * 4, rgb = [...blue.data.subarray(offset, offset + 3)];
        shades.set(rgb.join(','), { blue: rgb, target: [...target.data.subarray(offset, offset + 3)] });
    }
    const palette = [...shades.values()], mapped = new Map<string, number[]>();
    for (const pixel of WOODEN_SETTLEMENT_ROOF_PIXELS) {
        const offset = pixel * 4, rgb = [...source.data.subarray(offset, offset + 3)], key = rgb.join(',');
        let shade = mapped.get(key);
        if (!shade) {
            let best = palette[0], distance = Infinity;
            for (const candidate of palette) {
                const error = candidate.blue.reduce((sum, value, channel) => sum + (value - rgb[channel]) ** 2, 0);
                if (error < distance) { best = candidate; distance = error; }
            }
            shade = best.target; mapped.set(key, shade);
        }
        data.set(shade, offset);
    }
    return { width: 32, height: 34, data };
}

let original: HTMLImageElement | undefined;
let source: PunyPixels | undefined;
let loading: Promise<void> | undefined;
const sprites = new Map<string, HTMLCanvasElement>();
export function loadWoodenSettlementArt(): Promise<void> {
    return loading ??= (async () => {
        await loadPunyWorld();
        const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/buildings/wooden-settlement.png`;
        await image.decode();
        if (image.naturalWidth !== 32 || image.naturalHeight !== 34) throw new Error('Invalid wooden settlement artwork.');
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 34;
        const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0);
        source = { width: 32, height: 34, data: c.getImageData(0, 0, 32, 34).data }; original = image;
    })();
}

export function drawWoodenSettlement(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
    if (!original || !source) return;
    const faction = normalizedColor(color);
    let image: HTMLImageElement | HTMLCanvasElement = original;
    if (faction !== SOURCE_BLUE) {
        let sprite = sprites.get(faction);
        if (!sprite) {
            sprite = document.createElement('canvas'); sprite.width = 32; sprite.height = 34;
            const context = sprite.getContext('2d')!, pixels = context.createImageData(32, 34);
            pixels.data.set(recolorWoodenSettlementPixels(source, punyWorldPixels()!, faction).data);
            context.putImageData(pixels, 0, 0); sprites.set(faction, sprite);
        }
        image = sprite;
    }
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(image, x, y, size, size * 34 / 32); c.restore();
}
