import palettes from './relief-palettes.json';
import formations from './ore-formation-frames.json';
import { loadRockyDepositArt } from './rocky-deposit-art';
import { drawRockFrame, drawRockOre, isRockOre as isOreMaterial, loadRockRangeArt, rockOreHostKey, rockPalette, type RockOreHost, type RockOreMaterial, type RockPalette } from './rock-range-art';
export type OreMaterial = RockOreMaterial;
type SiteMaterial = 'marble' | 'peat' | 'grapes' | 'coal';
export type OrePalette = keyof typeof palettes;
export interface OreClumpArt {
  anchor: number; x: number; y: number; width: number; height: number;
  material: OreMaterial | 'stone' | SiteMaterial; palette: OrePalette;
  formation?: number;
  host?: RockOreHost;
  /** Explored cells inside the clump's bounding rectangle, in row order. */
  visible: readonly number[]; developed: boolean;
}
export const ORE_FORMATION_COUNT = formations.frames.length;
let formationAtlas: HTMLImageElement;
const sites = new Map<SiteMaterial, HTMLCanvasElement[]>();
const stonePictures = new Map<string, HTMLCanvasElement>();
const artKeys = new WeakMap<OreClumpArt, string>();
let loading: Promise<void> | undefined;
export { isOreMaterial };
export const isSiteMaterial = (resource: string): resource is SiteMaterial =>
  resource === 'marble' || resource === 'peat' || resource === 'grapes' || resource === 'coal';
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const ramps = Object.fromEntries(Object.entries(palettes).flatMap(([key, palette]) =>
  'surface' in palette ? [[key, palette.surface.map(rgb)]] : []));
const surfaceLevels = [46, 72, 97, 123, 151, 185];
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
    loadFormationAtlas(), loadRockRangeArt(), loadRockyDepositArt(),
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
    return image;
  })));
}
/** The capturable gold mine occupies its existing 2×2 building footprint. */
export function drawGoldMineObjective(c: CanvasRenderingContext2D, active: boolean, palette: RockPalette = 'temperate'): void {
  drawRockFrame(c, palette, 0, false, 0, 12, 64, 32);
  drawRockOre(c, 'gold', active, undefined, 0, 0, 64, 64, palette);
}
function groundColor(palette: OrePalette, r: number, g: number, b: number): number[] {
  const light = r * .2126 + g * .7152 + b * .0722;
  let shade = 0;
  for (let n = 1; n < surfaceLevels.length; n++)
    if (Math.abs(light - surfaceLevels[n]) < Math.abs(light - surfaceLevels[shade])) shade = n;
  return ramps[palette][shade];
}
function stoneSprite(art: OreClumpArt): HTMLCanvasElement | undefined {
  const key = `${art.formation}:${art.palette}`, cached = stonePictures.get(key);
  if (cached) return cached;
  const frame = formations.frames[art.formation ?? 0];
  if (!formationAtlas || !frame) return;
  const image = document.createElement('canvas');
  image.width = frame.width; image.height = frame.height;
  const context = image.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(formationAtlas, frame.x, frame.y, frame.width, frame.height, 0, 0, image.width, image.height);
  if (art.palette !== 'grassland') {
    const pixels = context.getImageData(0, 0, image.width, image.height), d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // Recolor the moss at the foot without changing the rock.
      if (!d[i + 3] || g <= r + 4 || g <= b * 1.16) continue;
      d.set(groundColor(art.palette, r, g, b), i);
    }
    context.putImageData(pixels, 0, 0);
  }
  stonePictures.set(key, image);
  return image;
}
export function oreArtKey(art: OreClumpArt): string {
  let key = artKeys.get(art);
  if (key === undefined) {
    const source = art.material === 'stone' ? `stone:${art.formation}:${art.palette}`
      : art.host ? `${art.material}:${rockOreHostKey(art.host)}:${Number(art.host.mirror)}`
      : isOreMaterial(art.material) ? `${art.material}:${art.palette}` : art.material;
    key = `${source}:${art.width}:${art.height}:${art.visible.join(',')}:${Number(art.developed)}`;
    artKeys.set(art, key);
  }
  return key;
}
/** Cached by NativeArt. The atlas and clipping mask depend on the observed deposit state. */
export function drawOreClump(c: CanvasRenderingContext2D, art: OreClumpArt, x = 0, y = 0, size = 32, oreOnly = false): void {
  c.save(); c.imageSmoothingEnabled = false;
  c.beginPath();
  for (const cell of art.visible) c.rect(x + cell % art.width * size, y + Math.floor(cell / art.width) * size, size, size);
  c.clip();
  const pixel = size / 16;
  if (isOreMaterial(art.material)) {
    const width = Math.min(2, art.width) * size, height = Math.min(2, art.height) * size;
    const left = x + (art.width * size - width) / 2, top = y + art.height * size - height;
    const palette = rockPalette(art.palette);
    if (!art.host && !oreOnly) drawRockFrame(c, palette, 1, false, left, top, width, height);
    drawRockOre(c, art.material, art.developed, art.host, left, top, width, height, palette, oreOnly);
  } else {
    const picture = art.material === 'stone' ? stoneSprite(art) : sites.get(art.material)?.[Number(art.developed)];
    if (picture) {
      const scale = art.material === 'stone' ? Math.min(pixel, art.width * size / picture.width, art.height * size / picture.height) : pixel;
      const width = picture.width * scale, height = picture.height * scale;
      c.drawImage(picture, x + (art.width * size - width) / 2, y + art.height * size - height, width, height);
    }
  }
  c.restore();
}
