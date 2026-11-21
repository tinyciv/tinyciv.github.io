import { landCoverSightCost } from './sight';
import { mountainTerrainHandle } from './terrain-rays-native';
import { rustEngine } from './rust-engine';
import type { Point, World } from './types';

interface Ray { x: number; y: number; distance: number; start: number; end: number }
interface RayGeometry {
    rays: Ray[]; x: Int32Array; y: Int32Array; length: Float64Array;
    left: number; top: number; width: number; height: number; affected: ReadonlyMap<number, Uint32Array>;
}
const geometry = new Map<string, RayGeometry>();
const MAX_SEGMENTS = 250_000;
const MAX_GEOMETRIES = 24;
let retainedSegments = 0;

/** Buildings share integer/half-integer sight origins. Their ray traversal
 * geometry is independent of the terrain and source location: retain it while
 * reading current cover for every query. The segment lengths keep precisely
 * the multiplication order used by sightDistance. */
function raysFor(radius: number, fractionX: number, fractionY: number): RayGeometry {
    const key = `${radius}:${fractionX}:${fractionY}`, cached = geometry.get(key);
    if (cached) { geometry.delete(key); geometry.set(key, cached); return cached; }
    const rays: Ray[] = [], xs: number[] = [], ys: number[] = [], lengths: number[] = [];
    const affected = new Map<number, number[]>();
    const left = Math.floor(fractionX - radius), right = Math.floor(fractionX + radius);
    const top = Math.floor(fractionY - radius), bottom = Math.floor(fractionY + radius), width = right - left + 1;
    const affects = (x: number, y: number): void => {
        const key = (y - top) * width + x - left, list = affected.get(key);
        if (list) { if (list[list.length - 1] !== rays.length) list.push(rays.length); }
        else affected.set(key, [rays.length]);
    };
    const radius2 = radius * radius;
    for (let y = Math.floor(fractionY - radius); y <= Math.floor(fractionY + radius); y++)
        for (let x = Math.floor(fractionX - radius); x <= Math.floor(fractionX + radius); x++) {
            const dx = x + .5 - fractionX, dy = y + .5 - fractionY;
            if (dx * dx + dy * dy > radius2) continue;
            const distance = Math.hypot(dx, dy);
            if (distance > radius) continue;
            const start = xs.length;
            affects(x, y);
            // A closed native ray touches every cell sharing the origin,
            // independently of its heading. Building centers can be corners.
            affects(0, 0);
            if (fractionX === 0) affects(-1, 0);
            if (fractionY === 0) affects(0, -1);
            if (fractionX === 0 && fractionY === 0) affects(-1, -1);
            if (distance) {
                let tileX = 0, tileY = 0, t = 0;
                const stepX = Math.sign(dx), stepY = Math.sign(dy);
                const deltaX = dx ? 1 / Math.abs(dx) : Infinity, deltaY = dy ? 1 / Math.abs(dy) : Infinity;
                let nextX = dx ? (stepX > 0 ? 1 - fractionX : fractionX) / Math.abs(dx) : Infinity;
                let nextY = dy ? (stepY > 0 ? 1 - fractionY : fractionY) / Math.abs(dy) : Infinity;
                while (t < 1) {
                    const next = Math.min(1, nextX, nextY);
                    xs.push(tileX); ys.push(tileY); lengths.push((next - t) * distance);
                    if (next > t) affects(tileX, tileY);
                    // Native mountain rays also touch the two side cells of
                    // a corner. Keep those zero-length dependencies so an
                    // edited mountain invalidates every affected cached ray.
                    if (next <= 1 && Math.abs(nextX - nextY) < 1e-10) {
                        affects(tileX + stepX, tileY); affects(tileX, tileY + stepY);
                    }
                    t = next;
                    if (nextX <= next) { tileX += stepX; nextX += deltaX; }
                    if (nextY <= next) { tileY += stepY; nextY += deltaY; }
                }
            }
            rays.push({ x, y, distance, start, end: xs.length });
        }
    const result = { rays, x: Int32Array.from(xs), y: Int32Array.from(ys), length: Float64Array.from(lengths),
        left, top, width, height: bottom - top + 1,
        affected: new Map([...affected].map(([cell, indices]) => [cell, Uint32Array.from(indices)])) };
    while (geometry.size && (retainedSegments + xs.length > MAX_SEGMENTS || geometry.size >= MAX_GEOMETRIES)) {
        const oldest = geometry.keys().next().value!;
        retainedSegments -= geometry.get(oldest)!.length.length; geometry.delete(oldest);
    }
    if (xs.length <= MAX_SEGMENTS) { geometry.set(key, result); retainedSegments += xs.length; }
    return result;
}

/** Exact covered-territory samples. Unusual fractional/editor coordinates and
 * very large influence radii retain the general scalar implementation; no
 * global cache can grow with world size or the number of claim sources. */
export function territorySightCosts(world: World, origin: Point, radius: number,
    left: number, top: number, right: number, bottom: number,
    previous?: Float64Array, changedCells?: readonly number[]): Float64Array | undefined {
    if (!(radius > 0 && radius <= 32) || !Number.isInteger(origin.x * 2) || !Number.isInteger(origin.y * 2)
        || origin.x < 0 || origin.y < 0 || origin.x >= world.width || origin.y >= world.height) return;
    const sourceX = Math.floor(origin.x), sourceY = Math.floor(origin.y);
    const terrain = mountainTerrainHandle(world);
    const rays = raysFor(radius, origin.x - sourceX, origin.y - sourceY), width = right - left + 1;
    const incremental = previous && previous.length === width * (bottom - top + 1) && changedCells !== undefined;
    const costs = incremental ? previous.slice() : new Float64Array(width * (bottom - top + 1)).fill(Infinity);
    const sample = (ray: Ray): void => {
        const x = sourceX + ray.x, y = sourceY + ray.y;
        if (x < left || x > right || y < top || y > bottom) return;
        const target = (y - top) * width + x - left;
        costs[target] = Infinity;
        if (!world.tiles[y * world.width + x]) return;
        let cost = rustEngine.terrain_rays_sight_penalty(terrain, origin.x, origin.y, x + .5, y + .5);
        if (cost > radius) return;
        for (let i = ray.start; i < ray.end; i++) {
            // Both endpoints are in the world, so their straight segment is
            // too. A zero-length initial boundary tile contributes nothing.
            cost += rays.length[i] * landCoverSightCost(world.tiles[(sourceY + rays.y[i]) * world.width + sourceX + rays.x[i]]?.overlay);
            if (cost > radius) break;
        }
        if (cost <= radius) costs[target] = cost;
    };
    if (incremental) {
        const dirty = new Set<number>();
        for (const cell of changedCells) {
            const x = cell % world.width - sourceX - rays.left, y = Math.floor(cell / world.width) - sourceY - rays.top;
            if (x < 0 || x >= rays.width || y < 0 || y >= rays.height) continue;
            for (const index of rays.affected.get(y * rays.width + x) ?? []) dirty.add(index);
        }
        for (const index of dirty) sample(rays.rays[index]);
    } else {
        for (const ray of rays.rays) sample(ray);
    }
    return costs;
}
