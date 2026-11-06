import { tileAt, WATER, type World } from './types';
import type { PunyPixels } from './puny-world';

/** Existing four-pixel Puny water, before irrigation's three-pixel refinement. */
export const CREEK_NATIVE_WIDTH = 4;
const DIRECTIONS = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]] as const;
let channel: HTMLImageElement | undefined, mouth: HTMLImageElement | undefined;
let channelPixels: PunyPixels | undefined, mouthPixels: PunyPixels | undefined;
let loading: Promise<void> | undefined;

export function loadCreekArt(): Promise<void> {
    return loading ??= Promise.all([['ditch', 256], ['inlet', 64]].map(async ([name, width]) => {
        const image = new Image();
        image.src = `${import.meta.env.BASE_URL}assets/irrigation/${name}.png`;
        await image.decode();
        if (image.naturalWidth !== width || image.naturalHeight !== 64) throw new Error(`Invalid creek ${name} sheet.`);
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const c = canvas.getContext('2d', { willReadFrequently: true })!; c.drawImage(image, 0, 0);
        return { image, pixels: c.getImageData(0, 0, canvas.width, canvas.height) };
    })).then(([ditch, inlet]) => {
        channel = ditch.image; channelPixels = ditch.pixels; mouth = inlet.image; mouthPixels = inlet.pixels;
    });
}

/** N=1, E=2, S=4, W=8. Only shared cardinal ports connect. */
export function creekConnections(world: World, x: number, y: number): number {
    let mask = 0;
    for (const [dx, dy, bit] of DIRECTIONS) {
        const neighbor = tileAt(world, x + dx, y + dy);
        if (neighbor && WATER.has(neighbor.terrain)) mask |= bit;
    }
    return mask;
}

/** A broad water tile receives a small fan across its bank at each creek mouth. */
export function creekMouthConnections(world: World, x: number, y: number): number {
    const tile = tileAt(world, x, y);
    if (!tile || tile.creek || tile.riverArt || tile.waterfall || !WATER.has(tile.terrain)) return 0;
    let mask = 0;
    for (const [dx, dy, bit] of DIRECTIONS) {
        const neighbor = tileAt(world, x + dx, y + dy);
        if (neighbor?.creek && WATER.has(neighbor.terrain)) mask |= bit;
    }
    return mask;
}

export interface CreekLayer { image: HTMLImageElement; pixels: PunyPixels; sx: number; sy: number }

/** Source rectangles are shared by cached terrain, water clipping, and animation. */
export function creekLayers(world: World, x: number, y: number, frame: number): CreekLayer[] {
    const tile = tileAt(world, x, y);
    if (!tile || !WATER.has(tile.terrain)) return [];
    if (tile.riverArt || tile.waterfall) return [];
    const sy = ((frame % 4 + 4) % 4) * 16;
    if (tile.creek) {
        if (!channel || !channelPixels) throw new Error('Load creek artwork before painting terrain.');
        // The source mask 0 is intentionally empty; an isolated water cell uses
        // its existing north–south sprite so the headwater stays visible.
        return [{ image: channel, pixels: channelPixels, sx: (creekConnections(world, x, y) || 5) * 16, sy }];
    }
    const mask = creekMouthConnections(world, x, y);
    if (!mask) return [];
    if (!mouth || !mouthPixels) throw new Error('Load creek artwork before painting terrain.');
    return DIRECTIONS.flatMap(([, , bit], direction) => mask & bit
        ? [{ image: mouth!, pixels: mouthPixels!, sx: ((direction + 3) % 4) * 16, sy }] : []);
}

export function drawCreekWater(c: CanvasRenderingContext2D, world: World, tx: number, ty: number,
    x: number, y: number, size: number, frame: number): void {
    c.save(); c.imageSmoothingEnabled = false;
    for (const layer of creekLayers(world, tx, ty, frame)) c.drawImage(layer.image, layer.sx, layer.sy, 16, 16, x, y, size, size);
    c.restore();
}
