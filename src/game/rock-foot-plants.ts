import type { FogView } from './fog';
import { rockFrameCoverage, type RockFormationArt } from './rock-range-art';
import type { Point, World } from './types';

const nativeTile = 16;
const frames = 3;
const rootX = 8, rootY = 14;
export const ROCK_FOOT_PLANT_BOUNDS = { x: -2 * rootX, y: -2 * rootY, width: 32, height: 32 };
let sheet: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
const closeToRock = new Map<string, Point[]>();

export interface RockFootPlant extends Point {
    frame: number;
}

export function loadRockFootPlantArt(): Promise<void> {
    return loading ??= (async () => {
        const image = new Image();
        image.src = `${import.meta.env.BASE_URL}assets/resources/rock-ranges/foot-plants.webp`;
        await image.decode();
        if (image.naturalWidth !== frames * nativeTile || image.naturalHeight !== nativeTile)
            throw new Error('Invalid rock foot plant atlas');
        sheet = image;
    })();
}

export function drawRockFootPlant(c: CanvasRenderingContext2D, frame: number): void {
    if (!sheet) return;
    const { x, y, width, height } = ROCK_FOOT_PLANT_BOUNDS;
    c.imageSmoothingEnabled = false;
    c.drawImage(sheet, frame * nativeTile, 0, nativeTile, nativeTile, x, y, width, height);
}

function rockFootCandidates(rock: RockFormationArt): readonly Point[] {
    const key = `${rock.variant}:${Number(rock.alternate)}:${Number(rock.mirror)}`;
    const cached = closeToRock.get(key);
    if (cached) return cached;
    const pixels = rockFrameCoverage('tundra', rock.variant, rock.mirror, rock.alternate);
    if (!pixels.length) return [];
    const base = new Int16Array(rock.width * nativeTile).fill(-1);
    for (const { x, y } of pixels) base[x] = Math.max(base[x], y);
    const points: Point[] = [];
    for (let x = 5; x < base.length - 5; x += 6) {
        const edge = Math.max(base[x - 1], base[x], base[x + 1]);
        if (edge >= 0) points.push({ x, y: edge + 3 });
    }
    closeToRock.set(key, points);
    return points;
}

/** Decorative tundra plants are tied to the intact foreground silhouette. */
export function rockFootPlant(world: World, fog: FogView, rock: RockFormationArt,
    occupied: (cell: number) => boolean): RockFootPlant | undefined {
    if (!sheet || rock.palette !== 'tundra') return;
    const anchor = rock.y * world.width + rock.x;
    if (world.tiles[anchor].rockOre !== undefined) return;
    const hash = Math.imul(anchor + 1, 0x9e3779b1);
    const order = (hash ^ hash >>> 16) >>> 0;
    if ((order & 3) < (rock.height === 1 ? 3 : 1)) return;
    const candidates = rockFootCandidates(rock);
    const start = (order >>> 8) % candidates.length;
    for (let i = 0; i < candidates.length; i++) {
        const foot = candidates[(start + i) % candidates.length];
        const x = rock.x + foot.x / nativeTile, y = rock.y + foot.y / nativeTile;
        const col = Math.floor(x), row = Math.floor(y);
        const cell = row * world.width + col, tile = world.tiles[cell];
        if (!tile || tile.terrain !== 'tundra' || tile.overlay !== 'none' || tile.creek || tile.marsh || tile.beach
            || tile.resource || tile.rockTree || tile.rockRangeGap || tile.villageTrail || tile.worldFeature
            || tile.rockHost !== undefined && tile.rockHost !== anchor || occupied(cell)) continue;
        const front = world.tiles[Math.floor(y + 4 / nativeTile) * world.width + col];
        if (front?.rockHost !== undefined && front.rockHost !== anchor) continue;
        let clear = true;
        for (let cy = Math.floor(y - rootY / nativeTile); cy <= row && clear; cy++) {
            for (let cx = Math.floor(x - rootX / nativeTile); cx <= Math.floor(x + (nativeTile - rootX - 1) / nativeTile); cx++) {
                if (cy < 0 || cx < 0 || cx >= world.width || !fog.explored[cy * world.width + cx]) { clear = false; break; }
            }
        }
        if (clear) return { x, y, frame: (order >>> 24) % frames };
    }
}
