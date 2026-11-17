import { runtimeArtUrl } from './runtime-art';
import type { Tile, World } from './types';

export type MeadowBiome = 'grassland' | 'plains';
export type MeadowVariant = 'grassland-short' | 'grassland-medium' | 'grassland-tall' | 'plains-1' | 'plains-2' | 'plains-3';
export interface MeadowSprite {
    biome: MeadowBiome;
    file: string;
    frameWidth: number;
    frameCount: number;
    frameDurationMs: number;
}
export const MEADOW_SPRITES: Readonly<Record<MeadowVariant, Readonly<MeadowSprite>>> = {
    'grassland-short': { biome: 'grassland', file: 'grassland/short.png', frameWidth: 16, frameCount: 15, frameDurationMs: 180 },
    'grassland-medium': { biome: 'grassland', file: 'grassland/medium.png', frameWidth: 16, frameCount: 16, frameDurationMs: 180 },
    'grassland-tall': { biome: 'grassland', file: 'grassland/tall.png', frameWidth: 16, frameCount: 17, frameDurationMs: 180 },
    'plains-1': { biome: 'plains', file: 'plains/1.png', frameWidth: 16, frameCount: 17, frameDurationMs: 180 },
    'plains-2': { biome: 'plains', file: 'plains/2.png', frameWidth: 16, frameCount: 17, frameDurationMs: 180 },
    'plains-3': { biome: 'plains', file: 'plains/3.png', frameWidth: 16, frameCount: 17, frameDurationMs: 180 },
};
const images = new Map<MeadowVariant, HTMLImageElement>();
let loading: Promise<void> | undefined;

export function loadMeadowArt(): Promise<void> {
    return loading ??= Promise.all((Object.entries(MEADOW_SPRITES) as [MeadowVariant, MeadowSprite][]).map(async ([variant, spec]) => {
        const image = new Image();
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/vegetation/meadow/${spec.file}`);
        await image.decode();
        if (image.height !== 16 || image.width < spec.frameWidth * spec.frameCount || image.width % spec.frameWidth)
            throw new Error(`Invalid meadow sheet: ${spec.file}`);
        images.set(variant, image);
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
const NONE: readonly MeadowTuft[] = Object.freeze([]);
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
        || tile.creek || tile.beach || tile.relief || tile.marsh || tile.palm || tile.resource
        || tile.geothermal || tile.villageTrail || tile.desertStone !== undefined) return undefined;
    return tile.terrain;
}

/** Pure placement also serves art previews. Broad continuous stands and fixed
 * subcell gaps break up open land; plains have one slot to grasslands' three. */
export function meadowTufts(tile: Tile, x: number, y: number): readonly MeadowTuft[] {
    const biome = meadowBiome(tile);
    if (!biome) return NONE;
    const salt = Math.floor(tile.variation * 0xffffff) >>> 0;
    const cluster = (Math.sin(x * .28 + Math.sin(y * .25) * 1.8) + Math.sin(y * .39 - x * .11)
        + Math.sin(x * .71 + y * .31) * .36 + 2.36) / 4.72;
    const chance = (biome === 'grassland' ? .72 : .6) * (.12 + cluster * 1.28);
    const tufts: MeadowTuft[] = [];
    for (let slot = 0; slot < (biome === 'grassland' ? 3 : 1); slot++) {
        if (hash(x, y, salt + slot * 13 + 15) > chance) continue;
        const variety = hash(x, y, salt + slot * 11 + 37);
        const variant: MeadowVariant = biome === 'plains'
            ? variety < 1 / 3 ? 'plains-1' : variety < 2 / 3 ? 'plains-2' : 'plains-3'
            : variety < .2 ? 'grassland-short' : variety < .8 ? 'grassland-medium' : 'grassland-tall';
        tufts.push({ x: .35 + hash(x, y, salt + slot * 7 + 5) * .3,
            y: .69 + hash(x, y, salt + slot * 5 + 9) * .26, variant,
            phase: (hash(x, y, salt + slot * 17 + 23) * .38 + x * .026 - y * .012 + 10000) % 1 });
    }
    return tufts.length ? tufts : NONE;
}

/** Placement work is bounded to newly viewed cells. Eligibility is cheap and
 * re-read so clearing trees or replacing terrain never leaves stale foliage. */
export class MeadowPlacementCache {
    private world?: World;
    private cells: ({ terrain: Tile['terrain']; variation: number; tufts: readonly MeadowTuft[] } | undefined)[] = [];

    get(world: World, x: number, y: number): readonly MeadowTuft[] {
        if (this.world !== world) { this.world = world; this.cells = new Array(world.width * world.height); }
        const cell = y * world.width + x, tile = world.tiles[cell];
        if (!tile || !meadowBiome(tile)) return NONE;
        const old = this.cells[cell];
        if (old && old.terrain === tile.terrain && old.variation === tile.variation) return old.tufts;
        const tufts = meadowTufts(tile, x, y);
        this.cells[cell] = { terrain: tile.terrain, variation: tile.variation, tufts };
        return tufts;
    }
}
