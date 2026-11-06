import { FIELD_HARVEST_SECONDS } from './farms';
import { type FarmField } from './types';
import { drawPuny } from './puny-world';

type Ctx = CanvasRenderingContext2D;
const fieldSheets: HTMLImageElement[] = [];
const fieldTips: number[][][] = [];
let loading: Promise<void> | undefined;

function cropTips(pixels: Uint8ClampedArray, width: number, sx: number, sy = 0): number[] {
  const tips = Array.from({ length: 16 }, () => 16);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++)
    if (pixels[((y + sy) * width + sx + x) * 4 + 3]) { tips[x] = y; break; }
  return tips;
}

/** Three joined stages: low pale seedlings, green crops, and original golden wheat. */
export function loadFarmArt(): Promise<void> {
  const load = (file: string, ready: (image: HTMLImageElement, pixels: Uint8ClampedArray) => void) => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0);
      const pixels = c.getImageData(0, 0, image.width, image.height).data;
      ready(image, pixels);
      resolve();
    };
    image.onerror = () => reject(new Error('Farm artwork could not be loaded.'));
    image.src = `${import.meta.env.BASE_URL}assets/pixelhole-overworld/${file}`;
  });
  return loading ??= Promise.all(['Seedling-Wheat-Joins.png', 'Green-Wheat-Joins.png', 'Wheatfield-Joins.png'].map((file, stage) =>
    load(file, (image, pixels) => {
      fieldSheets[stage] = image;
      fieldTips[stage] = Array.from({ length: 256 }, (_, mask) => cropTips(pixels, image.width, (mask & 15) * 16, (mask >> 4) * 16));
    }),
  )).then(() => undefined);
}

/** Grain stays ripe until collected or spoiled; empty plots follow their actual next crop. */
export function fieldGrowth(field: Pick<FarmField, 'planted' | 'food' | 'nextHarvest' | 'wheatRipe'>, time: number): number {
  if (!field.planted) return 0;
  if (field.wheatRipe ?? field.food > 0) return 1;
  return Math.max(0, Math.min(1, 1 - (field.nextHarvest - time) / FIELD_HARVEST_SECONDS));
}

/** Spend 10% of the crop cycle as seedlings, 55% green and 35% golden.
 * Golden appearance precedes harvest; only the crop deadline produces food. */
export function fieldStage(field: FarmField, time: number): number {
  if (!field.planted) return 0;
  if (field.wheatRipe ?? field.food > 0) return 2;
  const remaining = field.nextHarvest - time;
  return remaining > FIELD_HARVEST_SECONDS * .9 ? 0 : remaining > FIELD_HARVEST_SECONDS * .35 ? 1 : 2;
}

/** Fruit appears for the last 30–45 seconds of a mature crop cycle, before it
 * becomes collectible. A stable per-tree offset breaks up synchronized rows. */
export function orchardAppearance(field: FarmField, time: number): { mature: boolean; fruit: boolean } {
  const mature = !!field.orchard && time + 1e-7 >= field.orchard.readyAt;
  const offset = (Math.imul(field.camp, 2654435761) >>> 0) / 4294967296;
  const lead = FIELD_HARVEST_SECONDS * (.5 + offset * .25);
  const fruit = mature && field.planted && (field.food > 0 || field.nextHarvest - time <= lead);
  return { mature, fruit };
}

/** Remove internal borders, preserving the approved stalk tops and front face
 * around the patch. Callers supply observed fields/times so fog cannot reveal
 * a neighboring crop's hidden growth or ownership changes. */
export function wheatJoinMask(field: FarmField, time: number,
  fieldAt: (x: number, y: number) => FarmField | undefined,
  timeAt: (field: FarmField) => number = () => time): number {
  if (field.orchard) return 0;
  const stage = fieldStage(field, time);
  const joins = (dx: number, dy: number): boolean => {
    const neighbor = fieldAt(field.x + dx, field.y + dy);
    return !!neighbor && !neighbor.orchard && neighbor.faction === field.faction && fieldStage(neighbor, timeAt(neighbor)) === stage;
  };
  const n = joins(0, -1), e = joins(1, 0), s = joins(0, 1), w = joins(-1, 0);
  return Number(n) | Number(e) << 1 | Number(s) << 2 | Number(w) << 3
    | Number(n && e && joins(1, -1)) << 4 | Number(s && e && joins(1, 1)) << 5
    | Number(s && w && joins(-1, 1)) << 6 | Number(n && w && joins(-1, -1)) << 7;
}

/** Low crops hide feet and lower legs, never an entire standing figure. */
export function farmOcclusionHeight(field: FarmField, time: number): number {
  return field.orchard ? 0 : [.07, .14, .28][fieldStage(field, time)];
}

/** Original native wheat edges frame the patch, never individual joined cells. */
export function drawFarmField(c: Ctx, x: number, y: number, size: number, time: number, field: FarmField, joins = 0): void {
  c.save(); c.imageSmoothingEnabled = false;
  if (field.orchard) {
    const { mature, fruit } = orchardAppearance(field, time);
    // Native Puny orange/red fruit trees, with their matching fruitless canopy
    // while establishing or fallow. No wild-tree Medieval sprites are mixed in.
    const sy = (field.camp & 1) === 0 ? 416 : 432;
    c.globalAlpha *= mature ? 1 : .6;
    drawPuny(c, fruit ? 32 : 48, sy, 16, 16, x, y, size, size);
  } else {
    const stage = fieldStage(field, time), sheet = fieldSheets[stage];
    if (sheet) c.drawImage(sheet, (joins & 15) * 16, (joins >> 4) * 16, 16, 16, x, y, size, size);
  }
  c.restore();
}

/** Restore only low foreground wheat over a walker, using the crop's real
 * stalk edge. The caller applies terrain/ditch clipping just as for the field.
 * Crossing the southern planting edge puts the whole unit in front again. */
export function drawFarmOcclusion(c: Ctx, x: number, y: number, size: number, time: number, field: FarmField, feetX: number, feetY: number, continuesSouth = false, joins = 0): void {
  const stage = fieldStage(field, time), height = farmOcclusionHeight(field, time);
  const tips = fieldTips[stage]?.[joins];
  if (!fieldSheets[stage] || !height || !tips || feetY < y || feetY >= y + size && !continuesSouth) return;
  const pixel = size / 16, min = Math.min(...tips), top = y + Math.round((feetY - y - height * size) / pixel) * pixel;
  c.save(); c.beginPath(); c.rect(feetX - size * .55, top, size * 1.1, height * size + pixel); c.clip();
  c.beginPath();
  for (let column = 0; column < 16; column++) if (tips[column] < 16) {
    const start = Math.max(y, top + (tips[column] - min) * pixel);
    c.rect(x + column * pixel, start, pixel, Math.max(0, y + size - start));
  }
  c.clip(); drawFarmField(c, x, y, size, time, field, joins); c.restore();
}

/** A tiny pixel clock hops above grain that is close to its delivery deadline. */
export function drawFoodExpiryClock(c: Ctx, x: number, y: number, size: number, time: number): void {
  const scale = Math.max(1, Math.round(size / 36));
  c.save(); c.translate(Math.round(x - 4.5 * scale), Math.round(y - Math.abs(Math.sin(time * 5)) * 3 * scale));
  c.scale(scale, scale);
  c.fillStyle = '#222820';
  c.fillRect(2, 0, 5, 9); c.fillRect(0, 2, 9, 5); c.fillRect(1, 1, 7, 7);
  c.fillStyle = '#fff0bd'; c.fillRect(2, 1, 5, 7); c.fillRect(1, 2, 7, 5);
  c.fillStyle = '#b34c3e'; c.fillRect(4, 2, 1, 3); c.fillRect(4, 4, 3, 1);
  c.restore();
}
