import { buildingReady, isWallKind, tileAt, type Building, type World } from './types';
import { ridgeIsLedge, ridgeLevel, type StairDirection } from './ridges';
import { ridgeQuads } from './ridge-art';
import type { TerrainQuad } from './terrain';
import { punyWorldPixels, type PunyPixels } from './puny-world';
import type { RoadLinks } from './road-sprites';
import { drawPunyWall } from './wall-sprites';
import { drawPalisade } from './palisade-art';

const SIDES = [
    ['north', 0, -1, 'south'], ['east', 1, 0, 'west'],
    ['south', 0, 1, 'north'], ['west', -1, 0, 'east'],
] as const;

export interface WallCliffJoin {
    x: number; y: number;
    /** Direction from the wall's occupied cell toward its neighboring cliff. */
    side: StairDirection;
    quads: TerrainQuad[];
}

/** Visual contacts only: no extra wall entities, collision or terrain edits.
 * Continue an existing arm into a cliff, or turn an isolated/free end into it.
 * A parallel wall run must not grow a row of unnecessary T junctions. */
export function wallCliffJoins(building: Building, world: World, links: RoadLinks,
    known: (x: number, y: number) => boolean = () => true): WallCliffJoin[] {
    if (!isWallKind(building.kind) || !buildingReady(building)) return [];
    const level = ridgeLevel(tileAt(world, building.x, building.y));
    const branches = SIDES.filter(([side]) => links[side]).length;
    const joins: WallCliffJoin[] = [];
    for (const [side, dx, dy, opposite] of SIDES) {
        if (links[side] || branches > 1 && !links[opposite]) continue;
        const x = building.x + dx, y = building.y + dy;
        if (!known(x, y) || !ridgeIsLedge(world, x, y) || ridgeLevel(tileAt(world, x, y)) < level) continue;
        const quads = ridgeQuads(world, x, y);
        if (quads) joins.push({ x, y, side, quads });
    }
    return joins;
}

export function wallLinksWithCliffs(links: RoadLinks, joins: readonly WallCliffJoin[]): RoadLinks {
    if (!joins.length) return links;
    const result = { ...links };
    for (const join of joins) result[join.side] = true;
    return result;
}

/** Only the silhouette matters. Desert ledges preserve the grassy source's
 * exact pixel geometry, so both palettes share this small native mask cache. */
export function wallCliffKey(join: WallCliffJoin): string {
    return `${join.side}:${join.quads.map(q => `${q.sx},${q.sy},${q.dx},${q.dy}`).join(';')}`;
}

// The native cliffs cast green shadows onto the flat ground. These are part
// of the approach, not the rock silhouette: stopping at them leaves a visible
// 1–3 native-pixel moat between the wall and cliff, especially on south faces.
const CLIFF_GROUND_COLORS = new Set([
    0x85a643, 0x7c953a, 0x768e36, 0x768e35, 0x5f6c37, 0x7f9a3d,
]);

/** Reveal the approach-side ground and its shadow until the first rock pixel.
 * Never resume after that pixel: the summit uses the same flat grass color.
 * Rays missing the cliff entirely stay empty, avoiding floating corner arms.
 * At corners, keep fringe rays close to the wall's central structural body:
 * a long isolated cap or footing must not become a tapered timber tail. */
export function wallCliffGroundMask(join: WallCliffJoin, source: PunyPixels): Uint8Array {
    const ground = new Uint8Array(256), mask = new Uint8Array(256);
    for (const q of join.quads) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = ((q.sy + y) * source.width + q.sx + x) * 4;
        const rgb = source.data[i] << 16 | source.data[i + 1] << 8 | source.data[i + 2];
        ground[(q.dy + y) * 16 + q.dx + x] = Number(source.data[i + 3] === 255 && CLIFF_GROUND_COLORS.has(rgb));
    }
    const vertical = join.side === 'north' || join.side === 'south';
    const reverse = join.side === 'north' || join.side === 'west';
    const depths = new Uint8Array(16);
    for (let across = 0; across < 16; across++) {
        for (let along = 0; along < 16; along++) {
            const p = reverse ? 15 - along : along, i = vertical ? p * 16 + across : across * 16 + p;
            if (!ground[i]) { depths[across] = along; break; }
        }
    }
    // The central half is the structural wall body. Longer outer rays expose
    // only protruding roof or footing timber around a curved cliff corner.
    const bodyDepth = Math.max(...depths.subarray(4, 12));
    // Straight faces have authored one-pixel shoulder variation. Preserve it
    // so the compact corner treatment cannot reopen a gap beside the rock.
    const limit = Math.max(...depths) > bodyDepth + 1 ? bodyDepth : 16;
    for (let across = 0; across < 16; across++) for (let along = 0; along < Math.min(depths[across], limit); along++) {
        const p = reverse ? 15 - along : along;
        mask[vertical ? p * 16 + across : across * 16 + p] = 1;
    }
    return mask;
}

const clips = new Map<string, Path2D>();

/** Draw an ordinary native run beneath the neighboring cliff silhouette.
 * The existing terrain remains visible wherever the mask occludes the wall. */
export function drawWallCliffJoin(c: CanvasRenderingContext2D, kind: Building['kind'], join: WallCliffJoin): void {
    const source = punyWorldPixels();
    if (!source || !isWallKind(kind)) return;
    const key = wallCliffKey(join);
    let path = clips.get(key);
    if (!path) {
        const mask = wallCliffGroundMask(join, source);
        path = new Path2D();
        for (let y = 0; y < 16; y++) {
            let start = -1;
            for (let x = 0; x <= 16; x++) {
                const allowed = x < 16 && mask[y * 16 + x];
                if (allowed && start < 0) start = x;
                if (!allowed && start >= 0) { path.rect(start * 2, y * 2, (x - start) * 2, 2); start = -1; }
            }
        }
        clips.set(key, path);
    }
    const vertical = join.side === 'north' || join.side === 'south';
    const links = { north: vertical, south: vertical, east: !vertical, west: !vertical };
    c.save(); c.clip(path);
    if (kind === 'palisade') drawPalisade(c, links);
    else drawPunyWall(c, links, undefined);
    c.restore();
}
