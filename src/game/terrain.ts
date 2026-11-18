import { tundraWaterMask } from './tundra-water';
import { tundraPixels } from './tundra-art';
import { TILE_SIZE, WATER, type Terrain, type Tile, type World } from './types';
import { punyDesertLedgePixels, punyWorldPixels } from './puny-world';
import { prepareWaterDepth, waterDepthField, WATER_BAND_COLORS, type WaterDepthField } from './water-depth';
import { creekConnections, creekLayers, creekMouthConnections } from './creek-art';
import { bankedRiver, bankedRiverPixels, bankedRiverSprite, riverWaterPixel, WATERFALL_FRAME_SECONDS } from './banked-river-art';
import { applyWaterMotion, waterMotion, waterMotionFrameCount, WATER_MOTION_FRAME_SECONDS } from './water-motion-art';
import { isSaltPan, saltPanJoinMask, saltPanPixels } from './salt-pan-art';
import { ridgeQuads } from './ridge-art';
import type { WorldCellChanges } from './world-revisions';
export { waterDepthAt, waterDepthField, prepareWaterDepth } from './water-depth';

/** Minimap colors sampled from the native tiles; game ground is always atlas art. */
export const TERRAIN_COLORS: Record<Terrain, string> = {
    ocean: '#038aab', coast: '#2bc4a9', river: '#2bc4a9', lake: '#2bc4a9',
    grassland: '#85a643', plains: '#c4b253', desert: '#c9b266', tundra: '#94a99d',
};
export interface TerrainRaster { width: number; height: number; pixels: Uint8ClampedArray; water: Uint8Array }
export interface TerrainRegion { x: number; y: number; width: number; height: number }
export interface TerrainPaint extends TerrainRegion { regions?: readonly TerrainRegion[] }
export interface TerrainQuad { sx: number; sy: number; dx: number; dy: number; shallowGrass?: boolean; plainsFringe?: boolean }
const at = (world: World, x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height ? world.tiles[y * world.width + x] : undefined;
const isSand = (tile?: Tile) => {
    const ground = tile?.creek || bankedRiver(tile) ? tile?.creekGround : tile?.terrain;
    return ground === 'desert' || ground === 'plains';
};
const isPlains = (tile?: Tile) => !tile?.beach && (tile?.creek || bankedRiver(tile) ? tile?.creekGround : tile?.terrain) === 'plains';
const broadWater = (tile?: Tile) => !!tile && !tile.creek && !bankedRiver(tile) && WATER.has(tile.terrain);

export function terrainMinimapColor(world: World, x: number, y: number): string {
    const tile = at(world, x, y)!;
    if (tile.geothermal) return tile.geothermal <= 3 ? '#635044' : '#998365';
    if (tile.creek || bankedRiver(tile)) return '#04a0b4';
    if (tile.ridge) return isSand(tile) ? '#a7956b' : tile.terrain === 'tundra' ? '#7f9589' : '#758b40';
    if (WATER.has(tile.terrain)) return WATER_BAND_COLORS[waterDepthField(world).bands[y * world.width + x]];
    return tile.beach ? '#c9b266' : TERRAIN_COLORS[tile.terrain];
}

/** A 3×3 rim plus four inward corners covers arbitrary connected shapes. */
function autotile(x: number, y: number, member: (x: number, y: number) => boolean, ox: number, oy: number, innerX?: number, innerY = oy): TerrainQuad[] {
    const quads: TerrainQuad[] = [];
    for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
        const dx = qx ? 1 : -1, dy = qy ? 1 : -1;
        const horizontal = member(x + dx, y), vertical = member(x, y + dy), diagonal = member(x + dx, y + dy);
        let sx = ox + (horizontal ? 1 : qx * 2), sy = oy + (vertical ? 1 : qy * 2);
        if (horizontal && vertical && !diagonal && innerX !== undefined) { sx = innerX + qx; sy = innerY + qy; }
        quads.push({ sx: sx * 16 + qx * 8, sy: sy * 16 + qy * 8, dx: qx * 8, dy: qy * 8 });
    }
    return quads;
}

/** Original Puny rounded/frayed land edges, now shared by tundra. */
export function tundraEdgeQuads(world: World, x: number, y: number): TerrainQuad[] {
    return autotile(x, y, (nx, ny) => {
        const tile = at(world, nx, ny);
        return !tile || tile.terrain === 'tundra' || WATER.has(tile.terrain);
    }, 22, 0, 25, 0);
}

/** Native atlas source rectangles, shared by cached and animated terrain. */
export function terrainQuads(world: World, x: number, y: number, frame = 0, depths = waterDepthField(world)): TerrainQuad[] {
    const tile = at(world, x, y)!;
    const cliff = ridgeQuads(world, x, y);
    if (cliff) return cliff;
    if (broadWater(tile)) {
        frame = ((frame % 4) + 4) % 4;
        const waterMember = (nx: number, ny: number) => {
            const neighbor = at(world, nx, ny);
            return !neighbor || broadWater(neighbor);
        };
        // Rim animations occupy 48px; the shoreline's separate inward-corner
        // strip has 32px frames. Both use the original four authored frames.
        const grass = autotile(x, y, waterMember, 7, 10 + frame * 3, 10, 10 + frame * 2);
        return oceanQuads(world, x, y, frame, depths, grass, waterMember);
    }
    // Keep native ochre plains and warm sand distinct. Their shared boundary
    // uses the native sand rim against plains pixels instead of a square edge
    // or a green grass fringe. Beaches keep the coastal sand palette.
    // Tundra owns this shared transition. Do not draw a second grass-backed
    // plains/sand rim underneath it (notably around stone deposits).
    if (isPlains(tile)) return autotile(x, y, (nx, ny) => {
        const neighbor = at(world, nx, ny);
        return isSand(neighbor) || neighbor?.terrain === 'tundra';
    }, 10, 0, 13, 0);
    if (isSand(tile)) return autotile(x, y, (nx, ny) => {
        const neighbor = at(world, nx, ny);
        return neighbor?.terrain === 'tundra' || (isSand(neighbor) && !isPlains(neighbor)) || (!!tile.beach && broadWater(neighbor));
    }, 22, 0, 25, 0).map((quad, q) => {
        const dx = q % 2 ? 1 : -1, dy = q < 2 ? -1 : 1;
        return [at(world, x + dx, y), at(world, x, y + dy), at(world, x + dx, y + dy)].some(isPlains)
            ? { ...quad, plainsFringe: true } : quad;
    });
    const variant = Math.min(8, Math.floor(tile.variation * 9));
    return [0, 1, 2, 3].map(q => ({ sx: variant % 3 * 16 + q % 2 * 8, sy: Math.floor(variant / 3) * 16 + Math.floor(q / 2) * 8, dx: q % 2 * 8, dy: Math.floor(q / 2) * 8 }));
}

function oceanQuads(world: World, x: number, y: number, frame: number, depths: WaterDepthField, grass: TerrainQuad[], waterMember: (x: number, y: number) => boolean): TerrainQuad[] {
    const band = depths.bands[y * world.width + x];
    const sand = autotile(x, y, waterMember, 12, 10 + frame * 3, 15, 10 + frame * 2);
    const deeper = autotile(x, y, (nx, ny) => {
        const neighbor = at(world, nx, ny);
        return !neighbor || !broadWater(neighbor) || depths.bands[ny * world.width + nx] >= band;
    }, band === 2 ? 22 : 17, 10 + frame * 3, band === 2 ? 25 : 20, 10 + frame * 3);
    return grass.map((quad, q) => {
        const dx = q % 2 ? 1 : -1, dy = q < 2 ? -1 : 1;
        const neighbors = [at(world, x + dx, y), at(world, x, y + dy), at(world, x + dx, y + dy)];
        const banks = neighbors.filter((neighbor): neighbor is Tile => !!neighbor && !broadWater(neighbor));
        if (banks.length) return banks.some(bank => bank.beach) ? sand[q] : { ...quad, shallowGrass: band === 0 };
        return band === 0 ? sand[q] : deeper[q];
    });
}

/** Keep original shore geometry, with the native turquoise shelf fill. */
const shelfFill = (r: number, g: number, b: number): boolean => r === 4 && g === 160 && b === 180;
const sandGrassFringe = (r: number, g: number, b: number): boolean =>
    (r === 133 && g === 166 && b === 67) || (r === 157 && g === 167 && b === 71)
    || (r === 184 && g === 175 && b === 73) || (r === 183 && g === 162 && b === 72);
/** Native source pixels and the matching native shelf fill share one shoreline clip. */
export function rasterTerrain(world: World, region?: TerrainRegion, source = punyWorldPixels(), desertLedges = punyDesertLedgePixels(), saltPans = saltPanPixels(), frame = 0, tundraSource = tundraPixels(), depths = prepareWaterDepth(world)): TerrainRaster {
    if (!source) throw new Error('Load Puny World before painting terrain.');
    const originX = region?.x ?? 0, originY = region?.y ?? 0;
    const width = (region?.width ?? world.width) * 16, height = (region?.height ?? world.height) * 16;
    const pixels = new Uint8ClampedArray(width * height * 4), water = new Uint8Array(width * height);
    for (let ty = 0; ty < height / 16; ty++) for (let tx = 0; tx < width / 16; tx++) {
        const tile = at(world, originX + tx, originY + ty)!;
        const nativeFrame = tile.waterfall ? frame : 0;
        const sandyRidge = !!tile.ridge && isSand(tile) && !!desertLedges;
        const sheet = sandyRidge ? desertLedges : source;
        const sourceY = sandyRidge ? 64 : 0;
        for (const q of terrainQuads(world, originX + tx, originY + ty, nativeFrame, depths)) for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
            const src = ((q.sy - sourceY + py) * sheet.width + q.sx + px) * 4;
            const i = (ty * 16 + q.dy + py) * width + tx * 16 + q.dx + px;
            pixels.set(sheet.data.subarray(src, src + 4), i * 4);
            if (q.shallowGrass && shelfFill(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2])) {
                pixels[i * 4] = 43; pixels[i * 4 + 1] = 196; pixels[i * 4 + 2] = 169;
            }
            if (q.plainsFringe && sandGrassFringe(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2])) {
                pixels[i * 4] = 196; pixels[i * 4 + 1] = 178; pixels[i * 4 + 2] = 83;
            }
            // The native cyan, turquoise, and pale foam shades are water;
            // olive grass/earth and beach sand remain available to the farm clip.
            water[i] = Number(broadWater(tile) && sheet.data[src + 1] > sheet.data[src] + 20 && sheet.data[src + 2] > sheet.data[src] + 20);
        }
        const tundra = tundraSource;
        if (tile.terrain === 'tundra' && tundra && !tile.ridge) {
            const wx = originX + tx, wy = originY + ty;
            const joins = tundraEdgeQuads(world, wx, wy);
            const neighbors: { dx: number; dy: number; terrain: Terrain }[] = [];
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const n = at(world, wx + dx, wy + dy);
                if (n && n.terrain !== 'tundra' && !WATER.has(n.terrain)) neighbors.push({ dx, dy, terrain: n.terrain });
            }
            const variant = Math.min(8, Math.floor(tile.variation * 9));
            for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
                const i = ((ty * 16 + py) * width + tx * 16 + px) * 4;
                const src = ((Math.floor(variant / 3) * 16 + py) * 48 + variant % 3 * 16 + px) * 4;
                pixels.set(tundra.data.subarray(src, src + 4), i);
                if (neighbors.length) {
                    // Reuse the authored Puny sand rim, including its inner corners,
                    // as a blend mask. Keep hard native pixels, never a blurred edge.
                    const q = joins[(py >= 8 ? 2 : 0) + Number(px >= 8)];
                    const mask = ((q.sy + py % 8) * source.width + q.sx + px % 8) * 4;
                    const alpha = Math.max(0, Math.min(1, Math.round((source.data[mask] - source.data[mask + 1] + 33) / 56 * 3) / 3));
                    if (alpha < 1) {
                        let nearest = neighbors[0], distance = Infinity;
                        for (const n of neighbors) {
                            const d = (px - (8 + n.dx * 16)) ** 2 + (py - (8 + n.dy * 16)) ** 2;
                            if (d < distance) { distance = d; nearest = n; }
                        }
                        const sx = nearest.terrain === 'desert' ? 23 * 16 : nearest.terrain === 'plains' ? 11 * 16 : variant % 3 * 16;
                        const sy = nearest.terrain === 'desert' || nearest.terrain === 'plains' ? 16 : Math.floor(variant / 3) * 16;
                        const ground = ((sy + py) * source.width + sx + px) * 4;
                        for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.round(
                            pixels[i + channel] * alpha + source.data[ground + channel] * (1 - alpha));
                    }
                }
            }
        }
        if (saltPans && isSaltPan(tile)) {
            const mask = saltPanJoinMask(world, originX + tx, originY + ty), sx = (mask & 15) * 16, sy = (mask >> 4) * 16;
            for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
                const src = ((sy + py) * saltPans.width + sx + px) * 4;
                const i = (ty * 16 + py) * width + tx * 16 + px;
                // Transparent outer corners preserve the actual grass/plains/sand.
                // Coastal terrain's water pixels keep their native shoreline.
                if (!saltPans.data[src + 3] || water[i]) continue;
                pixels.set(saltPans.data.subarray(src, src + 4), i * 4);
            }
        }
        for (const layer of creekLayers(world, originX + tx, originY + ty, nativeFrame)) for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
            const src = ((layer.sy + py) * layer.pixels.width + layer.sx + px) * 4, alpha = layer.pixels.data[src + 3] / 255;
            if (!alpha) continue;
            const i = (ty * 16 + py) * width + tx * 16 + px;
            for (let channel = 0; channel < 3; channel++) pixels[i * 4 + channel] = Math.round(
                layer.pixels.data[src + channel] * alpha + pixels[i * 4 + channel] * (1 - alpha));
            pixels[i * 4 + 3] = 255;
            water[i] = Number(layer.pixels.data[src + 1] > layer.pixels.data[src] + 20 && layer.pixels.data[src + 2] > layer.pixels.data[src] + 20);
        }
        const river = bankedRiverSprite(world, originX + tx, originY + ty, nativeFrame);
        if (river) {
            const riverSheet = bankedRiverPixels(source, isSand(tile), desertLedges);
            for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
                const src = ((river[1] + py) * riverSheet.width + river[0] + px) * 4;
                const i = (ty * 16 + py) * width + tx * 16 + px;
                pixels.set(riverSheet.data.subarray(src, src + 4), i * 4);
                water[i] = Number(riverWaterPixel(riverSheet.data[src], riverSheet.data[src + 1], riverSheet.data[src + 2]));
            }
        }
        const coldBanks = tundra ? tundraWaterMask(world, originX + tx, originY + ty) : 0;
        if (coldBanks && tundra) {
            const variant = Math.min(8, Math.floor(tile.variation * 9));
            for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
                if (!(coldBanks & 1 << ((py >= 8 ? 2 : 0) + Number(px >= 8)))) continue;
                const i = ((ty * 16 + py) * width + tx * 16 + px) * 4;
                const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
                // Only grass/earth shades: water, foam, rock and transparency
                // retain their original pixels and collision/farm clipping masks.
                if (g <= b * 1.15 || r <= b * 1.15) continue;
                const src = ((Math.floor(variant / 3) * 16 + py) * tundra.width + variant % 3 * 16 + px) * 4;
                const shade = Math.min(1, g / 166);
                for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.round(tundra.data[src + channel] * shade);
            }
        }
        if (WATER.has(tile.terrain) && !tile.waterfall) {
            const wx = originX + tx, wy = originY + ty;
            applyWaterMotion(pixels, water, width, tx, ty, waterMotion(world, wx, wy, depths.bands[wy * world.width + wx]), frame);
        }
    }
    return { width, height, pixels, water };
}

export function waterAnimationFrame(tile: Tile, time: number): number {
    const count = tile.waterfall ? 4 : waterMotionFrameCount(tile);
    const seconds = tile.waterfall ? WATERFALL_FRAME_SECONDS : WATER_MOTION_FRAME_SECONDS;
    return ((Math.floor(time * (1 / seconds)) % count) + count) % count;
}

let animatedWaterCanvas: HTMLCanvasElement | undefined;
export function drawAnimatedWater(c: CanvasRenderingContext2D, world: World, tx: number, ty: number, x: number, y: number, size: number, time: number): void {
    const tile = at(world, tx, ty)!;
    if (!WATER.has(tile.terrain)) return;
    const frame = waterAnimationFrame(tile, time);
    // NativeArt calls this only on cache misses. Reuse the tiny upload canvas,
    // and use the prepared depth field instead of scanning the world per bake.
    const raster = rasterTerrain(world, { x: tx, y: ty, width: 1, height: 1 }, undefined, undefined, undefined,
        frame, undefined, waterDepthField(world));
    if (!animatedWaterCanvas) {
        animatedWaterCanvas = document.createElement('canvas'); animatedWaterCanvas.width = animatedWaterCanvas.height = 16;
    }
    const context = animatedWaterCanvas.getContext('2d')!, image = context.createImageData(16, 16);
    image.data.set(raster.pixels); context.putImageData(image, 0, 0);
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(animatedWaterCanvas, x, y, size, size); c.restore();
}

function describeWaterArt(world: World, x: number, y: number, frame: number): string {
    const tile = at(world, x, y)!;
    const nativeFrame = tile.waterfall ? frame : 0, cold = tundraWaterMask(world, x, y);
    const motion = tile.waterfall ? undefined : waterMotion(world, x, y, waterDepthField(world).bands[y * world.width + x]);
    return `${JSON.stringify(terrainQuads(world, x, y, nativeFrame))}:${Number(!!tile.creek)}:${tile.creek ? creekConnections(world, x, y) || 5 : creekMouthConnections(world, x, y)}:${frame}:${Number(isSand(tile))}:${cold}:${cold ? Math.floor(tile.variation * 9) : 0}:${JSON.stringify(bankedRiverSprite(world, x, y, nativeFrame))}:${motion ? `${motion.kind},${motion.column},${motion.row},${motion.heading},${Number(motion.openRiver)}` : 'waterfall'}`;
}

/** A water tile's key changes only with terrain geometry. The depth field is
 * replaced exactly then, so it owns the keys; drawing reuses one string per
 * tile and animation frame instead of describing each visible tile per frame. */
const waterArtKeys = new WeakMap<WaterDepthField, Map<number, string>>();
const WATER_ART_FRAMES = 64;

/** Animation and crop caches include the narrow ribbon and its actual ground. */
export function waterArtKey(world: World, x: number, y: number, frame = 0): string {
    // Unversioned fixtures edit tiles directly without replacing the depth field.
    if (world.revision === undefined || !(frame >= 0 && frame < WATER_ART_FRAMES)) return describeWaterArt(world, x, y, frame);
    const field = waterDepthField(world);
    let keys = waterArtKeys.get(field);
    if (!keys) { keys = new Map(); waterArtKeys.set(field, keys); }
    const slot = (y * world.width + x) * WATER_ART_FRAMES + frame;
    let key = keys.get(slot);
    if (key === undefined) { key = describeWaterArt(world, x, y, frame); keys.set(slot, key); }
    return key;
}

const waterSpriteKeys = new WeakMap<WaterDepthField, Map<number, string>>();
/** The animated water sprite's atlas key, one retained string per tile and frame. */
export function waterSpriteKey(world: World, x: number, y: number, frame: number): string {
    if (world.revision === undefined || !(frame >= 0 && frame < WATER_ART_FRAMES)) return `water:${describeWaterArt(world, x, y, frame)}`;
    const field = waterDepthField(world);
    let keys = waterSpriteKeys.get(field);
    if (!keys) { keys = new Map(); waterSpriteKeys.set(field, keys); }
    const slot = (y * world.width + x) * WATER_ART_FRAMES + frame;
    let key = keys.get(slot);
    if (key === undefined) { key = `water:${waterArtKey(world, x, y, frame)}`; keys.set(slot, key); }
    return key;
}

const terrainIds = new Map(Object.keys(TERRAIN_COLORS).map((terrain, i) => [terrain, i]));
const painted = new WeakMap<HTMLCanvasElement, { world: World; seed: string; signatures: Float64Array; depths: WaterDepthField; water: Uint8Array; farmClips: Map<number, Path2D | null> }>();

/** Crop rows use precisely the same native shoreline pixels as the ground. */
export function clipFarmToLand(c: CanvasRenderingContext2D, terrain: HTMLCanvasElement, tileX: number, tileY: number, x: number, y: number, size: number): void {
    const cache = painted.get(terrain);
    if (!cache) return;
    const width = cache.world.width * 16, key = tileY * cache.world.width + tileX;
    let path = cache.farmClips.get(key);
    if (path === null) return;
    if (!path) {
        path = new Path2D();
        let landPixels = 0;
        for (let row = 0; row < 16; row++) {
            let start = -1;
            for (let col = 0; col <= 16; col++) {
                const land = col < 16 && !cache.water[(tileY * 16 + row) * width + tileX * 16 + col];
                if (land) landPixels++;
                if (land && start < 0) start = col;
                if (!land && start >= 0) { path.rect(start * 2, row * 2, (col - start) * 2, 2); start = -1; }
            }
        }
        // Callers already confine their artwork to this tile (building
        // clearings have an explicit tile clip). A completely dry tile needs
        // no shoreline mask, keeping ordinary crops in the GPU sprite batch.
        if (landPixels === 256) { cache.farmClips.set(key, null); return; }
        cache.farmClips.set(key, path);
    }
    const transform = c.getTransform();
    c.translate(x, y); c.scale(size / TILE_SIZE, size / TILE_SIZE); c.clip(path); c.setTransform(transform);
}

/** Keep distant edits separate. Merge touching row spans, then vertically join
 * equal spans; every changed tile still includes its exact one-cell art rim. */
function dirtyTerrainRegions(cells: readonly number[], width: number, height: number): TerrainRegion[] {
    const rows = new Map<number, [number, number][]>();
    for (const cell of cells) {
        const x = cell % width, y = Math.floor(cell / width), left = Math.max(0, x - 1), right = Math.min(width - 1, x + 1);
        for (let row = Math.max(0, y - 1); row <= Math.min(height - 1, y + 1); row++) {
            const spans = rows.get(row);
            if (spans) spans.push([left, right]); else rows.set(row, [[left, right]]);
        }
    }
    const regions: TerrainRegion[] = [];
    let previous = new Map<string, TerrainRegion>(), previousRow = -2;
    for (const [y, spans] of [...rows].sort((a, b) => a[0] - b[0])) {
        spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const merged: [number, number][] = [];
        for (const span of spans) {
            const last = merged.at(-1);
            if (last && span[0] <= last[1] + 1) last[1] = Math.max(last[1], span[1]);
            else merged.push([...span]);
        }
        const current = new Map<string, TerrainRegion>();
        for (const [left, right] of merged) {
            const key = `${left},${right}`, old = previousRow === y - 1 ? previous.get(key) : undefined;
            const region = old ?? { x: left, y, width: right - left + 1, height: 0 };
            region.height++;
            if (!old) regions.push(region);
            current.set(key, region);
        }
        previous = current; previousRow = y;
    }
    return regions;
}

/** Repaint changed depth bands as well as tile edits and their native rims. */
export function paintTerrain(canvas: HTMLCanvasElement, world: World, changes?: WorldCellChanges): TerrainPaint | undefined {
    const previous = painted.get(canvas), depths = changes && !changes.full ? waterDepthField(world) : prepareWaterDepth(world);
    let left = world.width, top = world.height, right = -1, bottom = -1;
    const incremental = previous?.world === world && previous.seed === world.seed && canvas.width === world.width * TILE_SIZE && canvas.height === world.height * TILE_SIZE;
    // The renderer supplies its own journal cursor. Public/editor calls still
    // validate all scalars, including direct edits without revision bumps.
    const local = incremental && changes && !changes.full && previous.depths === depths;
    const signatures = incremental ? previous.signatures : new Float64Array(world.tiles.length);
    const dirty: number[] = [];
    const inspect = (i: number) => {
        const tile = world.tiles[i];
        const variant = Math.min(8, Math.floor(tile.variation * 9));
        const stair = tile.stair ? ['north', 'east', 'south', 'west'].indexOf(tile.stair) + 1 : 0;
        const ground = tile.creekGround === 'grassland' ? 1 : tile.creekGround === 'plains' ? 2 : tile.creekGround === 'desert' ? 3 : 0;
        const surface = (((terrainIds.get(tile.terrain)! * 2 + Number(tile.farm !== undefined)) * 2 + Number(!!tile.beach)) * 9 + variant) * 3 + depths.bands[i];
        const ridge = ((tile.ridge ?? 0) * 8 + (tile.ridge ? tile.ridgeTier ?? 1 : 0)) * 5 + stair;
        const signature = ((ridge * 8192 + (surface * 2 + Number(!!tile.creek)) * 4 + ground) * 4
            + Number(!!tile.riverArt) * 2 + Number(!!tile.waterfall)) * 2 + Number(isSaltPan(tile));
        if (!incremental || signature !== signatures[i]) {
            signatures[i] = signature;
            if (incremental) dirty.push(i);
            const x = i % world.width, y = Math.floor(i / world.width);
            left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
    };
    if (local) for (const cell of changes.cells) inspect(cell);
    else for (let cell = 0; cell < world.tiles.length; cell++) inspect(cell);
    if (right < left) { if (incremental) previous.depths = depths; return; }
    left = Math.max(0, left - 1); top = Math.max(0, top - 1); right = Math.min(world.width - 1, right + 1); bottom = Math.min(world.height - 1, bottom + 1);
    const bounds = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    const regions = incremental ? dirtyTerrainRegions(dirty, world.width, world.height) : [bounds];
    const low = document.createElement('canvas');
    if (!incremental) { canvas.width = world.width * TILE_SIZE; canvas.height = world.height * TILE_SIZE; }
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    const water = incremental ? previous.water : new Uint8Array(world.width * world.height * 256), farmClips = incremental ? previous.farmClips : new Map<number, Path2D | null>();
    for (const region of regions) {
        const raster = rasterTerrain(world, region, undefined, undefined, undefined, 0, undefined, depths);
        low.width = raster.width; low.height = raster.height;
        const lowContext = low.getContext('2d')!, image = lowContext.createImageData(raster.width, raster.height);
        image.data.set(raster.pixels); lowContext.putImageData(image, 0, 0);
        context.drawImage(low, region.x * TILE_SIZE, region.y * TILE_SIZE, region.width * TILE_SIZE, region.height * TILE_SIZE);
        for (let row = 0; row < raster.height; row++) water.set(raster.water.subarray(row * raster.width, (row + 1) * raster.width), (region.y * 16 + row) * world.width * 16 + region.x * 16);
        for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) farmClips.delete(y * world.width + x);
    }
    painted.set(canvas, { world, seed: world.seed, signatures, depths, water, farmClips });
    return regions.length === 1 ? bounds : { ...bounds, regions };
}
