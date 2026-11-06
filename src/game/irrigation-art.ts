import { buildingReady, tileAt, WATER, type Building, type World } from './types';
import type { RoadLinks } from './road-sprites';

const DIRECTIONS = [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]] as const;
let ditch: HTMLCanvasElement | undefined, inlet: HTMLCanvasElement | undefined, bridge: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
const cropMasks = new Map<string, Path2D>();
export const IRRIGATION_NATIVE_WIDTH = 3;
export const IRRIGATION_TERRAIN_BUFFER = 1;
// An odd-width channel sits on a native pixel center; all arms use this anchor.
const CHANNEL_CENTER = 7.5;

interface IrrigationPixels { width: number; height: number; data: Uint8ClampedArray }

/** Nearest point on a connected arm, measured in the native 16px tile. */
function channelPoint(mask: number, x: number, y: number, center: number): [number, number] {
    const arms: [number, number][] = [];
    if (mask & 1) arms.push([center, Math.min(y, center)]);
    if (mask & 2) arms.push([Math.max(x, center), center]);
    if (mask & 4) arms.push([center, Math.max(y, center)]);
    if (mask & 8) arms.push([Math.min(x, center), center]);
    let point = arms[0] ?? [center, center], distance = Infinity;
    for (const arm of arms) {
        const next = Math.hypot(x - arm[0], y - arm[1]);
        if (next < distance) { point = arm; distance = next; }
    }
    return point;
}

/** Compress only across the channel: preserve full-tile exits and the four
 * authored animation frames. Every output sample stays on the native grid. */
export function narrowIrrigationPixels(source: IrrigationPixels, kind: 'ditch' | 'inlet'): Uint8ClampedArray {
    const result = new Uint8ClampedArray(source.data.length), scale = IRRIGATION_NATIVE_WIDTH / 4;
    for (let row = 0; row < source.height; row++) for (let column = 0; column < source.width; column++) {
        const tile = Math.floor(column / 16), frame = Math.floor(row / 16), x = column % 16 + .5, y = row % 16 + .5;
        let sx = x, sy = y;
        if (kind === 'ditch') {
            if (!tile) continue;
            const point = channelPoint(tile, x, y, CHANNEL_CENTER);
            if (Math.hypot(x - point[0], y - point[1]) >= IRRIGATION_NATIVE_WIDTH / 2) continue;
            // Favor the source's water center over its irregular outer bank;
            // otherwise reducing four pixels to three drops a water column.
            // Along-channel samples keep their original row/column.
            sx = (point[0] === CHANNEL_CENTER ? 8.5 : point[0]) + (x - point[0]) / scale;
            sy = (point[1] === CHANNEL_CENTER ? 8.5 : point[1]) + (y - point[1]) / scale;
        } else {
            // Keep the river-facing fan broad, tapering to the same narrow
            // section at the land-facing edge of the inlet tile.
            const landward = tile === 0 ? x : tile === 1 ? y : tile === 2 ? 16 - x : 16 - y;
            const taper = Math.max(0, Math.min(1, (landward - 8) / 6));
            const widthScale = 1 - (1 - scale) * taper, center = 8 - .5 * taper;
            if (tile % 2 === 0) sy = 8 + .5 * taper + (y - center) / widthScale;
            else sx = 8 + .5 * taper + (x - center) / widthScale;
        }
        sx = Math.floor(sx); sy = Math.floor(sy);
        if (sx < 0 || sy < 0 || sx >= 16 || sy >= 16) continue;
        const at = ((frame * 16 + sy) * source.width + tile * 16 + sx) * 4;
        result.set(source.data.subarray(at, at + 4), (row * source.width + column) * 4);
    }
    return result;
}

function narrowSheet(image: HTMLImageElement, kind: 'ditch' | 'inlet'): HTMLCanvasElement {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0);
    const pixels = c.getImageData(0, 0, canvas.width, canvas.height);
    pixels.data.set(narrowIrrigationPixels(pixels, kind)); c.putImageData(pixels, 0, 0);
    return canvas;
}

/** Approved 1B: original transparent Puny water, with the small Miniworld bridge. */
export function loadIrrigationArt(): Promise<void> {
    return loading ??= Promise.all([['ditch', 256, 64], ['inlet', 64, 64], ['bridge', 28, 36]].map(async ([name, width, height]) => {
        const image = new Image();
        image.src = `${import.meta.env.BASE_URL}assets/irrigation/${name}.png`;
        await image.decode();
        if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error(`Invalid irrigation ${name} sprite.`);
        return image;
    })).then(images => { ditch = narrowSheet(images[0], 'ditch'); inlet = narrowSheet(images[1], 'inlet'); bridge = images[2]; });
}

export function irrigationConnections(building: Pick<Building, 'x' | 'y'>,
    occupants: (x: number, y: number) => readonly Building[], world?: World, waterKnown?: (x: number, y: number) => boolean): RoadLinks {
    const result: RoadLinks = { north: false, east: false, south: false, west: false };
    for (const [side, dx, dy] of DIRECTIONS) {
        const x = building.x + dx, y = building.y + dy, tile = world && tileAt(world, x, y);
        result[side] = occupants(x, y).some(other => other.kind === 'irrigation' && buildingReady(other))
            || !!tile && WATER.has(tile.terrain) && (!waterKnown || waterKnown(x, y));
    }
    return result;
}

export function irrigationMask(links: RoadLinks): number {
    // A single new ditch still has a visible native north–south channel.
    return Number(links.north) | Number(links.east) << 1 | Number(links.south) << 2 | Number(links.west) << 3 || 5;
}

/** Distance to the authored connected centerline in native 16px coordinates. */
export function irrigationChannelDistance(links: RoadLinks, x: number, y: number, center = 8): number {
    const mask = irrigationMask(links);
    let result = Infinity;
    if (mask & 1) result = Math.min(result, Math.hypot(x - center, Math.max(0, y - center)));
    if (mask & 2) result = Math.min(result, Math.hypot(Math.min(0, x - center), y - center));
    if (mask & 4) result = Math.min(result, Math.hypot(x - center, Math.min(0, y - center)));
    if (mask & 8) result = Math.min(result, Math.hypot(Math.max(0, x - center), y - center));
    return result;
}

export function drawIrrigation(c: CanvasRenderingContext2D, x: number, y: number, size: number, time: number, links: RoadLinks): void {
    if (!ditch) return;
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(ditch, irrigationMask(links) * 16, (Math.floor(time * 3) % 4) * 16, 16, 16, x, y, size, size);
    c.restore();
}

/** Direction names the river side of the inlet: west, north, east, south. */
export function drawIrrigationInlet(c: CanvasRenderingContext2D, x: number, y: number, size: number, time: number, direction: 0 | 1 | 2 | 3): void {
    if (!inlet) return;
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(inlet, direction * 16, (Math.floor(time * 3) % 4) * 16, 16, 16, x, y, size, size);
    c.restore();
}

/** Road deck sits above water and crops, using the actual road orientation. */
export function drawIrrigationBridge(c: CanvasRenderingContext2D, x: number, y: number, size: number, roads: RoadLinks, water: RoadLinks): void {
    if (!bridge) return;
    let vertical = roads.north || roads.south, horizontal = roads.east || roads.west;
    if (!vertical && !horizontal) { horizontal = water.north || water.south || !(water.east || water.west); vertical = !horizontal; }
    c.save(); c.imageSmoothingEnabled = false; c.translate(x + size / 2, y + size / 2);
    if (horizontal) c.drawImage(bridge, -size / 4, -size / 4, size / 2, size / 2);
    if (vertical) { c.rotate(Math.PI / 2); c.drawImage(bridge, -size / 4, -size / 4, size / 2, size / 2); }
    c.restore();
}

/** Preserve a full native pixel of the actual terrain outside each bank. */
export function irrigationCropExcluded(water: RoadLinks, x: number, y: number): boolean {
    return irrigationChannelDistance(water, x, y, CHANNEL_CENTER) < IRRIGATION_NATIVE_WIDTH / 2 + IRRIGATION_TERRAIN_BUFFER;
}

/** Clip crops, revealing the terrain already drawn below rather than painting
 * a fixed-color border. Grass, desert and their transitions retain their art. */
export function clipFarmAroundIrrigation(c: CanvasRenderingContext2D, x: number, y: number, size: number, water: RoadLinks, roads?: RoadLinks): void {
    const roadMask = roads ? Number(roads.north || roads.south) | Number(roads.east || roads.west) << 1 : 0;
    const key = `${irrigationMask(water)}:${roadMask}`;
    let path = cropMasks.get(key);
    if (!path) {
        path = new Path2D();
        for (let py = 0; py < 16; py++) {
            let start = -1;
            for (let px = 0; px <= 16; px++) {
                const channel = irrigationCropExcluded(water, px + .5, py + .5);
                const road = !!(roadMask & 1) && Math.abs(px + .5 - 8) < 3 || !!(roadMask & 2) && Math.abs(py + .5 - 8) < 3;
                const crop = px < 16 && !channel && !road;
                if (crop && start < 0) start = px;
                if (!crop && start >= 0) { path.rect(start, py, px - start, 1); start = -1; }
            }
        }
        cropMasks.set(key, path);
    }
    const transform = c.getTransform();
    c.translate(x, y); c.scale(size / 16, size / 16); c.clip(path); c.setTransform(transform);
}

export function irrigationIconUrl(): string {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    drawIrrigation(canvas.getContext('2d')!, 0, 0, 32, 0, { north: true, south: true, east: false, west: false });
    return canvas.toDataURL();
}
