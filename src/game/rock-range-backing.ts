import atlas from './rock-range-frames.json';
import { drawRockFrame, rockFrameCoverage, rockPalette, rockUsesAlternate, type RockPalette } from './rock-range-art';
import type { FogView } from './fog';
import { WATER, type Point, type World } from './types';

const native = 16, tileSize = 32;
const chunkEdge = 32, chunkHalo = 3, maxWholeEdge = 48, maxWholeArea = 1024;
export const ROCK_BACKING_MIN_TILE_PIXELS = 4;

interface VisibleBacking {
    exploration: FogView['explored'];
    revision: number;
    key: string;
    cells?: number[];
}

interface RangeBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface RockRangeBacking extends RangeBounds {
    id: number;
    image: HTMLCanvasElement;
    cells: number[];
    visible?: VisibleBacking;
}

interface RangeChunk extends RangeBounds {
    cells: number[];
    backing?: RockRangeBacking | null;
}

interface RangePlan extends RangeBounds {
    anchor: number;
    members: number[];
    hosts: ReadonlySet<number>;
    cells: number[];
    chunks?: Map<number, RangeChunk>;
    backing?: RockRangeBacking | null;
}

interface BackingView {
    left: number;
    right: number;
    top: number;
    bottom: number;
    tilePixels: number;
}

const noBackings: readonly RockRangeBacking[] = [];
const maps = new WeakMap<World, { geometry: number; tiles: World['tiles']; plans: Map<number, RangePlan | null> }>();
let nextBacking = 0;

function frameFor(world: World, anchor: number) {
    const tile = world.tiles[anchor];
    return tile?.rockOre === undefined && tile?.rockFormation !== undefined ? atlas.frames[tile.rockFormation] : undefined;
}

/** Visit neighboring stamps by their indexed footings, once per range. */
function rangePlan(world: World, anchor: number, geometry: number): RangePlan | undefined {
    if (!frameFor(world, anchor)) return;
    let map = maps.get(world);
    if (!map || map.geometry !== geometry || map.tiles !== world.tiles) {
        map = { geometry, tiles: world.tiles, plans: new Map() };
        maps.set(world, map);
    }
    const previous = map.plans.get(anchor);
    if (previous !== undefined) return previous ?? undefined;
    const members = [anchor], seen = new Set(members), cells: number[] = [];
    const { width: worldWidth, height: worldHeight, tiles } = world;
    let west = worldWidth, north = worldHeight, east = 0, south = 0;
    const follow = (cell: number): void => {
        const host = tiles[cell]?.rockHost;
        if (host === undefined || seen.has(host) || !frameFor(world, host)) return;
        seen.add(host);
        members.push(host);
    };
    for (let cursor = 0; cursor < members.length; cursor++) {
        const member = members[cursor], frame = frameFor(world, member)!;
        const x = member % worldWidth, y = Math.floor(member / worldWidth);
        const right = x + frame.width / native, end = y + frame.height / native;
        west = Math.min(west, x); north = Math.min(north, y);
        east = Math.max(east, right); south = Math.max(south, end);
        for (let row = y; row < end; row++) for (let col = x; col < right; col++) {
            const cell = row * worldWidth + col;
            cells.push(cell);
            if (col === x && col > 0) follow(cell - 1);
            if (col + 1 === right && right < worldWidth) follow(cell + 1);
            if (row === y && row > 0) follow(cell - worldWidth);
            if (row + 1 === end && end < worldHeight) follow(cell + worldWidth);
        }
    }
    if (members.length === 1) { map.plans.set(anchor, null); return; }
    const width = east - west, height = south - north;
    const plan: RangePlan = { anchor, members, hosts: seen, cells, x: west, y: north, width, height };
    if (Math.max(width, height) > maxWholeEdge || width * height > maxWholeArea) {
        const chunks = new Map<number, RangeChunk>();
        for (const cell of cells) {
            const cx = Math.floor((cell % worldWidth) / chunkEdge), cy = Math.floor(Math.floor(cell / worldWidth) / chunkEdge);
            const key = cy * worldWidth + cx, previous = chunks.get(key);
            if (previous) { previous.cells.push(cell); continue; }
            const x = cx * chunkEdge, y = cy * chunkEdge;
            chunks.set(key, { x, y, width: Math.min(chunkEdge, worldWidth - x), height: Math.min(chunkEdge, worldHeight - y), cells: [cell] });
        }
        plan.chunks = chunks;
    }
    for (const member of members) map.plans.set(member, plan);
    return plan;
}

function wholeBacking(world: World, plan: RangePlan): RockRangeBacking | null {
    if (plan.backing === undefined) plan.backing = buildBacking(world, plan.members, plan.cells, plan);
    return plan.backing;
}

/** Small authored ranges also expose their single backing to visual fixtures. */
export function rockRangeBacking(world: World, anchor: number, geometry: number): RockRangeBacking | undefined {
    const plan = rangePlan(world, anchor, geometry);
    return plan && !plan.chunks ? wholeBacking(world, plan) ?? undefined : undefined;
}

function chunkBacking(world: World, plan: RangePlan, chunk: RangeChunk): RockRangeBacking | null {
    const x = Math.max(plan.x, chunk.x - chunkHalo), y = Math.max(plan.y, chunk.y - chunkHalo);
    const right = Math.min(plan.x + plan.width, chunk.x + chunk.width + chunkHalo);
    const bottom = Math.min(plan.y + plan.height, chunk.y + chunk.height + chunkHalo);
    const members = new Set<number>(), cells: number[] = [];
    for (let row = y; row < bottom; row++) for (let col = x; col < right; col++) {
        const cell = row * world.width + col, host = world.tiles[cell].rockHost;
        if (host === undefined || !plan.hosts.has(host)) continue;
        members.add(host);
        cells.push(cell);
    }
    return members.size > 1 ? buildBacking(world, [...members], cells, { x, y, width: right - x, height: bottom - y }, chunk) : null;
}

/** Long ranges keep camera-local gap textures without baking a mostly empty diagonal rectangle. */
export function visibleRockRangeBackings(world: World, anchor: number, geometry: number, view: BackingView,
    fog: FogView, visited: Set<number>): readonly RockRangeBacking[] {
    const plan = rangePlan(world, anchor, geometry);
    if (!plan || visited.has(plan.anchor)) return noBackings;
    visited.add(plan.anchor);
    if (!plan.chunks) {
        const backing = wholeBacking(world, plan);
        return backing ? [backing] : noBackings;
    }
    if (view.tilePixels < ROCK_BACKING_MIN_TILE_PIXELS) return noBackings;
    const left = Math.floor(Math.max(plan.x, view.left - chunkHalo) / chunkEdge);
    const top = Math.floor(Math.max(plan.y, view.top - chunkHalo) / chunkEdge);
    const right = Math.ceil(Math.min(plan.x + plan.width, view.right + chunkHalo) / chunkEdge);
    const bottom = Math.ceil(Math.min(plan.y + plan.height, view.bottom + chunkHalo) / chunkEdge);
    const result: RockRangeBacking[] = [];
    for (let row = top; row < bottom; row++) for (let col = left; col < right; col++) {
        const chunk = plan.chunks.get(row * world.width + col);
        if (!chunk) continue;
        if (chunk.backing === undefined && chunk.cells.some(cell => fog.explored[cell]))
            chunk.backing = chunkBacking(world, plan, chunk);
        if (chunk.backing) result.push(chunk.backing);
    }
    return result;
}

function buildBacking(world: World, members: number[], cells: number[], { x, y, width, height }: RangeBounds,
    core?: RangeBounds): RockRangeBacking | null {
    // A one-pixel border gives the exterior flood a starting point.
    const w = width * native + 2, h = height * native + 2;
    const image = document.createElement('canvas');
    image.width = w; image.height = h;
    const context = image.getContext('2d', { willReadFrequently: true })!;
    // Halo stamps can extend outside the analysis window. Leave its exterior border clear.
    context.save(); context.beginPath(); context.rect(1, 1, w - 2, h - 2); context.clip();
    for (const member of members) {
        const tile = world.tiles[member], variant = tile.rockFormation!, frame = atlas.frames[variant];
        drawRockFrame(context, rockPalette(tile.terrain), variant, !!tile.rockMirror,
            1 + (member % world.width - x) * native, 1 + (Math.floor(member / world.width) - y) * native,
            frame.width, frame.height, rockUsesAlternate(tile, variant));
    }
    context.restore();
    const silhouette = context.getImageData(0, 0, w, h).data;
    const empty = 0, rock = 1, outside = 2, gap = 3, filled = 4;
    const pixels = new Uint8Array(w * h);
    for (let i = 0; i < pixels.length; i++) pixels[i] = silhouette[i * 4 + 3] ? rock : empty;

    const exterior = new Uint32Array(pixels.length);
    const markExterior = () => {
        for (let i = 0; i < pixels.length; i++) if (pixels[i] !== rock && pixels[i] !== filled) pixels[i] = empty;
        let end = 1;
        pixels[0] = outside;
        for (let cursor = 0; cursor < end; cursor++) {
            const i = exterior[cursor], col = i % w, row = Math.floor(i / w);
            for (let py = Math.max(0, row - 1); py < Math.min(h, row + 2); py++) {
                for (let px = Math.max(0, col - 1); px < Math.min(w, col + 2); px++) {
                    const p = py * w + px;
                    if (pixels[p] !== empty) continue;
                    pixels[p] = outside;
                    exterior[end++] = p;
                }
            }
        }
    };
    const hostAt = (i: number) => {
        const col = x + Math.floor((i % w - 1) / native);
        const row = y + Math.floor((Math.floor(i / w) - 1) / native);
        return world.tiles[row * world.width + col]?.rockHost;
    };
    const markJoinLine = (start: number, length: number, step: number, limit: number) => {
        let previous = -1;
        for (let n = 0; n < length; n++) {
            const i = start + n * step;
            if (pixels[i] !== rock) continue;
            const gapLength = n - previous;
            if (previous >= 0 && gapLength > 1 && gapLength <= limit && hostAt(i) !== hostAt(start + previous * step)) {
                for (let t = previous + 1; t < n; t++) pixels[start + t * step] = gap;
            }
            previous = n;
        }
    };
    // Mark short seams between stamps, including slanted joins between offset shelves.
    const markJoins = () => {
        const maxJoin = native + 5;
        const diagonalLimit = Math.floor(maxJoin / Math.SQRT2);
        const insideWidth = w - 2, insideHeight = h - 2;
        for (let row = 1; row <= insideHeight; row++) markJoinLine(row * w + 1, insideWidth, 1, maxJoin);
        for (let col = 1; col <= insideWidth; col++) {
            markJoinLine(w + col, insideHeight, w, maxJoin);
            markJoinLine(w + col, Math.min(insideHeight, insideWidth - col + 1), w + 1, diagonalLimit);
            markJoinLine(w + col, Math.min(insideHeight, col), w - 1, diagonalLimit);
        }
        for (let row = 2; row <= insideHeight; row++) {
            const length = Math.min(insideWidth, insideHeight - row + 1);
            markJoinLine(row * w + 1, length, w + 1, diagonalLimit);
            markJoinLine(row * w + insideWidth, length, w - 1, diagonalLimit);
        }
    };
    const paletteCells = new Map<number, RockPalette>();
    for (const cell of cells) {
        const tile = world.tiles[cell];
        if (!tile.villageTrail && !tile.resource && !tile.creek && !WATER.has(tile.terrain))
            paletteCells.set(cell, rockPalette(tile.terrain));
    }
    const reserved = new Uint8Array(pixels.length);
    for (const cell of paletteCells.keys()) {
        const px = 1 + (cell % world.width - x) * native, py = 1 + (Math.floor(cell / world.width) - y) * native;
        for (let row = py; row < py + native; row++) reserved.fill(1, row * w + px, row * w + px + native);
    }
    const ownsCenter = (px: number, py: number): boolean => !core ||
        px >= 1 + (core.x - x) * native && px < 1 + (core.x + core.width - x) * native &&
        py >= 1 + (core.y - y) * native && py < 1 + (core.y + core.height - y) * native;
    const findSamples = () => {
        const samples: { x: number; y: number; palette: RockPalette }[] = [];
        const sampleSize = native / 2;
        for (let py = 1; py < h - 1; py += sampleSize) for (let px = 1; px < w - 1; px += sampleSize) {
            const tile = (y + Math.floor((py - 1) / native)) * world.width + x + Math.floor((px - 1) / native);
            const palette = paletteCells.get(tile);
            let totalX = 0, totalY = 0, count = 0;
            for (let dy = 0; dy < sampleSize; dy++) for (let dx = 0; dx < sampleSize; dx++) {
                const i = (py + dy) * w + px + dx;
                if (pixels[i] !== empty && pixels[i] !== gap) continue;
                pixels[i] = palette ? gap : outside;
                totalX += px + dx; totalY += py + dy; count++;
            }
            if (palette && count && ownsCenter(px, py)) samples.push({ x: Math.round(totalX / count), y: Math.round(totalY / count), palette });
        }
        return samples;
    };

    context.clearRect(0, 0, w, h);
    let placed = false;
    // Bridge neighboring rock faces, then check for pockets those bridges enclosed.
    for (const bridgeJoins of [true, false]) {
        markExterior();
        if (bridgeJoins) markJoins();
        for (const sample of findSamples()) {
            let best: { sprite: GapSprite; x: number; y: number } | undefined, bestScore = 0;
            for (const sprite of gapSprites(sample.palette)) {
                for (const dy of [0, -2, 2]) for (const dx of [0, -2, 2]) {
                    if (!ownsCenter(sample.x + dx, sample.y + dy)) continue;
                    const sx = sample.x - sprite.centerX + dx, sy = sample.y - sprite.centerY + dy;
                    if (sx < 0 || sy < 0 || sx + sprite.width > w || sy + sprite.height > h) continue;
                    let gain = 0, spill = 0, spanning = !bridgeJoins, firstHost: number | undefined;
                    for (const point of sprite.coverage) {
                        const i = (sy + point.y) * w + sx + point.x, p = pixels[i];
                        if (!reserved[i] && p !== rock || !bridgeJoins && p === outside) { gain = 0; break; }
                        if (p === gap) gain++;
                        else if (p === outside) spill++;
                        else if (p === rock && !spanning) {
                            const host = hostAt(i);
                            if (firstHost === undefined) firstHost = host;
                            else if (host !== firstHost) spanning = true;
                        }
                    }
                    const score = 3 * gain - spill;
                    if (spanning && gain > (bridgeJoins ? 3 : 0) && score > bestScore) {
                        best = { sprite, x: sx, y: sy };
                        bestScore = score;
                    }
                }
            }
            if (!best) continue;
            const { sprite, x: sx, y: sy } = best;
            drawRockFrame(context, sample.palette, sprite.variant, sprite.mirror, sx, sy, sprite.width, sprite.height);
            for (const point of sprite.coverage) {
                const i = (sy + point.y) * w + sx + point.x;
                if (pixels[i] !== rock) pixels[i] = filled;
            }
            placed = true;
        }
    }
    return placed ? { id: nextBacking++, x, y, width, height, image, cells } : null;
}

interface GapSprite {
    variant: number; mirror: boolean; width: number; height: number;
    centerX: number; centerY: number; coverage: Point[];
}
const gapCatalog = new Map<RockPalette, GapSprite[]>();

function gapSprites(palette: RockPalette): GapSprite[] {
    const existing = gapCatalog.get(palette);
    if (existing) return existing;
    const centers = [{ variant: 1, x: 8, y: 7 }, { variant: 0, x: 20, y: 7 }, { variant: 3, x: 25, y: 18 }];
    const sprites = centers.flatMap(({ variant, x, y }) => [false, true].map(mirror => {
        const { width, height } = atlas.frames[variant];
        return { variant, mirror, width, height, centerX: mirror ? width - x - 1 : x, centerY: y,
            coverage: rockFrameCoverage(palette, variant, mirror) };
    }));
    gapCatalog.set(palette, sprites);
    return sprites;
}

export function rockBackingVisibility(backing: RockRangeBacking, fog: FogView): VisibleBacking {
    const previous = backing.visible;
    if (previous?.exploration === fog.explored && previous.revision === fog.explorationRevision) return previous;
    const cells = backing.cells.filter(cell => fog.explored[cell]);
    const full = cells.length === backing.cells.length;
    return backing.visible = { exploration: fog.explored, revision: fog.explorationRevision,
        key: full ? 'all' : cells.join(','), cells: full ? undefined : cells };
}

export function drawRockBacking(c: CanvasRenderingContext2D, backing: RockRangeBacking,
    worldWidth: number, visible: VisibleBacking): void {
    c.save(); c.imageSmoothingEnabled = false;
    if (visible.cells) {
        c.beginPath();
        for (const cell of visible.cells) c.rect((cell % worldWidth - backing.x) * tileSize,
            (Math.floor(cell / worldWidth) - backing.y) * tileSize, tileSize, tileSize);
        c.clip();
    }
    c.drawImage(backing.image, 1, 1, backing.width * native, backing.height * native,
        0, 0, backing.width * tileSize, backing.height * tileSize);
    c.restore();
}
