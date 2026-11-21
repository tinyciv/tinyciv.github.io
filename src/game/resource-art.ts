import { runtimeArtUrl } from './runtime-art';
import { type ResourceWorkKind, type Tile, type World, WATER } from './types';
import type { LivestockState } from './livestock';
import { rasterDirtRoad, trailArtVariant, type RoadLinks } from './road-sprites';
import { drawPuny, loadPunyWorld, punyWorldPixels } from './puny-world';
import { worldRevisions } from './world-revisions';
import { southernResourceCell } from './resource-worksite';
import { isOreMaterial, isSiteMaterial, loadOreArt, drawOreClump, drawGoldMineObjective, oreArtKey, ORE_FORMATION_COUNT, type OreClumpArt } from './ore-art';
import { buildLooseRockLayout, loadLooseRockArt, type LooseRockCell } from './outcrop-art';
import { rockOreArtHost, type RockPalette } from './rock-range-art';

export type ResourceArtKind = ResourceWorkKind;
export interface FenceArt {
    /** Exposed perimeter and optional access opening, N E S W. */
    fences: number;
    gate: number;
}
export interface ResourceCellArt extends FenceArt {
    resource: ResourceArtKind;
    developed: boolean;
    road: number;
    variant: number;
    /** Cached presentation geometry; no effect on deposits or navigation. */
    ore?: OreClumpArt;
    oreDraw?: boolean;
}

export interface PastureFenceCell extends FenceArt {
    x: number;
    y: number;
    faction: number;
}
const pastureLayouts = new WeakMap<LivestockState, { revision: number; cells: PastureFenceCell[] }>();
const NO_PASTURE_FENCES: readonly PastureFenceCell[] = Object.freeze([]);

/** Pastures contribute only their boundary cells to the scenery queue. */
export function pastureFenceCells(livestock: LivestockState | undefined): readonly PastureFenceCell[] {
    if (!livestock) return NO_PASTURE_FENCES;
    const cached = pastureLayouts.get(livestock);
    if (cached?.revision === livestock.revision) return cached.cells;
    const cells: PastureFenceCell[] = [];
    for (const { pasture } of livestock.herds) {
        if (!pasture) continue;
        const { x, y, width, height, faction } = pasture;
        const east = x + width - 1, south = y + height - 1;
        for (let column = x; column <= east; column++) {
            const sides = Number(column === x) * 8 | Number(column === east) * 2;
            cells.push({ x: column, y, faction, fences: 1 | sides, gate: 0 },
                { x: column, y: south, faction, fences: 4 | sides, gate: 0 });
        }
        for (let row = y + 1; row < south; row++) {
            cells.push({ x, y: row, faction, fences: 8, gate: 0 },
                { x: east, y: row, faction, fences: 2, gate: 0 });
        }
    }
    pastureLayouts.set(livestock, { revision: livestock.revision, cells });
    return cells;
}
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const KINDS: ReadonlySet<string> = new Set<ResourceArtKind>(['copper', 'iron', 'gold', 'stone', 'olives', 'salt', 'marble', 'peat', 'grapes', 'coal']);
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
    return loading ??= Promise.all([Promise.all(['cozy-farm-lite/fence-h.png', 'cozy-farm-lite/fence-v.png', 'cozy-farm-lite/fence-post.png'].map(async file => {
        const image = new Image(); image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/${file}`); await image.decode(); return image;
    })), loadLooseRockArt(), loadOreArt(), loadPunyWorld()]).then(([[horizontal, vertical, post]]) => {
        fenceH = compact(horizontal, Array.from({ length: 16 }, (_, x) => x), [6, 8, 10, 12, 13]);
        fenceV = compact(vertical, [6, 7, 9], Array.from({ length: 16 }, (_, y) => y));
        fencePost = compact(post, [5, 7, 10], [3, 6, 9, 12, 14, 15]);
    });
}
export function resourceHasArt(tile: Tile | undefined): boolean {
    return !!tile && KINDS.has(tile.resource ?? '') && !WATER.has(tile.terrain) && !tile.creek;
}

/** Keep the native 32px outcrop inside the mine's two-tile footprint. */
export function drawGoldMine(c: CanvasRenderingContext2D, active: boolean, palette?: RockPalette): void {
    drawGoldMineObjective(c, active, palette);
}

/** Shared by the game renderer and visual fixtures. No simulation mutations. */
export function buildResourceArtLayout(world: World, observedDevelopment?: Uint8Array, explored?: ArrayLike<number>): Map<number, ResourceCellArt> {
    const result = new Map<number, ResourceCellArt>();
    const { width, height, tiles } = world;
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height ? y * width + x : -1;
    for (let cell = 0; cell < tiles.length; cell++) {
        const tile = tiles[cell]; if (!resourceHasArt(tile)) continue;
        result.set(cell, { resource: tile.resource as ResourceArtKind, developed: observedDevelopment ? !!observedDevelopment[cell] : !!tile.resourceDeveloped,
            fences: 0, gate: 0, road: 0, variant: Math.floor(tile.variation * 0x1000000) & 1 });
    }
    const seen = new Set<number>();
    for (const [start, item] of result) {
        if (!item.developed || seen.has(start) || (item.resource !== 'salt' && item.resource !== 'olives')) continue;
        const group = [start]; seen.add(start);
        const same = (a: number, b: number): boolean => b >= 0 && !!result.get(b)?.developed
            && result.get(b)!.resource === item.resource
            && (tiles[a].resourceGroup === undefined || tiles[b].resourceGroup === undefined || tiles[a].resourceGroup === tiles[b].resourceGroup);
        for (let i = 0; i < group.length; i++) {
            const cell = group[i], x = cell % width, y = Math.floor(cell / width), current = result.get(cell)!;
            STEPS.forEach(([dx, dy], side) => {
                const next = at(x + dx, y + dy);
                if (!same(cell, next)) {
                    current.fences |= 1 << side;
                } else if (!seen.has(next)) { seen.add(next); group.push(next); }
            });
        }
        const southern = southernResourceCell(group, width)!;
        result.get(southern)!.gate = 4;
        if (item.resource !== 'salt') continue;
        const cx = group.reduce((sum, cell) => sum + cell % width, 0) / group.length;
        const cy = group.reduce((sum, cell) => sum + Math.floor(cell / width), 0) / group.length;
        const anchor = [...group].sort((a, b) => ((a % width - cx) ** 2 + (Math.floor(a / width) - cy) ** 2)
            - ((b % width - cx) ** 2 + (Math.floor(b / width) - cy) ** 2) || a - b)[0];
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
    return withOreClumps(world, result, explored);
}

/** Standard sites use their generated anchor. Sparse deposits share one clump per connected component. */
function withOreClumps(world: World, layout: Map<number, ResourceCellArt>, explored?: ArrayLike<number>): Map<number, ResourceCellArt> {
    const clumps = new Map<number, number[]>();
    const seen = new Set<number>();
    for (const [cell, art] of layout) if (isOreMaterial(art.resource) || art.resource === 'stone' || isSiteMaterial(art.resource)) {
        const sourceAnchor = world.tiles[cell].oreAnchor;
        if (sourceAnchor === undefined && (art.resource === 'stone' || isOreMaterial(art.resource))) {
            if (seen.has(cell)) continue;
            const members = [cell]; seen.add(cell);
            for (let i = 0; i < members.length; i++) {
                const current = members[i], x = current % world.width, y = Math.floor(current / world.width);
                for (const [dx, dy] of STEPS) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
                    const next = ny * world.width + nx;
                    if (seen.has(next) || layout.get(next)?.resource !== art.resource || world.tiles[next].oreAnchor !== undefined) continue;
                    const group = world.tiles[current].resourceGroup, nextGroup = world.tiles[next].resourceGroup;
                    if (group !== undefined && nextGroup !== undefined && group !== nextGroup) continue;
                    seen.add(next); members.push(next);
                }
            }
            clumps.set(cell, members);
            continue;
        }
        const anchor = sourceAnchor ?? cell, members = clumps.get(anchor) ?? [];
        members.push(cell); clumps.set(anchor, members);
    }
    let result = layout;
    for (const [sourceAnchor, members] of clumps) {
        const material = layout.get(members[0])!.resource as OreClumpArt['material'];
        const stone = material === 'stone', irregular = stone || isOreMaterial(material) && world.tiles[members[0]].oreAnchor === undefined;
        // A sparse component's bounding corner need not hold a resource.
        const tile = world.tiles[irregular ? members[0] : sourceAnchor];
        let anchor = sourceAnchor, x = anchor % world.width, y = Math.floor(anchor / world.width);
        let width = tile.oreWidth ?? 1, height = tile.oreHeight ?? 1;
        if (irregular) {
            let right = -1, bottom = -1; x = world.width; y = world.height;
            for (const cell of members) {
                const cx = cell % world.width, cy = Math.floor(cell / world.width);
                x = Math.min(x, cx); y = Math.min(y, cy); right = Math.max(right, cx); bottom = Math.max(bottom, cy);
            }
            // Keep the real member as a unique identity; two sparse components
            // can have the same empty northwest bounding corner.
            width = right - x + 1; height = bottom - y + 1;
        }
        const developed = material === 'marble'
            ? members.length === 4 && members.every(cell => layout.get(cell)!.developed)
            : !stone && members.some(cell => layout.get(cell)!.developed);
        const draw = members.find(cell => !explored || explored[cell]), visible: number[] = [];
        if (irregular && (material !== 'gold' || developed)) {
            // Keep explored holes in the image instead of cutting the mountain
            // into one fragment per occupied deposit cell.
            for (let row = 0; row < height; row++) for (let col = 0; col < width; col++)
                if (!explored || explored[(y + row) * world.width + x + col]) visible.push(row * width + col);
        } else for (const cell of members) if (!explored || explored[cell])
            visible.push((Math.floor(cell / world.width) - y) * width + cell % world.width - x);
        const formation = stone ? Math.floor(tile.variation * 0x1000000) % ORE_FORMATION_COUNT : undefined;
        const host = rockOreArtHost(world, world.tiles[members[0]].rockHost, sourceAnchor);
        const next: OreClumpArt = { anchor, x, y, width, height,
            material, formation, host,
            palette: tile.terrain === 'desert' || tile.terrain === 'plains' || tile.terrain === 'tundra' ? tile.terrain : 'grassland',
            visible, developed };
        const old = layout.get(members[0])!.ore;
        const ore = old && old.anchor === anchor && old.x === x && old.y === y && oreArtKey(old) === oreArtKey(next) ? old : next;
        for (const cell of members) {
            const art = layout.get(cell)!, oreDraw = cell === draw;
            if (art.ore === ore && art.oreDraw === oreDraw) continue;
            if (result === layout) result = new Map(layout);
            result.set(cell, { ...art, ore, oreDraw });
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
    private explorationRevision = -1;
    private allRubble: ReadonlyMap<number, LooseRockCell> = new Map();
    private rubble: ReadonlyMap<number, LooseRockCell> = new Map();
    get looseRocks(): ReadonlyMap<number, LooseRockCell> { return this.rubble; }
    observe(world: World, visible: Uint8Array, fogRevision: number, faction: number, owned?: Uint8Array,
        explored?: ArrayLike<number>, explorationRevision = 0): ReadonlyMap<number, ResourceCellArt> {
        const revision = worldRevisions(world).appearance;
        const reset = this.world !== world || this.faction !== faction || this.observed.length !== world.tiles.length;
        if (!reset && this.revision === revision && this.fogRevision === fogRevision && this.explorationRevision === explorationRevision) return this.layout;
        if (reset) { this.world = world; this.faction = faction; this.observed = new Uint8Array(world.tiles.length); }
        const geologyChanged = reset || this.revision !== revision;
        const explorationChanged = reset || this.explorationRevision !== explorationRevision;
        let changed = geologyChanged;
        for (let i = 0; i < world.tiles.length; i++) if (visible[i] || owned?.[i]) {
            const value = Number(!!world.tiles[i].resourceDeveloped);
            if (this.observed[i] !== value) { this.observed[i] = value; changed = true; }
        }
        this.revision = revision; this.fogRevision = fogRevision;
        this.explorationRevision = explorationRevision;
        if (changed) this.layout = buildResourceArtLayout(world, this.observed, explored);
        else if (explorationChanged) this.layout = withOreClumps(world, this.layout, explored);
        if (geologyChanged) this.allRubble = buildLooseRockLayout(world, this.layout.keys());
        if (geologyChanged || explorationChanged) this.rubble = explored
            ? new Map([...this.allRubble].filter(([, rocks]) => !!explored[rocks.source])) : this.allRubble;
        return this.layout;
    }
}

export function resourceObjectBounds(art: ResourceCellArt): { x: number; y: number; width: number; height: number } {
    if (art.ore) return { x: 0, y: 0, width: art.ore.width * 32, height: art.ore.height * 32 };
    return { x: 0, y: 0, width: 32, height: 32 };
}
export function resourceObjectKey(art: ResourceCellArt): string {
    if (art.ore) return `ore:${oreArtKey(art.ore)}`;
    if (art.resource === 'olives') return `olives:${art.variant}`;
    return `${art.resource}:${art.variant}:${Number(art.developed)}`;
}
export function resourceHasObject(art: ResourceCellArt): boolean { return art.ore ? !!art.oreDraw : art.resource !== 'salt' || art.developed; }

/** Broad, quiet evaporation beds on the same 16px grid as the original pan.
 * Rectangle runs give intentionally stepped round corners without smoothing. */
export function drawSaltFields(c: CanvasRenderingContext2D, x = 0, y = 0, size = 32): void {
    const pixel = size / 16;
    c.fillStyle = '#e7dac6'; // Existing approved dry-salt rim color.
    c.fillRect(x + 4 * pixel, y + 2 * pixel, 8 * pixel, 12 * pixel);
    c.fillRect(x + 3 * pixel, y + 3 * pixel, 10 * pixel, 10 * pixel);
    c.fillRect(x + 2 * pixel, y + 4 * pixel, 12 * pixel, 8 * pixel);
}
export function drawResourceObject(c: CanvasRenderingContext2D, art: ResourceCellArt, x = 0, y = 0, size = 32, oreOnly = false): void {
    if (art.resource === 'salt') {
        if (art.developed) drawSaltFields(c, x, y, size);
        return;
    }
    if (art.ore) { drawOreClump(c, art.ore, x, y, size, oreOnly); return; }
    if (art.resource === 'stone' || isOreMaterial(art.resource)) {
        drawOreClump(c, { anchor: 0, x: 0, y: 0, width: 1, height: 1,
            formation: art.variant % ORE_FORMATION_COUNT,
            material: art.resource, palette: 'grassland', visible: [0], developed: art.developed }, x, y, size, oreOnly);
        return;
    }
    if (art.resource !== 'olives') return;
    c.imageSmoothingEnabled = false;
    drawPuny(c, 48, art.variant === 0 ? 416 : 432, 16, 16, x, y, size, size);
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
export function drawResourceFence(c: CanvasRenderingContext2D, art: FenceArt, front = false, size = 32): void {
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
