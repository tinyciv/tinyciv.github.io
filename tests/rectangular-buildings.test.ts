import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildingsInArea } from '../src/game/area-tools';
import { buildingWithinBorders } from '../src/game/border-placement';
import { type Territory, UNCLAIMED } from '../src/game/borders';
import { constructionEdges } from '../src/game/builders';
import { clearBuildingFootprint } from '../src/game/construction-clearance';
import { removeCoveredRoads } from '../src/game/covered-roads';
import { synchronizeFarms } from '../src/game/farms';
import { buildingAtPoint } from '../src/game/hit-testing';
import { canWalk } from '../src/game/pathfinding';
import { ridgeFootprintAllowed } from '../src/game/ridges';
import { rasterBuildingGround } from '../src/game/building-ground';
import type { Building, GameState } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 20, height: 16, seed: 'rectangle', source: 'test', spawns: [], tiles: Array.from({ length: 320 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .7, food: 2, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'archeryRange', faction: 0, x: 8, y: 7, hp: 400, maxHp: 400, capacity: 0 }],
    units: [{ id: 500, kind: 'leader', faction: 0, x: 8.5, y: 8.5, hp: 100, morale: 100, attack: 20, defense: 5, speed: 3,
      range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#d85842', affinity: 100, relation: 'self', gold: 1000, food: 100,
      population: 4, production: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'rectangle', rngState: 1,
  };
}

const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({ id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });

describe('two by one archery ranges', () => {
  it('blocks two cells, provides six construction approaches, and leaves the southern row untouched', () => {
    const state = fixture(), range = state.buildings[0], leader = state.units[0];
    expect(canWalk(state, 8.5, 7.5, 0)).toBe(false);
    expect(canWalk(state, 9.5, 7.5, 0)).toBe(false);
    expect(canWalk(state, 8.5, 8.5, 0)).toBe(true);
    expect(constructionEdges(state, range)).toEqual(expect.arrayContaining([
      { x: 7.5, y: 7.5 }, { x: 10.5, y: 7.5 }, { x: 8.5, y: 6.5 }, { x: 9.5, y: 6.5 },
      { x: 8.5, y: 8.5 }, { x: 9.5, y: 8.5 },
    ]));
    expect(constructionEdges(state, range)).toHaveLength(6);
    expect(clearBuildingFootprint(state, range)).toBe(true);
    expect(leader).toMatchObject({ x: 8.5, y: 8.5 });
  });

  it('selects and demolishes through either occupied cell but not the row below', () => {
    const state = fixture(), range = state.buildings[0];
    expect(buildingAtPoint(state, { x: 9.8, y: 7.9 })).toBe(range);
    expect(buildingAtPoint(state, { x: 9.8, y: 8.1 })).toBeUndefined();
    expect(buildingsInArea(state, { x: 9, y: 7 }, { x: 9, y: 7 })).toEqual([range]);
    expect(buildingsInArea(state, { x: 8, y: 8 }, { x: 9, y: 8 })).toEqual([]);
  });

  it('removes only the two road underlays and leaves adjacent farm plots intact', () => {
    const state = fixture(), range = state.buildings[0];
    const covered = [building(2, 'road', 8, 7), building(3, 'road', 9, 7)];
    const below = [building(4, 'road', 8, 8), building(5, 'road', 9, 8)];
    const farm = building(6, 'camp', 8, 9);
    entityStore(state).buildings.add(...covered, ...below, farm);
    synchronizeFarms(state);
    expect(state.fields!.filter(field => field.camp === farm.id)).toHaveLength(1);
    removeCoveredRoads(state, range);
    expect(state.buildings).not.toEqual(expect.arrayContaining(covered));
    expect(state.buildings).toEqual(expect.arrayContaining(below));
    expect(state.fields!.filter(field => field.camp === farm.id)).toHaveLength(1);
  });

  it('fits a one-row owned strip at the southern world edge', () => {
    const state = fixture(), owners = new Int32Array(320).fill(UNCLAIMED);
    owners[15 * 20 + 8] = 0; owners[15 * 20 + 9] = 0;
    const territory: Territory = { width: 20, height: 16, owners,
      sourceIds: new Int32Array(320).fill(UNCLAIMED), alternateOwners: new Int32Array(320).fill(UNCLAIMED),
      alternateSourceIds: new Int32Array(320).fill(UNCLAIMED), sourceRadii: new Map(),
      edges: [], paths: [], revision: 0 };
    expect(buildingWithinBorders(state, 'archeryRange', 8, 15, 0, territory)).toBe(true);
    owners[15 * 20 + 9] = 1;
    expect(buildingWithinBorders(state, 'archeryRange', 8, 15, 0, territory)).toBe(false);
    expect(buildingWithinBorders(state, 'archeryRange', 19, 15, 0, territory)).toBe(false);
  });

  it('checks only actual ridge cells and keeps the rectangular clearing rectangular', () => {
    const state = fixture();
    state.world.tiles[8 * 20 + 8].ridge = 1;
    expect(ridgeFootprintAllowed(state.world, 8, 7, 2, 1)).toBe(true);
    expect(ridgeFootprintAllowed(state.world, 8, 7, 2, 2)).toBe(false);
    const pixels = new Uint8ClampedArray(64 * 64 * 4).fill(255);
    const raster = rasterBuildingGround(2, 0, { width: 64, height: 64, data: pixels }, 1);
    expect(raster.width).toBe(92); expect(raster.height).toBe(60);
    expect(raster.pixels).toHaveLength(92 * 60 * 4);
  });
});
