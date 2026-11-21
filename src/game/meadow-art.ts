import { runtimeArtUrl } from './runtime-art';
import { tileAt, type Tile, type World } from './types';

export type MeadowBiome = 'grassland' | 'plains';
export type MeadowVariant = 'grassland-short' | 'grassland-medium' | 'grassland-tall'
    | `grassland-${4 | 5 | 6 | 7 | 8 | 9}` | `plains-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;
export interface MeadowSprite {
    biome: MeadowBiome;
    file: string;
    /** Native 16px animation row in the biome's shared atlas. */
    row: number;
    /** Vertical root footing within the native frame. */
    anchorY: number;
    frameWidth: number;
    frameCount: number;
    frameDurationMs: number;
}
const sprite = (biome: MeadowBiome, row: number, frameCount = 17, anchorY = 1): Readonly<MeadowSprite> => ({
    biome, file: `${biome}/variants.png`, row, anchorY, frameWidth: 16, frameCount, frameDurationMs: 180,
});
export const MEADOW_SPRITES: Readonly<Record<MeadowVariant, Readonly<MeadowSprite>>> = {
    'grassland-short': sprite('grassland', 0, 15),
    'grassland-medium': sprite('grassland', 1, 16),
    'grassland-tall': sprite('grassland', 2),
    'grassland-4': sprite('grassland', 3, 17, 15 / 16),
    'grassland-5': sprite('grassland', 4, 17, 15 / 16),
    'grassland-6': sprite('grassland', 5, 16),
    'grassland-7': sprite('grassland', 6, 16, 15 / 16),
    'grassland-8': sprite('grassland', 7, 16),
    'grassland-9': sprite('grassland', 8, 16),
    'plains-1': sprite('plains', 0),
    'plains-2': sprite('plains', 1),
    'plains-3': sprite('plains', 2),
    'plains-4': sprite('plains', 3),
    'plains-5': sprite('plains', 4, 10),
    'plains-6': sprite('plains', 5, 14),
    'plains-7': sprite('plains', 6, 14),
    'plains-8': sprite('plains', 7, 15),
    'plains-9': sprite('plains', 8),
};
const images = new Map<MeadowVariant, HTMLImageElement>();
const variants = Object.entries(MEADOW_SPRITES) as [MeadowVariant, Readonly<MeadowSprite>][];
let loading: Promise<void> | undefined;

export function loadMeadowArt(): Promise<void> {
    return loading ??= Promise.all([...new Set(variants.map(([, spec]) => spec.file))].map(async file => {
        const image = new Image();
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/vegetation/meadow/${file}`);
        await image.decode();
        for (const [variant, spec] of variants) {
            if (spec.file !== file) continue;
            if (image.height < (spec.row + 1) * 16 || image.height % 16
                || image.width < spec.frameWidth * spec.frameCount || image.width % spec.frameWidth)
                throw new Error(`Invalid meadow atlas: ${file}`);
            images.set(variant, image);
        }
    })).then(() => undefined);
}

export const meadowImage = (variant: MeadowVariant): HTMLImageElement | undefined => images.get(variant);

/** Shared authored frames only; no deformation, new raster, or random stream. */
export function meadowFrame(variant: MeadowVariant, time: number, phase = 0): number {
    const spec = MEADOW_SPRITES[variant];
    return ((Math.floor(time * 1000 / spec.frameDurationMs + phase * spec.frameCount) % spec.frameCount) + spec.frameCount) % spec.frameCount;
}

export interface MeadowTuft {
    /** Root footing in local tile coordinates. */
    x: number;
    y: number;
    variant: MeadowVariant;
    phase: number;
}
export const MEADOW_TUFT_SCALE = .7;
const MEADOW_DENSITY_SCALE = .7;
const NONE: readonly MeadowTuft[] = Object.freeze([]);
const NEW_GRASSLAND_VARIANTS: readonly MeadowVariant[] = ['grassland-4', 'grassland-5', 'grassland-6', 'grassland-7', 'grassland-8', 'grassland-9'];
const PLAINS_VARIANTS: readonly MeadowVariant[] = ['plains-1', 'plains-2', 'plains-3', 'plains-4', 'plains-5', 'plains-6', 'plains-7', 'plains-8', 'plains-9'];
const hash = (x: number, y: number, salt: number): number => {
    let value = Math.imul(x + salt * 317, 0x1f123bb5) ^ Math.imul(y + salt * 117, 0x5f356495);
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    return ((value ^ value >>> 16) >>> 0) / 4294967296;
};

/** Decorative footing is restricted to the actual terrain, never ecology or a
 * nearby biome. Roads, fields, buildings and observed resources are excluded by
 * the renderer's existing occupancy indices before these placements are used. */
export function meadowBiome(tile: Tile): MeadowBiome | undefined {
    if ((tile.terrain !== 'grassland' && tile.terrain !== 'plains') || tile.overlay !== 'none'
        || tile.creek || tile.beach || tile.relief || tile.waterfall || tile.marsh || tile.palm || tile.resource
        || tile.geothermal || tile.villageTrail || tile.desertStone !== undefined) return undefined;
    return tile.terrain;
}

/** Pure placement also serves art previews. Broad continuous stands and fixed
 * subcell gaps break up open land; plains have one slot to grasslands' three. */
export function meadowTufts(tile: Tile, x: number, y: number, density = 1): readonly MeadowTuft[] {
    const biome = meadowBiome(tile);
    if (!biome) return NONE;
    const salt = Math.floor(tile.variation * 0xffffff) >>> 0;
    const cluster = (Math.sin(x * .28 + Math.sin(y * .25) * 1.8) + Math.sin(y * .39 - x * .11)
        + Math.sin(x * .71 + y * .31) * .36 + 2.36) / 4.72;
    const chance = (biome === 'grassland' ? .72 : .6) * (.12 + cluster * 1.28) * (2 / 3) * MEADOW_DENSITY_SCALE * density;
    const tufts: MeadowTuft[] = [];
    for (let slot = 0; slot < (biome === 'grassland' ? 3 : 1); slot++) {
        if (hash(x, y, salt + slot * 13 + 15) > chance) continue;
        const variety = hash(x, y, salt + slot * 11 + 37);
        const variant: MeadowVariant = biome === 'plains'
            ? PLAINS_VARIANTS[Math.floor(variety * PLAINS_VARIANTS.length)]!
            : variety < .1 ? 'grassland-short' : variety < .25 ? 'grassland-medium' : variety < .35 ? 'grassland-tall'
                : NEW_GRASSLAND_VARIANTS[Math.min(NEW_GRASSLAND_VARIANTS.length - 1,
                    Math.floor((variety - .35) / .65 * NEW_GRASSLAND_VARIANTS.length))]!;
        tufts.push({ x: .35 + hash(x, y, salt + slot * 7 + 5) * .3,
            y: .69 + hash(x, y, salt + slot * 5 + 9) * .26, variant,
            phase: (hash(x, y, salt + slot * 17 + 23) * .38 + x * .026 - y * .012 + 10000) % 1 });
    }
    return tufts.length ? tufts : NONE;
}

/** Taper foreground grass as frost begins to appear in the ground palette. */
function tundraEdgeDensity(world: World, x: number, y: number): number {
    let density = 1;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (tileAt(world, x + dx, y + dy)?.terrain === 'tundra')
            density = Math.min(density, Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? .45 : .75);
    }
    return density;
}

/** The full animation frame can extend past its root tile. Check it once per
 * placement so every pose keeps waterfalls clear. */
function meadowFits(world: World, x: number, y: number, tuft: MeadowTuft): boolean {
    const left = x + tuft.x - .5 * MEADOW_TUFT_SCALE;
    const top = y + tuft.y - MEADOW_SPRITES[tuft.variant].anchorY * MEADOW_TUFT_SCALE;
    const right = left + MEADOW_TUFT_SCALE, bottom = top + MEADOW_TUFT_SCALE;
    for (let row = Math.floor(top); row < bottom; row++) for (let col = Math.floor(left); col < right; col++) {
        const tile = tileAt(world, col, row);
        if (tile?.waterfall) return false;
    }
    return true;
}

/** Recheck tile eligibility each draw. Cache animation footprints until the
 * terrain geometry changes, then refresh visible cells on demand. */
export class MeadowPlacementCache {
    private world?: World;
    private tiles?: World['tiles'];
    private geometry?: number;
    private cells: ({ terrain: Tile['terrain']; variation: number; tufts: readonly MeadowTuft[] } | undefined)[] = [];

    get(world: World, x: number, y: number, geometry: number): readonly MeadowTuft[] {
        if (this.world !== world || this.tiles !== world.tiles || this.geometry !== geometry) {
            this.world = world;
            this.tiles = world.tiles;
            this.geometry = geometry;
            this.cells = [];
        }
        const cell = y * world.width + x, tile = world.tiles[cell];
        if (!tile || !meadowBiome(tile)) return NONE;
        const old = this.cells[cell];
        if (old && old.terrain === tile.terrain && old.variation === tile.variation) return old.tufts;
        const candidates = meadowTufts(tile, x, y, tundraEdgeDensity(world, x, y));
        const tufts = candidates.length ? candidates.filter(tuft => meadowFits(world, x, y, tuft)) : NONE;
        this.cells[cell] = { terrain: tile.terrain, variation: tile.variation, tufts };
        return tufts;
    }
}
