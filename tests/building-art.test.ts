import { describe, expect, it, vi } from 'vitest';
import { buildingSize, type Building, type GameState } from '../src/game/types';
import { buildingBlockers } from '../src/game/pathfinding';
import { startConstruction } from '../src/game/structures';

// Capture destination geometry after the same canvas transforms a real atlas
// draw uses. This verifies art sizing independently of its logical footprint.
vi.mock('../src/game/puny-world', () => ({
  loadPunyWorld: async () => undefined,
  punyWorldImage: () => undefined,
  punyWorldPixels: () => undefined,
  drawPuny(c: RecordingCanvas, sx: number, sy: number, sw: number, sh: number, x: number, y: number, width: number, height: number) {
    c.images.push(c.rectangle(x, y, width, height));
    c.sources.push({ rect: [sx, sy, sw, sh] });
  },
}));
// Keep the real tier selector and production building wrappers. Only replace
// the final canvas raster boundary, recording the actual chosen atlas crop
// and team color rather than stubbing each building into a generic rectangle.
vi.mock('../src/game/puny-building-art', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/game/puny-building-art')>();
  const region = (c: RecordingCanvas, rect: readonly number[], x: number, y: number, width: number, height: number, color: string) => {
    c.images.push(c.rectangle(x, y, width, height));
    c.sources.push({ rect: [...rect], color });
  };
  return {
    ...actual,
    drawPunyBuildingRegion: region,
    drawPunyBuildingTile(c: RecordingCanvas, column: number, row: number, x: number, y: number, width: number, height: number, color: string) {
      region(c, [column * 16, row * 16, 16, 16], x, y, width, height, color);
    },
  };
});
import { buildingArtTop, drawBuilding } from '../src/game/sprites';
import { buildingKey, NativeArt } from '../src/game/native-art';

type Rect = { x: number; y: number; width: number; height: number };
class RecordingCanvas {
  images: Rect[] = [];
  sources: { rect: number[]; color?: string }[] = [];
  fills: Rect[] = [];
  matrix = { x: 0, y: 0, sx: 1, sy: 1 };
  stack: typeof this.matrix[] = [];
  imageSmoothingEnabled = false;
  globalAlpha = 1;
  fillStyle = '';
  paths: Rect[][] = [];
  clips: string[] = [];
  save() { this.stack.push({ ...this.matrix }); }
  restore() { this.matrix = this.stack.pop()!; }
  translate(x: number, y: number) { this.matrix.x += x * this.matrix.sx; this.matrix.y += y * this.matrix.sy; }
  scale(x: number, y: number) { this.matrix.sx *= x; this.matrix.sy *= y; }
  rectangle(x: number, y: number, width: number, height: number): Rect {
    return { x: this.matrix.x + x * this.matrix.sx, y: this.matrix.y + y * this.matrix.sy, width: width * this.matrix.sx, height: height * this.matrix.sy };
  }
  fillRect(x: number, y: number, width: number, height: number) { this.fills.push(this.rectangle(x, y, width, height)); }
  beginPath() { this.paths.push([]); }
  rect(x: number, y: number, width: number, height: number) { this.paths.at(-1)!.push(this.rectangle(x, y, width, height)); }
  clip(rule = 'nonzero') { this.clips.push(rule); }
}
const structure = (kind: Building['kind']): Building => ({ id: 1, kind, faction: 0, x: 1, y: 1, hp: 100, maxHp: 100, capacity: 0 });
function render(building: Building, time = 10, attached = false): RecordingCanvas {
  const canvas = new RecordingCanvas();
  drawBuilding(canvas as unknown as CanvasRenderingContext2D, building, 64, 96, 64, time, '#3988ff', undefined, undefined, attached);
  return canvas;
}

describe('building artwork and construction stages', () => {
  it.each([
    [1, [64, 416, 16, 16]],
    [2, [64, 432, 16, 16]],
    [3, [80, 432, 16, 16]],
    [4, [128, 464, 16, 16]],
  ] as const)('routes gameplay house level %s to its original Puny crop and the supplied team color', (level, rect) => {
    const house = { ...structure('house'), houseLevel: level, houseStyle: 'villa' as const, faction: 42 };
    const canvas = new RecordingCanvas();
    drawBuilding(canvas as unknown as CanvasRenderingContext2D, house, 64, 96, 64, 10, '#33aabb');
    expect(canvas.sources).toEqual([{ rect: [...rect], color: '#33aabb' }]);
    expect(canvas.images).toEqual([{ x: 64, y: 96, width: 64, height: 64 }]);
    expect(buildingSize(house)).toBe(1);
  });

  it('routes an unlevelled construction preview to the first house, independent of its temporary ID', () => {
    const house = { ...structure('house'), id: -987 };
    expect(render(house).sources).toEqual([{ rect: [64, 416, 16, 16], color: '#3988ff' }]);
  });

  it('uses the approved native narrow well for every game time', () => {
    const well = structure('well');
    for (const time of [0, .125, .75, 100])
      expect(render(well, time).sources).toEqual([{ rect: [80, 480, 16, 16], color: '#3988ff' }]);
  });

  it('places an attached well at the approved front-left offset without shrinking its pixels', () => {
    const canvas = new RecordingCanvas();
    drawBuilding(canvas as unknown as CanvasRenderingContext2D, structure('well'), 64, 96, 64, 10, '#e45454', undefined, undefined, true);
    expect(canvas.sources).toEqual([{ rect: [80, 480, 16, 16], color: '#e45454' }]);
    expect(canvas.images).toEqual([{ x: 40, y: 108, width: 64, height: 64 }]);
    expect(buildingSize(structure('well'))).toBe(1);
  });

  it('marks attached well construction with the same offset pegs throughout work', () => {
    const well = { ...structure('well'), construction: { startedAt: 0, duration: 20, waitingForBuilder: true } };
    const draw = () => {
      const canvas = new RecordingCanvas();
      drawBuilding(canvas as unknown as CanvasRenderingContext2D, well, 64, 96, 64, 10, '#3988ff', undefined, undefined, true);
      return canvas;
    };
    const reserved = draw();
    expect(reserved.sources).toEqual(Array.from({ length: 4 }, () => ({ rect: [352, 424, 3, 8] })));
    expect(reserved.fills).toHaveLength(0);
    well.construction.waitingForBuilder = false;
    const active = draw();
    expect(active.sources).toEqual(reserved.sources);
    expect(active.images).toEqual(reserved.images);
    expect(active.fills).toHaveLength(0);
  });

  it.each([
    ['woodenTower', [[112, 432, 16, 16]]],
    ['palace', [[192, 416, 16, 32], [208, 416, 16, 32]]],
  ] as const)('routes the %s team surfaces through the original atlas', (kind, rectangles) => {
    const building = { ...structure(kind), ...(kind === 'palace' ? { palaceLevel: 2 as const } : {}) };
    expect(render(building).sources.filter(source => source.color)).toEqual(
      rectangles.map(rect => ({ rect: [...rect], color: '#3988ff' })),
    );
  });

  it.each(['house', 'well'] as const)('draws %s at integer native scale without changing its collision cell', kind => {
    const building = structure(kind), canvas = render(building), art = canvas.images[0];
    expect(art.width).toBe(64); expect(art.height).toBe(64);
    expect(art.x).toBe(64); expect(art.y).toBe(96);
    expect(art.x + art.width / 2).toBeCloseTo(96);
    expect(art.y + art.height / 2).toBeCloseTo(128);
    const state = { world: { width: 4, height: 4 }, buildings: [building] } as unknown as GameState;
    expect([...buildingBlockers(state, 0)]).toEqual([5]);
  });

  it.each(['camp', 'shack', 'cottage'] as const)('draws no solid building over the four plots of a completed %s farm', kind => {
    const building = structure(kind), canvas = render(building);
    expect(canvas.images).toHaveLength(0);
    expect(canvas.fills).toHaveLength(0);
    const state = { world: { width: 4, height: 4 }, buildings: [building] } as unknown as GameState;
    expect([...buildingBlockers(state, 0)]).toEqual([]);
  });

  it.each(['tower', 'woodenTower'] as const)('raises the %s above the rear tile while preserving its centered, one-cell footing', kind => {
    const building = structure(kind), canvas = render(building);
    const left = Math.min(...canvas.images.map(image => image.x));
    const right = Math.max(...canvas.images.map(image => image.x + image.width));
    const top = Math.min(...canvas.images.map(image => image.y));
    const bottom = Math.max(...canvas.images.map(image => image.y + image.height));
    expect(right - left).toBe(64);
    expect((left + right) / 2).toBeCloseTo(96);
    expect(top).toBeCloseTo(96 + buildingArtTop(building) * 64);
    expect(bottom).toBe(96 + 64);
    expect((bottom - top) / 64).toBe(1.75);
    const state = { world: { width: 4, height: 4 }, buildings: [building] } as unknown as GameState;
    expect([...buildingBlockers(state, 0)]).toEqual([5]);
    building.construction = { startedAt: 0, duration: 25 };
    expect(buildingArtTop(building)).toBe(0);
    expect(Math.min(...render(building).images.map(image => image.y))).toBeGreaterThanOrEqual(96);
  });

  it('crops mounted wooden supports to short stubs while preserving the roof and standalone legs', () => {
    const tower = structure('woodenTower'), standalone = render(tower), mounted = render(tower, 10, true);
    expect(standalone.sources.slice(0, 2)).toEqual(Array.from({ length: 2 }, () => ({ rect: [352, 432, 4, 16] })));
    expect(mounted.sources.slice(0, 2)).toEqual(Array.from({ length: 2 }, () => ({ rect: [352, 432, 4, 5] })));
    expect(mounted.images.slice(0, 2)).toEqual([
      { x: 72, y: 96, width: 16, height: 20 }, { x: 104, y: 96, width: 16, height: 20 },
    ]);
    expect(standalone.images.slice(0, 2).every(image => image.height === 64)).toBe(true);
    expect(mounted.images.at(-1)).toEqual(standalone.images.at(-1));
    expect(mounted.sources.at(-1)).toEqual(standalone.sources.at(-1));
    tower.construction = { startedAt: 0, duration: 15, waitingForBuilder: true };
    expect(render(tower, 10, true).images).toEqual(render(tower).images);
  });

  it('separates mounted tower atlas art from full supports without enlarging its bounds', () => {
    const tower = structure('woodenTower'), art = new NativeArt();
    const paint = vi.spyOn(art, 'paint').mockImplementation((_key, bounds) => ({ ...bounds, texture: null! }));
    const standalone = art.building(tower, 0, '#3988ff'), mounted = art.building(tower, 0, '#3988ff', undefined, undefined, true);
    expect(mounted).toEqual(standalone);
    expect(mounted).toMatchObject({ x: 0, y: -24, width: 32, height: 56 });
    expect(buildingKey(tower, 0, '#3988ff')).not.toBe(buildingKey(tower, 0, '#3988ff', undefined, undefined, true));
    expect(paint.mock.calls[0][0]).not.toBe(paint.mock.calls[1][0]);
  });

  it('uses the complete native barred gate and retains the cell footprint', () => {
    const canvas = new RecordingCanvas(), palisade = structure('wall');
    const links = { north: false, east: true, south: false, west: true };
    const gate = { north: true, east: false, south: true, west: false };
    drawBuilding(canvas as unknown as CanvasRenderingContext2D, palisade, 64, 96, 64, 10, '#3988ff', links, gate);
    expect(Math.min(...canvas.images.map(image => image.x))).toBe(64);
    expect(Math.max(...canvas.images.map(image => image.x + image.width))).toBe(128);
    expect(canvas.sources).toEqual([{ rect: [320, 464, 16, 16] }]);
    expect(canvas.clips).toEqual([]);
  });

  it('fits the native stone Keep into its existing two-tile collision footprint', () => {
    const palace = { ...structure('palace'), palaceLevel: 2 as const }, canvas = render(palace);
    expect(canvas.images.length).toBeGreaterThan(0);
    expect(Math.min(...canvas.images.map(image => image.x))).toBe(64);
    expect(Math.min(...canvas.images.map(image => image.y))).toBe(96);
    expect(Math.max(...canvas.images.map(image => image.x + image.width))).toBe(192);
    expect(Math.max(...canvas.images.map(image => image.y + image.height))).toBe(224);
    const state = { world: { width: 4, height: 4 }, buildings: [palace] } as unknown as GameState;
    expect([...buildingBlockers(state, 0)]).toEqual([5, 6, 9, 10]);
  });

  it('keeps only the reservation pegs after the builder arrives and throughout progress', () => {
    const house = structure('house');
    house.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    const reserved = render(house);
    expect(reserved.images).toHaveLength(4); expect(reserved.fills).toHaveLength(0);
    house.construction.waitingForBuilder = false;
    const active = render(house);
    expect(active.images).toEqual(reserved.images);
    expect(active.fills).toHaveLength(0);
    expect(render(house, 19.9).images).toEqual(reserved.images);
  });

  it('keeps interrupted construction marked with the same static pegs', () => {
    const house = structure('house');
    house.construction = { startedAt: 5, duration: 20, waitingForBuilder: true, pausedAt: 10 };
    expect(render(house, 20).fills).toEqual(render(house, 100).fills);
    expect(render(house, 20).images).toHaveLength(4);
    expect(render(house, 20).fills).toHaveLength(0);
  });

  it.each(['camp', 'shack', 'cottage'] as const)('keeps %s construction as static perimeter posts around the single plot', kind => {
    const farm = structure(kind);
    farm.construction = { startedAt: 0, duration: 15, waitingForBuilder: true };
    const outline = render(farm);
    expect(outline.images).toHaveLength(4);
    expect(outline.fills).toHaveLength(0);
    // Posts remain inside the one-cell footprint and leave its center clear.
    expect(buildingSize(farm)).toBe(1);
    expect(Math.min(...outline.images.map(image => image.x))).toBe(70);
    expect(Math.max(...outline.images.map(image => image.x + image.width))).toBe(122);
    expect(Math.min(...outline.images.map(image => image.y))).toBe(100);
    expect(Math.max(...outline.images.map(image => image.y + image.height))).toBe(156);
    for (const x of [96]) for (const y of [128])
      expect(outline.images.some(image => x >= image.x && x < image.x + image.width
        && y >= image.y && y < image.y + image.height)).toBe(false);
    farm.construction.waitingForBuilder = false;
    for (const time of [0, 7.5, 14.9]) {
      expect(render(farm, time).images).toEqual(outline.images);
      expect(render(farm, time).fills).toHaveLength(0);
    }
    farm.construction.pausedAt = 8;
    expect(render(farm, 30).images).toEqual(outline.images);
    delete farm.construction;
    expect(render(farm).images).toHaveLength(0);
  });

  it.each(['wall', 'palisade'] as const)('builds %s sections in four seconds with static posts until completion', kind => {
    const building = structure(kind);
    startConstruction(building, 10);
    expect(building.construction!.duration).toBe(4);
    const outline = render(building, 10);
    expect(outline.images).toHaveLength(4);
    expect(outline.fills).toHaveLength(0);
    expect(render(building, 13.9).images).toEqual(outline.images);
    expect(render(building, 13.9).fills).toHaveLength(0);
    building.construction!.waitingForBuilder = true;
    expect(render(building, 20).images).toEqual(outline.images);
    building.construction!.pausedAt = 12;
    expect(render(building, 30).images).toEqual(outline.images);
    delete building.construction;
    expect(render(building).images).not.toEqual(outline.images);
  });
});
