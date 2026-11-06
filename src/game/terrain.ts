import { TILE_SIZE, WATER, type Terrain, type Tile, type World } from './types';
import { drawPuny, punyDesertLedgeImage, punyDesertLedgePixels, punyWorldPixels } from './puny-world';
import { prepareWaterDepth, waterDepthField, WATER_BAND_COLORS, type WaterDepthField } from './water-depth';
import { ridgeQuads } from './ridge-art';
import { creekConnections, creekLayers, creekMouthConnections, drawCreekWater } from './creek-art';
import { bankedRiver, bankedRiverPixels, bankedRiverSprite, drawBankedRiver, riverWaterPixel, WATERFALL_FRAME_SECONDS } from './banked-river-art';
export { waterDepthAt, waterDepthField, prepareWaterDepth } from './water-depth';

/** Minimap colors sampled from the native tiles; game ground is always atlas art. */
export const TERRAIN_COLORS: Record<Terrain, string> = {
    ocean: '#038aab', coast: '#2bc4a9', river: '#2bc4a9', lake: '#2bc4a9',
    grassland: '#85a643', plains: '#c9b266', desert: '#c9b266', tundra: '#85a643',
};
export interface TerrainRaster { width: number; height: number; pixels: Uint8ClampedArray; water: Uint8Array }
export interface TerrainRegion { x: number; y: number; width: number; height: number }
export interface TerrainQuad { sx: number; sy: number; dx: number; dy: number; shallowGrass?: boolean }
const at = (world: World, x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height ? world.tiles[y * world.width + x] : undefined;
const isSand = (tile?: Tile) => {
    const ground = tile?.creek || bankedRiver(tile) ? tile?.creekGround : tile?.terrain;
    return ground === 'desert' || ground === 'plains';
};
const broadWater = (tile?: Tile) => !!tile && !tile.creek && !bankedRiver(tile) && WATER.has(tile.terrain);

export function terrainMinimapColor(world: World, x: number, y: number): string {
    const tile = at(world, x, y)!;
    if (tile.creek || bankedRiver(tile)) return '#04a0b4';
    if (tile.ridge) return isSand(tile) ? '#a7956b' : '#758b40';
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

/** Native atlas source rectangles, shared by cached and animated terrain. */
export function terrainQuads(world: World, x: number, y: number, frame = 0, depths = waterDepthField(world)): TerrainQuad[] {
    const tile = at(world, x, y)!;
    const relief = ridgeQuads(world, x, y);
    if (relief) return relief;
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
    // Use the shore's matching warm sand palette for every connected sandy
    // biome; adjoining inland dunes must not introduce a square color seam.
    if (isSand(tile)) return autotile(x, y, (nx, ny) => {
        const neighbor = at(world, nx, ny);
        return isSand(neighbor) || (!!tile.beach && broadWater(neighbor));
    }, 22, 0, 25, 0);
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

/** Keep the original grassy bank shape, but use the atlas's turquoise shelf
 * fill in place of its cyan fill. Its grass, foam, and animation stay intact. */
const shelfFill = (r: number, g: number, b: number): boolean => r === 4 && g === 160 && b === 180;
let shallowGrassSheet: HTMLCanvasElement | undefined;
function grassShelfSheet(): HTMLCanvasElement | undefined {
    if (shallowGrassSheet) return shallowGrassSheet;
    const source = punyWorldPixels();
    if (!source) return;
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    const c = canvas.getContext('2d')!, pixels = c.createImageData(source.width, source.height);
    pixels.data.set(source.data);
    for (let i = 0; i < pixels.data.length; i += 4) if (shelfFill(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])) {
        pixels.data[i] = 43; pixels.data[i + 1] = 196; pixels.data[i + 2] = 169;
    }
    c.putImageData(pixels, 0, 0); shallowGrassSheet = canvas; return canvas;
}

/** Native source pixels and the matching native shelf fill share one shoreline clip. */
export function rasterTerrain(world: World, region?: TerrainRegion, source = punyWorldPixels(), desertLedges = punyDesertLedgePixels()): TerrainRaster {
    if (!source) throw new Error('Load Puny World before painting terrain.');
    const depths = prepareWaterDepth(world);
    const originX = region?.x ?? 0, originY = region?.y ?? 0;
    const width = (region?.width ?? world.width) * 16, height = (region?.height ?? world.height) * 16;
    const pixels = new Uint8ClampedArray(width * height * 4), water = new Uint8Array(width * height);
    for (let ty = 0; ty < height / 16; ty++) for (let tx = 0; tx < width / 16; tx++) {
        const tile = at(world, originX + tx, originY + ty)!;
        const sandyRidge = !!tile.ridge && isSand(tile);
        const sheet = sandyRidge ? desertLedges : source;
        if (!sheet) throw new Error('Load desert ledges before painting sandy ridges.');
        const sourceY = sandyRidge ? 64 : 0;
        for (const q of terrainQuads(world, originX + tx, originY + ty, 0, depths)) for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
            const src = ((q.sy - sourceY + py) * sheet.width + q.sx + px) * 4;
            const i = (ty * 16 + q.dy + py) * width + tx * 16 + q.dx + px;
            pixels.set(sheet.data.subarray(src, src + 4), i * 4);
            if (q.shallowGrass && shelfFill(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2])) {
                pixels[i * 4] = 43; pixels[i * 4 + 1] = 196; pixels[i * 4 + 2] = 169;
            }
            // The native cyan, turquoise, and pale foam shades are water;
            // olive grass/earth and beach sand remain available to the farm clip.
            water[i] = Number(broadWater(tile) && sheet.data[src + 1] > sheet.data[src] + 20 && sheet.data[src + 2] > sheet.data[src] + 20);
        }
        for (const layer of creekLayers(world, originX + tx, originY + ty, 0)) for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
            const src = ((layer.sy + py) * layer.pixels.width + layer.sx + px) * 4, alpha = layer.pixels.data[src + 3] / 255;
            if (!alpha) continue;
            const i = (ty * 16 + py) * width + tx * 16 + px;
            for (let channel = 0; channel < 3; channel++) pixels[i * 4 + channel] = Math.round(
                layer.pixels.data[src + channel] * alpha + pixels[i * 4 + channel] * (1 - alpha));
            pixels[i * 4 + 3] = 255;
            water[i] = Number(layer.pixels.data[src + 1] > layer.pixels.data[src] + 20 && layer.pixels.data[src + 2] > layer.pixels.data[src] + 20);
        }
        const river = bankedRiverSprite(world, originX + tx, originY + ty);
        if (river) {
            const riverSheet = bankedRiverPixels(source, isSand(tile), desertLedges);
            for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
                const src = ((river[1] + py) * riverSheet.width + river[0] + px) * 4;
                const i = (ty * 16 + py) * width + tx * 16 + px;
                pixels.set(riverSheet.data.subarray(src, src + 4), i * 4);
                water[i] = Number(riverWaterPixel(riverSheet.data[src], riverSheet.data[src + 1], riverSheet.data[src + 2]));
            }
        }
    }
    return { width, height, pixels, water };
}

export function waterAnimationFrame(tile: Tile, time: number): number {
    return ((Math.floor(time * (tile.waterfall ? 1 / WATERFALL_FRAME_SECONDS : 3)) % 4) + 4) % 4;
}

export function drawAnimatedWater(c: CanvasRenderingContext2D, world: World, tx: number, ty: number, x: number, y: number, size: number, time: number): void {
    const tile = at(world, tx, ty)!;
    if (!WATER.has(tile.terrain)) return;
    const frame = waterAnimationFrame(tile, time);
    const desertLedge = tile.ridge && isSand(tile) ? punyDesertLedgeImage() : undefined;
    for (const q of terrainQuads(world, tx, ty, frame)) {
        const sheet = q.shallowGrass ? grassShelfSheet() : undefined;
        if (desertLedge) c.drawImage(desertLedge, q.sx, q.sy - 64, 8, 8, x + q.dx / 16 * size, y + q.dy / 16 * size, size / 2, size / 2);
        else if (sheet) c.drawImage(sheet, q.sx, q.sy, 8, 8, x + q.dx / 16 * size, y + q.dy / 16 * size, size / 2, size / 2);
        else drawPuny(c, q.sx, q.sy, 8, 8, x + q.dx / 16 * size, y + q.dy / 16 * size, size / 2, size / 2);
    }
    drawCreekWater(c, world, tx, ty, x, y, size, frame);
    drawBankedRiver(c, world, tx, ty, x, y, size, frame, isSand(tile));
}

/** Animation and crop caches include the narrow ribbon and its actual ground. */
export function waterArtKey(world: World, x: number, y: number, frame = 0): string {
    const tile = at(world, x, y)!;
    return `${JSON.stringify(terrainQuads(world, x, y, frame))}:${Number(!!tile.creek)}:${tile.creek ? creekConnections(world, x, y) || 5 : creekMouthConnections(world, x, y)}:${frame}:${Number(isSand(tile))}:${JSON.stringify(bankedRiverSprite(world, x, y, frame))}`;
}

const terrainIds = new Map(Object.keys(TERRAIN_COLORS).map((terrain, i) => [terrain, i]));
const painted = new WeakMap<HTMLCanvasElement, { world: World; seed: string; signatures: Float64Array; water: Uint8Array; farmClips: Map<number, Path2D | null> }>();

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

/** Repaint changed depth bands as well as tile edits and their native rims. */
export function paintTerrain(canvas: HTMLCanvasElement, world: World): TerrainRegion | undefined {
    const previous = painted.get(canvas), signatures = new Float64Array(world.tiles.length), depths = prepareWaterDepth(world);
    let left = world.width, top = world.height, right = -1, bottom = -1;
    const incremental = previous?.world === world && previous.seed === world.seed && canvas.width === world.width * TILE_SIZE && canvas.height === world.height * TILE_SIZE;
    for (let i = 0; i < world.tiles.length; i++) {
        const tile = world.tiles[i];
        const variant = Math.min(8, Math.floor(tile.variation * 9));
        const stair = tile.stair ? ['north', 'east', 'south', 'west'].indexOf(tile.stair) + 1 : 0;
        const ground = tile.creekGround === 'grassland' ? 1 : tile.creekGround === 'plains' ? 2 : tile.creekGround === 'desert' ? 3 : 0;
        const surface = (((terrainIds.get(tile.terrain)! * 2 + Number(tile.farm !== undefined)) * 2 + Number(!!tile.beach)) * 9 + variant) * 3 + depths.bands[i];
        // Eight height slots support stacked mountain shelves. Float64 keeps
        // large plateau IDs exact instead of wrapping a 32-bit signature.
        signatures[i] = ((((tile.ridge ?? 0) * 8 + (tile.ridge ? tile.ridgeTier ?? 1 : 0)) * 5 + stair) * 8192
            + (surface * 2 + Number(!!tile.creek)) * 4 + ground) * 4 + Number(!!tile.riverArt) * 2 + Number(!!tile.waterfall);
        if (!incremental || signatures[i] !== previous.signatures[i]) {
            const x = i % world.width, y = Math.floor(i / world.width);
            left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
    }
    if (right < left) return;
    left = Math.max(0, left - 1); top = Math.max(0, top - 1); right = Math.min(world.width - 1, right + 1); bottom = Math.min(world.height - 1, bottom + 1);
    const region = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, raster = rasterTerrain(world, region), low = document.createElement('canvas');
    low.width = raster.width; low.height = raster.height;
    const lowContext = low.getContext('2d')!, image = lowContext.createImageData(raster.width, raster.height);
    image.data.set(raster.pixels); lowContext.putImageData(image, 0, 0);
    if (!incremental) { canvas.width = world.width * TILE_SIZE; canvas.height = world.height * TILE_SIZE; }
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.drawImage(low, left * TILE_SIZE, top * TILE_SIZE, region.width * TILE_SIZE, region.height * TILE_SIZE);
    const water = incremental ? previous.water : new Uint8Array(world.width * world.height * 256), farmClips = incremental ? previous.farmClips : new Map<number, Path2D | null>();
    for (let row = 0; row < raster.height; row++) water.set(raster.water.subarray(row * raster.width, (row + 1) * raster.width), (top * 16 + row) * world.width * 16 + left * 16);
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) farmClips.delete(y * world.width + x);
    painted.set(canvas, { world, seed: world.seed, signatures, water, farmClips });
    return region;
}
