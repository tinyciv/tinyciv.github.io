import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { planStartingCityFarms, planStartingSettlement, startingFarmPalaceGap, type StartingSettlementLayout } from '../src/game/settlement-layout';
import { palaceReachability, palaceSpacingAllowed } from '../src/game/placement';
import { buildingSize, tileAt, WATER, type Building, type BuildingKind, type GameState, type Point, type World } from '../src/game/types';
import { generateWorld } from '../src/world/generator';
import { CAMP_FIELD_OFFSETS, expectedFarmDelivery, fieldHarvestFood, harvestFoodPerEconomyCycle } from '../src/game/farms';
import { farmWalkingDistance, palaceWalkingDistances } from '../src/game/farm-travel';
import { farmBlockGeometry } from './helpers/farm-block-geometry';

function stateFor(world: World): GameState {
  return { world, buildings: [], units: [], factions: [], fields: [], time: 0, tick: 0,
    paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: world.seed, rngState: 1 };
}

function grass(width = 40, height = 30): World {
  return { width, height, seed: 'starting-layout', source: 'test', spawns: [{ x: 15, y: 12 }],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none',
      elevation: .4, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
}

function place(state: GameState, layout: StartingSettlementLayout, faction: number): Building {
  function add(kind: BuildingKind, point: Point): Building {
    const building: Building = { ...point, id: state.buildings.length + 1, kind, faction, hp: 100, maxHp: 100, capacity: kind === 'house' ? 2 : 0 };
    entityStore(state).buildings.add(building); return building;
  }
  const palace = add('palace', layout.palace);
  for (const point of layout.roads) add('road', point);
  for (const point of layout.houses) add('house', point);
  for (const point of layout.farms) add('camp', point);
  return palace;
}

function assertLayout(state: GameState, layout: StartingSettlementLayout): void {
  expect(layout.roads).toHaveLength(12);
  expect(layout.houses).toHaveLength(4);
  expect(layout.farms.length).toBeGreaterThanOrEqual(4);
  for (const block of farmBlockGeometry(layout.farms)) {
    expect(block.size).toBeLessThanOrEqual(16);
    if (block.size > 6) expect(block.aspectRatio).toBeLessThanOrEqual(1.5);
  }
  const cell = ({ x, y }: Point) => `${x},${y}`;
  const roads = new Set(layout.roads.map(cell));
  for (const road of layout.roads) {
    expect([[1, 0], [0, 1], [-1, 0], [0, -1]].filter(([dx, dy]) => roads.has(`${road.x + dx},${road.y + dy}`))).toHaveLength(2);
    expect(road.x < layout.palace.x || road.y < layout.palace.y || road.x >= layout.palace.x + 2 || road.y >= layout.palace.y + 2).toBe(true);
  }
  for (const house of layout.houses) {
    expect(roads.has(cell(house))).toBe(false);
    expect([[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dy]) => roads.has(`${house.x + dx},${house.y + dy}`))).toBe(true);
  }
  for (const farm of layout.farms) {
    expect(startingFarmPalaceGap(farm, layout.palace)).toBeGreaterThanOrEqual(2);
    for (let dy = 0; dy < 1; dy++) for (let dx = 0; dx < 1; dx++) {
      const tile = tileAt(state.world, farm.x + dx, farm.y + dy);
      expect(tile).toBeDefined(); expect(WATER.has(tile!.terrain)).toBe(false);
      expect(state.buildings.some(building => farm.x + dx >= building.x && farm.x + dx < building.x + buildingSize(building)
        && farm.y + dy >= building.y && farm.y + dy < building.y + buildingSize(building))).toBe(false);
    }
  }
  expect(Math.max(Math.abs(layout.farms[0].x - layout.farms[1].x), Math.abs(layout.farms[0].y - layout.farms[1].y))).toBeGreaterThanOrEqual(1);
}

describe('starting settlement layout', () => {
  it.each(['CROWN', 'first-light'])('starts twenty residents with sufficient beds and reachable food on %s', seed => {
    const state = stateFor(generateWorld(seed)), layout = planStartingSettlement(state, state.world.spawns[0], 20);
    expect(layout.houses.length * 2 + 4).toBeGreaterThanOrEqual(20);
    const palace = place(state, layout, 0), walking = palaceWalkingDistances(state, palace);
    const supply = layout.farms.reduce((sum, farm) => sum + CAMP_FIELD_OFFSETS.reduce((food, [dx, dy]) =>
      food + fieldHarvestFood(state.world, farm.x + dx, farm.y + dy), 0)
      * expectedFarmDelivery(farmWalkingDistance(walking, state.world.width, farm.x, farm.y)), 0);
    expect(harvestFoodPerEconomyCycle(supply)).toBeGreaterThanOrEqual(20 * 1.25);
    for (const block of farmBlockGeometry(layout.farms)) {
      expect(block.size).toBeLessThanOrEqual(16);
      if (block.size > 6) expect(block.aspectRatio).toBeLessThanOrEqual(1.5);
    }
  });

  it('keeps a continuous road ring, four outside houses and enough nearby farmland', () => {
    const state = stateFor(grass()), layout = planStartingSettlement(state, state.world.spawns[0]);
    expect(layout.palace).toEqual({ x: 15, y: 12 });
    assertLayout(state, layout);
    expect(planStartingSettlement(state, state.world.spawns[0])).toEqual(layout);
  });

  it.each([{ x: 15, y: 12 }, { x: 23, y: 18 }, { x: 31, y: 23 }])
    ('finishes mostly 2×2 and 3×3 squares on open land near $x,$y while meeting the initial food target', spawn => {
      const world = grass(56, 44); world.spawns = [spawn];
      const state = stateFor(world), original = JSON.stringify(world.tiles), layout = planStartingSettlement(state, spawn, 20);
      const blocks = farmBlockGeometry(layout.farms), squares = blocks.filter(block => [2, 3].includes(block.width)
        && block.width === block.height && block.size === block.width * block.height);
      expect(squares.length).toBeGreaterThanOrEqual(3);
      expect(squares.length / blocks.length).toBeGreaterThanOrEqual(.6);
      expect(squares.reduce((sum, block) => sum + block.size, 0) / layout.farms.length).toBeGreaterThanOrEqual(.7);
      const palace = place(state, layout, 0), walking = palaceWalkingDistances(state, palace);
      const supply = layout.farms.reduce((sum, farm) => sum + harvestFoodPerEconomyCycle(fieldHarvestFood(world, farm.x, farm.y))
        * expectedFarmDelivery(farmWalkingDistance(walking, world.width, farm.x, farm.y)), 0);
      expect(supply).toBeGreaterThanOrEqual(25);
      expect(JSON.stringify(world.tiles)).toBe(original);
      for (const block of blocks) {
        expect(block.size).toBeLessThanOrEqual(16);
        if (block.size > 6) expect(block.aspectRatio).toBeLessThanOrEqual(1.5);
      }
    });

  it.each(['CROWN', 'river-kingdom', '42', 'autumn', 'first-light', 'BTV-847', 'settlement-loop-7', 'settlement-loop-8'])
    ('places reachable dry farms and intact towns for every faction on %s', seed => {
      const state = stateFor(generateWorld(seed)), original = JSON.stringify(state.world.tiles);
      for (let faction = 0; faction < state.world.spawns.length; faction++) {
        const spawn = state.world.spawns[faction], layout = planStartingSettlement(state, spawn);
        assertLayout(state, layout);
        expect(Math.hypot(layout.palace.x - spawn.x, layout.palace.y - spawn.y)).toBeLessThan(10);
        const palace = place(state, layout, faction), reachable = palaceReachability(state, palace);
        for (const farm of layout.farms) {
          // Fields remain traversable around their historical center marker.
          for (const [dx, dy] of CAMP_FIELD_OFFSETS)
            expect(reachable[(farm.y + dy) * state.world.width + farm.x + dx]).toBe(1);
        }
      }
      expect(JSON.stringify(state.world.tiles)).toBe(original);
    });

  it('prefers a productive field over an equally close desert enclosure', () => {
    const world = grass(), state = stateFor(world);
    for (const tile of world.tiles) tile.terrain = 'desert';
    for (const center of [{ x: 7, y: 12 }, { x: 7, y: 16 }])
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) tileAt(world, center.x + dx, center.y + dy)!.terrain = 'grassland';
    const layout = planStartingSettlement(state, world.spawns[0]);
    expect(layout.farms).toEqual(expect.arrayContaining([{ x: 7, y: 12 }, { x: 7, y: 16 }]));
  });

  it('moves the town to nearby dry ground without filling a river', () => {
    const state = stateFor(grass());
    for (let y = 0; y < state.world.height; y++) tileAt(state.world, 16, y)!.terrain = 'river';
    const layout = planStartingSettlement(state, state.world.spawns[0]);
    assertLayout(state, layout);
    for (const point of [...layout.roads, ...layout.houses]) expect(point.x).not.toBe(16);
    expect(state.world.tiles.filter(tile => tile.terrain === 'river')).toHaveLength(state.world.height);
  });

  it('retains a valid compact town on maps too small for distant farms', () => {
    const state = stateFor(grass(8, 8)), layout = planStartingSettlement(state, { x: 3, y: 3 });
    expect(layout.roads).toHaveLength(12); expect(layout.houses).toHaveLength(4); expect(layout.farms.length).toBeGreaterThan(0);
    for (const point of [...layout.roads, ...layout.houses]) expect(tileAt(state.world, point.x, point.y)).toBeDefined();
  });

  it('allows buildings directly beside the palace without a special setback', () => {
    const state = stateFor(grass());
    entityStore(state).buildings.add({ id: 1, kind: 'palace', x: 15, y: 12, hp: 100, maxHp: 100, capacity: 0, faction: 0 });
    for (const kind of ['house', 'tower', 'wall', 'camp', 'well'] as const)
      expect(palaceSpacingAllowed(state, kind, 17, 12)).toBe(true);
  });

  it('re-plans complete farm blocks around finished city structures without changing terrain', () => {
    const state = stateFor(grass()), layout = planStartingSettlement(state, state.world.spawns[0], 20);
    const palace = place(state, { ...layout, farms: [] }, 0);
    // A mixture of bonus structures cuts holes through the original crop plan.
    for (const [i, point] of layout.farms.filter((_, index) => index % 4 === 0).entries())
      entityStore(state).buildings.add({ id: 100 + i, kind: i % 2 ? 'road' : 'library', ...point,
        faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    const before = JSON.stringify(state.world.tiles);
    const farms = planStartingCityFarms(state, palace, 20, state.world.spawns[0]);
    expect(farms.length).toBeGreaterThan(0);
    for (const farm of farms) expect(state.buildings.some(building => building.x === farm.x && building.y === farm.y)).toBe(false);
    for (const block of farmBlockGeometry(farms)) {
      expect(block.size).toBeLessThanOrEqual(16);
      if (block.size > 6) expect(block.aspectRatio).toBeLessThanOrEqual(1.5);
    }
    const walking = palaceWalkingDistances(state, palace);
    const supply = farms.reduce((sum, farm) => sum + harvestFoodPerEconomyCycle(fieldHarvestFood(state.world, farm.x, farm.y))
      * expectedFarmDelivery(farmWalkingDistance(walking, state.world.width, farm.x, farm.y)), 0);
    expect(supply).toBeGreaterThanOrEqual(25);
    expect(JSON.stringify(state.world.tiles)).toBe(before);
  });

  it('uses a legal isolated one-cell pocket without changing terrain', () => {
    const state = stateFor(grass(12, 12));
    for (const tile of state.world.tiles) tile.terrain = 'lake';
    for (let x = 2; x <= 9; x++) tileAt(state.world, x, 5)!.terrain = 'grassland';
    const palace: Building = { id: 1, kind: 'palace', x: 2, y: 3, faction: 0, hp: 100, maxHp: 100, capacity: 4 };
    entityStore(state).buildings.add(palace);
    for (let x = 5; x <= 9; x++) entityStore(state).buildings.add({ id: x, kind: 'road', x, y: 5, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    tileAt(state.world, 8, 4)!.terrain = 'grassland';
    const before = JSON.stringify(state.world.tiles);
    expect(planStartingCityFarms(state, palace, 5)).toEqual([{ x: 8, y: 4 }]);
    expect(JSON.stringify(state.world.tiles)).toBe(before);
  });
});
