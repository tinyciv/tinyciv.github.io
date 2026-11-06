import { WATER, type World } from './types';
import { worldRevisions } from './world-revisions';

/** Native Puny World water colors: turquoise shelf, cyan, then deep blue. */
export const WATER_BAND_COLORS = ['#2bc4a9', '#04a0b4', '#038aab'] as const;
export const BEACH_SHELF_WIDTH = 3;
export const DEEP_WATER_DISTANCE = 7;
export interface WaterDepthField {
    /** Approximate Euclidean tile distance to the nearest dry land. */
    distance: Float32Array;
    /** 0 = turquoise shelf, 1 = cyan water, 2 = deep blue. */
    bands: Uint8Array;
    signature: Uint8Array;
    width: number;
    height: number;
    revision: number | undefined;
    geometryRevision: number;
}
const cached = new WeakMap<World, WaterDepthField>();

/** Two-pass chamfer transform: cardinal steps are 1, diagonal steps √2. */
function distances(world: World, source: (i: number) => boolean): Float32Array {
    const { width, height } = world, result = new Float32Array(width * height);
    for (let i = 0; i < result.length; i++) result[i] = source(i) ? 0 : Infinity;
    const diagonal = Math.SQRT2;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (x) result[i] = Math.min(result[i], result[i - 1] + 1);
        if (y) {
            result[i] = Math.min(result[i], result[i - width] + 1);
            if (x) result[i] = Math.min(result[i], result[i - width - 1] + diagonal);
            if (x + 1 < width) result[i] = Math.min(result[i], result[i - width + 1] + diagonal);
        }
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        if (x + 1 < width) result[i] = Math.min(result[i], result[i + 1] + 1);
        if (y + 1 < height) {
            result[i] = Math.min(result[i], result[i + width] + 1);
            if (x) result[i] = Math.min(result[i], result[i + width - 1] + diagonal);
            if (x + 1 < width) result[i] = Math.min(result[i], result[i + width + 1] + diagonal);
        }
    }
    return result;
}

/** Validate once at terrain preparation, including edits without a revision bump. */
export function prepareWaterDepth(world: World): WaterDepthField {
    const geometryRevision = worldRevisions(world).geometry;
    const previous = cached.get(world), signature = new Uint8Array(world.tiles.length);
    let changed = !previous || previous.width !== world.width || previous.height !== world.height;
    for (let i = 0; i < signature.length; i++) {
        const tile = world.tiles[i];
        signature[i] = WATER.has(tile.terrain) && !tile.creek && !tile.riverArt && !tile.waterfall ? 2 : tile.beach ? 1 : 0;
        if (!changed && previous!.signature[i] !== signature[i]) changed = true;
    }
    if (!changed) { previous!.revision = world.revision; previous!.geometryRevision = geometryRevision; return previous!; }
    const distance = distances(world, i => signature[i] < 2), bands = new Uint8Array(signature.length);
    for (let i = 0; i < signature.length; i++) {
        // Rivers and seas share one continuous field. Terrain labels must never
        // create a color seam at a river mouth or a coastline boundary.
        bands[i] = signature[i] < 2 ? 1 : distance[i] >= DEEP_WATER_DISTANCE ? 2
            : distance[i] <= BEACH_SHELF_WIDTH ? 0 : 1;
    }
    const field = { distance, bands, signature, width: world.width, height: world.height, revision: world.revision, geometryRevision };
    cached.set(world, field);
    return field;
}

/** O(1) during draw; paintTerrain/rasterTerrain validate before sampling tiles. */
export function waterDepthField(world: World): WaterDepthField {
    const field = cached.get(world);
    if (field && field.width === world.width && field.height === world.height) {
        // Most draw calls sample many water tiles without any intervening edit.
        // This also avoids a full unversioned-world fingerprint per sample;
        // explicit prepareWaterDepth still validates direct terrain edits.
        if (field.revision === world.revision) return field;
        if (world.revision !== undefined && field.geometryRevision === worldRevisions(world).geometry) {
            field.revision = world.revision;
            return field;
        }
    }
    return prepareWaterDepth(world);
}

export function waterDepthAt(world: World, x: number, y: number): number {
    return waterDepthField(world).distance[y * world.width + x];
}
