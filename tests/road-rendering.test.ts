import { describe, expect, it } from 'vitest';
import { rasterDirtRoad, type RoadLinks } from '../src/game/road-sprites';
import { buildingConnections, indexBuildings } from '../src/game/renderer';
import { punyAtlas } from './puny-atlas';
import type { Building } from '../src/game/types';

const atlas = punyAtlas();
const road = (x: number, y: number): Building => ({ id: y * 10 + x, kind: 'road', x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
const empty: RoadLinks = { north: false, east: false, south: false, west: false };

describe('diagonal traffic roads', () => {
  it('joins a diagonal sequence without widening a cardinal elbow', () => {
    const roads = [road(1, 1), road(2, 2), road(3, 3)], index = indexBuildings(roads);
    expect(buildingConnections(roads[1], index)).toEqual({ ...empty, northwest: true, southeast: true });
    const elbow = [road(1, 1), road(2, 1), road(2, 2)];
    expect(buildingConnections(elbow[0], indexBuildings(elbow))).toEqual({ ...empty, east: true });
  });

  it('carries opaque native pathway pixels through both diagonal tile corners', () => {
    for (const links of [{ ...empty, northwest: true, southeast: true }, { ...empty, northeast: true, southwest: true }]) {
      const pixels = rasterDirtRoad(links, atlas);
      for (let i = 0; i < 32; i++) {
        const x = links.northwest ? i : 31 - i;
        expect(pixels[(i * 32 + x) * 4 + 3]).toBe(255);
      }
      // The diagonal shoulders still leave most of the tile uncovered.
      let covered = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) covered++;
      expect(covered).toBeLessThan(450);
    }
  });

  it('keeps the existing cardinal road cross-sections continuous', () => {
    for (const links of [{ ...empty, north: true, south: true }, { ...empty, east: true, west: true }]) {
      const pixels = rasterDirtRoad(links, atlas);
      for (let i = 0; i < 32; i++) {
        const x = links.north ? 16 : i, y = links.north ? i : 16;
        expect(pixels[(y * 32 + x) * 4 + 3]).toBe(255);
      }
    }
  });
});
