import { runtimeArtUrl } from './runtime-art';
import { FIELD_HARVEST_SECONDS } from './farms';
import { type FarmField } from './types';
import { drawPuny } from './puny-world';
import growthAtlas from './wheat-growth-atlas.json';

type Ctx = CanvasRenderingContext2D;
const FIELD_ART = [
  'farms/turned-loam-joins.png',
  'pixelhole-overworld/Seedling-Wheat-Joins.png',
  'pixelhole-overworld/Green-Wheat-Joins.png',
  'pixelhole-overworld/Wheatfield-Joins.png',
];
const GROWTH_ART = 'farms/wheat-growth-joins.png';
const STAGE_REMAINING = [.9, .8, .35].map(fraction => FIELD_HARVEST_SECONDS * fraction);
const TRANSITION_SECONDS = 4;
const FIRST_TRANSITION_FRAME = growthAtlas.frames.map((_, stage) =>
  FIELD_ART.length + growthAtlas.frames.slice(0, stage).reduce((sum, count) => sum + count, 0));
const OCCLUSION_HEIGHT = [0, .07, .14, .28];
const FRAME_HEIGHT = [...OCCLUSION_HEIGHT, ...growthAtlas.frames.flatMap((count, stage) =>
  Array.from({ length: count }, (_, step) => OCCLUSION_HEIGHT[stage]
    + (OCCLUSION_HEIGHT[stage + 1] - OCCLUSION_HEIGHT[stage]) * (step + 1) / (count + 1)))];
interface WheatTileArt {
  image: HTMLImageElement;
  rect: [number, number, number, number];
  tips?: number[];
  top: number;
}
const fieldTiles: WheatTileArt[][] = [];
let loading: Promise<void> | undefined;

function tileArt(image: HTMLImageElement, sx: number, sy: number, pixels?: Uint8ClampedArray): WheatTileArt {
  const rect: WheatTileArt['rect'] = [sx, sy, 16, 16];
  if (!pixels) return { image, rect, top: 16 };
  const tips = Array<number>(16).fill(16);
  let top = 16;
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
    if (pixels[((y + sy) * image.width + sx + x) * 4 + 3]) {
      tips[x] = y; top = Math.min(top, y); break;
    }
  }
  return { image, rect, tips, top };
}

function loadWheatSheet(file: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Farm artwork could not be loaded: ${file}`));
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/${file}`);
  });
}

function readPixels(image: HTMLImageElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height).data;
}

/** Read crop silhouettes once at load time. Rendering only selects existing frames. */
export function loadFarmArt(): Promise<void> {
  return loading ??= Promise.all([
    ...FIELD_ART.map(async (file, stage) => {
      const image = await loadWheatSheet(file), pixels = stage ? readPixels(image) : undefined;
      fieldTiles[stage] = Array.from({ length: 256 }, (_, mask) =>
        tileArt(image, (mask & 15) * 16, (mask >> 4) * 16, pixels));
    }),
    loadWheatSheet(GROWTH_ART).then(image => {
      const pixels = readPixels(image);
      for (let frame = FIELD_ART.length; frame < FRAME_HEIGHT.length; frame++) {
        const tiles: WheatTileArt[] = [];
        for (const [column, mask] of growthAtlas.masks.entries()) {
          tiles[mask] = tileArt(image, column * 16, (frame - FIELD_ART.length) * 16, pixels);
        }
        fieldTiles[frame] = tiles;
      }
    }),
  ]).then(() => undefined);
}

/** Harvest crates and standing crops have independent lifetimes. */
export function fieldGrowth(field: Pick<FarmField, 'planted' | 'nextHarvest'>, time: number): number {
  if (!field.planted) return 0;
  return Math.max(0, Math.min(1, 1 - (field.nextHarvest - time) / FIELD_HARVEST_SECONDS));
}

/** The soil, seedling, green and golden keyframes begin at 0%, 10%, 20% and 65%.
 * Golden appearance precedes harvest; only the crop deadline produces food. */
export function fieldStage(field: FarmField, time: number): number {
  if (!field.planted) return 0;
  return stageFromRemaining(field.nextHarvest - time);
}

function stageFromRemaining(remaining: number): number {
  if (remaining > STAGE_REMAINING[0]) return 0;
  if (remaining > STAGE_REMAINING[1]) return 1;
  return remaining > STAGE_REMAINING[2] ? 2 : 3;
}

/** Ease into each crop state during the four seconds preceding its existing deadline. */
export function wheatFrame(field: FarmField, time: number): number {
  if (!field.planted) return 0;
  const remaining = field.nextHarvest - time, stage = stageFromRemaining(remaining);
  if (stage === 3) return stage;
  const fraction = 1 - (remaining - STAGE_REMAINING[stage]) / TRANSITION_SECONDS;
  const count = growthAtlas.frames[stage], slot = Math.floor(fraction * (count + 1));
  return slot < 1 ? stage : FIRST_TRANSITION_FRAME[stage] + Math.min(count, slot) - 1;
}

export function wheatTile(frame: number, joins: number): WheatTileArt | undefined {
  return fieldTiles[frame]?.[joins] ?? fieldTiles[frame]?.[0];
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
  const frame = wheatFrame(field, time);
  const joins = (dx: number, dy: number): boolean => {
    const neighbor = fieldAt(field.x + dx, field.y + dy);
    return !!neighbor && !neighbor.orchard && neighbor.faction === field.faction && wheatFrame(neighbor, timeAt(neighbor)) === frame;
  };
  const n = joins(0, -1), e = joins(1, 0), s = joins(0, 1), w = joins(-1, 0);
  return Number(n) | Number(e) << 1 | Number(s) << 2 | Number(w) << 3
    | Number(n && e && joins(1, -1)) << 4 | Number(s && e && joins(1, 1)) << 5
    | Number(s && w && joins(-1, 1)) << 6 | Number(n && w && joins(-1, -1)) << 7;
}

/** Low crops hide feet and lower legs, never an entire standing figure. */
export function farmOcclusionHeight(field: FarmField, time: number): number {
  return field.orchard ? 0 : FRAME_HEIGHT[wheatFrame(field, time)];
}

/** Soil and crop edges frame the connected patch. */
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
    const tile = wheatTile(wheatFrame(field, time), joins);
    if (tile) c.drawImage(tile.image, ...tile.rect, x, y, size, size);
  }
  c.restore();
}

/** Restore only low foreground wheat over a walker, using the crop's real
 * stalk edge. The caller applies terrain/ditch clipping just as for the field.
 * Crossing the southern planting edge puts the whole unit in front again. */
export function drawFarmOcclusion(c: Ctx, x: number, y: number, size: number, time: number, field: FarmField, feetX: number, feetY: number, continuesSouth = false, joins = 0): void {
  if (field.orchard) return;
  const frame = wheatFrame(field, time), height = FRAME_HEIGHT[frame], tile = wheatTile(frame, joins);
  if (!height || !tile?.tips || feetY < y || feetY >= y + size && !continuesSouth) return;
  const { tips } = tile;
  const pixel = size / 16, top = y + Math.round((feetY - y - height * size) / pixel) * pixel;
  c.save(); c.imageSmoothingEnabled = false;
  c.beginPath(); c.rect(feetX - size * .55, top, size * 1.1, height * size + pixel); c.clip();
  c.beginPath();
  for (let column = 0; column < 16; column++) if (tips[column] < 16) {
    const start = Math.max(y, top + (tips[column] - tile.top) * pixel);
    c.rect(x + column * pixel, start, pixel, Math.max(0, y + size - start));
  }
  c.clip(); c.drawImage(tile.image, ...tile.rect, x, y, size, size); c.restore();
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
