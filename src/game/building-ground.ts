import { type Building, buildingWidth, buildingHeight, isFarmKind, isWallKind } from './types';
import { type PunyPixels, punyWorldPixels } from './puny-world';

const MARGIN = 14;
const surfaces = new Map<string, HTMLCanvasElement>();
const solidGround = (building: Building) => !isFarmKind(building.kind) && !isWallKind(building.kind) && !['road', 'bridge', 'irrigation', 'ruin'].includes(building.kind);

/** A textured earth clearing with a feathered perimeter. Its alpha blends
 * against the actual neighboring terrain, rather than a baked grass border. */
export function rasterBuildingGround(spanX: number, variation: number, atlas: PunyPixels, spanY = spanX): { width: number; height: number; pixels: Uint8ClampedArray } {
  const width = spanX * 32 + MARGIN * 2, height = spanY * 32 + MARGIN * 2, pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const qx = Math.max(0, Math.abs(x + .5 - width / 2) - spanX * 16 + 7);
    const qy = Math.max(0, Math.abs(y + .5 - height / 2) - spanY * 16 + 7);
    const noise = Math.sin((Math.floor(x / 2) + variation) * 1.7 + Math.floor(y / 2) * 2.3) * 1.4;
    const edge = Math.hypot(qx, qy) - 7 + noise;
    const t = Math.max(0, Math.min(1, (12 - edge) / 21));
    const alpha = t * t * (3 - 2 * t) * .88;
    if (alpha < .01) continue;
    // Dirt from the same native path as roads joins naturally at a doorway.
    const sx = 56 + (Math.floor(x / 2) + variation) % 3;
    const sy = 16 + (Math.floor(y / 2) + variation * 3) % 16;
    const source = (sy * atlas.width + sx) * 4, target = (y * width + x) * 4;
    pixels.set(atlas.data.subarray(source, source + 3), target);
    pixels[target + 3] = Math.round(alpha * 255);
  }
  return { width, height, pixels };
}

export function drawBuildingGround(c: CanvasRenderingContext2D, building: Building, x: number, y: number, tileSize: number): void {
  if (!solidGround(building)) return;
  const atlas = punyWorldPixels();
  if (!atlas) return;
  const width = buildingWidth(building), height = buildingHeight(building), variation = Math.abs(building.x * 7 + building.y * 13) % 4;
  const key = `${width}:${height}:${variation}`;
  let canvas = surfaces.get(key);
  if (!canvas) {
    const raster = rasterBuildingGround(width, variation, atlas, height);
    canvas = document.createElement('canvas'); canvas.width = raster.width; canvas.height = raster.height;
    const context = canvas.getContext('2d')!, image = context.createImageData(raster.width, raster.height);
    image.data.set(raster.pixels); context.putImageData(image, 0, 0);
    surfaces.set(key, canvas);
  }
  const scale = tileSize / 32;
  c.drawImage(canvas, x - MARGIN * scale, y - MARGIN * scale, canvas.width * scale, canvas.height * scale);
}
