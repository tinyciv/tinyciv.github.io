import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildingKey } from '../src/game/native-art';
import { indexBuildings, towerSupportingWallKind } from '../src/game/renderer';
import type { Building } from '../src/game/types';
import provenance from '../public/assets/buildings/stone-wall-tower-source.json';
import palisadeProvenance from '../public/assets/buildings/palisade-tower-source.json';
import { punyAtlas } from './puny-atlas';

const building = (kind: Building['kind'], extra: Partial<Building> = {}): Building => ({
  id: 1, kind, x: 4, y: 6, faction: 0, hp: 600, maxHp: 600, capacity: 0, ...extra,
});

describe('wall-mounted watchtower artwork', () => {
  it.each([
    ['stone-wall-tower', provenance], ['palisade-tower', palisadeProvenance],
  ] as const)('preserves the approved %s sprite and bottom-center ground anchor', (name, metadata) => {
    const url = new URL(`../public/assets/buildings/${name}.png`, import.meta.url);
    const pixels = punyAtlas(url);
    expect(createHash('sha256').update(readFileSync(url)).digest('hex')).toBe(metadata.sha256);
    expect([pixels.width, pixels.height]).toEqual([16, 28]);
    expect(metadata.nativeSize).toEqual([16, 28]);
    expect(metadata.groundAnchor).toEqual([8, 28]);
    expect(new Set(Array.from(pixels.data).filter((_, i) => i % 4 === 3))).toEqual(new Set([0, 255]));
  });

  it('keeps the palisade tower side outline one native pixel wide', () => {
    const pixels = punyAtlas(new URL('../public/assets/buildings/palisade-tower.png', import.meta.url));
    const pixel = (x: number, y: number) => Array.from(pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4));
    const outline = [46, 32, 54, 255];
    expect(palisadeProvenance.outlineNativePixels).toBe(1);
    expect(palisadeProvenance.outlineColor).toBe('#2e2036');
    for (let y = 0; y < 28; y++) {
      const opaque = Array.from({ length: 16 }, (_, x) => x).filter(x => pixel(x, y)[3] === 255);
      expect(pixel(opaque[0], y), `left outline at row ${y}`).toEqual(outline);
      expect(pixel(opaque.at(-1)!, y), `right outline at row ${y}`).toEqual(outline);
    }
    for (let y = 16; y < 27; y++) for (const x of [2, 13])
      expect(pixel(x, y), `outline remains one pixel wide at ${x},${y}`).not.toEqual(outline);
  });

  it('keeps the corrected lookout deck divided into horizontal boards', () => {
    const pixels = punyAtlas(new URL('../public/assets/buildings/palisade-tower.png', import.meta.url));
    const pixel = (x: number, y: number) => Array.from(pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4)).join(',');
    expect(palisadeProvenance.deckRect).toEqual([3, 5, 10, 7]);
    expect(palisadeProvenance.deckSeamRows).toEqual([7, 9]);
    for (const y of palisadeProvenance.deckSeamRows) {
      const seam = pixel(3, y);
      expect(seam.endsWith(',255')).toBe(true);
      expect(new Set(Array.from({ length: 10 }, (_, x) => pixel(x + 3, y))).size).toBe(1);
      for (const adjacent of [y - 1, y + 1])
        expect(Array.from({ length: 10 }, (_, x) => pixel(x + 3, adjacent)).some(color => color !== seam)).toBe(true);
    }
  });

  it.each(['wall', 'palisade'] as const)('selects the completed %s in either build order', kind => {
    const tower = building('woodenTower'), wall = building(kind, { id: 2 });
    for (const pair of [[tower, wall], [wall, tower]])
      expect(towerSupportingWallKind(tower, indexBuildings(pair))).toBe(kind);
  });

  it.each([
    { construction: { startedAt: 0, duration: 10, waitingForBuilder: true } },
    { construction: { startedAt: 0, duration: 10, waitingForBuilder: false } },
    { hp: 0 }, { faction: 1 }, { x: 5 }, { y: 5 },
  ])('does not switch for an unfinished, dead, foreign, or adjacent wall (%j)', extra => {
    const tower = building('woodenTower');
    for (const kind of ['wall', 'palisade'] as const) {
      const wall = building(kind, { id: 2, ...extra });
      expect(towerSupportingWallKind(tower, indexBuildings([tower, wall]))).toBeUndefined();
    }
  });

  it('switches the same tower as the stone upgrade finishes or its supporting walls are lost', () => {
    const tower = building('woodenTower'), palisade = building('palisade', { id: 2 });
    const wall = building('wall', { id: 3, construction: { startedAt: 0, duration: 10 } });
    for (const pair of [[palisade, wall], [wall, palisade]])
      expect(towerSupportingWallKind(tower, indexBuildings([tower, ...pair]))).toBe('palisade');
    delete wall.construction;
    for (const pair of [[palisade, wall], [wall, palisade]])
      expect(towerSupportingWallKind(tower, indexBuildings([tower, ...pair]))).toBe('wall');
    wall.hp = 0;
    expect(towerSupportingWallKind(tower, indexBuildings([tower, wall, palisade]))).toBe('palisade');
    palisade.hp = 0;
    expect(towerSupportingWallKind(tower, indexBuildings([tower, wall, palisade]))).toBeUndefined();
  });

  it('applies only to living defensive towers', () => {
    const wall = building('wall', { id: 2 });
    for (const occupant of [building('woodenTower', { hp: 0 }), building('house'), building('tower')])
      expect(towerSupportingWallKind(occupant, indexBuildings([occupant, wall]))).toBeUndefined();
  });

  it('keeps independent cache entries when the same tower changes between stone, timber, and no wall', () => {
    const tower = building('woodenTower');
    const standalone = buildingKey(tower, 0, '#ee3434');
    const palisade = buildingKey(tower, 0, '#ee3434', undefined, undefined, true, 'palisade');
    const stone = buildingKey(tower, 0, '#ee3434', undefined, undefined, true, 'wall');
    expect(new Set([standalone, palisade, stone]).size).toBe(3);
    expect(buildingKey(tower, 50, '#ee3434', undefined, undefined, true, 'wall')).toBe(stone);
  });
});
