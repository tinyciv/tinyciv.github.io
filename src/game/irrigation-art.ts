import { runtimeArtUrl } from './runtime-art';
import { buildingReady, tileAt, WATER, type Building, type World } from './types';
import { roadCoversPixel, roadLinkMask, type RoadLinks } from './road-sprites';

const DIRECTIONS = [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]] as const;
let ditch: HTMLCanvasElement | undefined, inlet: HTMLCanvasElement | undefined, ditchPixels: Uint8ClampedArray;
let loading: Promise<void> | undefined;
const cropMasks = new Map<string, Path2D>();
const shoulderLayouts = new Map<number, IrrigationLayout>();
const shoulderSprites = new Map<number, HTMLCanvasElement>();
export const IRRIGATION_NATIVE_WIDTH = 3;
export const IRRIGATION_TERRAIN_BUFFER = 1;
// An odd-width channel sits on a native pixel center; all arms use this anchor.
const CHANNEL_CENTER = 7.5;
const WEST_SHOULDER = 2.5, SOUTH_SHOULDER = 13.5;

interface ShoulderPixels {
    distance: Float32Array;
    source: Int16Array;
}
export interface IrrigationLayout {
    key: number;
    links: RoadLinks;
    shoulder?: ShoulderPixels;
}
export interface IrrigationRoad {
    building: Building;
    links: RoadLinks;
}

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

export function loadIrrigationArt(): Promise<void> {
    return loading ??= Promise.all([['ditch', 256, 64], ['inlet', 64, 64]].map(async ([name, width, height]) => {
        const image = new Image();
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/irrigation/${name}.png`);
        await image.decode();
        if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error(`Invalid irrigation ${name} sprite.`);
        return image;
    })).then(images => {
        ditch = narrowSheet(images[0], 'ditch'); inlet = narrowSheet(images[1], 'inlet');
        ditchPixels = ditch.getContext('2d')!.getImageData(0, 0, ditch.width, ditch.height).data;
    });
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

/** Match offsets at both ends of every shared road and ditch edge. Open-water
 * inlets and ditch-only neighbors keep their original centered exits. */
export function irrigationLayout(ditch: Pick<Building, 'x' | 'y'>, links: RoadLinks,
    occupants: (x: number, y: number) => readonly Building[]): IrrigationLayout {
    const road = (b: Building) => b.kind === 'road' && buildingReady(b);
    let shared = 0;
    if (occupants(ditch.x, ditch.y).some(road)) {
        DIRECTIONS.forEach(([side, dx, dy], bit) => {
            if (!links[side]) return;
            const neighbors = occupants(ditch.x + dx, ditch.y + dy);
            if (neighbors.some(road) && neighbors.some(b => b.kind === 'irrigation' && buildingReady(b))) shared |= 1 << bit;
        });
    }
    const mask = irrigationMask(links), key = mask | shared << 4;
    let layout = shoulderLayouts.get(key);
    if (!layout) {
        layout = { key, links, shoulder: shared ? shoulderPixels(mask, shared) : undefined };
        shoulderLayouts.set(key, layout);
    }
    return layout;
}

/** Route each arm from its boundary pixel to the common junction. A short
 * straight section at each edge keeps the three-pixel profile at tile seams. */
function shoulderPixels(mask: number, shared: number): ShoulderPixels {
    const hubX = shared & 5 ? WEST_SHOULDER : CHANNEL_CENTER;
    const hubY = shared & 10 ? SOUTH_SHOULDER : CHANNEL_CENTER;
    const segments: { x: number; y: number; dx: number; dy: number; vertical: boolean }[] = [];
    for (let side = 0; side < 4; side++) {
        if (!(mask & 1 << side)) continue;
        const [, dx, dy] = DIRECTIONS[side], offset = !!(shared & 1 << side);
        const x = dx ? (dx > 0 ? 16 : 0) : offset ? WEST_SHOULDER : CHANNEL_CENTER;
        const y = dy ? (dy > 0 ? 16 : 0) : offset ? SOUTH_SHOULDER : CHANNEL_CENTER;
        const innerX = x - 2 * dx, innerY = y - 2 * dy;
        segments.push({ x, y, dx: -2 * dx, dy: -2 * dy, vertical: !!dy },
            { x: innerX, y: innerY, dx: hubX - innerX, dy: hubY - innerY, vertical: !!dy });
    }
    const distance = new Float32Array(256), source = new Int16Array(256).fill(-1);
    for (let row = 0; row < 16; row++) for (let column = 0; column < 16; column++) {
        const x = column + .5, y = row + .5, pixel = row * 16 + column;
        let nearest = Infinity, across = 0, vertical = false;
        for (const segment of segments) {
            const dx = x - segment.x, dy = y - segment.y;
            const projection = Math.max(0, Math.min(1, (dx * segment.dx + dy * segment.dy) / (segment.dx ** 2 + segment.dy ** 2 || 1)));
            const u = dx - projection * segment.dx, v = dy - projection * segment.dy, gap = Math.hypot(u, v);
            if (gap >= nearest) continue;
            nearest = gap; vertical = segment.vertical; across = (vertical ? u : v) < 0 ? -gap : gap;
        }
        distance[pixel] = nearest;
        if (nearest >= IRRIGATION_NATIVE_WIDTH / 2) continue;
        // Sample the existing animated water strips at native resolution.
        const cross = 7 + Math.round(across);
        source[pixel] = vertical ? row * 256 + 5 * 16 + cross : cross * 256 + 10 * 16 + column;
    }
    return { distance, source };
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

export function drawRoadsideIrrigation(c: CanvasRenderingContext2D, x: number, y: number, size: number, time: number, layout: IrrigationLayout): void {
    if (!ditch || !layout.shoulder) return;
    const frame = Math.floor(time * 3) % 4, key = layout.key * 4 + frame;
    let sprite = shoulderSprites.get(key);
    if (!sprite) {
        sprite = document.createElement('canvas'); sprite.width = sprite.height = 16;
        const context = sprite.getContext('2d')!, pixels = context.createImageData(16, 16);
        for (let i = 0; i < layout.shoulder.source.length; i++) {
            const sample = layout.shoulder.source[i];
            if (sample < 0) continue;
            const offset = (frame * 16 * ditch.width + sample) * 4;
            pixels.data.set(ditchPixels.subarray(offset, offset + 4), i * 4);
        }
        context.putImageData(pixels, 0, 0);
        shoulderSprites.set(key, sprite);
    }
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(sprite, x, y, size, size);
    c.restore();
}

/** Direction names the river side of the inlet: west, north, east, south. */
export function drawIrrigationInlet(c: CanvasRenderingContext2D, x: number, y: number, size: number, time: number, direction: 0 | 1 | 2 | 3): void {
    if (!inlet) return;
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(inlet, direction * 16, (Math.floor(time * 3) % 4) * 16, 16, 16, x, y, size, size);
    c.restore();
}

/** Preserve a full native pixel of the actual terrain outside each bank. */
export function irrigationCropExcluded(water: RoadLinks, x: number, y: number): boolean {
    return irrigationChannelDistance(water, x, y, CHANNEL_CENTER) < IRRIGATION_NATIVE_WIDTH / 2 + IRRIGATION_TERRAIN_BUFFER;
}

export function irrigationLayoutDistance(layout: IrrigationLayout, x: number, y: number): number {
    return layout.shoulder?.distance[Math.floor(y) * 16 + Math.floor(x)] ?? irrigationChannelDistance(layout.links, x, y, CHANNEL_CENTER);
}

/** Clip crops, revealing the terrain already drawn below rather than painting
 * a fixed-color border. Grass, desert and their transitions retain their art. */
export function irrigationCropKey(layout: IrrigationLayout, road?: IrrigationRoad): string {
    return road ? `${layout.key}:${roadLinkMask(road.links)}:${road.links.pavedEnds ?? ''}:${road.building.roadStyle ?? ''}` : String(layout.key);
}

export function clipFarmAroundIrrigation(c: CanvasRenderingContext2D, x: number, y: number, size: number, layout: IrrigationLayout, road?: IrrigationRoad): void {
    const key = irrigationCropKey(layout, road);
    let path = cropMasks.get(key);
    if (!path) {
        path = new Path2D();
        for (let py = 0; py < 16; py++) {
            let start = -1;
            for (let px = 0; px <= 16; px++) {
                const channel = irrigationLayoutDistance(layout, px + .5, py + .5) < IRRIGATION_NATIVE_WIDTH / 2 + IRRIGATION_TERRAIN_BUFFER;
                const tread = road && roadCoversPixel(road.links, road.building, px * 2 + 1, py * 2 + 1);
                const crop = px < 16 && !channel && !tread;
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
