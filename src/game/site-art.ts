import type { GraphicsContext } from 'pixi.js';

/** Runtime footprint annotation, like selection outlines. Four square corner
 * brackets are cached vector geometry, with no image or per-frame raster work. */
export function drawSiteBrackets(g: GraphicsContext, width: number, height: number, near: boolean, mask = 15): void {
    const inset = width * .035, arm = width * .17;
    for (let corner = 0; corner < 4; corner++) {
        if (!(mask & 1 << corner)) continue;
        const right = !!(corner & 1), bottom = !!(corner & 2);
        const x = right ? width - inset : inset, y = bottom ? height - inset : inset;
        g.moveTo(x + (right ? -arm : arm), y).lineTo(x, y).lineTo(x, y + (bottom ? -arm : arm));
    }
    g.stroke({ color: near ? '#e45b55' : '#b8bab8', alpha: near ? .95 : .38, width: Math.max(1, width / 48), cap: 'square', join: 'miter' });
}
