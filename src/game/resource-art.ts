import { type Tile, type World, WATER } from './types';
import { rasterDirtRoad, trailArtVariant, type RoadLinks } from './road-sprites';
import { punyWorldPixels } from './puny-world';
import { worldRevisions } from './world-revisions';
import { southernResourceCell } from './resource-worksite';

export type ResourceArtKind = 'copper' | 'iron' | 'stone' | 'olives' | 'salt';
export interface ResourceCellArt {
    resource: ResourceArtKind;
    developed: boolean;
    /** One south-facing mine entrance per connected developed metal patch. */
    worksite: boolean;
    /** Exposed perimeter and optional access opening, N E S W. */
    fences: number;
    gate: number;
    road: number;
    variant: number;
}
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const KINDS = new Set(['copper', 'iron', 'stone', 'olives', 'salt']);
let objects: HTMLImageElement | undefined;
let fenceH: HTMLCanvasElement | undefined, fenceV: HTMLCanvasElement | undefined, fencePost: HTMLCanvasElement | undefined;
let loading: Promise<void> | undefined;
const roadPictures = new Map<string, HTMLCanvasElement>();

function compact(image: HTMLImageElement, columns: number[], rows: number[]): HTMLCanvasElement {
    const canvas = document.createElement('canvas'); canvas.width = columns.length; canvas.height = rows.length;
    const c = canvas.getContext('2d')!;
    rows.forEach((sy, y) => columns.forEach((sx, x) => c.drawImage(image, sx, sy, 1, 1, x, y, 1, 1)));
    return canvas;
}
export function loadResourceArt(): Promise<void> {
    return loading ??= Promise.all(['resources/resource-objects.png', 'cozy-farm-lite/fence-h.png', 'cozy-farm-lite/fence-v.png', 'cozy-farm-lite/fence-post.png'].map(async file => {
        const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/${file}`; await image.decode(); return image;
    })).then(([sheet, horizontal, vertical, post]) => {
        objects = sheet;
        fenceH = compact(horizontal, Array.from({ length: 16 }, (_, x) => x), [6, 8, 10, 12, 13]);
        fenceV = compact(vertical, [6, 7, 9], Array.from({ length: 16 }, (_, y) => y));
        fencePost = compact(post, [5, 7, 10], [3, 6, 9, 12, 14, 15]);
    });
}
export function resourceHasArt(tile: Tile | undefined): boolean {
    return !!tile && KINDS.has(tile.resource ?? '') && !WATER.has(tile.terrain) && !tile.creek;
}

/** Shared by the game renderer and visual fixtures. No simulation mutations. */
export function buildResourceArtLayout(world: World, observedDevelopment?: Uint8Array): Map<number, ResourceCellArt> {
    const result = new Map<number, ResourceCellArt>();
    const { width, height, tiles } = world;
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height ? y * width + x : -1;
    for (let cell = 0; cell < tiles.length; cell++) {
        const tile = tiles[cell]; if (!resourceHasArt(tile)) continue;
        result.set(cell, { resource: tile.resource as ResourceArtKind, developed: observedDevelopment ? !!observedDevelopment[cell] : !!tile.resourceDeveloped,
            worksite: false, fences: 0, gate: 0, road: 0, variant: Math.floor(tile.variation * 0x1000000) & 1 });
    }
    const seen = new Set<number>();
    for (const [start, item] of result) {
        if (!item.developed || seen.has(start)) continue;
        const group = [start]; seen.add(start);
        const same = (a: number, b: number): boolean => b >= 0 && !!result.get(b)?.developed
            && result.get(b)!.resource === item.resource
            && (tiles[a].resourceGroup === undefined || tiles[b].resourceGroup === undefined || tiles[a].resourceGroup === tiles[b].resourceGroup);
        for (let i = 0; i < group.length; i++) {
            const cell = group[i], x = cell % width, y = Math.floor(cell / width), current = result.get(cell)!;
            STEPS.forEach(([dx, dy], side) => {
                const next = at(x + dx, y + dy);
                if (!same(cell, next)) {
                    if (item.resource === 'salt' || item.resource === 'olives') current.fences |= 1 << side;
                } else if (!seen.has(next)) { seen.add(next); group.push(next); }
            });
        }
        const cx = group.reduce((sum, cell) => sum + cell % width, 0) / group.length;
        const cy = group.reduce((sum, cell) => sum + Math.floor(cell / width), 0) / group.length;
        const anchor = [...group].sort((a, b) => ((a % width - cx) ** 2 + (Math.floor(a / width) - cy) ** 2)
            - ((b % width - cx) ** 2 + (Math.floor(b / width) - cy) ** 2) || a - b)[0];
        const southern = southernResourceCell(group, width)!;
        if (item.resource === 'copper' || item.resource === 'iron') result.get(southern)!.worksite = true;
        if (item.resource === 'salt' || item.resource === 'olives') result.get(southern)!.gate = 4;
        if (item.resource !== 'salt') continue;
        // One dirt approach from the salt beds to a south perimeter opening.
        // It is decoration; fences do not alter movement or route connectivity.
        const members = new Set(group), queue = [anchor], previous = new Map<number, number>([[anchor, -1]]);
        for (let i = 0; i < queue.length; i++) {
            const cell = queue[i], x = cell % width, y = Math.floor(cell / width);
            for (const [dx, dy] of STEPS) {
                const next = at(x + dx, y + dy);
                if (members.has(next) && !previous.has(next)) { previous.set(next, cell); queue.push(next); }
            }
        }
        const exit = southern;
        result.get(exit)!.road |= 4;
        for (let cell = exit; previous.get(cell)! >= 0;) {
            const parent = previous.get(cell)!, dx = parent % width - cell % width, dy = Math.floor(parent / width) - Math.floor(cell / width);
            const side = STEPS.findIndex(([sx, sy]) => sx === dx && sy === dy);
            result.get(cell)!.road |= 1 << side; result.get(parent)!.road |= 1 << ((side + 2) % 4); cell = parent;
        }
    }
    return result;
}

/** Explored fog remembers resource worksites without revealing remote development. */
export class ResourceArtMemory {
    private world?: World;
    private faction?: number;
    private observed = new Uint8Array();
    private revision = -1;
    private fogRevision = -1;
    private layout = new Map<number, ResourceCellArt>();
    observe(world: World, visible: Uint8Array, fogRevision: number, faction: number, owned?: Uint8Array): ReadonlyMap<number, ResourceCellArt> {
        const revision = worldRevisions(world).appearance;
        const reset = this.world !== world || this.faction !== faction || this.observed.length !== world.tiles.length;
        if (!reset && this.revision === revision && this.fogRevision === fogRevision) return this.layout;
        if (reset) { this.world = world; this.faction = faction; this.observed = new Uint8Array(world.tiles.length); }
        let changed = reset || this.revision !== revision;
        for (let i = 0; i < world.tiles.length; i++) if (visible[i] || owned?.[i]) {
            const value = Number(!!world.tiles[i].resourceDeveloped);
            if (this.observed[i] !== value) { this.observed[i] = value; changed = true; }
        }
        this.revision = revision; this.fogRevision = fogRevision;
        if (changed) this.layout = buildResourceArtLayout(world, this.observed);
        return this.layout;
    }
}

export function resourceObjectBounds(art: ResourceCellArt): { x: number; y: number; width: number; height: number } {
    return art.resource === 'olives' && art.variant ? { x: 0, y: -32, width: 32, height: 64 } : { x: 0, y: 0, width: 32, height: 32 };
}
export function resourceObjectKey(art: ResourceCellArt): string { return `${art.resource}:${Number(art.worksite)}:${art.variant}:${Number(art.developed)}`; }
export function resourceHasObject(art: ResourceCellArt): boolean { return art.resource !== 'salt' || art.developed; }

/** Broad, quiet evaporation beds on the same 16px grid as the original pan.
 * Rectangle runs give intentionally stepped round corners without smoothing. */
export function drawSaltFields(c: CanvasRenderingContext2D, x = 0, y = 0, size = 32): void {
    const pixel = size / 16;
    c.fillStyle = '#e7dac6'; // Existing approved dry-salt rim color.
    c.fillRect(x + 4 * pixel, y + 2 * pixel, 8 * pixel, 12 * pixel);
    c.fillRect(x + 3 * pixel, y + 3 * pixel, 10 * pixel, 10 * pixel);
    c.fillRect(x + 2 * pixel, y + 4 * pixel, 12 * pixel, 8 * pixel);
}
export function drawResourceObject(c: CanvasRenderingContext2D, art: ResourceCellArt, x = 0, y = 0, size = 32): void {
    if (art.resource === 'salt') {
        if (art.developed) drawSaltFields(c, x, y, size);
        return;
    }
    if (!objects) return;
    c.imageSmoothingEnabled = false;
    const pixel = size / 16;
    if (art.resource === 'olives') {
        const height = art.variant ? 32 : 16;
        c.drawImage(objects, art.variant ? 64 : 48, 0, 16, height, x, y + size - height * pixel, size, height * pixel);
    } else {
        const column = art.resource === 'copper' ? 0 : art.resource === 'iron' ? 16 : 32;
        c.drawImage(objects, column, art.resource !== 'stone' && art.worksite ? 16 : 0, 16, 16, x, y, size, size);
    }
}
export function drawResourceRoad(c: CanvasRenderingContext2D, art: ResourceCellArt, x: number, y: number): void {
    if (!art.road) return;
    const atlas = punyWorldPixels(); if (!atlas) return;
    const links: RoadLinks = { north: !!(art.road & 1), east: !!(art.road & 2), south: !!(art.road & 4), west: !!(art.road & 8) };
    const variant = trailArtVariant(x, y), key = `${art.road}:${variant}`;
    let picture = roadPictures.get(key);
    if (!picture) {
        picture = document.createElement('canvas'); picture.width = picture.height = 32;
        const pixels = rasterDirtRoad(links, atlas, 'trail', variant), context = picture.getContext('2d')!;
        // Original paths contain a grass-colored shoulder. Salt approaches
        // reveal the white crust through that shoulder instead of adding moss.
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > pixels[i] && pixels[i + 1] > pixels[i + 2] * 1.2) pixels[i + 3] = 0;
        const image = context.createImageData(32, 32); image.data.set(pixels); context.putImageData(image, 0, 0);
        roadPictures.set(key, picture);
    }
    c.drawImage(picture, 0, 0);
}
export function drawResourceFence(c: CanvasRenderingContext2D, art: ResourceCellArt, front = false, size = 32): void {
    if (!fenceH || !fenceV || !fencePost || !art.fences) return;
    c.save(); c.scale(size / 16, size / 16); c.imageSmoothingEnabled = false;
    const horizontal = (y: number, gate: boolean) => {
        if (gate) { c.drawImage(fenceH!, 0, 0, 5, 5, 0, y, 5, 5); c.drawImage(fenceH!, 11, 0, 5, 5, 11, y, 5, 5); }
        else c.drawImage(fenceH!, 0, y);
    };
    if (front) {
        if (art.fences & 4) { horizontal(11, !!(art.gate & 4)); c.drawImage(fencePost, 0, 10); c.drawImage(fencePost, 13, 10); }
    } else {
        if (art.fences & 1) { horizontal(-3, !!(art.gate & 1)); c.drawImage(fencePost, 0, -4); c.drawImage(fencePost, 13, -4); }
        if (art.fences & 8) c.drawImage(fenceV, 0, 0);
        if (art.fences & 2) c.drawImage(fenceV, 13, 0);
    }
    c.restore();
}
