import atlas from './rock-range-frames.json';
import { hostedOreLayer } from './hosted-ore-art';
import type { FogView } from './fog';
import type { ArtBounds } from './native-art';
import type { Point, Tile, World } from './types';

const palettes = ['temperate', 'plains', 'desert', 'tundra'] as const;
export type RockPalette = (typeof palettes)[number];
const materials = ['copper', 'iron', 'gold'] as const;
export type RockOreMaterial = (typeof materials)[number];
const nativeTile = 16, oreSize = 2 * nativeTile, tilePixels = 32;
const rangeSheets = new Map<RockPalette, HTMLCanvasElement>();
const rangePixels = new Map<RockPalette, ImageData>();
const treeFootings = new Map<string, Point | undefined>();
interface OrePicture { image: HTMLCanvasElement; rgba: Uint8ClampedArray; }
interface HostOreSurface { rock: Uint8ClampedArray; selection: OrePicture; }
const orePictures = new Map<RockPalette, OrePicture[]>();
const oreSurfaces = new Map<string, HostOreSurface>();
const hostedOres = new Map<string, HTMLCanvasElement>();
let loading: Promise<void> | undefined;

export interface RockOreHost {
    palette: RockPalette;
    /** Unmirrored source region in the host atlas. */
    sourceX: number;
    sourceY: number;
    mirror: boolean;
}

export interface RockFormationArt {
    x: number;
    y: number;
    variant: NonNullable<Tile['rockFormation']>;
    palette: RockPalette;
    alternate: boolean;
    mirror: boolean;
    width: number;
    height: number;
    explored: number;
}

export const isRockOre = (material: string | undefined): material is RockOreMaterial =>
    material === 'copper' || material === 'iron' || material === 'gold';
export const rockPalette = (terrain: Tile['terrain']): RockPalette =>
    terrain === 'plains' || terrain === 'desert' || terrain === 'tundra' ? terrain : 'temperate';

export function rockUsesAlternate(tile: Tile, variant: NonNullable<Tile['rockFormation']>): boolean {
    return !!tile.rockAlternate && tile.rockOre === undefined && !!atlas.alternates[variant];
}

function rockSourceFrame(variant: number, alternate: boolean) {
    return (alternate ? atlas.alternates[variant] : undefined) ?? atlas.frames[variant];
}

async function loadSheet(file: string, width: number, height: number): Promise<HTMLImageElement> {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}assets/resources/rock-ranges/${file}.webp`;
    await image.decode();
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error(`Invalid rock range atlas: ${file}`);
    return image;
}

function prepareRangeSheet(palette: RockPalette, image: HTMLImageElement): void {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const c = canvas.getContext('2d', { willReadFrequently: true })!;
    c.drawImage(image, 0, 0);
    rangeSheets.set(palette, canvas);
    rangePixels.set(palette, c.getImageData(0, 0, canvas.width, canvas.height));
}

export function loadRockRangeArt(): Promise<void> {
    return loading ??= Promise.all([
        ...palettes.map(async palette => {
            const image = await loadSheet(palette, atlas.width, atlas.height);
            prepareRangeSheet(palette, image);
        }),
        ...palettes.map(async palette => {
            const image = await loadSheet(palette === 'temperate' ? 'ore' : `ore-${palette}`, 4 * oreSize, oreSize * 2);
            const pictures: OrePicture[] = [];
            for (const [column] of materials.entries()) for (const row of [0, 1]) {
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = oreSize;
                const context = canvas.getContext('2d', { willReadFrequently: true })!;
                context.drawImage(image, column * oreSize, row * oreSize, oreSize, oreSize, 0, 0, oreSize, oreSize);
                pictures[column * 2 + row] = { image: canvas, rgba: context.getImageData(0, 0, oreSize, oreSize).data };
            }
            orePictures.set(palette, pictures);
        }),
    ]).then(() => undefined);
}

/** The indexed host cells let an explored fragment reveal the correct formation even if its anchor is off-screen. */
export function rockFormationArt(world: World, fog: FogView, anchor: number): RockFormationArt | undefined {
    const tile = world.tiles[anchor], variant = tile?.rockFormation;
    if (variant === undefined) return;
    const frame = atlas.frames[variant], x = anchor % world.width, y = Math.floor(anchor / world.width);
    const width = frame.width / nativeTile, height = frame.height / nativeTile;
    let explored = 0;
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
        if (fog.explored[anchor + dy * world.width + dx]) explored |= 1 << (dy * width + dx);
    }
    return { x, y, variant, palette: rockPalette(tile.terrain), alternate: rockUsesAlternate(tile, variant),
        mirror: !!tile.rockMirror, width, height, explored };
}

export function rockFormationBounds(rock: RockFormationArt): ArtBounds {
    return { x: 0, y: 0, width: rock.width * tilePixels, height: rock.height * tilePixels };
}

export function drawRockFormation(c: CanvasRenderingContext2D, rock: RockFormationArt, bounds: ArtBounds): void {
    c.save();
    const cells = rock.width * rock.height;
    if (rock.explored !== (1 << cells) - 1) {
        c.beginPath();
        for (let i = 0; i < cells; i++) {
            if (rock.explored & (1 << i)) c.rect(i % rock.width * tilePixels, Math.floor(i / rock.width) * tilePixels, tilePixels, tilePixels);
        }
        c.clip();
    }
    drawRockFrame(c, rock.palette, rock.variant, rock.mirror, bounds.x, bounds.y, bounds.width, bounds.height, rock.alternate);
    c.restore();
}

export function drawRockFrame(c: CanvasRenderingContext2D, palette: RockPalette, variant: number,
    mirror: boolean, x: number, y: number, width: number, height: number, alternate = false): void {
    const image = rangeSheets.get(palette), frame = rockSourceFrame(variant, alternate);
    if (!image || !frame) return;
    c.save(); c.imageSmoothingEnabled = false;
    if (mirror) { c.translate(x + width, 0); c.scale(-1, 1); x = 0; }
    c.drawImage(image, frame.x, frame.y, frame.width, frame.height, x, y, width, height);
    c.restore();
}

/** Opaque native pixels in the selected frame, in draw orientation. */
export function rockFrameCoverage(palette: RockPalette, variant: number, mirror: boolean, alternate = false): Point[] {
    const image = rangePixels.get(palette), frame = rockSourceFrame(variant, alternate);
    const pixels: Point[] = [];
    if (!image) return pixels;
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        if (image.data[4 * ((frame.y + y) * image.width + frame.x + x) + 3]) {
            pixels.push({ x: mirror ? frame.width - x - 1 : x, y });
        }
    }
    return pixels;
}

/** Select a lit, opaque surface for the trunk within the marked rock cell. */
export function rockTreeFooting(rock: RockFormationArt, tileX: number, tileY: number): Point | undefined {
    const dx = tileX - rock.x, dy = tileY - rock.y;
    const key = `${rock.palette}:${rock.variant}:${Number(rock.alternate)}:${Number(rock.mirror)}:${dx}:${dy}`;
    if (treeFootings.has(key)) return treeFootings.get(key);
    const image = rangePixels.get(rock.palette), frame = rockSourceFrame(rock.variant, rock.alternate);
    if (!image || dx < 0 || dx >= rock.width || dy < 0 || dy >= rock.height) return;
    const x0 = dx * nativeTile, y0 = dy * nativeTile;
    const at = (x: number, y: number): number =>
        ((frame.y + y) * image.width + frame.x + (rock.mirror ? frame.width - 1 - x : x)) * 4;
    let best: Point | undefined, score = -Infinity;
    for (let y = y0 + 2; y < Math.min(y0 + nativeTile, frame.height - 1); y++) {
        for (let x = x0 + 3; x < x0 + nativeTile - 3; x++) {
            const p = at(x, y), data = image.data;
            if (!data[p + 3] || !data[at(x - 1, y) + 3] || !data[at(x + 1, y) + 3]
                || !data[at(x, y + 1) + 3]) continue;
            const rank = .21 * data[p] + .72 * data[p + 1] + .07 * data[p + 2]
                - 2 * Math.abs(x - x0 - 8) - Math.abs(y - y0 - 8);
            if (rank <= score) continue;
            score = rank;
            best = { x: x * 2 + 1, y: y * 2 + 1 };
        }
    }
    treeFootings.set(key, best);
    return best;
}

export function rockOreArtHost(world: World, anchor: number | undefined, section: number): RockOreHost | undefined {
    if (anchor === undefined) return;
    const host = world.tiles[anchor];
    if (host?.rockOre !== section || host.rockFormation === undefined) return;
    const frame = atlas.frames[host.rockFormation];
    const dx = (section % world.width - anchor % world.width) * nativeTile;
    const dy = (Math.floor(section / world.width) - Math.floor(anchor / world.width)) * nativeTile;
    const mirror = !!host.rockMirror;
    return { palette: rockPalette(host.terrain), sourceX: frame.x + (mirror ? frame.width - dx - oreSize : dx), sourceY: frame.y + dy, mirror };
}

export const rockOreHostKey = (host: RockOreHost) => `${host.palette}:${host.sourceX}:${host.sourceY}`;

function hostOreSurface(host: RockOreHost): HostOreSurface | undefined {
    const key = rockOreHostKey(host), cached = oreSurfaces.get(key);
    if (cached) return cached;
    const sheet = rangeSheets.get(host.palette);
    const footprint = orePictures.get('temperate')?.[0];
    if (!sheet || !footprint) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = oreSize;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(sheet, host.sourceX, host.sourceY, oreSize, oreSize, 0, 0, oreSize, oreSize);
    const rock = context.getImageData(0, 0, oreSize, oreSize).data;
    // The mineral and timber pixels are small. Keep the surrounding visible
    // ore section selectable and use the same mask in both development states.
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(footprint.image, 0, 0);
    const selection = { image: canvas, rgba: context.getImageData(0, 0, oreSize, oreSize).data };
    const surface = { rock, selection };
    oreSurfaces.set(key, surface);
    return surface;
}

function hostedOreImage(material: RockOreMaterial, developed: boolean, host: RockOreHost,
    selectionOnly: boolean): HTMLCanvasElement | undefined {
    const surface = hostOreSurface(host);
    if (!surface) return;
    if (selectionOnly) return surface.selection.image;
    const index = materials.indexOf(material) * 2 + Number(developed);
    const key = `${index}:${rockOreHostKey(host)}`, cached = hostedOres.get(key);
    if (cached) return cached;
    const source = orePictures.get('temperate')?.[index];
    if (!source) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = oreSize;
    canvas.getContext('2d')!.putImageData(hostedOreLayer(material, developed, source.rgba, surface.rock, oreSize), 0, 0);
    hostedOres.set(key, canvas);
    return canvas;
}

export function drawRockOre(c: CanvasRenderingContext2D, material: RockOreMaterial, developed: boolean,
    host: RockOreHost | undefined, x: number, y: number, width: number, height: number,
    palette: RockPalette = 'temperate', selectionOnly = false): void {
    const image = host ? hostedOreImage(material, developed, host, selectionOnly)
        : orePictures.get(palette)?.[materials.indexOf(material) * 2 + Number(developed)]?.image;
    if (!image) return;
    c.save(); c.imageSmoothingEnabled = false;
    if (host?.mirror) { c.translate(x + width, 0); c.scale(-1, 1); x = 0; }
    c.drawImage(image, x, y, width, height);
    c.restore();
}

/** Normalized local sprite coordinates; same alpha and mirroring as the renderer. */
function rockOreHit(host: RockOreHost, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return false;
    const selection = hostOreSurface(host)?.selection;
    if (!selection) return false;
    const col = Math.floor(x * oreSize), row = Math.floor(y * oreSize);
    const pixel = row * oreSize + (host.mirror ? oreSize - 1 - col : col);
    return selection.rgba[pixel * 4 + 3] >= 96;
}

/** Undefined keeps ordinary resource parcels on the existing tile hit rule. */
export function rockOreAtPoint(world: World, tile: Tile, point: Point): boolean | undefined {
    const { rockHost, oreAnchor, resource } = tile;
    if (rockHost === undefined || oreAnchor === undefined || !isRockOre(resource)) return;
    const host = rockOreArtHost(world, rockHost, oreAnchor);
    if (!host) return;
    const x = oreAnchor % world.width, y = Math.floor(oreAnchor / world.width);
    const width = tile.oreWidth ?? 2, height = tile.oreHeight ?? 2;
    return rockOreHit(host, (point.x - x) / width, (point.y - y) / height);
}
