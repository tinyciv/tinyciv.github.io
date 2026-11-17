import { runtimeArtUrl } from './runtime-art';
import { WATER, type Tile, type World } from './types';

/** Approved PixelLab studies. Patches retain the native 16px terrain grid. */
const MOTIONS = [
    { file: 'coast-1a.png', size: 32, frames: 16, base: [43, 196, 169] },
    { file: 'ocean-2b.png', size: 48, frames: 16, base: [3, 138, 171] },
    { file: 'river-3c.png', size: 16, frames: 9, base: [4, 160, 180] },
] as const;
export const WATER_MOTION_FRAME_SECONDS = .17;
let fields: Int16Array[] | undefined, loading: Promise<void> | undefined;
let openRiverField: Int16Array | undefined;

/** The narrow 3C source has permanent bright banks. Broad rivers use only
 * its temporal changes, without stretching those banks over the water. */
function openRiverHighlights(pixels: Uint8ClampedArray): Int16Array {
    const { size, frames } = MOTIONS[2], width = size * frames;
    const result = new Int16Array(size * size * frames * 3);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let r = 255, g = 255, b = 255, water = true;
        for (let frame = 0; frame < frames; frame++) {
            const p = (y * width + frame * size + x) * 4;
            water &&= !!pixels[p + 3] && pixels[p + 1] > pixels[p] + 20 && pixels[p + 2] > pixels[p] + 20;
            r = Math.min(r, pixels[p]); g = Math.min(g, pixels[p + 1]); b = Math.min(b, pixels[p + 2]);
        }
        if (!water) continue;
        for (let frame = 0; frame < frames; frame++) {
            const i = y * width + frame * size + x, p = i * 4, to = i * 3;
            result[to] = pixels[p] - r; result[to + 1] = pixels[p + 1] - g; result[to + 2] = pixels[p + 2] - b;
        }
    }
    return result;
}

export function loadWaterMotionArt(): Promise<void> {
    return loading ??= Promise.all(MOTIONS.map(async ({ file, size, frames, base }) => {
        const image = new Image();
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/water-motion/${file}`);
        await image.decode();
        if (image.naturalWidth !== size * frames || image.naturalHeight !== size)
            throw new Error(`Invalid water motion artwork: ${file}`);
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, size).data;
        if (file === 'river-3c.png') openRiverField = openRiverHighlights(pixels);
        const field = new Int16Array(size * size * frames * 3);
        for (let i = 0; i < pixels.length / 4; i++) {
            const p = i * 4;
            // Extract only generated water highlights. Generated land and flat
            // fills never replace native banks or create rectangular color seams.
            if (!pixels[p + 3] || pixels[p + 1] <= pixels[p] + 20 || pixels[p + 2] <= pixels[p] + 20
                || pixels[p + 1] <= base[1] || pixels[p + 2] <= base[2]) continue;
            for (let channel = 0; channel < 3; channel++) field[i * 3 + channel] = pixels[p + channel] - base[channel];
        }
        return field;
    })).then(result => { fields = result; });
}

const riverSurface = (tile: Tile) => tile.terrain === 'river' || !!tile.creek;
export const waterMotionFrameCount = (tile: Tile): number => riverSurface(tile) ? MOTIONS[2].frames : MOTIONS[0].frames;
export interface WaterMotion { kind: number; column: number; row: number; heading: number; openRiver: boolean }

/** O(1) sampling; animation depends on local geometry, never pathfinding. */
export function waterMotion(world: World, x: number, y: number, band: number): WaterMotion {
    const tile = world.tiles[y * world.width + x];
    const kind = riverSurface(tile) ? 2 : band === 0 ? 0 : 1;
    const cells = MOTIONS[kind].size / 16;
    const openRiver = kind === 2 && !tile.creek && tile.riverArt !== 'banked';
    let heading = 0; // The approved river flows toward the bottom of its frame.
    if (kind === 2 && !openRiver) {
        const next = tile.channelNext ?? tile.drainage;
        const dx = next !== undefined && next >= 0 && next < world.tiles.length ? next % world.width - x : 0;
        const dy = next !== undefined && next >= 0 && next < world.tiles.length ? Math.floor(next / world.width) - y : 0;
        if (Math.abs(dx) + Math.abs(dy) === 1) heading = dx > 0 ? 3 : dx < 0 ? 1 : dy < 0 ? 2 : 0;
        else {
            const wet = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < world.width && ny < world.height
                && WATER.has(world.tiles[ny * world.width + nx].terrain);
            const horizontal = Number(wet(x - 1, y)) + Number(wet(x + 1, y));
            const vertical = Number(wet(x, y - 1)) + Number(wet(x, y + 1));
            if (horizontal > vertical) heading = 3;
        }
    }
    // 1A includes a generated sandy bank in its upper half. Repeat only
    // the lower 32x16 water strip, retaining the world's actual shoreline.
    return { kind, column: x % cells, row: kind === 0 ? 0 : y % cells, heading, openRiver };
}

/** Called only while baking a cached sprite or repainting dirty terrain.
 * The native water mask and all land/foam pixels remain unchanged. */
export function applyWaterMotion(pixels: Uint8ClampedArray, water: Uint8Array, width: number,
    tx: number, ty: number, motion: WaterMotion, frame: number): void {
    const field = motion.openRiver ? openRiverField : fields?.[motion.kind];
    if (!field) return;
    const spec = MOTIONS[motion.kind], column = ((frame % spec.frames) + spec.frames) % spec.frames * spec.size;
    for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
        const i = (ty * 16 + py) * width + tx * 16 + px, p = i * 4;
        if (!water[i] || pixels[p] > 50) continue;
        let sx = motion.column * 16 + px, sy = (motion.kind === 0 ? 16 : motion.row * 16) + py;
        if (motion.kind === 2 && !motion.openRiver) {
            // Fit the generated water interior to any native channel shape,
            // including horizontal bends and creek junctions. Broad water
            // instead samples the unstretched field on the shared world grid.
            let cross = px, along = py;
            if (motion.heading === 1) { cross = py; along = 15 - px; }
            else if (motion.heading === 2) { cross = 15 - px; along = 15 - py; }
            else if (motion.heading === 3) { cross = 15 - py; along = px; }
            sx = 4 + Math.floor(cross / 2); sy = along;
        }
        const from = (sy * spec.size * spec.frames + column + sx) * 3;
        for (let channel = 0; channel < 3; channel++) pixels[p + channel] += field[from + channel];
    }
}
