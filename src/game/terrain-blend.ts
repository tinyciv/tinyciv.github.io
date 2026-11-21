import type { PunyPixels } from './puny-world';
import type { TerrainRegion } from './terrain';
import { type Tile, type World } from './types';

const BLUR_PASSES = 2;
export const TERRAIN_BLEND_RADIUS = BLUR_PASSES + 1;

const GRASS = 1, PLAINS = 2, SAND = 3, TUNDRA = 4, BEACH = 5;
const DRYNESS = [0, 0, 2 / 3, 1, 0, .56];
const GRASS_COLOR = [133, 166, 67], OLIVE_COLOR = [163, 165, 75];
const PLAINS_COLOR = [196, 178, 83], SAND_COLOR = [201, 178, 102], TUNDRA_COLOR = [151, 169, 157];
const PALETTE_STEPS = 24;
const warmPalette = Array.from({ length: PALETTE_STEPS + 1 }, (_, i) => {
    const low = i < 9 ? GRASS_COLOR : i < 16 ? OLIVE_COLOR : PLAINS_COLOR;
    const high = i < 9 ? OLIVE_COLOR : i < 16 ? PLAINS_COLOR : SAND_COLOR;
    const weight = i < 9 ? i / 9 : i < 16 ? (i - 9) / 7 : (i - 16) / 8;
    return low.map((value, channel) => value + (high[channel] - value) * weight);
});

export function terrainBlendKind(tile: Tile): number {
    if (tile.relief || tile.riverArt || tile.waterfall || tile.marsh || tile.geothermal) return 0;
    switch (tile.creek ? tile.creekGround : tile.terrain) {
        case 'grassland': return tile.beach ? BEACH : GRASS;
        case 'plains': return tile.beach ? BEACH : PLAINS;
        case 'desert': return tile.beach ? BEACH : SAND;
        case 'tundra': return TUNDRA;
        default: return 0;
    }
}

export function hasFreshwaterBank(tile?: Tile): boolean {
    return (tile?.terrain === 'river' || tile?.terrain === 'lake')
        && (!tile.creek || tile.riverArt === 'banked') && !tile.waterfall;
}

/** The backdrop colors in the grassy shoreline quads. Dark bank rocks retain
 * their authored shades, as do water and foam. */
export function freshwaterBankGround(r: number, g: number, b: number): boolean {
    return (r === 133 && g === 166 && b === 67) || (r === 157 && g === 167 && b === 71)
        || (r === 184 && g === 175 && b === 73) || (r === 150 && g === 177 && b === 70)
        || (r === 126 && g === 158 && b === 63) || (r === 138 && g === 156 && b === 85)
        || (r === 111 && g === 142 && b === 51);
}

interface BlendField {
    x: number; y: number; width: number; height: number;
    kinds: Uint8Array;
    cold: Float32Array;
    dry: Float32Array;
}
interface BlendCorners { cold: number[]; dry: number[] }

/** Diffuse only across connected ground. Include the full dependency halo
 * so a dirty rectangle and a complete paint produce the same native pixels. */
export function prepareTerrainBlend(world: World, region: TerrainRegion): BlendField | undefined {
    const single = region.width === 1 && region.height === 1 ? world.tiles[region.y * world.width + region.x] : undefined;
    if (single && !terrainBlendKind(single) && !hasFreshwaterBank(single)) return;
    const x = Math.max(0, region.x - TERRAIN_BLEND_RADIUS), y = Math.max(0, region.y - TERRAIN_BLEND_RADIUS);
    const width = Math.min(world.width, region.x + region.width + TERRAIN_BLEND_RADIUS) - x;
    const height = Math.min(world.height, region.y + region.height + TERRAIN_BLEND_RADIUS) - y;
    const kinds = new Uint8Array(width * height);
    let classes = 0, freshwater = false;
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
        const tile = world.tiles[(row + y) * world.width + col + x];
        const kind = terrainBlendKind(tile);
        kinds[row * width + col] = kind;
        if (kind) classes |= 1 << kind;
        else freshwater ||= hasFreshwaterBank(tile);
    }
    if (!(classes & (classes - 1)) && !(classes & (1 << BEACH)) && !(freshwater && classes & ~(1 << GRASS))) return;

    let cold = Float32Array.from(kinds, kind => Number(kind === TUNDRA));
    let dry = Float32Array.from(kinds, kind => DRYNESS[kind]);
    let nextCold = new Float32Array(kinds.length), nextDry = new Float32Array(kinds.length);
    const offsets = [-1, 1, -width, width];
    for (let pass = 0; pass < BLUR_PASSES; pass++) {
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
            const cell = row * width + col;
            if (!kinds[cell]) continue;
            let weight = 2, c = cold[cell] * weight, d = dry[cell] * weight;
            for (let direction = 0; direction < offsets.length; direction++) {
                if ((direction === 0 && col === 0) || (direction === 1 && col === width - 1)) continue;
                const neighbor = cell + offsets[direction];
                if (!kinds[neighbor]) continue;
                weight++; c += cold[neighbor]; d += dry[neighbor];
            }
            nextCold[cell] = c / weight; nextDry[cell] = d / weight;
        }
        [cold, nextCold] = [nextCold, cold]; [dry, nextDry] = [nextDry, dry];
    }
    return { x, y, width, height, kinds, cold, dry };
}

function fieldCell(field: BlendField, x: number, y: number): number {
    return x >= 0 && y >= 0 && x < field.width && y < field.height ? y * field.width + x : -1;
}

/** Extend the surrounding land's blended pigments across the dry parts of a
 * freshwater tile. Each corner uses the ground touching that same vertex. */
export function freshwaterBankCorners(field: BlendField, x: number, y: number): BlendCorners | undefined {
    const cold: number[] = [], dry: number[] = [];
    const fx = x - field.x, fy = y - field.y;
    let available = 0;
    for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
        let weight = 0, c = 0, d = 0;
        for (const neighbor of [fieldCell(field, fx + dx, fy), fieldCell(field, fx, fy + dy), fieldCell(field, fx + dx, fy + dy)]) {
            if (!field.kinds[neighbor]) continue;
            weight++; c += field.cold[neighbor]; d += field.dry[neighbor];
        }
        if (weight) available |= 1 << cold.length;
        cold.push(weight ? c / weight : 0); dry.push(weight ? d / weight : 0);
    }
    if (!cold.some(value => value > 0) && !dry.some(value => value > 0)) return;
    // A corner facing open water has no bank sample. Extend its nearest
    // available colors inward so they can meet at bends without square bands.
    for (let q = 0; q < 4; q++) {
        if (available & 1 << q) continue;
        const samples = [q ^ 1, q ^ 2].filter(i => available & 1 << i);
        if (!samples.length) samples.push(q ^ 3);
        cold[q] = samples.reduce((sum, i) => sum + cold[i], 0) / samples.length;
        dry[q] = samples.reduce((sum, i) => sum + dry[i], 0) / samples.length;
    }
    return { cold, dry };
}

function seaAt(world: World, x: number, y: number): boolean {
    if (x < 0 || x >= world.width || y < 0 || y >= world.height) return false;
    const terrain = world.tiles[y * world.width + x].terrain;
    return terrain === 'coast' || terrain === 'ocean';
}

/** Paint flat ground in discrete steps at native pixel resolution. Grass
 * texture and frost details fade with their pigments across shared corners. */
export function paintTerrainBlend(field: BlendField, world: World, x: number, y: number, source: PunyPixels,
    tundra: PunyPixels | undefined, pixels: Uint8ClampedArray, offset: number, stride: number, bank?: BlendCorners): boolean {
    const fx = x - field.x, fy = y - field.y, cell = fieldCell(field, fx, fy), kind = field.kinds[cell];
    if (!kind && !bank) return false;
    const baseCold = Number(kind === TUNDRA), baseDry = DRYNESS[kind];
    // Uniform interiors already have native atlas art. The exact small range
    // check also avoids allocating corner arrays across whole uniform biomes.
    if (!bank && kind !== BEACH && Math.abs(field.cold[cell] - baseCold) < .001 && Math.abs(field.dry[cell] - baseDry) < .001) {
        let mixed = false;
        for (let dy = -1; dy <= 1 && !mixed; dy++) for (let dx = -1; dx <= 1; dx++) {
            const neighbor = fieldCell(field, fx + dx, fy + dy);
            if (field.kinds[neighbor] && (Math.abs(field.cold[neighbor] - baseCold) >= .001 || Math.abs(field.dry[neighbor] - baseDry) >= .001)) {
                mixed = true; break;
            }
        }
        if (!mixed) return false;
    }

    const { cold, dry } = bank ?? { cold: [], dry: [] };
    if (!bank) for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
        const horizontal = fieldCell(field, fx + dx, fy);
        const vertical = fieldCell(field, fx, fy + dy);
        const diagonal = fieldCell(field, fx + dx, fy + dy);
        let weight = 1, c = field.cold[cell], d = field.dry[cell];
        if (field.kinds[horizontal]) { c += field.cold[horizontal]; d += field.dry[horizontal]; weight++; }
        if (field.kinds[vertical]) { c += field.cold[vertical]; d += field.dry[vertical]; weight++; }
        if (field.kinds[diagonal] && (field.kinds[horizontal] || field.kinds[vertical])) {
            c += field.cold[diagonal]; d += field.dry[diagonal]; weight++;
        }
        cold.push(c / weight); dry.push(d / weight);
    }

    const tile = world.tiles[y * world.width + x];
    // Keep the full sand or tundra palette at the surf. The inland part of
    // a sand beach starts in the dry-olive range even on wide beaches.
    const coast = kind === BEACH || kind === TUNDRA;
    const shoreDry = kind === BEACH ? 1 : baseDry;
    const west = coast && seaAt(world, x - 1, y), east = coast && seaAt(world, x + 1, y);
    const north = coast && seaAt(world, x, y - 1), south = coast && seaAt(world, x, y + 1);
    const variant = Math.min(8, Math.floor(tile.variation * 9));
    const sx = variant % 3 * 16, sy = Math.floor(variant / 3) * 16;
    for (let py = 0; py < 16; py++) {
        const v = (py + .5) / 16;
        const leftCold = cold[0] + (cold[2] - cold[0]) * v, rightCold = cold[1] + (cold[3] - cold[1]) * v;
        const leftDry = dry[0] + (dry[2] - dry[0]) * v, rightDry = dry[1] + (dry[3] - dry[1]) * v;
        for (let px = 0; px < 16; px++) {
            const target = offset + (py * stride + px) * 4;
            if (bank && !freshwaterBankGround(pixels[target], pixels[target + 1], pixels[target + 2])) continue;
            const u = (px + .5) / 16;
            const edge = Math.min(west ? px : 16, east ? 15 - px : 16, north ? py : 16, south ? 15 - py : 16);
            const anchor = Math.max(0, 1 - edge / 9);
            const rawCold = (leftCold + (rightCold - leftCold) * u) * (1 - anchor) + baseCold * anchor;
            const rawDry = (leftDry + (rightDry - leftDry) * u) * (1 - anchor) + shoreDry * anchor;
            // Stable clusters of four native pixels keep the palette bands
            // irregular even when the generated boundary is locally straight.
            const block = Math.imul(x * 4 + (px >> 2), 0x1f123bb5) ^ Math.imul(y * 4 + (py >> 2), 0x5f356495);
            const jitter = (((block ^ block >>> 13) & 15) - 7.5) / 100;
            const coldWeight = Math.round((rawCold + jitter * Math.min(rawCold, 1 - rawCold)) * PALETTE_STEPS) / PALETTE_STEPS;
            const warmth = rawCold >= 1 ? 0 : Math.min(1, rawDry / (1 - rawCold));
            const warmStep = Math.round((warmth + jitter * Math.min(warmth, 1 - warmth)) * PALETTE_STEPS);
            const warm = warmPalette[warmStep];
            const grassWeight = (1 - coldWeight) * (1 - warmStep / PALETTE_STEPS);
            const grassOffset = ((sy + py) * source.width + sx + px) * 4;
            const frostOffset = ((sy + py) * (tundra?.width ?? 48) + sx + px) * 4;
            for (let channel = 0; channel < 3; channel++) {
                const grassDetail = (bank ? pixels[target + channel] : source.data[grassOffset + channel]) - GRASS_COLOR[channel];
                const frost = TUNDRA_COLOR[channel];
                const frostDetail = (tundra?.data[frostOffset + channel] ?? frost) - frost;
                pixels[target + channel] = warm[channel] * (1 - coldWeight) + frost * coldWeight
                    + grassDetail * grassWeight + frostDetail * coldWeight * coldWeight;
            }
            pixels[target + 3] = 255;
        }
    }
    return true;
}
