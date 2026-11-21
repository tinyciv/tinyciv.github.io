import atlas from '../game/rock-range-frames.json';
import type { Tile, World } from '../game/types';

/** Formation dimensions in native 16px tiles, ordered by size and elongated/compact shape. */
export const ROCK_FORMATION_SIZES = [[2, 1], [1, 1], [4, 2], [3, 2], [8, 3], [5, 3]] as const;
export const ROCK_ARRANGEMENTS = ['horizontal', 'vertical', 'diagonal'] as const;
export const ROCK_RANGE_LENGTHS = ['short', 'medium', 'long', 'continental'] as const;

/** Mix whole sprites on native footprints, avoiding copies on touching edges when possible. */
export function varyRockArt(world: World, anchors: readonly number[], random: () => number): void {
    const { width, tiles } = world;
    for (const anchor of anchors) {
        const tile = tiles[anchor], shape = tile.rockFormation!;
        const [rockWidth, rockHeight] = ROCK_FORMATION_SIZES[shape];
        const choices = atlas.alternates[shape] ? 4 : 2;
        const x = anchor % width;
        let used = 0;
        const noteNeighbor = (cell: number) => {
            const host = tiles[cell].rockHost;
            if (host === undefined || host >= anchor) return;
            const neighbor = tiles[host];
            if (neighbor.rockFormation !== shape || neighbor.rockOre !== undefined) return;
            used |= 1 << (Number(!!neighbor.rockAlternate) * 2 + Number(!!neighbor.rockMirror));
        };
        if (anchor >= width) {
            for (let dx = 0; dx < rockWidth; dx++) noteNeighbor(anchor - width + dx);
        }
        for (let dy = 0; dy < rockHeight; dy++) {
            const row = anchor + dy * width;
            if (x > 0) noteNeighbor(row - 1);
            if (x + rockWidth < width) noteNeighbor(row + rockWidth);
        }
        const first = Math.floor(random() * choices);
        let choice = first;
        for (let offset = 0; offset < choices; offset++) {
            const candidate = (first + offset) % choices;
            if (!(used & (1 << candidate))) { choice = candidate; break; }
        }
        if (choice & 1) tile.rockMirror = true;
        if (choice & 2) tile.rockAlternate = true;
    }
}

export function clearRockFormation(tile: Tile): void {
    delete tile.rockFormation;
    delete tile.rockHost;
    delete tile.rockOre;
    delete tile.rockAlternate;
    delete tile.rockMirror;
    delete tile.rockRelief;
    delete tile.rockTree;
    delete tile.rockArrangement;
    delete tile.rockRangeLength;
    delete tile.rockRangeId;
    delete tile.rockRangeGap;
}
