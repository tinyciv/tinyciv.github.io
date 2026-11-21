import { runtimeArtUrl } from './runtime-art';
/** Presentation only: no resource, collision or mining state is changed.
 * Shared contours use native 16px coordinates, so neighboring cells agree. */
import { WATER, type Tile, type World } from './types';

export type OutcropMaterial = 'stone' | 'copper' | 'iron';
export type OutcropEdgeStyle = 'flat' | 'rim' | 'grounded';
export interface OutcropCell {
    readonly neighbors: number;
    readonly phaseX: number;
    readonly phaseY: number;
    readonly seed: number;
}
export interface LooseRock {
    readonly x: number;
    readonly y: number;
    readonly frame: number;
}
export interface LooseRockCell {
    readonly key: string;
    readonly rocks: readonly LooseRock[];
    /** Source deposit must be explored before this decoration is revealed. */
    readonly source: number;
}
// Clockwise N, NE, E, SE, S, SW, W, NW.
const STEPS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
const NATIVE = 16, PERIOD = 128;
const STONE_BRIGHTNESS = 1.32;
interface ContourLayers {
    readonly mask: HTMLCanvasElement;
    readonly rim: HTMLCanvasElement;
    readonly contact: HTMLCanvasElement;
    readonly mineDoorY: number;
}
const masks = new Map<string, ContourLayers>();
const noiseFields = new Map<number, Float32Array>();
let stone: HTMLCanvasElement | undefined, copper: HTMLImageElement | undefined, iron: HTMLImageElement | undefined;
let loose: HTMLCanvasElement | undefined, looseShadow: HTMLCanvasElement | undefined;
let loading: Promise<void> | undefined, loadingLooseRocks: Promise<void> | undefined;

export function isOutcrop(tile: Tile | undefined): boolean {
    return !!tile && !WATER.has(tile.terrain) && !tile.creek
        && (tile.resource === 'stone' || tile.resource === 'marble' || tile.resource === 'copper' || tile.resource === 'iron' || tile.resource === 'gold');
}
function hash(x: number, y: number, seed: number): number {
    let n = Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ Math.imul(seed, 0x6c8e9cf5);
    n = Math.imul(n ^ n >>> 16, 0x45d9f3b); n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
    return (n ^ n >>> 16) >>> 0;
}
export function outcropSeed(seed: string): number {
    let result = 2166136261;
    for (let i = 0; i < seed.length; i++) result = Math.imul(result ^ seed.charCodeAt(i), 16777619);
    return result >>> 0;
}
export function outcropCell(world: World, x: number, y: number, seed: number, explored?: ArrayLike<number>): OutcropCell {
    let neighbors = 0;
    STEPS.forEach(([dx, dy], bit) => {
        const nx = x + dx, ny = y + dy, cell = ny * world.width + nx;
        if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height
            && (!explored || explored[cell]) && isOutcrop(world.tiles[cell])) neighbors |= 1 << bit;
    });
    return { neighbors, phaseX: x & 7, phaseY: y & 7, seed: seed & 15 };
}
export function outcropKey(cell: OutcropCell): string {
    // Fully surrounded interiors share only 16 texture phases per material.
    return cell.neighbors === 255 ? `solid:${cell.phaseX & 3}:${cell.phaseY & 3}`
        : `${cell.neighbors}:${cell.phaseX}:${cell.phaseY}:${cell.seed}`;
}

/** One ring of indexed decoration, rebuilt with terrain/exploration revisions.
 * Rocks stay wholly inside their host cell, avoiding fog and terrain spill. */
export function buildLooseRockLayout(world: World, resourceCells: Iterable<number>, explored?: ArrayLike<number>): ReadonlyMap<number, LooseRockCell> {
    const candidates = new Map<number, number>();
    for (const cell of resourceCells) {
        if (explored && !explored[cell]) continue;
        const x = cell % world.width, y = Math.floor(cell / world.width);
        if (!isOutcrop(world.tiles[cell]) || world.tiles[cell].rockHost !== undefined) continue;
        STEPS.forEach(([dx, dy], bit) => {
            const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
            if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) return;
            const tile = world.tiles[next];
            if (tile.resource || tile.rockHost !== undefined || tile.rockRangeGap || tile.relief || tile.overlay !== 'none'
                || WATER.has(tile.terrain) || tile.creek || tile.palm || tile.marsh || tile.villageTrail) return;
            candidates.set(next, (candidates.get(next) ?? 0) | 1 << ((bit + 4) & 7));
        });
    }
    const result = new Map<number, LooseRockCell>(), seed = outcropSeed(world.seed);
    for (const [cell, neighbors] of candidates) {
        const x = cell % world.width, y = Math.floor(cell / world.width), h = hash(x, y, seed);
        const directions = STEPS.filter((_, bit) => neighbors & 1 << bit);
        // Loose rubble clusters around long faces and concavities; isolated
        // boulders get only a few companions rather than a uniform eight-rock ring.
        if (h % 100 >= (directions.length === 1 ? 28 : 52)) continue;
        const [dx, dy] = directions[(h >>> 8) % directions.length];
        const count = (h >>> 16) % 5 === 0 ? 2 : 1, rocks: LooseRock[] = [];
        for (let i = 0; i < count; i++) {
            const k = hash(x * 2 + i, y, seed ^ h);
            if (k % 5 !== 0) continue;
            // Place the rubble towards its source deposit, with a small gap.
            // The larger sprites occupy the bottom row of the atlas.
            const frame = 4 + (k >>> 4) % 4;
            const rx = Math.max(4, Math.min(12, 8 + dx * 3 + ((k >>> 8) % 7 - 3)));
            const ry = Math.max(4, Math.min(12, 8 + dy * 3 + ((k >>> 12) % 7 - 3)));
            if (rocks.some(rock => Math.hypot(rock.x - rx, rock.y - ry) < 4)) continue;
            rocks.push({ x: rx, y: ry, frame });
        }
        if (rocks.length) result.set(cell, { key: rocks.map(rock => `${rock.x},${rock.y},${rock.frame}`).join(';'), rocks,
            source: (y + dy) * world.width + x + dx });
    }
    return result;
}

/** Prepare only gray stone once; mineral overlays retain their source colors. */
function lightenStone(image: HTMLImageElement): HTMLCanvasElement {
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false;
    c.filter = `brightness(${STONE_BRIGHTNESS})`; c.drawImage(image, 0, 0);
    return canvas;
}
async function loadImage(file: string): Promise<HTMLImageElement> {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/resources/outcrops/${file}`);
    await image.decode();
    return image;
}
export function loadLooseRockArt(): Promise<void> {
    return loadingLooseRocks ??= loadImage('loose-rocks.png').then(image => {
        loose = lightenStone(image);
        // Derive the contact shadow from the generated sprites' alpha, once.
        looseShadow = document.createElement('canvas'); looseShadow.width = loose.width; looseShadow.height = loose.height;
        const c = looseShadow.getContext('2d')!; c.drawImage(loose, 0, 0);
        c.globalCompositeOperation = 'source-in'; c.fillStyle = '#263025'; c.fillRect(0, 0, loose.width, loose.height);
    });
}
export function loadOutcropArt(): Promise<void> {
    return loading ??= Promise.all(['stone.png', 'copper-overlay.png', 'iron-overlay.png'].map(loadImage))
        .then(([stoneImage, copperImage, ironImage]) => {
            stone = lightenStone(stoneImage);
            copper = copperImage; iron = ironImage;
        });
}
function noise(x: number, y: number, scale: number, seed: number): number {
    const ix = Math.floor(x / scale), iy = Math.floor(y / scale), wrap = PERIOD / scale - 1;
    let fx = x / scale - ix, fy = y / scale - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const at = (dx: number, dy: number) => hash((ix + dx) & wrap, (iy + dy) & wrap, seed) / 0xffffffff;
    return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
}
function noiseField(seed: number): Float32Array {
    let field = noiseFields.get(seed);
    if (field) return field;
    field = new Float32Array(PERIOD * PERIOD);
    for (let y = 0; y < PERIOD; y++) for (let x = 0; x < PERIOD; x++)
        // More coverage and quieter erosion produce fuller lobes and wider
        // necks. Keep a small inset so the contact border fits in its own cell.
        field[y * PERIOD + x] = Math.max(.525, .555 + (noise(x, y, 32, seed) - .5) * .09
            + (noise(x, y, 8, seed + 1) - .5) * .065 + (noise(x, y, 4, seed + 2) - .5) * .02);
    if (noiseFields.size >= 4) noiseFields.delete(noiseFields.keys().next().value!);
    noiseFields.set(seed, field); return field;
}
function contour(cell: OutcropCell): ContourLayers {
    const key = outcropKey(cell), old = masks.get(key);
    if (old) return old;
    const field = noiseField(cell.seed);
    const samples = new Uint8Array(9); samples[4] = 1;
    STEPS.forEach(([dx, dy], bit) => { samples[(dy + 1) * 3 + dx + 1] = Number(!!(cell.neighbors & 1 << bit)); });
    const occupied = (x: number, y: number): number => samples[(y + 1) * 3 + x + 1];
    // Sample beyond the tile bounds. These samples describe the SAME global
    // surface in adjacent cells, so a rim never appears on an internal seam.
    const margin = 3, width = NATIVE + margin * 2, coverage = new Uint8Array(width * width);
    for (let y = -margin; y < NATIVE + margin; y++) for (let x = -margin; x < NATIVE + margin; x++) {
        const fx = (x + .5) / NATIVE - .5, fy = (y + .5) / NATIVE - .5;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy;
        // Smooth shared occupancy rather than cutting diagonal diamonds out
        // of the perimeter. Neighboring tiles still sample the same field.
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const density = (occupied(ix, iy) * (1 - tx) + occupied(ix + 1, iy) * tx) * (1 - ty)
            + (occupied(ix, iy + 1) * (1 - tx) + occupied(ix + 1, iy + 1) * tx) * ty;
        const nx = (cell.phaseX * NATIVE + x + PERIOD) % PERIOD, ny = (cell.phaseY * NATIVE + y + PERIOD) % PERIOD;
        if (density >= field[ny * PERIOD + nx]) coverage[(y + margin) * width + x + margin] = 1;
    }
    const at = (x: number, y: number) => coverage[(y + margin) * width + x + margin];
    const make = () => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = NATIVE;
        const c = canvas.getContext('2d')!;
        return { canvas, c, image: c.createImageData(NATIVE, NATIVE) };
    };
    const mask = make(), rim = make(), contact = make();
    const shade = (data: Uint8ClampedArray, index: number, r: number, g: number, b: number, alpha: number) => {
        data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = alpha;
    };
    for (let y = 0; y < NATIVE; y++) for (let x = 0; x < NATIVE; x++) {
        const index = (y * NATIVE + x) * 4;
        if (at(x, y)) {
            mask.image.data[index + 3] = 255;
            const north = !at(x, y - 1), west = !at(x - 1, y), south = !at(x, y + 1), east = !at(x + 1, y);
            if (south || east) shade(rim.image.data, index, 28, 34, 32, 190);
            else if (north || west) shade(rim.image.data, index, 25, 32, 30, 145);
            // A broken highlight sits inside the upper rim; the lower two
            // pixels retain texture under a darker face, giving shallow relief.
            else if (!at(x, y + 2) || !at(x + 2, y)) shade(rim.image.data, index, 29, 37, 35, 110);
            else if (!at(x, y - 2) || !at(x - 2, y)) shade(rim.image.data, index, 191, 195, 175, 100);
        } else {
            const near = at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
            const below = at(x - 1, y - 1) || at(x, y - 1);
            if (near) shade(contact.image.data, index, 91, 76, 48, below ? 150 : 90);
            else if (at(x, y - 2) || at(x - 1, y - 2)) shade(contact.image.data, index, 41, 47, 33, 55);
        }
    }
    for (const layer of [mask, rim, contact]) layer.c.putImageData(layer.image, 0, 0);
    // Fit the complete 10x8 timber doorway inside the rock, towards its foot.
    // This is baked with the contour, not searched while rendering each frame.
    let mineDoorY = 5;
    for (let bottom = 14; bottom >= 11; bottom--) {
        let fits = true;
        for (let y = bottom - 7; y <= bottom && fits; y++) for (let x = 3; x < 13; x++)
            if (!at(x, y)) { fits = false; break; }
        if (fits) { mineDoorY = bottom - 7; break; }
    }
    const layers: ContourLayers = { mask: mask.canvas, rim: rim.canvas, contact: contact.canvas, mineDoorY };
    if (masks.size >= 512) masks.delete(masks.keys().next().value!);
    masks.set(key, layers); return layers;
}

/** Called only while baking retained art. No pixel work occurs on cache hits. */
export function drawOutcrop(c: CanvasRenderingContext2D, material: OutcropMaterial, cell: OutcropCell, x = 0, y = 0, size = 32,
    edgeStyle: OutcropEdgeStyle = 'grounded'): void {
    if (!stone) return;
    c.save(); c.translate(x, y); c.scale(size / NATIVE, size / NATIVE); c.imageSmoothingEnabled = false;
    // NativeArt clips its atlas slot; a local 16px tile isolates destination-in.
    const tile = document.createElement('canvas'); tile.width = tile.height = NATIVE;
    const tc = tile.getContext('2d')!; tc.imageSmoothingEnabled = false;
    const sx = (cell.phaseX & 3) * NATIVE, sy = (cell.phaseY & 3) * NATIVE;
    tc.drawImage(stone, sx, sy, NATIVE, NATIVE, 0, 0, NATIVE, NATIVE);
    const ore = material === 'copper' ? copper : material === 'iron' ? iron : undefined;
    if (ore) tc.drawImage(ore, sx, sy, NATIVE, NATIVE, 0, 0, NATIVE, NATIVE);
    if (cell.neighbors !== 255) {
        const layers = contour(cell);
        if (edgeStyle === 'grounded') c.drawImage(layers.contact, 0, 0);
        tc.globalCompositeOperation = 'destination-in'; tc.drawImage(layers.mask, 0, 0);
        tc.globalCompositeOperation = 'source-over';
        if (edgeStyle !== 'flat') tc.drawImage(layers.rim, 0, 0);
    }
    c.drawImage(tile, 0, 0); c.restore();
}

export function drawOutcropMineDoor(c: CanvasRenderingContext2D, door: HTMLCanvasElement, cell: OutcropCell,
    x = 0, y = 0, size = 32): void {
    const pixel = size / NATIVE;
    const top = cell.neighbors === 255 ? 7 : contour(cell).mineDoorY;
    c.imageSmoothingEnabled = false;
    c.drawImage(door, x + 3 * pixel, y + top * pixel, 10 * pixel, 8 * pixel);
}

export function drawLooseRocks(c: CanvasRenderingContext2D, cell: LooseRockCell, size = 32, edgeStyle: OutcropEdgeStyle = 'grounded'): void {
    if (!loose) return;
    c.imageSmoothingEnabled = false;
    const scale = size / NATIVE;
    if (looseShadow && edgeStyle === 'grounded') {
        c.save(); c.globalAlpha *= .35;
        for (const rock of cell.rocks) c.drawImage(looseShadow, rock.frame % 4 * 16, Math.floor(rock.frame / 4) * 16, 16, 16,
            (rock.x - 8) * scale, (rock.y - 7) * scale, 16 * scale, 16 * scale);
        c.restore();
    }
    for (const rock of cell.rocks) c.drawImage(loose, rock.frame % 4 * 16, Math.floor(rock.frame / 4) * 16, 16, 16,
        (rock.x - 8) * scale, (rock.y - 8) * scale, 16 * scale, 16 * scale);
}
