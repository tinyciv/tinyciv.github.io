import { runtimeArtUrl } from './runtime-art';
import { punyWorldPixels } from './puny-world';
import { rasterDirtRoad, roadDistanceField, pavedRoadHalfWidth, pavingEndDistance, type RoadLinks } from './road-sprites';

interface TileRecord { corners: Record<'NW' | 'NE' | 'SW' | 'SE', string> }
interface TilesetMetadata { tiles: TileRecord[] }
interface Pixels { width: number; height: number; data: Uint8ClampedArray }
const surfaces = new Map<string, HTMLCanvasElement>();
let tiles: Pixels[] | undefined;
let revision = 0;
let loading: Promise<void> | undefined;
export const pavedRoadArtRevision = (): number => revision;

export function loadPavedRoadArt(): Promise<void> {
    return loading ??= loadPavedRoadTiles(`${import.meta.env.BASE_URL}assets/roads/paved`);
}

/** Load unchanged PixelLab Wang tiles. Review scenes may load a candidate;
 * production chooses its approved directory in the normal art-loader list. */
export async function loadPavedRoadTiles(base: string): Promise<void> {
    const response = await fetch(`${base}/metadata.json`);
    if (!response.ok) throw new Error('Paved road metadata could not be loaded.');
    const metadata: TilesetMetadata = await response.json();
    const loaded: Pixels[] = [];
    await Promise.all(metadata.tiles.map(async (record, index) => {
        const image = new Image(); image.src = runtimeArtUrl(`${base}/tile-${String(index).padStart(2, '0')}.png`); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
        const context = canvas.getContext('2d')!; context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, 16, 16);
        const mask = (['NW', 'NE', 'SW', 'SE'] as const).reduce((mask, side, bit) => mask | Number(record.corners[side] === 'upper') << bit, 0);
        loaded[mask] = context.getImageData(0, 0, 16, 16);
    }));
    if (loaded.filter(Boolean).length !== 16) throw new Error('Paved roads need all sixteen Wang corner combinations.');
    tiles = loaded; revision++; surfaces.clear();
}

/** Cache authored gray surfacing and brown shoulders under the road mask.
 * At unpaved exits, the generated transition meets the original dirt pixels. */
export function drawPavedRoad(c: CanvasRenderingContext2D, links: RoadLinks): boolean {
    const atlas = punyWorldPixels();
    if (!tiles || !atlas) return false;
    const mask = roadMask(links), ends = links.pavedEnds ?? 0, key = `${mask}:${ends}`;
    let surface = surfaces.get(key);
    if (!surface) {
        const pixels = rasterDirtRoad(links, atlas, 'road', 0, true), field = roadDistanceField(mask);
        const endTiles = [12, 5, 3, 10, 13, 7, 11, 14];
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
            const halfWidth = pavedRoadHalfWidth(links, x, y), gap = field[y * 32 + x];
            if (gap > halfWidth - .6) continue;
            // Both sides of the boundary retain the dirt road's exact pixels.
            if (pavingEndDistance(ends, x, y) < 3) continue;
            const distances = [y, 31 - x, 31 - y, x, Math.hypot(31 - x, y), Math.hypot(31 - x, 31 - y), Math.hypot(x, 31 - y), Math.hypot(x, y)];
            let nearest = Infinity, tile = 15;
            for (let side = 0; side < 8; side++) if (ends & 1 << side && distances[side] < nearest) {
                nearest = distances[side]; tile = endTiles[side];
            }
            if (gap > halfWidth - 2.2) tile = 0;
            const source = tiles![tile], offset = (Math.floor(y / 2) * source.width + Math.floor(x / 2)) * 4;
            // Generated transitions may retain reference grass. Let the
            // existing dirt show through those pixels instead of inserting
            // a green stripe inside a paved-to-dirt crossing.
            const red = source.data[offset], green = source.data[offset + 1], blue = source.data[offset + 2];
            if (green > red && green > blue * 1.5) continue;
            const target = (y * 32 + x) * 4;
            pixels.set(source.data.subarray(offset, offset + 4), target);
        }
        surface = document.createElement('canvas'); surface.width = surface.height = 32;
        const context = surface.getContext('2d')!, result = context.createImageData(32, 32);
        result.data.set(pixels); context.putImageData(result, 0, 0); surfaces.set(key, surface);
    }
    c.drawImage(surface, 0, 0, 32, 32); return true;
}
function roadMask(links: RoadLinks): number {
    return (['north', 'east', 'south', 'west', 'northeast', 'southeast', 'southwest', 'northwest'] as const)
        .reduce((mask, side, bit) => mask | Number(!!links[side]) << bit, 0);
}
