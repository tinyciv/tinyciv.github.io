import { tileAt, type Overlay, type Point, type World } from './types';
import { ridgeLevel } from './ridges';

export const HIGH_GROUND_SIGHT_MULTIPLIER = 1.5;

/** Playable ledge tiers extend sight toward lower ground. Cover still consumes
 * the full ray; buildings opt out to retain their established sight ranges. */
export function highGroundSightMultiplier(world: World | undefined, source: Point, target: Point, includeRidges = true): number {
    if (!world || !includeRidges) return 1;
    const observer = tileAt(world, source.x, source.y), destination = tileAt(world, target.x, target.y);
    return observer && destination && ridgeLevel(observer) > ridgeLevel(destination) ? HIGH_GROUND_SIGHT_MULTIPLIER : 1;
}

/** Conservative search radius; target-specific height checks happen afterward. */
export function maximumHighGroundSightMultiplier(world: World | undefined, source: Point, includeRidges = true): number {
    const tile = world && tileAt(world, source.x, source.y);
    return includeRidges && ridgeLevel(tile) > 0 ? HIGH_GROUND_SIGHT_MULTIPLIER : 1;
}

/** A tile of continuous woodland leaves 30% of the usual viewing distance. */
export function landCoverSightCost(overlay: Overlay | undefined): number {
    return overlay === 'forest' || overlay === 'jungle' ? 1 / .3 : 1;
}

/** Skip ray traversal altogether for observers whose surroundings are open. */
export function hasSightCover(world: World | undefined, source: Point, radius: number): boolean {
    if (!world) return false;
    const x0 = Math.max(0, Math.floor(source.x - radius)), x1 = Math.min(world.width - 1, Math.floor(source.x + radius));
    const y0 = Math.max(0, Math.floor(source.y - radius)), y1 = Math.min(world.height - 1, Math.floor(source.y + radius));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
        if (landCoverSightCost(world.tiles[y * world.width + x]?.overlay) > 1) return true;
    return false;
}

/** Integrate cover along the actual ray, including fractional entry/exit tiles.
 * A stand between two clearings therefore consumes sight just as one around
 * the observer does. The limit lets hidden targets stop traversal early. */
export function sightDistance(world: World | undefined, source: Point, x: number, y: number, limit = Infinity): number {
    const dx = x - source.x, dy = y - source.y, distance = Math.hypot(dx, dy);
    if (!world || !world.tiles.length || !distance || distance > limit) return distance;
    let tileX = Math.floor(source.x), tileY = Math.floor(source.y), t = 0, cost = 0;
    const stepX = Math.sign(dx), stepY = Math.sign(dy);
    const deltaX = dx ? 1 / Math.abs(dx) : Infinity, deltaY = dy ? 1 / Math.abs(dy) : Infinity;
    let nextX = dx ? (stepX > 0 ? tileX + 1 - source.x : source.x - tileX) / Math.abs(dx) : Infinity;
    let nextY = dy ? (stepY > 0 ? tileY + 1 - source.y : source.y - tileY) / Math.abs(dy) : Infinity;
    while (t < 1) {
        const next = Math.min(1, nextX, nextY);
        const overlay = tileX >= 0 && tileY >= 0 && tileX < world.width && tileY < world.height
            ? world.tiles[tileY * world.width + tileX]?.overlay : undefined;
        cost += (next - t) * distance * landCoverSightCost(overlay);
        if (cost > limit) return cost;
        t = next;
        // Cross both boundaries at a corner, without charging zero-width tiles.
        if (nextX <= next) { tileX += stepX; nextX += deltaX; }
        if (nextY <= next) { tileY += stepY; nextY += deltaY; }
    }
    return cost;
}
