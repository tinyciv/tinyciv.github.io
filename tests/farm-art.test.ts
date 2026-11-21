import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawFarmField, drawFarmOcclusion, drawFoodExpiryClock, farmOcclusionHeight, fieldGrowth, fieldStage, loadFarmArt, orchardAppearance, wheatJoinMask } from '../src/game/farm-art';
import { CAMP_FIELD_OFFSETS, FIELD_HARVEST_SECONDS } from '../src/game/farms';
import type { Building, FarmField } from '../src/game/types';
import { punyAtlas } from './puny-atlas.js';
import { drawPuny } from '../src/game/puny-world';
import { fieldKey } from '../src/game/native-art';
import { runtimeArtUrl } from '../src/game/runtime-art';

vi.mock('../src/game/puny-world', async importOriginal => ({
  ...await importOriginal<typeof import('../src/game/puny-world')>(), drawPuny: vi.fn(),
}));

const camp: Building = { id: 1, kind: 'camp', faction: 0, x: 10, y: 10, hp: 100, maxHp: 100, capacity: 4 };
const field = (x: number, y: number, faction = 0): FarmField => ({ id: y * 100 + x, x, y, faction, camp: camp.id, planted: true, food: 0, nextHarvest: FIELD_HARVEST_SECONDS });


beforeAll(async () => {
  const paths = ['farms/turned-loam-joins.png', 'pixelhole-overworld/Seedling-Wheat-Joins.png',
    'pixelhole-overworld/Green-Wheat-Joins.png', 'pixelhole-overworld/Wheatfield-Joins.png',
    'farms/wheat-growth-joins.png'];
  const sheets = paths.map(file => punyAtlas(new URL(`../public/assets/${file}`, import.meta.url)));
  vi.stubGlobal('document', { createElement: () => {
    let pixels = sheets[0];
    return { getContext: () => ({ drawImage(image: { pixels: typeof pixels }) { pixels = image.pixels; }, getImageData: () => pixels }) };
  } });
  vi.stubGlobal('Image', class {
    width = 256; height = 256;
    pixels = sheets[0];
    filename = '';
    onload?: () => void;
    set src(value: string) {
      const index = paths.findIndex(file => value === runtimeArtUrl(`${import.meta.env.BASE_URL}assets/${file}`));
      if (index < 0) throw new Error(`Unexpected farm sheet: ${value}`);
      this.filename = paths[index].split('/').at(-1)!; this.pixels = sheets[index];
      this.width = this.pixels.width; this.height = this.pixels.height;
      queueMicrotask(() => this.onload?.());
    }
  });
  await loadFarmArt();
});
afterAll(() => vi.unstubAllGlobals());

describe('grain harvest appearance', () => {
  it.each([
    [0, 0, 'turned-loam-joins.png'], [5.999, 0, 'wheat-growth-joins.png'],
    [6, 1, 'Seedling-Wheat-Joins.png'], [11.999, 1, 'wheat-growth-joins.png'],
    [12, 2, 'Green-Wheat-Joins.png'], [38.999, 2, 'wheat-growth-joins.png'],
    [39, 3, 'Wheatfield-Joins.png'], [45, 3, 'Wheatfield-Joins.png'], [60, 3, 'Wheatfield-Joins.png'],
  ] as const)
    ('draws growth at %s seconds with stage %s from %s', (time, stage, filename) => {
      const context = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn() };
      const c = context as unknown as CanvasRenderingContext2D, plot = field(1, 1);
      expect(fieldStage(plot, time)).toBe(stage);
      drawFarmField(c, 0, 0, 32, time, plot, 255);
      const crop = context.drawImage.mock.calls[0];
      expect(crop[0].filename).toBe(filename);
      expect(crop.slice(3)).toEqual([16, 16, 0, 0, 32, 32]);
      if (filename !== 'wheat-growth-joins.png') expect(crop.slice(1, 3)).toEqual([240, 240]);
    });

  it.each([[4, 'wheat-growth-joins.png'], [6, 'Seedling-Wheat-Joins.png'], [15, 'Green-Wheat-Joins.png'], [39, 'Wheatfield-Joins.png']])
    ('uses the same joined tile for the field and foreground at %s seconds', (time, filename) => {
      const plot = field(1, 1);
      const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn() };
      const c = context as unknown as CanvasRenderingContext2D, joins = 1 | 2 | 16;
      drawFarmField(c, 32, 32, 32, Number(time), plot, joins);
      const crop = context.drawImage.mock.calls[0];
      expect(crop[0].filename).toBe(filename);
      if (filename !== 'wheat-growth-joins.png') expect(crop.slice(1, 5)).toEqual([48, 16, 16, 16]);
      context.drawImage.mockClear();
      drawFarmOcclusion(c, 32, 32, 32, Number(time), plot, 48, 48, false, joins);
      expect(context.drawImage).toHaveBeenCalledOnce();
      expect(context.drawImage.mock.calls[0].slice(0, 5)).toEqual(crop.slice(0, 5));
    });

  it('shares frames across synchronized fields and preserves a different observed frame in fog', () => {
    const left = field(1, 1), right = field(2, 1);
    const at = (x: number, y: number) => x === right.x && y === right.y ? right : undefined;
    expect(fieldKey(left, 4, 2)).toBe(fieldKey(right, 4, 2));
    expect(fieldKey(left, 4, 2)).not.toBe(fieldKey(left, 5, 2));
    expect(wheatJoinMask(left, 4, at)).toBe(2);
    expect(wheatJoinMask(left, 4, at, () => 3)).toBe(0);
    expect(fieldKey({ ...left, planted: false }, 4)).toBe(fieldKey(left, 0));
  });

  it('keeps seedling occlusion below green crops and green crops below golden wheat', () => {
    const plot = field(1, 1);
    expect(farmOcclusionHeight(plot, 0)).toBe(0);
    expect(farmOcclusionHeight(plot, 6)).toBe(farmOcclusionHeight(plot, 15) / 2);
    expect(farmOcclusionHeight(plot, 15)).toBe(farmOcclusionHeight(plot, 60) / 2);
    const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn() };
    drawFarmOcclusion(context as unknown as CanvasRenderingContext2D, 0, 0, 32, 0, plot, 16, 16);
    expect(context.drawImage).not.toHaveBeenCalled();
    drawFarmOcclusion(context as unknown as CanvasRenderingContext2D, 0, 0, 32, 6, plot, 16, 16);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(context.rect.mock.calls[0][1]).toBeGreaterThanOrEqual(16 - 32 * .1);
  });

  it('hides only lower legs in grown grain and leaves a walker in front of the southern crop edge', () => {
    const plot = { ...field(1, 1), nextHarvest: 0 };
    expect(farmOcclusionHeight(plot, 0)).toBeLessThan(.4);
    expect(farmOcclusionHeight({ ...plot, planted: false }, 0)).toBe(0);
    const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn() };
    drawFarmOcclusion(context as unknown as CanvasRenderingContext2D, 32, 32, 32, 0, plot, 48, 48);
    expect(context.drawImage).toHaveBeenCalledOnce();
    const unitClip = context.rect.mock.calls[0];
    expect(unitClip[1]).toBeGreaterThan(48 - 32 * .4);
    context.drawImage.mockClear();
    drawFarmOcclusion(context as unknown as CanvasRenderingContext2D, 32, 32, 32, 0, plot, 48, 64);
    expect(context.drawImage).not.toHaveBeenCalled();
    // Adjoining wheat has no artificial gap at the boundary between rows.
    drawFarmOcclusion(context as unknown as CanvasRenderingContext2D, 32, 32, 32, 0, plot, 48, 64, true);
    expect(context.drawImage).toHaveBeenCalledOnce();
    context.drawImage.mockClear();
    drawFarmOcclusion(context as unknown as CanvasRenderingContext2D, 32, 64, 32, 0, plot, 48, 65);
    expect(context.drawImage).toHaveBeenCalledOnce();
  });

  it('draws ripe fruit trees directly on terrain with no wheat soil pad', () => {
    const context = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), globalAlpha: 1 };
    const plot = { ...field(1, 1), food: 2, orchard: { startedAt: 0, readyAt: 120 } };
    vi.mocked(drawPuny).mockClear();
    drawFarmField(context as unknown as CanvasRenderingContext2D, 0, 0, 32, 120, plot);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(vi.mocked(drawPuny).mock.calls[0].slice(1, 5)).toEqual([32, 432, 16, 16]);
    drawFarmField(context as unknown as CanvasRenderingContext2D, 0, 0, 32, 120, { ...plot, food: 0, nextHarvest: 180 });
    expect(vi.mocked(drawPuny).mock.calls[1].slice(1, 5)).toEqual([48, 432, 16, 16]);
    expect(farmOcclusionHeight(plot, 120)).toBe(0);
  });

  it('shows fruit well before harvest with different visual phases while leaving all production state unchanged', () => {
    const plots = Array.from({ length: 12 }, (_, index) => ({ ...field(index, 1), camp: index + 1,
      orchard: { startedAt: 0, readyAt: 120 }, nextHarvest: 180 }));
    const before = JSON.stringify(plots);
    expect(plots.every(plot => !orchardAppearance(plot, 121).fruit)).toBe(true);
    const mixed = plots.map(plot => orchardAppearance(plot, 145).fruit);
    expect(mixed.some(Boolean)).toBe(true); expect(mixed.some(fruit => !fruit)).toBe(true);
    expect(plots.every(plot => orchardAppearance(plot, 150).fruit)).toBe(true);
    expect(plots.every(plot => !orchardAppearance({ ...plot, planted: false }, 179).fruit)).toBe(true);
    expect(plots.every(plot => !orchardAppearance(plot, 119).fruit)).toBe(true);
    expect(JSON.stringify(plots)).toBe(before);
    expect(plots.map(plot => orchardAppearance(JSON.parse(JSON.stringify(plot)), 145))).toEqual(plots.map(plot => orchardAppearance(plot, 145)));
  });

  it('invalidates the native orchard sprite when early fruit appears without making per-tree atlas entries', () => {
    const plot = { ...field(1, 1), orchard: { startedAt: 0, readyAt: 120 }, nextHarvest: 180 };
    expect(fieldKey(plot, 121)).not.toBe(fieldKey(plot, 145));
    expect(fieldKey(plot, 145)).toBe(fieldKey({ ...plot, food: 4 }, 180));
    const keys = new Set<string>();
    for (let camp = 1; camp <= 40; camp++) for (const time of [90, 121, 145, 150, 175]) keys.add(fieldKey({ ...plot, camp }, time));
    expect(keys.size).toBe(6);
  });

  it('shows each stage of the new crop while the previous harvest awaits pickup', () => {
    const plot = field(1, 1);
    expect(fieldGrowth(plot, 0)).toBe(0);
    expect(fieldGrowth(plot, FIELD_HARVEST_SECONDS / 2)).toBe(.5);
    expect(fieldGrowth(plot, FIELD_HARVEST_SECONDS)).toBe(1);
    plot.food = 1.1; plot.nextHarvest = FIELD_HARVEST_SECONDS * 2;
    expect([60, 66, 72, 99].map(time => fieldStage(plot, time))).toEqual([0, 1, 2, 3]);
    expect(fieldGrowth(plot, FIELD_HARVEST_SECONDS + 1)).toBeCloseTo(1 / 60);
    plot.food = 0; plot.harvestedAt = FIELD_HARVEST_SECONDS * 7 / 6;
    expect(fieldGrowth(plot, FIELD_HARVEST_SECONDS * 7 / 6)).toBeCloseTo(1 / 6);
    expect(fieldGrowth(plot, FIELD_HARVEST_SECONDS * 2)).toBe(1);
  });

  it('keeps fallow fields at the first stage and derives the same crop phase after save and reload', () => {
    const plot = { ...field(1, 1), nextHarvest: 120, harvestedAt: 90 };
    expect(fieldGrowth({ ...plot, planted: false }, 119)).toBe(0);
    expect(fieldGrowth(JSON.parse(JSON.stringify(plot)), 99)).toBe(fieldGrowth(plot, 99));
  });

  it('shows fallow farms as furrowed soil and keeps harvested active plots visible', () => {
    const canvas = {
      save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '', imageSmoothingEnabled: false,
    };
    const plot = { ...field(1, 1), planted: false, harvestedAt: 30 };
    drawFarmField(canvas as unknown as CanvasRenderingContext2D, 0, 0, 32, 30, plot);
    expect(canvas.fillRect).not.toHaveBeenCalled();
    expect(canvas.drawImage).toHaveBeenCalledTimes(1);
    expect(canvas.drawImage.mock.calls[0][0].filename).toBe('turned-loam-joins.png');
    expect(canvas.drawImage.mock.calls[0].slice(1, 5)).toEqual([0, 0, 16, 16]);
    plot.planted = true;
    drawFarmField(canvas as unknown as CanvasRenderingContext2D, 0, 0, 32, 30, plot);
    expect(canvas.fillRect).not.toHaveBeenCalled();
    expect(canvas.drawImage).toHaveBeenCalledTimes(2);
  });
});

describe('compact farms and expiry clock', () => {
  it('uses one crop tile per farm', () => {
    expect(CAMP_FIELD_OFFSETS).toHaveLength(1);
    expect(new Set(CAMP_FIELD_OFFSETS.map(([x,y]) => `${x},${y}`))).toEqual(new Set(['0,0']));
  });

  it('draws a small hopping pixel clock without depending on fonts or emoji', () => {
    const canvas = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
    drawFoodExpiryClock(canvas as unknown as CanvasRenderingContext2D, 50, 50, 32, 0);
    const firstY = canvas.translate.mock.calls[0][1];
    drawFoodExpiryClock(canvas as unknown as CanvasRenderingContext2D, 50, 50, 32, Math.PI / 10);
    expect(canvas.translate.mock.calls[1][1]).toBeLessThan(firstY);
    expect(canvas.fillRect).toHaveBeenCalled();
  });
});
