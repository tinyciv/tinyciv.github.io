import { WATER, type Tile, type World } from './types';
import type { PunyPixels } from './puny-world';

let pixels: PunyPixels | undefined;
let loading: Promise<void> | undefined;

/** Salt is a flat ground feature, beneath roads, buildings and vegetation. */
export function isSaltPan(tile: Tile | undefined): boolean {
    return !!tile && tile.resource === 'salt' && !WATER.has(tile.terrain)
        && !tile.ridge && !tile.creek && !tile.stair;
}

/** Same eight-neighbor convention as wheat: N E S W NE SE SW NW.
 * A diagonal closes a corner only when both adjoining edges also join. */
export function saltPanJoinMask(world: World, x: number, y: number): number {
    const member = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < world.width && ny < world.height
        && isSaltPan(world.tiles[ny * world.width + nx]);
    if (!member(x, y)) return 0;
    const n = member(x, y - 1), e = member(x + 1, y), s = member(x, y + 1), w = member(x - 1, y);
    return Number(n) | Number(e) << 1 | Number(s) << 2 | Number(w) << 3
        | Number(n && e && member(x + 1, y - 1)) << 4
        | Number(s && e && member(x + 1, y + 1)) << 5
        | Number(s && w && member(x - 1, y + 1)) << 6
        | Number(n && w && member(x - 1, y - 1)) << 7;
}

export function loadSaltPanArt(): Promise<void> {
    return loading ??= new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            if (image.naturalWidth !== 256 || image.naturalHeight !== 256) {
                reject(new Error('Invalid salt-pan join sheet.')); return;
            }
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
            const c = canvas.getContext('2d', { willReadFrequently: true })!;
            c.drawImage(image, 0, 0); pixels = c.getImageData(0, 0, 256, 256); resolve();
        };
        image.onerror = () => reject(new Error('Salt-pan artwork could not be loaded.'));
        image.src = `${import.meta.env.BASE_URL}assets/resources/salt-pan-joins.png`;
    });
}

export const saltPanPixels = () => pixels;
