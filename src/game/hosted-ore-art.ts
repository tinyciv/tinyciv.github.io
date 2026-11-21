import type { RockOreMaterial } from './rock-range-art';

// Inclusive horizontal runs in the 32×32 temperate ore frames. Only the
// minerals, timber, and excavated opening are taken from that artwork.
type Run = readonly [row: number, first: number, last: number];
const veins: Record<RockOreMaterial, readonly Run[]> = {
    copper: [[16, 24, 25], [17, 9, 9], [17, 22, 24], [18, 6, 9], [18, 18, 18]],
    iron: [[15, 25, 26], [16, 25, 26], [17, 8, 9], [17, 24, 25], [18, 5, 9], [18, 18, 18]],
    gold: [[16, 24, 25], [17, 9, 11], [18, 7, 9], [18, 18, 18]],
};
const minedVeins: Record<RockOreMaterial, readonly Run[]> = {
    copper: [[18, 9, 10], [18, 23, 25]],
    iron: [[15, 25, 26], [16, 25, 26], [17, 24, 24], [18, 5, 6]],
    gold: [[18, 9, 10], [18, 23, 26]],
};
const posts: readonly Run[] = [
    [14, 11, 21], [15, 11, 12], [15, 20, 21], [16, 11, 11], [16, 20, 21],
    [17, 11, 11], [17, 20, 21], [18, 11, 11], [18, 20, 21], [19, 11, 11], [19, 20, 20],
];
const ironPosts: readonly Run[] = [
    [13, 8, 23], [14, 9, 23], [15, 9, 9], [15, 22, 23], [16, 9, 9], [16, 22, 23],
    [17, 9, 9], [17, 22, 23], [18, 9, 9], [18, 22, 23], [19, 9, 9], [19, 22, 23],
];
const opening: readonly Run[] = [[15, 13, 19], [16, 12, 19], [17, 12, 19], [18, 12, 19], [19, 17, 19]];
const ironOpening: readonly Run[] = [[15, 10, 21], [16, 10, 21], [17, 10, 21], [18, 10, 21], [19, 10, 21]];
const mineralHighlights = {
    copper: [219, 132, 83],
    iron: [163, 194, 211],
    gold: [249, 197, 69],
} as const;

const shade = (pixels: Uint8ClampedArray, at: number): number =>
    .2126 * pixels[at] + .7152 * pixels[at + 1] + .0722 * pixels[at + 2];

/** Paint a transparent layer over the actual formation, including cuts that
 * take their color from the local stone. This runs once per cached art variant. */
export function hostedOreLayer(material: RockOreMaterial, developed: boolean, source: Uint8ClampedArray,
    host: Uint8ClampedArray, size: number): ImageData {
    const layer = new ImageData(size, size), pixels = layer.data;
    const paint = (runs: readonly Run[], mode: 'feature' | 'mineral' | 'cut' | 'shadow'): void => {
        for (const [row, first, last] of runs) for (let col = first; col <= last; col++) {
            const at = (row * size + col) * 4;
            const target = mode === 'shadow' ? at + size * 4 : at;
            if (!source[at + 3] || !host[target + 3]) continue;
            if (mode === 'feature') {
                pixels.set(source.subarray(at, at + 4), target);
            } else if (mode === 'mineral') {
                for (let channel = 0; channel < 3; channel++) {
                    pixels[target + channel] = .6 * source[at + channel] + .4 * mineralHighlights[material][channel];
                }
            } else {
                const darken = mode === 'shadow' ? .58 : Math.min(.64, shade(source, at) / Math.max(1, shade(host, target)));
                pixels[target] = host[target] * darken;
                pixels[target + 1] = host[target + 1] * darken;
                pixels[target + 2] = host[target + 2] * darken;
            }
            pixels[target + 3] = host[target + 3];
        }
    };
    const mineral = developed ? minedVeins[material] : veins[material];
    paint(mineral, 'shadow');
    if (developed) {
        paint(material === 'iron' ? ironOpening : opening, 'cut');
        paint(material === 'iron' ? ironPosts : posts, 'feature');
    }
    paint(mineral, 'mineral');
    return layer;
}
