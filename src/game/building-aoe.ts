import { borderRadius } from './borders';
import { WOODEN_TOWER_RANGE } from './tower-combat';
import { WELL_RADIUS } from './wells';
import { OBSERVATION_POST_SIGHT } from './observation-posts';
import { IRRIGATION_RADIUS } from './irrigation';
import { BALLISTA_RANGE } from './ballista';
import { HEALER_SHACK_RADIUS } from './healer-shack';
import type { GameState, Point, World } from './types';

interface PlacementEffect { radius: number; beneficial: boolean }
interface CellBounds { left: number; right: number; top: number; bottom: number }

export function buildingPlacementEffect(kind: GameState['buildMode'], culture = 0): PlacementEffect | undefined {
    if (kind === 'well') return { radius: WELL_RADIUS, beneficial: true };
    if (kind === 'observationPost') return { radius: OBSERVATION_POST_SIGHT, beneficial: true };
    if (kind === 'irrigation') return { radius: IRRIGATION_RADIUS, beneficial: true };
    if (kind === 'healerShack') return { radius: HEALER_SHACK_RADIUS, beneficial: true };
    if (kind === 'ballista') return { radius: BALLISTA_RANGE, beneficial: false };
    if (kind === 'woodenTower') return { radius: WOODEN_TOWER_RANGE, beneficial: false };
    if (kind === 'monument' || kind === 'house') return { radius: borderRadius(kind, culture), beneficial: true };
}

/** Nominal coverage, measured at tile centers like the underlying effects.
 * Never inspect terrain, targets or claims: a preview in fog must not reveal
 * hidden obstacles. Actual claims and shots still obey their normal rules. */
export function buildingEffectCells(world: Pick<World, 'width' | 'height'>, origins: readonly Point[], radius: number,
    bounds: CellBounds = { left: 0, right: world.width, top: 0, bottom: world.height }): Point[] {
    const cells = new Set<number>(), radius2 = radius * radius;
    for (const origin of origins) {
        const cx = Math.floor(origin.x), cy = Math.floor(origin.y);
        if (cx < 0 || cy < 0 || cx >= world.width || cy >= world.height) continue;
        const left = Math.max(0, bounds.left, Math.ceil(cx - radius)), right = Math.min(world.width - 1, bounds.right - 1, Math.floor(cx + radius));
        const top = Math.max(0, bounds.top, Math.ceil(cy - radius)), bottom = Math.min(world.height - 1, bounds.bottom - 1, Math.floor(cy + radius));
        for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 <= radius2) cells.add(y * world.width + x);
        }
    }
    return Array.from(cells, cell => ({ x: cell % world.width, y: Math.floor(cell / world.width) }));
}
