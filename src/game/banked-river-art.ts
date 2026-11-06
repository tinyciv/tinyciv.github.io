import { tileAt, type Tile, type World } from './types';
import { drawPuny, punyWorldPixels, punyDesertLedgePixels, type PunyPixels } from './puny-world';

/** Approved 1A: original 16px waterfall with its full rocky flanks and foam. */
export const WATERFALL_SOURCE = [64, 352, 16, 16] as const;
export const WATERFALL_FRAME_SECONDS = .1;
const CHANNELS = [[0,208],[0,192],[16,208],[16,192],[0,160],[0,176],[16,160],[16,176],
    [48,208],[48,192],[32,208],[32,192],[48,160],[48,176],[32,160],[32,176]] as const;
const DIRECTIONS = [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]] as const;
export const bankedRiver = (tile: Tile | undefined): boolean => tile?.terrain === 'river' && (!!tile.waterfall || tile.riverArt === 'banked');
export const riverWaterPixel = (r: number, g: number, b: number): boolean => g > r + 20 && b > r + 20;

/** A waterfall's ports are strictly upstream/downstream. Flat reaches retain
 * the complete authored corner/junction set, including ordinary river mouths. */
export function bankedRiverSprite(world: World, x: number, y: number, frame = 0): readonly [number, number, number, number] | undefined {
    const tile = tileAt(world, x, y);
    if (!bankedRiver(tile)) return;
    frame = ((frame % 4) + 4) % 4;
    if (tile!.waterfall) return [64 + frame * 16, 352, 16, 16];
    let mask = 0;
    for (const [dx, dy, bit] of DIRECTIONS) {
        const neighbor = tileAt(world, x + dx, y + dy);
        if (!neighbor || !['river', 'lake', 'ocean', 'coast'].includes(neighbor.terrain)) continue;
        if (neighbor.waterfall && dx !== 0) continue;
        mask |= bit;
    }
    const [sx, sy] = CHANNELS[mask || 5];
    return [sx, sy + frame * 64, 16, 16];
}

interface SandSheet { source: PunyPixels; ledges: PunyPixels; pixels: PunyPixels; canvas?: HTMLCanvasElement }
let sandSheet: SandSheet | undefined;
const rgbKey = (r: number, g: number, b: number) => r * 65536 + g * 256 + b;

/** Reuse the already-approved desert ledge palette. Water, alpha and every
 * pixel position remain unchanged. Extra bank shades use the nearest existing
 * ledge color instead of inventing another desert material palette. */
export function bankedRiverPixels(source: PunyPixels, sand: boolean, desertLedges?: PunyPixels): PunyPixels {
    if (!sand || !desertLedges) return source;
    if (sandSheet?.source === source && sandSheet.ledges === desertLedges) return sandSheet.pixels;
    const palette = new Map<number, readonly [number, number, number]>();
    for (let y = 0; y < desertLedges.height; y++) for (let x = 0; x < desertLedges.width; x++) {
        const from = ((y + 64) * source.width + x) * 4, to = (y * desertLedges.width + x) * 4;
        if (!source.data[from + 3] || !desertLedges.data[to + 3]) continue;
        palette.set(rgbKey(source.data[from], source.data[from + 1], source.data[from + 2]),
            [desertLedges.data[to], desertLedges.data[to + 1], desertLedges.data[to + 2]]);
    }
    const choices = [...palette].map(([key, color]) => ({ source: [key >>> 16, key >>> 8 & 255, key & 255], color }));
    const data = new Uint8ClampedArray(source.data);
    for (const [sx, sy, width, height] of [[0,160,64,256],[64,352,64,16]])
        for (let y = sy; y < sy + height; y++) for (let x = sx; x < sx + width; x++) {
            const i = (y * source.width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
            if (!data[i + 3] || riverWaterPixel(r, g, b)) continue;
            const key = rgbKey(r, g, b);
            let color = palette.get(key);
            if (!color && choices.length) {
                let distance = Infinity;
                for (const choice of choices) {
                    const d = (r - choice.source[0]) ** 2 + (g - choice.source[1]) ** 2 + (b - choice.source[2]) ** 2;
                    if (d < distance) { distance = d; color = choice.color; }
                }
                palette.set(key, color!);
            }
            if (color) data.set(color, i);
        }
    const pixels = { width: source.width, height: source.height, data };
    sandSheet = { source, ledges: desertLedges, pixels };
    return pixels;
}

export function drawBankedRiver(c: CanvasRenderingContext2D, world: World, tx: number, ty: number,
    x: number, y: number, size: number, frame: number, sand: boolean): void {
    const rect = bankedRiverSprite(world, tx, ty, frame);
    if (!rect) return;
    const source = punyWorldPixels(), ledges = punyDesertLedgePixels();
    if (!sand || !source || !ledges) { drawPuny(c, ...rect, x, y, size, size); return; }
    const pixels = bankedRiverPixels(source, true, ledges);
    if (!sandSheet!.canvas) {
        const canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height;
        const context = canvas.getContext('2d')!, image = context.createImageData(pixels.width, pixels.height);
        image.data.set(pixels.data); context.putImageData(image, 0, 0); sandSheet!.canvas = canvas;
    }
    c.drawImage(sandSheet!.canvas, ...rect, x, y, size, size);
}
