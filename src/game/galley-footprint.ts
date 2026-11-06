import type { Point } from './types';

export const GALLEY_LENGTH = 2;
export const GALLEY_WIDTH = 1;
export type GalleyPose = Point & { facing: number };
const RADIUS = GALLEY_WIDTH / 2;
const HALF_SPINE = (GALLEY_LENGTH - GALLEY_WIDTH) / 2;
const EPSILON = 1e-8;

/** A rounded 2×1 hull: the bow and stern can turn without reserving empty
 * rectangular corners. Oars and the sail are visual overhang, not obstacles. */
function spine(boat: GalleyPose): readonly [Point, Point] {
  const x = Math.cos(boat.facing) * HALF_SPINE, y = Math.sin(boat.facing) * HALF_SPINE;
  return [{ x: boat.x - x, y: boat.y - y }, { x: boat.x + x, y: boat.y + y }];
}
function closestOnSegment(a: Point, b: Point, point: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
export function galleyHullDistance(boat: GalleyPose, point: Point): number {
  const [a, b] = spine(boat), near = closestOnSegment(a, b, point);
  return Math.max(0, Math.hypot(point.x - near.x, point.y - near.y) - RADIUS);
}
export function galleyContainsPoint(boat: GalleyPose, point: Point, padding = 0): boolean {
  const [a, b] = spine(boat), near = closestOnSegment(a, b, point);
  return Math.hypot(point.x - near.x, point.y - near.y) <= RADIUS + padding + EPSILON;
}
export function galleyClosestPoint(boat: GalleyPose, point: Point): Point {
  const [a, b] = spine(boat), near = closestOnSegment(a, b, point);
  const dx = point.x - near.x, dy = point.y - near.y, length = Math.hypot(dx, dy);
  if (length <= RADIUS) return { x: point.x, y: point.y };
  return { x: near.x + dx / length * RADIUS, y: near.y + dy / length * RADIUS };
}
function segmentIntersectsTile(a: Point, b: Point, x: number, y: number): boolean {
  let low = 0, high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, x, x + 1], [a.y, b.y - a.y, y, y + 1]]) {
    if (Math.abs(delta) < EPSILON) { if (start < min || start > max) return false; continue; }
    const enter = (min - start) / delta, leave = (max - start) / delta;
    low = Math.max(low, Math.min(enter, leave)); high = Math.min(high, Math.max(enter, leave));
    if (low > high) return false;
  }
  return true;
}
export function galleyOverlapsTile(boat: GalleyPose, x: number, y: number, padding = 0): boolean {
  const [a, b] = spine(boat), radius = RADIUS + padding;
  if (Math.max(a.x, b.x) + radius <= x + EPSILON || Math.min(a.x, b.x) - radius >= x + 1 - EPSILON
    || Math.max(a.y, b.y) + radius <= y + EPSILON || Math.min(a.y, b.y) - radius >= y + 1 - EPSILON) return false;
  if (segmentIntersectsTile(a, b, x, y)) return true;
  let distanceSquared = Infinity;
  for (const p of [a, b]) {
    const dx = Math.max(x - p.x, 0, p.x - x - 1), dy = Math.max(y - p.y, 0, p.y - y - 1);
    distanceSquared = Math.min(distanceSquared, dx * dx + dy * dy);
  }
  for (const p of [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }]) {
    const near = closestOnSegment(a, b, p);
    distanceSquared = Math.min(distanceSquared, (p.x - near.x) ** 2 + (p.y - near.y) ** 2);
  }
  return distanceSquared < radius * radius - EPSILON;
}
/** Integer water cells touched by the actual hull; edge-only contact is clear. */
export function galleyFootprintCells(boat: GalleyPose): Point[] {
  const [a, b] = spine(boat), cells: Point[] = [];
  for (let y = Math.floor(Math.min(a.y, b.y) - RADIUS + EPSILON); y < Math.ceil(Math.max(a.y, b.y) + RADIUS - EPSILON); y++)
    for (let x = Math.floor(Math.min(a.x, b.x) - RADIUS + EPSILON); x < Math.ceil(Math.max(a.x, b.x) + RADIUS - EPSILON); x++)
      if (galleyOverlapsTile(boat, x, y)) cells.push({ x, y });
  return cells;
}
