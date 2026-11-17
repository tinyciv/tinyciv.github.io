import { runtimeArtUrl } from './runtime-art';
import type { Tile } from './types';

type GeothermalVariant = NonNullable<Tile['geothermal']>;
const files = ['volcano-a.png', 'volcano-b.png', 'volcano-c.png', 'mud-pool-a.png', 'mud-pool-b.png', 'mud-pool-c.png'];
const sheets = new Map<GeothermalVariant, HTMLImageElement>();
let loading: Promise<void> | undefined;

export function loadGeothermalArt(): Promise<void> {
    return loading ??= Promise.all(files.map(async (file, index) => {
        const image = new Image();
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/geothermal/${file}`);
        await image.decode();
        if (image.naturalWidth !== 288 || image.naturalHeight !== 32)
            throw new Error(`Invalid geothermal artwork: ${file}`);
        sheets.set((index + 1) as GeothermalVariant, image);
    })).then(() => undefined);
}

/** Presentation only: fixed native scale and a position-offset looping clock. */
export function geothermalFrame(variant: GeothermalVariant, time: number, x: number, y: number): number {
    return (Math.floor(time / (variant <= 3 ? .14 : .18)) + x * 7 + y * 13) % 9;
}

/** Steam occupies the top eight pixels of the doubled mud frames. Center the
 * pool body on the footprint while preserving the steam above its north edge. */
export const geothermalArtOffsetY = (variant: GeothermalVariant): number => variant >= 4 ? -8 : 0;

/** Native 32px art covers 2x2 world cells, just like a 32px building. The mask
 * clips each still-unexplored cell, including partially discovered footprints. */
export function drawGeothermal(c: CanvasRenderingContext2D, variant: GeothermalVariant, frame: number, exploredMask: number): void {
    const image = sheets.get(variant);
    if (!image) return;
    c.save(); c.imageSmoothingEnabled = false;
    if (exploredMask !== 15) {
        c.beginPath();
        for (let bit = 0; bit < 4; bit++) if (exploredMask & 1 << bit)
            c.rect(bit % 2 * 32, Math.floor(bit / 2) * 32 - geothermalArtOffsetY(variant), 32, 32);
        c.clip();
    }
    c.drawImage(image, frame * 32, 0, 32, 32, 0, 0, 64, 64);
    c.restore();
}
