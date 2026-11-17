import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildingSize, type Building, type GameState } from '../src/game/types';
import { buildingBlockers } from '../src/game/pathfinding';
import { startConstruction } from '../src/game/structures';
import { loadPalisadeTowerArt } from '../src/game/palisade-tower-art';
import { loadStoneWallTowerArt } from '../src/game/stone-wall-tower-art';
import { loadConstructionArt } from '../src/game/construction-art';
import type { TowerWallKind } from '../src/game/wall-towers';

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
  spriteSources: string[] = [];
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
  drawImage(image: { src: string }, x: number, y: number, width: number, height: number) {
    this.images.push(this.rectangle(x, y, width, height));
    this.spriteSources.push(image.src);
  }
  fillRect(x: number, y: number, width: number, height: number) { this.fills.push(this.rectangle(x, y, width, height)); }
  beginPath() { this.paths.push([]); }
  rect(x: number, y: number, width: number, height: number) { this.paths.at(-1)!.push(this.rectangle(x, y, width, height)); }
  clip(rule = 'nonzero') { this.clips.push(rule); }
}
const structure = (kind: Building['kind']): Building => ({ id: 1, kind, faction: 0, x: 1, y: 1, hp: 100, maxHp: 100, capacity: 0 });
function render(building: Building, time = 10, attached = false, towerWall?: TowerWallKind): RecordingCanvas {
  const canvas = new RecordingCanvas();
  drawBuilding(canvas as unknown as CanvasRenderingContext2D, building, 64, 96, 64, time, '#3988ff', undefined, undefined, attached, towerWall);
  return canvas;
}

describe('building artwork and construction stages', () => {
  beforeAll(async () => {
    vi.stubGlobal('Image', class {
      src = '';
      get naturalWidth() { return this.src.endsWith('construction/2x2.png') ? 32 : 16; }
      get naturalHeight() { return this.src.includes('assets/construction/') ? this.naturalWidth : 28; }
      async decode() {}
    });
    await Promise.all([loadPalisadeTowerArt(), loadStoneWallTowerArt(), loadConstructionArt()]);
  });
  afterAll(() => vi.unstubAllGlobals());

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

  it('marks attached well construction with the same offset site throughout work', () => {
    const well = { ...structure('well'), construction: { startedAt: 0, duration: 20, waitingForBuilder: true } };
    const draw = () => {
      const canvas = new RecordingCanvas();
      drawBuilding(canvas as unknown as CanvasRenderingContext2D, well, 64, 96, 64, 10, '#3988ff', undefined, undefined, true);
      return canvas;
    };
    const reserved = draw();
    expect(reserved.sources).toEqual([]);
    expect(reserved.spriteSources).toEqual([`${import.meta.env.BASE_URL}assets/construction/1x1.png`]);
    expect(reserved.images).toEqual([{ x: 40, y: 108, width: 64, height: 64 }]);
    expect(reserved.fills).toHaveLength(0);
    well.construction.waitingForBuilder = false;
    const active = draw();
    expect(active.spriteSources).toEqual(reserved.spriteSources);
    expect(active.images).toEqual(reserved.images);
    expect(active.fills).toHaveLength(0);
  });

  it('routes the palace team surfaces through the original atlas', () => {
    const building = { ...structure('palace'), palaceLevel: 2 as const };
    expect(render(building).sources.filter(source => source.color)).toEqual(
      [[192, 416, 16, 32], [208, 416, 16, 32]].map(rect => ({ rect, color: '#3988ff' })),
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

  it.each([
    [undefined, 'palisade-tower.png'],
    ['palisade', 'palisade-tower.png'],
    ['wall', 'stone-wall-tower.png'],
  ] as const)('uses the approved %s-supported watchtower sprite at the original ground anchor', (support, filename) => {
    const tower = structure('woodenTower'), canvas = render(tower, 10, support !== undefined, support);
    expect(canvas.spriteSources).toEqual([`${import.meta.env.BASE_URL}assets/buildings/${filename}`]);
    expect(canvas.sources).toEqual([]);
    expect(canvas.images).toEqual([{ x: 64, y: 48, width: 64, height: 112 }]);
    tower.construction = { startedAt: 0, duration: 15, waitingForBuilder: true };
    expect(render(tower, 10, support !== undefined, support).images).toEqual(render(tower).images);
  });

  it('keeps the same tower bounds when attaching to a wall', () => {
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

  it('keeps the approved construction site after the builder arrives and throughout progress', () => {
    const house = structure('house');
    house.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    const reserved = render(house);
    expect(reserved.spriteSources).toEqual([`${import.meta.env.BASE_URL}assets/construction/1x1.png`]);
    expect(reserved.images).toEqual([{ x: 64, y: 96, width: 64, height: 64 }]);
    expect(reserved.fills).toHaveLength(0);
    house.construction.waitingForBuilder = false;
    const active = render(house);
    expect(active.images).toEqual(reserved.images);
    expect(active.fills).toHaveLength(0);
    expect(render(house, 19.9).images).toEqual(reserved.images);
  });

  it('keeps interrupted construction marked with the same static site', () => {
    const house = structure('house');
    house.construction = { startedAt: 5, duration: 20, waitingForBuilder: true, pausedAt: 10 };
    expect(render(house, 20).fills).toEqual(render(house, 100).fills);
    expect(render(house, 20).images).toHaveLength(1);
    expect(render(house, 20).fills).toHaveLength(0);
  });

  it.each(['camp', 'shack', 'cottage'] as const)('keeps %s construction as the approved site within the single plot', kind => {
    const farm = structure(kind);
    farm.construction = { startedAt: 0, duration: 15, waitingForBuilder: true };
    const outline = render(farm);
    expect(outline.images).toHaveLength(1);
    expect(outline.spriteSources).toEqual([`${import.meta.env.BASE_URL}assets/construction/1x1.png`]);
    expect(outline.fills).toHaveLength(0);
    // The selected site retains the one-cell footprint and native pixel scale.
    expect(buildingSize(farm)).toBe(1);
    expect(outline.images).toEqual([{ x: 64, y: 96, width: 64, height: 64 }]);
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

  it.each(['wall', 'palisade'] as const)('builds %s sections in four seconds with the static site until completion', kind => {
    const building = structure(kind);
    startConstruction(building, 10);
    expect(building.construction!.duration).toBe(4);
    const outline = render(building, 10);
    expect(outline.images).toHaveLength(1);
    expect(outline.spriteSources).toEqual([`${import.meta.env.BASE_URL}assets/construction/1x1.png`]);
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
