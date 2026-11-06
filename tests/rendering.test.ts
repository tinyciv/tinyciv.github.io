import { describe, expect, it } from 'vitest';
import { buildingConnections, buildingRenderDepth, gateConnections, indexBuildings, towerAttachedToWall, towerMountedOnWall, wellAttachedToHouse } from '../src/game/renderer';
import type { Building, BuildingKind, Tile, World } from '../src/game/types';

const building = (kind: BuildingKind, x: number, y: number): Building => ({ id: y * 8 + x, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
const world = (): World => ({ width: 5, height: 5, seed: 'rendering', source: 'test', spawns: [], tiles: Array.from({ length: 25 }, (): Tile => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 1, production: 1, gold: 0, variation: .2 })) });

describe('connected map features', () => {
  it('joins bank roads to cardinal ford crossings without extending into ordinary water', () => {
    const w = world(), road = building('road', 2, 2), index = indexBuildings([road]);
    for (const [x, y] of [[2, 1], [3, 2], [2, 3], [1, 2]]) Object.assign(w.tiles[y * w.width + x], { terrain: 'river', overlay: 'ford' });
    expect(buildingConnections(road, index, w)).toEqual({ north: true, east: true, south: true, west: true });
    w.tiles[1 * w.width + 2].overlay = 'none';
    w.tiles[2 * w.width + 3].terrain = 'grassland';
    expect(buildingConnections(road, index, w)).toEqual({ north: false, east: false, south: true, west: true });
  });

  it.each([false, true])('keeps wall joins and draws its tower in front in either build order (wall first: %s)', wallFirst => {
    const wall = building('wall', 2, 2), tower = building('woodenTower', 2, 2);
    const west = building('wall', 1, 2), east = building('wall', 3, 2);
    const pair = wallFirst ? [wall, tower] : [tower, wall];
    const index = indexBuildings([...pair, west, east]);
    expect(index.get('2,2')).toHaveLength(2);
    expect(towerAttachedToWall(tower, index)).toBe(true);
    expect([...pair].sort((a, b) => buildingRenderDepth(a, index) - buildingRenderDepth(b, index))).toEqual([wall, tower]);
    expect(buildingConnections(wall, index)).toEqual({ north: false, east: true, south: false, west: true });
    expect(buildingConnections(west, index).east).toBe(true);
    expect(buildingConnections(east, index).west).toBe(true);
    wall.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
    expect(buildingRenderDepth(tower, index)).toBeGreaterThan(buildingRenderDepth(wall, index));
  });

  it.each(['wall', 'palisade'] as const)('shortens tower legs only while a completed friendly %s supports it', kind => {
    const tower = building('woodenTower', 2, 2), wall = building(kind, 2, 2), index = indexBuildings([tower, wall]);
    expect(towerMountedOnWall(tower, index)).toBe(true);
    wall.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
    expect(towerMountedOnWall(tower, index)).toBe(false);
    delete wall.construction; wall.hp = 0;
    expect(towerMountedOnWall(tower, index)).toBe(false);
    wall.hp = 100; wall.faction = 1;
    expect(towerMountedOnWall(tower, index)).toBe(false);
    wall.faction = 0; wall.x = 3;
    expect(towerMountedOnWall(tower, index)).toBe(false);
    expect(towerMountedOnWall(tower, indexBuildings([tower]))).toBe(false);
  });

  it('retains the old palisade support while a stone replacement is queued in either index order', () => {
    const tower = building('woodenTower', 2, 2), palisade = building('palisade', 2, 2), wall = building('wall', 2, 2);
    wall.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
    for (const pair of [[palisade, wall], [wall, palisade]]) expect(towerMountedOnWall(tower, indexBuildings([tower, ...pair]))).toBe(true);
  });

  it.each([false, true])('indexes both house/well layers and draws the well in front regardless of creation order (house first: %s)', houseFirst => {
    const house = building('house', 2, 2), well = building('well', 2, 2);
    const order = houseFirst ? [house, well] : [well, house], index = indexBuildings(order);
    expect(index.get('2,2')).toHaveLength(2);
    expect(wellAttachedToHouse(well, index)).toBe(true);
    expect([...order].sort((a, b) => buildingRenderDepth(a, index) - buildingRenderDepth(b, index))).toEqual([house, well]);
    expect(buildingRenderDepth(well, index)).toBe(3 + 3 / 16);
    house.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    expect(wellAttachedToHouse(well, index)).toBe(true);
    expect(buildingRenderDepth(well, index)).toBeGreaterThan(buildingRenderDepth(house, index));
  });

  it('keeps a standalone well centered until a live same-owner house or valid house ghost shares its tile', () => {
    const well = building('well', 2, 2), house = building('house', 2, 2);
    expect(wellAttachedToHouse(well, indexBuildings([well]))).toBe(false);
    house.faction = 1;
    expect(wellAttachedToHouse(well, indexBuildings([house, well]))).toBe(false);
    house.faction = 0; house.hp = 0;
    expect(wellAttachedToHouse(well, indexBuildings([house, well]))).toBe(false);
    house.hp = 100; house.id = -1;
    expect(wellAttachedToHouse(well, indexBuildings([house, well]))).toBe(true);
    expect(wellAttachedToHouse(house, indexBuildings([house, well]))).toBe(false);
  });

  it('connects roads and bridges without drawing inward arms to the palace', () => {
    const center = building('road', 2, 3);
    const index = indexBuildings([center, building('palace', 1, 1), building('road', 1, 3), building('bridge', 3, 3), building('road', 2, 4)]);
    expect(buildingConnections(center, index)).toEqual({ north: false, east: true, south: true, west: true });
    expect(buildingConnections(index.get('3,3')![0], index).west).toBe(true);
  });

  it('indexes the complete palace footprint for scene and adjacency queries', () => {
    const palace = building('palace', 1, 1), index = indexBuildings([palace]);
    expect([...index.keys()].sort()).toEqual(['1,1', '1,2', '2,1', '2,2']);
    expect(index.get('2,2')).toEqual([palace]);
  });

  it('joins wall corners and T-junctions without joining roads or diagonal walls', () => {
    const center = building('wall', 2, 2);
    const index = indexBuildings([center, building('wall', 2, 1), building('wall', 3, 2), building('wall', 2, 3), building('road', 1, 2), building('wall', 1, 1)]);
    expect(buildingConnections(center, index)).toEqual({ north: true, east: true, south: true, west: false });
    expect(buildingConnections(index.get('2,3')![0], index)).toEqual({ north: true, east: false, south: false, west: false });
  });

  it('joins same-owner legacy aliases and walls in both directions', () => {
    const center = building('palisade', 2, 2), stone = building('wall', 3, 2);
    const index = indexBuildings([center, stone, building('palisade', 2, 1), building('road', 1, 2)]);
    expect(buildingConnections(center, index)).toEqual({ north: true, east: true, south: false, west: false });
    expect(buildingConnections(stone, index).west).toBe(true);
  });

  it('joins only completed, living sections of the same owner, including ready preview ghosts', () => {
    const center = building('wall', 2, 2), north = building('wall', 2, 1), east = building('wall', 3, 2);
    const south = building('wall', 2, 3), west = building('wall', 1, 2);
    north.faction = 1;
    east.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
    south.hp = 0;
    west.id = -1; // Placement previews are ready, same-owner sections.
    const index = indexBuildings([center, north, east, south, west]);
    expect(buildingConnections(center, index)).toEqual({ north: false, east: false, south: false, west: true });
    expect(buildingConnections(west, index).east).toBe(true);
    north.faction = 0; delete east.construction; south.hp = 225;
    expect(buildingConnections(center, indexBuildings([center, north, east, south, west])))
      .toEqual({ north: true, east: true, south: true, west: true });
    west.faction = -2;
    expect(buildingConnections(center, indexBuildings([center, west])).west).toBe(false);
  });

  it('does not use enemy or unfinished walls to choose an isolated gate direction', () => {
    const gate = building('wall', 2, 2), road = building('road', 2, 2);
    const west = building('wall', 1, 2), east = building('wall', 3, 2);
    west.faction = 1; east.construction = { startedAt: 0, duration: 4 };
    const alone = gateConnections(gate, indexBuildings([gate, road]));
    expect(gateConnections(gate, indexBuildings([gate, road, west, east]))).toEqual(alone);
  });

  it.each(['wall', 'palisade'] as const)('opens a %s gate through a wall boundary containing a legacy alias', kind => {
    const gate = building(kind, 2, 2), road = building('road', 2, 2);
    const index = indexBuildings([gate, road, building('wall', 1, 2), building('palisade', 3, 2)]);
    expect(gateConnections(gate, index)).toEqual({ north: true, east: false, south: true, west: false });
    gate.construction = { startedAt: 0, duration: 4 };
    expect(gateConnections(gate, index)).toBeUndefined();
  });

  it.each([false, true])('keeps road and wall joins at gates in either placement order (wall first: %s)', wallFirst => {
    const road = building('road', 2, 2), wall = building('wall', 2, 2);
    const north = building('road', 2, 1), east = building('wall', 3, 2);
    const index = indexBuildings([...(wallFirst ? [wall, road] : [road, wall]), north, east, building('road', 2, 3), building('wall', 1, 2)]);
    expect(index.get('2,2')).toHaveLength(2);
    expect(buildingConnections(road, index)).toEqual({ north: true, east: false, south: true, west: false });
    expect(buildingConnections(wall, index)).toEqual({ north: false, east: true, south: false, west: true });
    expect(buildingConnections(north, index).south).toBe(true);
    expect(buildingConnections(east, index).west).toBe(true);
    expect(gateConnections(wall, index)).toEqual({ north: true, east: false, south: true, west: false });
  });

  it('opens gates across either wall direction before a road approach is built', () => {
    const gate = building('wall', 2, 2), road = building('road', 2, 2);
    expect(gateConnections(gate, indexBuildings([gate, road, building('wall', 2, 1), building('wall', 2, 3)])))
      .toEqual({ north: false, east: true, south: false, west: true });
    expect(gateConnections(gate, indexBuildings([gate, road, building('wall', 1, 2), building('wall', 3, 2)])))
      .toEqual({ north: true, east: false, south: true, west: false });
  });

  it('follows road bends and opens both sides of a road ending at a gate', () => {
    const gate = building('wall', 2, 2), road = building('road', 2, 2);
    expect(gateConnections(gate, indexBuildings([gate, road, building('road', 3, 2)])))
      .toEqual({ north: false, east: true, south: false, west: true });
    expect(gateConnections(gate, indexBuildings([gate, road, building('road', 3, 2), building('road', 2, 1)])))
      .toEqual({ north: true, east: true, south: false, west: false });
  });

  it('keeps a plain wall solid when its underlying road is absent or destroyed', () => {
    const wall = building('wall', 2, 2), road = { ...building('road', 2, 2), hp: 0 };
    expect(gateConnections(wall, indexBuildings([wall]))).toBeUndefined();
    expect(gateConnections(wall, indexBuildings([wall, road]))).toBeUndefined();
  });

  it('shows a completed wall gate over a pending road but keeps the working wall as a site', () => {
    const wall = building('wall', 2, 2), road = building('road', 2, 2);
    const index = indexBuildings([wall, road]);
    road.construction = { startedAt: 0, duration: 2, waitingForBuilder: true };
    expect(gateConnections(wall, index)).toBeDefined();
    delete road.construction;
    wall.construction = { startedAt: 0, duration: 8 };
    expect(gateConnections(wall, index)).toBeUndefined();
    delete wall.construction;
    expect(gateConnections(wall, index)).toBeDefined();
  });

  it('orients an isolated bridge across its river and keeps the span once an approach is added', () => {
    const w = world(), bridge = building('bridge', 2, 2);
    for (let y = 0; y < 5; y++) w.tiles[y * 5 + 2].terrain = 'river';
    expect(buildingConnections(bridge, indexBuildings([bridge]), w)).toEqual({ north: false, east: true, south: false, west: true });
    expect(buildingConnections(bridge, indexBuildings([bridge, building('road', 1, 2)]), w)).toEqual({ north: false, east: true, south: false, west: true });
    w.tiles.forEach(t => { t.terrain = 'grassland'; });
    for (let x = 0; x < 5; x++) w.tiles[2 * 5 + x].terrain = 'river';
    expect(buildingConnections(bridge, indexBuildings([bridge]), w)).toEqual({ north: true, east: false, south: true, west: false });
  });


});
