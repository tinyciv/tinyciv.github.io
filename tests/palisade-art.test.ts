import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { drawPalisade, loadPalisadeArt, PALISADE_TILES } from '../src/game/palisade-art';
import type { RoadLinks } from '../src/game/road-sprites';

type Rect = readonly [number, number, number, number];
type Draw = { source: Rect; destination: Rect; clips: Rect[][] };
const links = (mask: number): RoadLinks => ({ north: !!(mask & 1), east: !!(mask & 2), south: !!(mask & 4), west: !!(mask & 8) });
const loadedSources: string[] = [];
class RecordingCanvas {
  imageSmoothingEnabled = true;
  images: Draw[] = [];
  path: Rect[] = [];
  clips: Rect[][] = [];
  stack: Rect[][][] = [];
  save() { this.stack.push(this.clips.map(region => [...region])); }
  restore() { this.clips = this.stack.pop()!; }
  beginPath() { this.path = []; }
  rect(x: number, y: number, width: number, height: number) { this.path.push([x, y, width, height]); }
  clip() { this.clips.push([...this.path]); }
  drawImage(_sheet: unknown, sx: number, sy: number, sw: number, sh: number, x: number, y: number, width: number, height: number) {
    this.images.push({ source: [sx, sy, sw, sh], destination: [x, y, width, height], clips: this.clips.map(region => [...region]) });
  }
}
const render = (mask: number, gate?: number) => {
  const canvas = new RecordingCanvas();
  drawPalisade(canvas as unknown as CanvasRenderingContext2D, links(mask), gate === undefined ? undefined : links(gate));
  return canvas;
};

beforeAll(async () => {
  vi.stubGlobal('Image', class {
    src = ''; naturalWidth = 160; naturalHeight = 64;
    async decode() { loadedSources.push(this.src); }
  });
  await loadPalisadeArt();
});
afterAll(() => vi.unstubAllGlobals());

describe('approved native Puny Medieval palisades', () => {
  it('loads the exact approved preview crop with its purchased provenance', () => {
    const file = readFileSync('public/assets/puny-medieval/palisades.png');
    const preview = readFileSync('dev/marauder-camp-review/art/palisades.png');
    const metadata = JSON.parse(readFileSync('public/assets/puny-medieval/palisades-source.json', 'utf8'));
    expect(file.equals(preview)).toBe(true);
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([160, 64]);
    expect(metadata.source_rect).toEqual([2640, 96, 160, 64]);
    expect(metadata.sha256).toBe(createHash('sha256').update(file).digest('hex'));
    expect(metadata.license).toContain('Purchased');
    expect(loadedSources).toEqual([expect.stringContaining('assets/puny-medieval/palisades.png')]);
  });

  it.each(Array.from({ length: 16 }, (_, mask) => mask))('keeps connection mask %s at native 2× scale inside exactly one tile', mask => {
    const canvas = render(mask);
    expect(canvas.images.length).toBeGreaterThan(0);
    expect(canvas.imageSmoothingEnabled).toBe(false);
    for (const image of canvas.images) {
      expect(image.source.slice(2)).toEqual([16, 16]);
      expect(image.destination).toEqual([0, 0, 32, 32]);
      expect(image.source[0]).toBeGreaterThanOrEqual(0); expect(image.source[0] + 16).toBeLessThanOrEqual(160);
      expect(image.source[1]).toBeGreaterThanOrEqual(0); expect(image.source[1] + 16).toBeLessThanOrEqual(64);
      expect(image.clips[0]).toEqual([[0, 0, 32, 32]]);
      for (const region of image.clips) for (const [x, y, width, height] of region) {
        expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(32); expect(y + height).toBeLessThanOrEqual(32);
      }
    }
    expect(canvas.stack).toEqual([]);
  });

  it.each([
    [10, PALISADE_TILES.horizontal], [5, PALISADE_TILES.vertical],
    [0, PALISADE_TILES.pier], [2, PALISADE_TILES.eastEnd], [8, PALISADE_TILES.westEnd],
    [1, PALISADE_TILES.northEnd], [4, PALISADE_TILES.southEnd],
    [3, PALISADE_TILES.northeast], [6, PALISADE_TILES.southeast],
    [9, PALISADE_TILES.northwest], [12, PALISADE_TILES.southwest],
  ] as const)('uses the authored run or corner for mask %s', (mask, source) => {
    expect(render(mask).images.map(image => image.source)).toEqual([source]);
  });

  it.each([1, 4, 5])('orients complete timber gates across north/south road mask %s', passage => {
    expect(render(10, passage).images.map(image => image.source)).toEqual([PALISADE_TILES.closedGateNS]);
  });
  it.each([2, 8, 10])('orients complete timber gates across east/west road mask %s', passage => {
    expect(render(5, passage).images.map(image => image.source)).toEqual([PALISADE_TILES.closedGateEW]);
  });
  it('orients an isolated road marker perpendicular to the wall run', () => {
    expect(render(5, 0).images[0].source).toEqual(PALISADE_TILES.closedGateEW);
    expect(render(10, 0).images[0].source).toEqual(PALISADE_TILES.closedGateNS);
  });

  it.each([3, 6, 7, 9, 11, 12, 13, 14, 15])('preserves visible gate bars and fittings at road junction mask %s', passage => {
    for (const [wallMask, source] of [[5, PALISADE_TILES.closedGateEW], [10, PALISADE_TILES.closedGateNS]] as const) {
      const image = render(wallMask, passage).images[0];
      expect(image.source).toEqual(source);
      expect(image.clips).toEqual([[[0, 0, 32, 32]]]);
    }
  });
});
