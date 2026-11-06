import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { drawHealerShack, healerShackIconUrl, HEALER_SHACK_SPRITE, loadHealerShackArt } from '../src/game/healer-art';
import { drawBuilding } from '../src/game/sprites';
import { NativeArt, buildingKey } from '../src/game/native-art';
import { buildingArtTop, buildingHeight, buildingWidth, type Building } from '../src/game/types';
import { punyAtlas } from './puny-atlas';

type Rect = { x: number; y: number; width: number; height: number };
type Matrix = { x: number; y: number; scaleX: number; scaleY: number };
class RecordingCanvas {
  imageSmoothingEnabled = true;
  matrix = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  stack: { matrix: Matrix; smoothing: boolean }[] = [];
  images: { src: string; rect: Rect; smoothing: boolean }[] = [];
  save() { this.stack.push({ matrix: { ...this.matrix }, smoothing: this.imageSmoothingEnabled }); }
  restore() { const saved = this.stack.pop()!; this.matrix = saved.matrix; this.imageSmoothingEnabled = saved.smoothing; }
  translate(x: number, y: number) { this.matrix.x += x * this.matrix.scaleX; this.matrix.y += y * this.matrix.scaleY; }
  scale(x: number, y: number) { this.matrix.scaleX *= x; this.matrix.scaleY *= y; }
  drawImage(image: HTMLImageElement, x: number, y: number, width: number, height: number) {
    this.images.push({ src: image.src, smoothing: this.imageSmoothingEnabled, rect: {
      x: this.matrix.x + x * this.matrix.scaleX, y: this.matrix.y + y * this.matrix.scaleY,
      width: width * this.matrix.scaleX, height: height * this.matrix.scaleY,
    } });
  }
}
const shack: Building = { id: 1, kind: 'healerShack', faction: 0, x: 3, y: 4, hp: 260, maxHp: 260, capacity: 0 };
const loaded: string[] = [];
beforeAll(async () => {
  vi.stubGlobal('Image', class {
    src = ''; naturalWidth = 16; naturalHeight = 16;
    async decode() { loaded.push(this.src); }
  });
  await Promise.all([loadHealerShackArt(), loadHealerShackArt()]);
});
afterAll(() => vi.unstubAllGlobals());

describe('native healer’s shack artwork', () => {
  it('uses the unmodified, distinct one-cell potion shop with recorded provenance', () => {
    const file = readFileSync('public/assets/miniworld/Healers-Shack.png');
    const metadata = JSON.parse(readFileSync('public/assets/miniworld/Healers-Shack-source.json', 'utf8'));
    const hash = createHash('sha256').update(file).digest('hex');
    expect(hash).toBe('bcf8f4e71d1a094927d44c9deee89e5e62a136cdfe97396ccda1a8511b6c4f79');
    expect(metadata.sha256).toBe(hash);
    expect(metadata.original_path).toBe('MiniWorldSprites/Buildings/Wood/Market.png');
    expect(metadata.source_rect).toEqual([16, 32, 16, 16]);
    expect(metadata.license).toBe('CC0-1.0');
    for (const other of ['miniworld/Blacksmith', 'miniworld/Guard-Post', 'medieval/Scouts-Lodge', 'medieval/Library'])
      expect(createHash('sha256').update(readFileSync(`public/assets/${other}.png`)).digest('hex')).not.toBe(hash);
  });

  it('anchors the visible foundation to the tile floor without padded height', () => {
    const native = punyAtlas(new URL('../public/assets/miniworld/Healers-Shack.png', import.meta.url));
    expect([native.width, native.height]).toEqual([16, 16]);
    expect(HEALER_SHACK_SPRITE.groundAnchor).toEqual([8, 16]);
    const opaqueRows = Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => native.data[(y * 16 + x) * 4 + 3]).some(alpha => alpha > 0));
    expect(opaqueRows.at(-1)).toBe(true);
    expect([buildingWidth(shack), buildingHeight(shack), buildingArtTop(shack)]).toEqual([1, 1, 0]);
  });

  it('loads once and uses the same square image for the research and building icon', () => {
    expect(loaded).toEqual([healerShackIconUrl()]);
    expect(healerShackIconUrl()).toContain('assets/miniworld/Healers-Shack.png');
  });

  it.each([16, 32, 64])('draws at %spx without smoothing and restores the caller’s context', size => {
    const c = new RecordingCanvas();
    drawHealerShack(c as unknown as CanvasRenderingContext2D, 24, 48, size);
    expect(c.images).toEqual([{ src: healerShackIconUrl(), smoothing: false, rect: { x: 24, y: 48, width: size, height: size } }]);
    expect(c.imageSmoothingEnabled).toBe(true);
    expect(c.stack).toEqual([]);
  });

  it('routes both Canvas world drawing and Pixi atlas baking through the same native sprite', () => {
    const c = new RecordingCanvas();
    drawBuilding(c as unknown as CanvasRenderingContext2D, shack, 64, 96, 64, 0, '#c94c4c');
    expect(c.images).toEqual([{ src: healerShackIconUrl(), smoothing: false, rect: { x: 64, y: 96, width: 64, height: 64 } }]);
    const art = new NativeArt();
    const baked = new RecordingCanvas();
    const paint = vi.spyOn(art, 'paint').mockImplementation((_key, bounds, draw) => {
      draw(baked as unknown as CanvasRenderingContext2D); return { ...bounds, texture: null! };
    });
    expect(art.building(shack, 0, '#c94c4c')).toEqual({ x: 0, y: 0, width: 32, height: 32, texture: null });
    expect(baked.images).toEqual([{ src: healerShackIconUrl(), smoothing: false, rect: { x: 0, y: 0, width: 32, height: 32 } }]);
    expect(paint).toHaveBeenCalledOnce();
    expect(buildingKey(shack, 0, '#c94c4c')).not.toBe(buildingKey({ ...shack, kind: 'blacksmith' }, 0, '#c94c4c'));
  });
});
