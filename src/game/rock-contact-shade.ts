import type { FogView } from './fog';
import type { ArtBounds } from './native-art';
import { rockFrameCoverage, type RockFormationArt, type RockPalette } from './rock-range-art';
import { WATER, type World } from './types';

const nativeTile = 16, tilePixels = 32;
const sideReach = 5;
const shadeFalloff = [45, 44, 42, 38, 34, 30, 25, 20, 14, 8];
const shadeColors: Record<RockPalette, readonly [number, number, number]> = {
    temperate: [47, 51, 38],
    plains: [53, 51, 35],
    desert: [66, 51, 36],
    tundra: [39, 50, 51],
};

interface ShadeCell {
    x: number;
    y: number;
    flag: number;
    /** Bitset of source tiles whose visible foothold contributes to this fragment. */
    sources: number;
}

interface ShadeArt {
    key: string;
    bounds: ArtBounds;
    mask: HTMLCanvasElement;
    cells: ShadeCell[];
    allCells: number;
}

export interface RockContactShade {
    key: string;
    bounds: ArtBounds;
    art: ShadeArt;
    visibleCells: number;
}

const artByFrame = new Map<string, ShadeArt>();

function contactArt(rock: RockFormationArt): ShadeArt | undefined {
    const key = `rock-contact:${rock.palette}:${rock.variant}:${+rock.alternate}:${+rock.mirror}`;
    const cached = artByFrame.get(key);
    if (cached) return cached;
    const coverage = rockFrameCoverage(rock.palette, rock.variant, rock.mirror, rock.alternate);
    if (!coverage.length) return;

    const sourceWidth = rock.width * nativeTile;
    const width = sourceWidth + sideReach * 2;
    const height = rock.height * nativeTile + shadeFalloff.length - 1;
    const front = new Int16Array(sourceWidth).fill(-1);
    for (const { x, y } of coverage) front[x] = Math.max(front[x], y);
    const alpha = new Uint8Array(width * height);
    const owners = new Int8Array(alpha.length);
    // Project downhill and to the sides from the lower silhouette.
    for (let x = 0; x < sourceWidth; x++) {
        const foot = front[x];
        if (foot < 0) continue;
        const source = Math.floor(foot / nativeTile) * rock.width + Math.floor(x / nativeTile);
        for (let dx = -sideReach; dx <= sideReach; dx++) {
            const px = x + dx;
            const distance = Math.abs(dx);
            for (let dy = 0; dy < shadeFalloff.length - distance; dy++) {
                const py = foot + dy;
                if (px >= 0 && px < sourceWidth && py <= front[px]) continue;
                const index = py * width + px + sideReach, strength = shadeFalloff[dy + distance];
                if (strength <= alpha[index]) continue;
                alpha[index] = strength;
                owners[index] = source;
            }
        }
    }

    const mask = document.createElement('canvas');
    mask.width = width;
    mask.height = height;
    const context = mask.getContext('2d')!;
    const image = context.createImageData(width, height);
    const stride = rock.width + 2;
    const tileSources = new Uint32Array(stride * (rock.height + 1));
    const [r, g, b] = shadeColors[rock.palette];
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const pixel = py * width + px, strength = alpha[pixel];
        if (!strength) continue;
        const index = pixel * 4;
        image.data[index] = r;
        image.data[index + 1] = g;
        image.data[index + 2] = b;
        image.data[index + 3] = strength;
        const col = Math.floor((px - sideReach) / nativeTile) + 1;
        const tile = Math.floor(py / nativeTile) * stride + col;
        tileSources[tile] |= 1 << owners[pixel];
    }
    context.putImageData(image, 0, 0);
    const cells: ShadeCell[] = [];
    for (let cell = 0; cell < tileSources.length; cell++) {
        const sources = tileSources[cell];
        // The padded 8×3 frame can touch up to 40 tiles, within integer precision.
        if (sources) cells.push({ x: cell % stride - 1, y: Math.floor(cell / stride), sources, flag: 2 ** cells.length });
    }
    const bounds = { x: -sideReach * 2, y: 0, width: width * 2, height: height * 2 };
    const art = { key, bounds, mask, cells, allCells: 2 ** cells.length - 1 };
    artByFrame.set(key, art);
    return art;
}

/** Resolve only the visible fragments on dry ground. The clipped atlas entry
 * is shared by formations with the same art and visible footprint. */
export function rockContactShade(world: World, fog: FogView, rock: RockFormationArt,
    shadedGround: Set<number>): RockContactShade | undefined {
    const art = contactArt(rock);
    if (!art) return;
    const host = rock.y * world.width + rock.x;
    let visibleCells = 0;
    for (const { x, y, sources, flag } of art.cells) {
        const cellX = rock.x + x, cellY = rock.y + y;
        if (cellX < 0 || cellX >= world.width || cellY >= world.height || (rock.explored & sources) !== sources) continue;
        const cell = cellY * world.width + cellX, tile = world.tiles[cell];
        if (!fog.explored[cell] || WATER.has(tile.terrain) || tile.creek || tile.rockRangeGap) continue;
        if (tile.rockHost === undefined) {
            if (shadedGround.has(cell)) continue;
            shadedGround.add(cell);
        } else if (tile.rockHost !== host) continue;
        visibleCells += flag;
    }
    if (visibleCells) return { key: `${art.key}:${visibleCells}`, bounds: art.bounds, art, visibleCells };
}

export function drawRockContactShade(c: CanvasRenderingContext2D, shade: RockContactShade): void {
    const { art, visibleCells, bounds } = shade;
    c.save();
    c.imageSmoothingEnabled = false;
    if (visibleCells !== art.allCells) {
        c.beginPath();
        for (const { x, y, flag } of art.cells) {
            if (Math.floor(visibleCells / flag) % 2) c.rect(x * tilePixels, y * tilePixels, tilePixels, tilePixels);
        }
        c.clip();
    }
    c.drawImage(art.mask, bounds.x, bounds.y, bounds.width, bounds.height);
    c.restore();
}
