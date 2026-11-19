import palettes from './relief-palettes.json';
import formations from './ore-formation-frames.json';
import type { Tile } from './types';
export type OreMaterial = 'copper' | 'iron' | 'gold';
type SiteMaterial = 'marble' | 'peat' | 'grapes' | 'coal';
export type OrePalette = keyof typeof palettes;
export interface OreClumpArt {
  anchor: number; x: number; y: number; width: number; height: number;
  family: NonNullable<Tile['oreFamily']>; variant: 0 | 1; material: OreMaterial | 'stone' | SiteMaterial; palette: OrePalette;
  formation?: number;
  /** Explored cells inside the clump's bounding rectangle, in row order. */
  visible: readonly number[]; developed: boolean;
}
type MineDoor = { x: number; y: number; width: number; height: number };
interface Sprite { image: HTMLCanvasElement; door?: MineDoor; compactDoor?: MineDoor }
export const ORE_FORMATION_COUNT = formations.frames.length;
let goldMineBody: HTMLCanvasElement | undefined;
let formationAtlas: HTMLImageElement;
const sites = new Map<SiteMaterial, Sprite[]>();
const pictures = new Map<string, Sprite>();
const artKeys = new WeakMap<OreClumpArt, string>();
let loading: Promise<void> | undefined;
export const isOreMaterial = (resource: string | undefined): resource is OreMaterial => resource === 'copper' || resource === 'iron' || resource === 'gold';
export const isSiteMaterial = (resource: string): resource is SiteMaterial =>
  resource === 'marble' || resource === 'peat' || resource === 'grapes' || resource === 'coal';
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const ramps = Object.fromEntries(Object.entries(palettes).flatMap(([key, palette]) =>
  'surface' in palette ? [[key, palette.surface.map(rgb)]] : []));
const surfaceLevels = [46, 72, 97, 123, 151, 185];
function sourceKey(art: OreClumpArt): string {
  if (isSiteMaterial(art.material)) return art.material;
  return art.formation === undefined ? 'gold-mine-building' : `formation:${art.formation}:${art.material}:${art.palette}`;
}
async function loadFormationAtlas(): Promise<void> {
  const image = new Image();
  image.src = `${import.meta.env.BASE_URL}assets/resources/ore-formations/atlas.webp`;
  await image.decode();
  if (image.naturalWidth !== formations.width || image.naturalHeight !== formations.height)
    throw new Error('Invalid ore formation atlas');
  formationAtlas = image;
}
export function loadOreArt(): Promise<void> {
  return loading ??= Promise.all([
    loadFormationAtlas(), loadGoldMineBody(),
    loadSiteAtlas('marble-quarry', ['marble']), loadSiteAtlas('peat-and-grapes', ['peat', 'grapes']),
    loadSiteAtlas('coal-open-cut', ['coal'], 48),
  ]).then(() => undefined);
}
async function loadSiteAtlas(file: string, rows: SiteMaterial[], size = 32): Promise<void> {
  const atlas = new Image();
  atlas.src = `${import.meta.env.BASE_URL}assets/resources/${file}.webp`;
  await atlas.decode();
  if (atlas.naturalWidth !== 2 * size || atlas.naturalHeight !== rows.length * size) throw new Error(`Invalid ${file} atlas`);
  rows.forEach((material, row) => sites.set(material, [0, size].map(x => {
    const image = document.createElement('canvas');
    image.width = image.height = size;
    image.getContext('2d')!.drawImage(atlas, x, row * size, size, size, 0, 0, size, size);
    return { image };
  })));
}
async function loadGoldMineBody(): Promise<void> {
  const image = new Image();
  image.src = `${import.meta.env.BASE_URL}assets/runtime/game/ore-2.webp`;
  await image.decode();
  // The dedicated gold mine building uses this crop.
  if (image.naturalWidth !== 96 || image.naturalHeight !== 64) throw new Error('Invalid gold mine atlas');
  const body = document.createElement('canvas');
  body.width = body.height = 32;
  body.getContext('2d', { willReadFrequently: true })!.drawImage(image, 64, 0, 32, 32, 0, 0, 32, 32);
  goldMineBody = body;
}
function doorPosition(image: HTMLCanvasElement, width: number, height: number): MineDoor {
  const { width: w, height: h } = image;
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
function fittedMineDoor(picture: Sprite, art: OreClumpArt): MineDoor {
  if (art.formation === undefined) return picture.door ??= doorPosition(picture.image, 10, 8);
  if (art.family === 0) return picture.compactDoor ??= doorPosition(picture.image, 9, 8);
  return picture.door ??= doorPosition(picture.image, 15, 12);
}
function groundColor(palette: OrePalette, r: number, g: number, b: number): number[] {
  const light = r * .2126 + g * .7152 + b * .0722;
  let shade = 0;
  for (let n = 1; n < surfaceLevels.length; n++)
    if (Math.abs(light - surfaceLevels[n]) < Math.abs(light - surfaceLevels[shade])) shade = n;
  return ramps[palette][shade];
}
function sprite(art: OreClumpArt): Sprite | undefined {
  if (isSiteMaterial(art.material)) return sites.get(art.material)?.[Number(art.developed)];
  const key = sourceKey(art), cached = pictures.get(key); if (cached) return cached;
  if (art.formation !== undefined) {
    const frame = formations.frames[art.formation];
    if (!formationAtlas || !frame) return;
    const image = document.createElement('canvas');
    image.width = frame.width; image.height = frame.height;
    const y = frame.y + formations.materials.indexOf(art.material) * formations.bankHeight;
    const context = image.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(formationAtlas, frame.x, y, frame.width, frame.height, 0, 0, image.width, image.height);
    if (art.palette !== 'grassland') {
      const pixels = context.getImageData(0, 0, image.width, image.height), d = pixels.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        // Recolor the moss at the foot without changing stone or mineral colors.
        if (!d[i + 3] || g <= r + 4 || g <= b * 1.16) continue;
        d.set(groundColor(art.palette, r, g, b), i);
      }
      context.putImageData(pixels, 0, 0);
    }
    const result = { image };
    pictures.set(key, result); return result;
  }
  if (!goldMineBody || art.material !== 'gold') return;
  const result = { image: goldMineBody };
  pictures.set(key, result); return result;
}
export function oreArtKey(art: OreClumpArt): string {
  let key = artKeys.get(art);
  if (key === undefined) {
    key = `${sourceKey(art)}:${art.family}:${art.width}:${art.height}:${art.visible.join(',')}:${Number(art.developed)}`;
    artKeys.set(art, key);
  }
  return key;
}
/** Cached by NativeArt. No pixel work or doorway fitting occurs on cache hits. */
export function drawOreClump(c: CanvasRenderingContext2D, art: OreClumpArt, door?: HTMLCanvasElement, x = 0, y = 0, size = 32): void {
  const picture = sprite(art); if (!picture) return;
  c.save(); c.imageSmoothingEnabled = false; c.beginPath();
  for (const cell of art.visible) c.rect(x + cell % art.width * size, y + Math.floor(cell / art.width) * size, size, size);
  const nativePixel = size / 16;
  // Fit each irregular deposit's silhouette without clipping its
  // peaks or stretching it into the footprint's rectangular shape.
  const pixel = art.formation !== undefined ? Math.min(nativePixel,
    art.width * size / picture.image.width, art.height * size / picture.image.height) : nativePixel;
  const width = picture.image.width * pixel, height = picture.image.height * pixel;
  const left = x + (art.width * size - width) / 2, top = y + art.height * size - height;
  c.clip(); c.drawImage(picture.image, left, top, width, height);
  if (art.developed && door && isOreMaterial(art.material)) {
    const fitted = fittedMineDoor(picture, art);
    c.drawImage(door, left + fitted.x * pixel, top + fitted.y * pixel, fitted.width * pixel, fitted.height * pixel);
  }
  c.restore();
}
