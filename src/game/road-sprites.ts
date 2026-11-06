import { punyWorldPixels } from './puny-world';
import type { RoadStyle } from './types';

export interface RoadLinks {
  north: boolean; east: boolean; south: boolean; west: boolean;
  northeast?: boolean; southeast?: boolean; southwest?: boolean; northwest?: boolean;
}
export const ROAD_WIDTH_SCALE = .7;
/** Half-width on the local 32px ground plane; road length stays a full tile. */
export const ROAD_HALF_WIDTH = 6.5 * ROAD_WIDTH_SCALE;
/** Trails share road exits, with about two thirds of the width. */
export const TRAIL_HALF_WIDTH = ROAD_HALF_WIDTH * .65;
export const TRAIL_ART_VARIANTS = 16;

type Point = readonly [number, number];
const fields = new Map<number, Float32Array>();
const surfaces = new Map<string, HTMLCanvasElement>();
const maskOf = (links: RoadLinks) => Number(links.north) | Number(links.east) << 1 | Number(links.south) << 2 | Number(links.west) << 3
  | Number(!!links.northeast) << 4 | Number(!!links.southeast) << 5 | Number(!!links.southwest) << 6 | Number(!!links.northwest) << 7;

/** Stable scenery variation, shared by both Canvas and the world atlas cache.
 * A bounded variant set avoids baking a separate texture for every map cell. */
export function trailArtVariant(worldX: number, worldY: number): number {
  let hash = Math.imul(Math.floor(worldX), 0x1f123bb5) ^ Math.imul(Math.floor(worldY), 0x5f356495);
  hash = Math.imul(hash ^ hash >>> 16, 0x45d9f3b);
  return (hash ^ hash >>> 16) & (TRAIL_ART_VARIANTS - 1);
}

export function dirtRoadArtKey(links: RoadLinks, worldX: number, worldY: number, style: RoadStyle = 'road'): string {
  return `${style}:${maskOf(links)}${style === 'trail' ? `:${trailArtVariant(worldX, worldY)}` : ''}`;
}

const TRAIL_BENDS: readonly Point[] = [[-4, -2], [-2, 4], [3, 1], [0, -4], [4, -4], [-3, 0], [2, -2], [0, 3]];
const edgeBlend = (value: number) => Math.sin(Math.PI * Math.max(0, Math.min(1, (value - 2) / 27)));
function bow(value: number, controls: Point): number {
  const t = Math.max(0, Math.min(1, (value - 2) / 27)), s = 1 - t;
  return 3 * s * t * (s * controls[0] + t * controls[1]);
}
function sampleField(field: Float32Array, x: number, y: number): number {
  x = Math.max(0, Math.min(31, x)); y = Math.max(0, Math.min(31, y));
  const left = Math.floor(x), top = Math.floor(y), right = Math.min(31, left + 1), bottom = Math.min(31, top + 1);
  const fx = x - left, fy = y - top;
  return (field[top * 32 + left] * (1 - fx) + field[top * 32 + right] * fx) * (1 - fy)
    + (field[bottom * 32 + left] * (1 - fx) + field[bottom * 32 + right] * fx) * fy;
}
function distance(x: number, y: number, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}

/** Geometry bends the authored pathway; it never invents scenery colors. */
function distanceField(mask: number): Float32Array {
  const existing = fields.get(mask);
  if (existing) return existing;
  const cardinal: Point[] = [[16, 0], [32, 16], [16, 32], [0, 16]];
  const exits = cardinal.filter((_, i) => mask & 1 << i);
  const segments: [Point, Point][] = [];
  if (exits.length < 2) segments.push([exits[0] ?? [16, 16], [16, 16]]);
  for (let a = 0; a < exits.length; a++) for (let b = a + 1; b < exits.length; b++) {
    const start = exits[a], end = exits[b];
    if (start[0] === end[0] || start[1] === end[1]) segments.push([start, end]);
    else {
      let previous = start;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, s = 1 - t;
        const point: Point = [s * s * start[0] + 2 * s * t * 16 + t * t * end[0], s * s * start[1] + 2 * s * t * 16 + t * t * end[1]];
        segments.push([previous, point]); previous = point;
      }
    }
  }
  // Eight-way movement wears diagonal trails too. Carry their centerlines to
  // the shared tile corner instead of rendering a row of isolated dirt dots.
  const corners: Point[] = [[32, 0], [32, 32], [0, 32], [0, 0]];
  for (let i = 0; i < corners.length; i++) if (mask & 1 << (i + 4)) segments.push([[16, 16], corners[i]]);
  const field = new Float32Array(32 * 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    let gap = Math.min(...segments.map(([a, b]) => distance(x + .5, y + .5, a, b)));
    // A bend and a straight have identical shared-edge cross sections.
    if ((x === 0 && mask & 8) || (x === 31 && mask & 2)) gap = Math.abs(y + .5 - 16);
    if ((y === 0 && mask & 1) || (y === 31 && mask & 4)) gap = Math.abs(x + .5 - 16);
    field[y * 32 + x] = gap;
  }
  fields.set(mask, field);
  return field;
}

export function rasterDirtRoad(links: RoadLinks, atlas: { width: number; data: Uint8ClampedArray }, style: RoadStyle = 'road', variant = 0): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    const mask = maskOf(links), field = distanceField(mask);
    const junction = Object.values(links).filter(Boolean).length > 2;
    variant &= TRAIL_ART_VARIANTS - 1;
    const trail = style === 'trail', flip = variant & 8 ? -1 : 1;
    const horizontalBow = TRAIL_BENDS[variant & 7], verticalBow = TRAIL_BENDS[(variant * 5 + 3) & 7];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      // Leave a three-pixel band at every edge untouched. Adjacent variants,
      // normal roads and diagonal exits therefore retain their exact seams.
      const interior = trail && mask !== 0 && x > 2 && x < 29 && y > 2 && y < 29;
      // Keep the narrow meeting point of three or more arms intact. It has
      // less spare width than a straight run, particularly with diagonals.
      const hubBlend = junction ? Math.max(0, Math.min(1, (Math.hypot(x - 15.5, y - 15.5) - 6) / 4)) : 1;
      const blendX = interior ? edgeBlend(x) * hubBlend : 0, blendY = interior ? edgeBlend(y) * hubBlend : 0;
      const blend = blendX * blendY;
      const gap = interior ? sampleField(field, x + flip * blendX * bow(y, verticalBow),
        y + flip * blendY * bow(x, horizontalBow)) : field[y * 32 + x];
      const halfWidth = trail ? TRAIL_HALF_WIDTH * (1 + blend * ((variant % 4 - 1.5) * .07
        + .04 * Math.sin((x + y) * Math.PI / 24 + variant))) : ROAD_HALF_WIDTH;
      if (gap > halfWidth) continue;
      // The native straight path (column 3, row 1) supplies its dirt center,
      // uneven shoulder, and grass transition. Mirror its authored shoulder
      // around the connected centerline, retaining the reduced road width.
      const across = Math.min(15, 8 + Math.floor(gap / halfWidth * 7));
      // Both adjoining tiles sample the same source row at their shared edge.
      const along = (Math.floor(((x === 31 ? 32 : x) + (y === 31 ? 32 : y)) / 2)
        + Math.round(blend * ((variant * 5) % 16))) % 16;
      const source = ((16 + along) * atlas.width + 48 + across) * 4;
      const red = atlas.data[source], green = atlas.data[source + 1], blue = atlas.data[source + 2];
      // Remove only the baked background grass; the authored shoulder colors
      // remain intact, including their irregular outline and little dirt flecks.
      if (red === 133 && green === 166 && blue === 67) continue;
      const target = (y * 32 + x) * 4;
      pixels.set(atlas.data.subarray(source, source + 4), target);
      // Warm the dirt toward brown, retaining the native grass shoulder so
      // trails meet the surrounding terrain without a dark green outline.
      if (style === 'trail' && !(red === 157 && green === 167 && blue === 71)) {
        pixels[target] = Math.round(red * .91);
        pixels[target + 1] = Math.round(green * .86);
        pixels[target + 2] = Math.round(blue * 1.03);
      }
    }
    return pixels;
}

export function drawDirtRoad(c: CanvasRenderingContext2D, links: RoadLinks, worldX: number, worldY: number, style: RoadStyle = 'road'): void {
  const atlas = punyWorldPixels();
  if (!atlas) return;
  const key = dirtRoadArtKey(links, worldX, worldY, style);
  let surface = surfaces.get(key);
  if (!surface) {
    surface = document.createElement('canvas');
    surface.width = surface.height = 32;
    const context = surface.getContext('2d')!;
    const result = context.createImageData(32, 32);
    result.data.set(rasterDirtRoad(links, atlas, style, trailArtVariant(worldX, worldY)));
    context.putImageData(result, 0, 0);
    surfaces.set(key, surface);
  }
  c.drawImage(surface, 0, 0, 32, 32);
}
