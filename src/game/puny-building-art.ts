import type { Building } from './types';
import { punyWorldPixels, type PunyPixels } from './puny-world';

export type NativeBuildingRect = readonly [number, number, number, number];
export type NativeHouseTier = 1 | 2 | 3 | 4;
const rect = (x: number, y: number, w = 16, h = 16): NativeBuildingRect => [x, y, w, h];

/** Native atlas coordinates; destination rectangles are logical 32px-cell units.
 * The palace retains both source rows of its two adjoining 1×2 columns. */
export const NATIVE_BUILDINGS = {
  houses: {
    1: { column: 4, row: 26, rect: rect(64, 416) },
    2: { column: 4, row: 27, rect: rect(64, 432) },
    3: { column: 5, row: 27, rect: rect(80, 432) },
    4: { column: 8, row: 29, rect: rect(128, 464) },
  },
  well: { column: 5, row: 30, rect: rect(80, 480) },
  palace: {
    rect: rect(192, 416, 32, 32), destination: rect(0, 0, 64, 64), footprint: [2, 2] as const,
    buildings: [rect(192, 416, 16, 32), rect(208, 416, 16, 32)],
  },
  woodenTower: {
    platform: { rect: rect(112, 432), destination: rect(0, -24, 32, 32) },
    posts: [
      { rect: rect(352, 432, 4, 16), destination: rect(4, 0, 8, 32) },
      { rect: rect(352, 432, 4, 16), destination: rect(20, 0, 8, 32) },
    ],
    bounds: rect(0, -24, 32, 56), footprint: [1, 1] as const,
  },
  masonryTower: { rect: rect(288, 464), bounds: rect(0, -24, 32, 56), footprint: [1, 1] as const },
  crops: { ripe: rect(0, 448), green: rect(16, 448) },
} as const;

/** Each upgrade uses its own original 16×16 sprite, with the chimney house at
 * level four. Explicit styles never randomize unlevelled house art. */
export function nativeHouseTier(building: Pick<Building, 'houseLevel' | 'houseStyle'> & Partial<Pick<Building, 'id'>>): NativeHouseTier {
  if (typeof building.houseLevel === 'number' && Number.isFinite(building.houseLevel))
    return Math.max(1, Math.min(4, Math.floor(building.houseLevel))) as NativeHouseTier;
  if (building.houseStyle === 'hovel') return 2;
  if (building.houseStyle === 'cottage') return 3;
  if (building.houseStyle === 'villa') return 4;
  return 1;
}

function teamColor(value: string): [number, number, number] {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value);
  const hex = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : /^#[\da-f]{6}$/i.test(value) ? value : '#3988ff';
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Keep the native cyan palette's discrete brightness levels, shifting only
 * hue/saturation and its lightness center to the requested faction color.
 * Bounded centers keep black and white factions shaded rather than flat. */
function shadeColor(rgb: readonly number[], nativeValue: number): readonly number[] {
  const channels = rgb.map(v => v / 255), high = Math.max(...channels), low = Math.min(...channels);
  const delta = high - low, light = (high + low) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * light - 1)) : 0;
  let hue = 0;
  if (delta) {
    hue = high === channels[0] ? ((channels[1] - channels[2]) / delta) % 6
      : high === channels[1] ? (channels[2] - channels[0]) / delta + 2
      : (channels[0] - channels[1]) / delta + 4;
    hue = ((hue / 6) + 1) % 1;
  }
  const shadedLight = Math.min(.94, Math.max(.18, Math.min(.72, light)) * (.35 + .9 * nativeValue / 255));
  const chroma = (1 - Math.abs(2 * shadedLight - 1)) * saturation;
  const second = chroma * (1 - Math.abs((hue * 6) % 2 - 1)), offset = shadedLight - chroma / 2;
  const sector = Math.floor(hue * 6);
  const base = sector === 0 ? [chroma, second, 0] : sector === 1 ? [second, chroma, 0]
    : sector === 2 ? [0, chroma, second] : sector === 3 ? [0, second, chroma]
    : sector === 4 ? [second, 0, chroma] : [chroma, 0, second];
  return base.map(v => Math.round((v + offset) * 255));
}

export interface PunyBuildingPixels extends PunyPixels { teamMask: Uint8Array }

/** Pure pixel operation for both runtime caching and palette regression tests.
 * The mask comes from matching gold/cyan/red source pixels, not a broad color
 * threshold: neutral wood, stone, outlines and the full alpha channel survive. */
export function recolorPunyBuildingPixels(atlas: PunyPixels, source: NativeBuildingRect, color: string): PunyBuildingPixels {
  const [sx, sy, width, height] = source;
  if (![sx, sy, width, height].every(Number.isInteger) || sx < 0 || sy < 0 || width <= 0 || height <= 0
    || sx + width > atlas.width || sy + height > atlas.height) throw new RangeError('Invalid native building rectangle.');
  const data = new Uint8ClampedArray(width * height * 4), teamMask = new Uint8Array(width * height);
  const rgb = teamColor(color), shades = new Map<number, readonly number[]>();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = sx + x, py = sy + y, original = (py * atlas.width + px) * 4, target = (y * width + x) * 4;
    data.set(atlas.data.subarray(original, original + 4), target);
    // Only this gold block has position-identical cyan/red counterparts.
    if (px < 64 || px >= 224 || py < 416 || py >= 496 || !data[target + 3]) continue;
    const cyan = ((py + 112) * atlas.width + px) * 4;
    const red = ((py + 112) * atlas.width + px + 160) * 4;
    if (py + 112 >= atlas.height || px + 160 >= atlas.width
      || atlas.data[cyan + 3] !== data[target + 3] || atlas.data[red + 3] !== data[target + 3]) continue;
    const differs = [0, 1, 2].some(c => atlas.data[original + c] !== atlas.data[cyan + c]
      || atlas.data[original + c] !== atlas.data[red + c]);
    if (!differs) continue;
    teamMask[y * width + x] = 1;
    const value = Math.max(atlas.data[cyan], atlas.data[cyan + 1], atlas.data[cyan + 2]);
    let shade = shades.get(value);
    if (!shade) { shade = shadeColor(rgb, value); shades.set(value, shade); }
    data[target] = shade[0]; data[target + 1] = shade[1]; data[target + 2] = shade[2];
  }
  return { width, height, data, teamMask };
}

let cachedAtlas: PunyPixels | undefined;
const sprites = new Map<string, HTMLCanvasElement>();
const icons = new Map<string, string>();
function sprite(source: NativeBuildingRect, color: string): HTMLCanvasElement | undefined {
  const atlas = punyWorldPixels();
  if (!atlas) return undefined;
  if (atlas !== cachedAtlas) { sprites.clear(); icons.clear(); cachedAtlas = atlas; }
  const key = `${source.join(',')}:${teamColor(color).join(',')}`, cached = sprites.get(key);
  if (cached) return cached;
  const pixels = recolorPunyBuildingPixels(atlas, source, color), canvas = document.createElement('canvas');
  canvas.width = pixels.width; canvas.height = pixels.height;
  const c = canvas.getContext('2d')!, image = c.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data); c.putImageData(image, 0, 0);
  sprites.set(key, canvas); return canvas;
}

export function drawPunyBuildingRegion(c: CanvasRenderingContext2D, source: NativeBuildingRect, x: number, y: number, width: number, height: number, color: string): void {
  const image = sprite(source, color);
  if (!image) return;
  c.imageSmoothingEnabled = false; c.drawImage(image, x, y, width, height);
}

export function drawPunyBuildingTile(c: CanvasRenderingContext2D, column: number, row: number, x: number, y: number, width: number, height: number, color: string): void {
  drawPunyBuildingRegion(c, [column * 16, row * 16, 16, 16], x, y, width, height, color);
}

export function punyBuildingRegionIconUrl(source: NativeBuildingRect, color: string): string {
  const image = sprite(source, color);
  if (!image) return '';
  const key = `${source.join(',')}:${teamColor(color).join(',')}`;
  let url = icons.get(key);
  if (!url) { url = image.toDataURL(); icons.set(key, url); }
  return url;
}

export function punyBuildingIconUrl(column: number, row: number, color: string): string {
  return punyBuildingRegionIconUrl([column * 16, row * 16, 16, 16], color);
}
