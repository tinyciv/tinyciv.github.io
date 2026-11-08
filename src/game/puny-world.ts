import { loadTundraArt } from './tundra-art';
import { loadDesertStoneArt } from './desert-stone-art';
import { loadCreekArt } from './creek-art';

/** Shade's unmodified CC0 Puny World atlas. All coordinates are native pixels. */
export interface PunyPixels { width: number; height: number; data: Uint8ClampedArray }
let atlas: HTMLImageElement | undefined;
let pixels: PunyPixels | undefined;
let desertLedges: PunyPixels | undefined;
let desertLedgeImage: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

function loadAtlas(file: string): Promise<{ image: HTMLImageElement; pixels: PunyPixels }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true })!;
            context.drawImage(image, 0, 0);
            resolve({ image, pixels: context.getImageData(0, 0, canvas.width, canvas.height) });
        };
        image.onerror = () => reject(new Error(`Puny World artwork could not be loaded: ${file}`));
        image.src = `${import.meta.env.BASE_URL}assets/puny-world/${file}`;
    });
}

export function loadPunyWorld(): Promise<void> {
    return loading ??= Promise.all([loadAtlas('overworld.png'), loadAtlas('desert-ledges.png'), loadCreekArt(), loadDesertStoneArt(), loadTundraArt()]).then(([original, desert]) => {
        if (desert.pixels.width !== 128 || desert.pixels.height !== 48) throw new Error('Invalid desert ledge sheet.');
        atlas = original.image;
        pixels = original.pixels;
        desertLedges = desert.pixels;
        desertLedgeImage = desert.image;
    });
}

export const punyWorldImage = () => atlas;
export const punyWorldPixels = () => pixels;
/** Approved 1A crop; original atlas coordinates begin at (0, 64). */
export const punyDesertLedgePixels = () => desertLedges;
export const punyDesertLedgeImage = () => desertLedgeImage;

export function drawPuny(c: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, x: number, y: number, w: number, h: number): boolean {
    if (!atlas) return false;
    c.drawImage(atlas, sx, sy, sw, sh, x, y, w, h);
    return true;
}
