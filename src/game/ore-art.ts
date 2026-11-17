import palettes from './relief-palettes.json';
export type OreMaterial = 'copper' | 'iron' | 'gold';
export type OrePalette = keyof typeof palettes;
export interface OreClumpArt {
  anchor: number; x: number; y: number; width: number; height: number;
  family: 0 | 1 | 2; variant: 0 | 1; material: OreMaterial; palette: OrePalette;
  /** Explored cells inside the clump's bounding rectangle, in row order. */
  visible: readonly number[]; developed: boolean;
}
interface Sprite { image: HTMLCanvasElement; door: { x: number; y: number; width: number; height: number } }
export const ORE_VISUAL_SCALE = 1.5;
const sizes = [[16, 16], [32, 32], [48, 32]];
const originals: HTMLCanvasElement[][] = [];
const pictures = new Map<string, Sprite>();
const artKeys = new WeakMap<OreClumpArt, string>();
let loading: Promise<void> | undefined;
export const isOreMaterial = (resource: string | undefined): resource is OreMaterial => resource === 'copper' || resource === 'iron' || resource === 'gold';
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const ramps = Object.fromEntries(Object.entries(palettes).filter(([, p]) => 'surface' in p).map(([key, p]) => {
  const ramp = p as typeof palettes.plains; return [key, { surface: ramp.surface.map(rgb), rock: ramp.rock.map(rgb) }];
}));
const levels = { surface: [46, 72, 97, 123, 151, 185], rock: [43, 75, 109, 144, 180, 220] };
// Iron uses the approved foothill and seam families, retaining both silhouettes.
const sourceKey = (art: OreClumpArt): string => art.material === 'iron' ? `${art.family === 2 ? 2 : 1}:${art.variant}:iron:grassland`
  : `${art.family}:${art.variant}:${art.material}:${art.palette}`;
export function loadOreArt(): Promise<void> {
  // tools/runtime-art/ore.mjs bakes the former Canvas crop and rasterization.
  return loading ??= Promise.all([0, 1, 2].map(async family => {
    const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/runtime/game/ore-${family + 1}.webp`; await image.decode();
    const [w, h] = sizes[family];
    if (image.naturalWidth !== w * 3 || image.naturalHeight !== h * 2) throw new Error(`Invalid ore atlas ${family}`);
    originals[family] = Array.from({ length: 6 }, (_, slot) => {
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      out.getContext('2d', { willReadFrequently: true })!.drawImage(image, slot % 3 * w, Math.floor(slot / 3) * h, w, h, 0, 0, w, h);
      return out;
    });
  })).then(() => undefined);
}
function doorPosition(image: HTMLCanvasElement, family: number): Sprite['door'] {
  const { width: w, height: h } = image, width = family === 0 ? 6 : 10, height = family === 0 ? 5 : 8;
  const data = image.getContext('2d')!.getImageData(0, 0, w, h).data;
  let best = -Infinity, position = { x: Math.floor((w - width) / 2), y: h - height - 2, width, height };
  for (let y = 1; y < h - height; y++) for (let x = 1; x < w - width; x++) {
    let cover = 0, minerals = 0;
    for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) {
      const i = (yy * w + xx) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (data[i + 3] && !(g > r + 4 && g > b * 1.16)) {
        cover++;
        if (r > g * 1.13 && g > b * 1.2 || g > b * 1.65 && r > g || b > r * 1.08 && g > r * 1.025) minerals++;
      }
    }
    const score = cover * 4 - minerals * 3 + y * .7 - Math.abs(x + width / 2 - w / 2) * .4;
    if (score > best) { best = score; position = { x, y, width, height }; }
  }
  return position;
}
function sprite(art: OreClumpArt): Sprite | undefined {
  const key = sourceKey(art), cached = pictures.get(key); if (cached) return cached;
  const iron = art.material === 'iron', family = iron ? art.family === 2 ? 2 : 1 : art.family;
  const variant = art.variant, palette = iron ? 'grassland' : art.palette;
  const slot = variant * 3 + ['copper', 'iron', 'gold'].indexOf(art.material), original = originals[family]?.[slot]; if (!original) return;
  const image = document.createElement('canvas'); image.width = original.width; image.height = original.height;
  const c = image.getContext('2d', { willReadFrequently: true })!; c.drawImage(original, 0, 0);
  if (palette !== 'grassland') {
    const pixels = c.getImageData(0, 0, image.width, image.height), d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2], surface = g > r + 4 && g > b * 1.16;
      const mineral = !surface && (r > g * 1.13 && g > b * 1.2 || g > b * 1.65 && r > g
        || b > r * 1.08 && g > r * 1.025 || g > r * 1.1 && b > r * 1.1);
      if (mineral) continue;
      const material = surface ? 'surface' : 'rock', light = r * .2126 + g * .7152 + b * .0722;
      let shade = 0; for (let n = 1; n < 6; n++) if (Math.abs(light - levels[material][n]) < Math.abs(light - levels[material][shade])) shade = n;
      const color = ramps[palette][material][shade]; d[i] = color[0]; d[i + 1] = color[1]; d[i + 2] = color[2];
    }
    c.putImageData(pixels, 0, 0);
  }
  const result = { image, door: doorPosition(original, family) }; pictures.set(key, result); return result;
}
export function oreArtKey(art: OreClumpArt): string {
  let key = artKeys.get(art);
  if (key === undefined) {
    key = `${sourceKey(art)}:${art.width}:${art.height}:${art.visible.join(',')}:${Number(art.developed)}`;
    artKeys.set(art, key);
  }
  return key;
}
/** Cached by NativeArt. No pixel work or doorway fitting occurs on cache hits. */
export function drawOreClump(c: CanvasRenderingContext2D, art: OreClumpArt, door?: HTMLCanvasElement, x = 0, y = 0, size = 32): void {
  const picture = sprite(art); if (!picture) return;
  c.save(); c.imageSmoothingEnabled = false; c.beginPath();
  for (const cell of art.visible) c.rect(x + cell % art.width * size, y + Math.floor(cell / art.width) * size, size, size);
  const nativePixel = size / 16 * ORE_VISUAL_SCALE;
  // Fit each iron silhouette into smaller deposits without clipping its
  // peaks or stretching it into the footprint's rectangular shape.
  const pixel = art.material === 'iron' ? Math.min(nativePixel,
    art.width * size / picture.image.width, art.height * size / picture.image.height) : nativePixel;
  const width = picture.image.width * pixel, height = picture.image.height * pixel;
  const left = x + (art.width * size - width) / 2, top = y + art.height * size - height;
  c.clip(); c.drawImage(picture.image, left, top, width, height);
  if (art.developed && door) {
    const fitted = picture.door;
    c.drawImage(door, left + fitted.x * pixel, top + fitted.y * pixel, fitted.width * pixel, fitted.height * pixel);
  }
  c.restore();
}
