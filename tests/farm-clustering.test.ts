import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { planBuildingFarmRelocations, planFarmRelocation, relocateBuildingFarms } from '../src/game/farm-relocation';
import { farmWalkingDistance, palaceWalkingDistances } from '../src/game/farm-travel';
import { farmCompactnessQuery, farmParcelPreferenceQuery, FARM_CLUSTER_WALKING_BIAS } from '../src/game/farm-clusters';
import { fieldHarvestFoodForState } from '../src/game/farms';
import { type Building, type GameState, type Point } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'farm-blocks', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 8, y: 10, hp: 650, maxHp: 650, capacity: 20, unhousedResidents: 20 }],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#d85842', affinity: 100, relation: 'self',
      population: 20, gold: 2000, food: 500, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'farm-blocks', rngState: 1,
  };
}
function add(state: GameState, kind: Building['kind'], point: Point, faction = 0): Building {
  const building: Building = { id: Math.max(...state.buildings.map(building => building.id)) + 1, kind, faction, ...point, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.add(building); state.world.revision!++;
  return building;
}
function restrictPlots(state: GameState, candidates: Point[]): void {
  const allowed = new Set(candidates.map(point => point.y * 32 + point.x));
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
    if (allowed.has(y * 32 + x) || state.buildings.some(building => x >= building.x && y >= building.y
      && x < building.x + (building.kind === 'palace' ? 2 : 1) && y < building.y + (building.kind === 'palace' ? 2 : 1))) continue;
    add(state, 'road', { x, y });
  }
}
function cardinallyConnected(points: Point[]): boolean {
  const remaining = new Set(points.map(point => `${point.x},${point.y}`)), queue = [points[0]];
  remaining.delete(`${points[0].x},${points[0].y}`);
  for (let index = 0; index < queue.length; index++) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const point = { x: queue[index].x + dx, y: queue[index].y + dy }, key = `${point.x},${point.y}`;
    if (remaining.delete(key)) queue.push(point);
  }
  return remaining.size === 0;
}
function parcels(points: Point[]): Point[][] {
  const remaining = new Map(points.map(point => [`${point.x},${point.y}`, point])), groups: Point[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!, queue = [first]; remaining.delete(`${first.x},${first.y}`);
    for (let index = 0; index < queue.length; index++) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const key = `${queue[index].x + dx},${queue[index].y + dy}`, next = remaining.get(key);
      if (next) { remaining.delete(key); queue.push(next); }
    }
    groups.push(queue);
  }
  return groups;
}
function square(x: number, y: number, size: number): Point[] {
  return Array.from({ length: size * size }, (_, index) => ({ x: x + index % size, y: y + Math.floor(index / size) }));
}

describe('compact farm placement', () => {
  it('sequentially completes 2×2 and 3×3 squares with one-cell gaps on uniform terrain', () => {
    const state = fixture(), crops: Building[] = [];
    for (let order = 0; order < 20; order++) {
      const plan = planAutomaticFarmSite(state, state.buildings[0])!;
      expect(plan).toBeDefined();
      const crop = add(state, 'camp', plan.point);
      crop.construction = { startedAt: 0, duration: 3.75, waitingForBuilder: true };
      crops.push(crop);
    }
    const groups = parcels(crops);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    let incomplete = 0, squarePlots = 0;
    for (const group of groups) {
      const width = Math.max(...group.map(crop => crop.x)) - Math.min(...group.map(crop => crop.x)) + 1;
      const height = Math.max(...group.map(crop => crop.y)) - Math.min(...group.map(crop => crop.y)) + 1;
      expect(width).toBeLessThanOrEqual(3); expect(height).toBeLessThanOrEqual(3);
      if (group.length !== width * height || Math.min(width, height) < 2) incomplete++;
      else { expect(width).toBe(height); squarePlots += group.length; }
    }
    expect(incomplete).toBeLessThanOrEqual(1);
    expect(squarePlots / crops.length).toBeGreaterThanOrEqual(.8);
    expect(state.buildings.some(building => building.kind === 'road')).toBe(false);
    const closestGap = Math.min(...groups.flatMap((a, index) => groups.slice(index + 1).flatMap(b =>
      a.flatMap(first => b.map(second => Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y)))))));
    expect(closestGap).toBe(2); // One unplanted cell, without generating roads.
  });

  it('offers only square preferred parcels and gives a partly planted square priority', () => {
    const state = fixture(), palace = state.buildings[0], points = [];
    for (let y = 1; y < 23; y++) for (let x = 1; x < 31; x++) points.push({ x, y });
    const preference = farmParcelPreferenceQuery(state, palace, points);
    const groups = parcels(points.filter(point => preference(point.x, point.y) > 0));
    expect(new Set(groups.map(group => group.length))).toEqual(new Set([4, 9]));
    const parcel = groups.find(group => group.length === 4)!, first = parcel[0]; add(state, 'camp', first);
    const after = farmParcelPreferenceQuery(state, palace, points.filter(point => point !== first));
    expect(after(parcel[1].x, parcel[1].y)).toBeGreaterThan(after(groups.find(group => group !== parcel)![0].x, groups.find(group => group !== parcel)![0].y));
  });

  it('continues an intended 3×3 square after its first four plots form a 2×2 corner', () => {
    const state = fixture(), palace = state.buildings[0], points: Point[] = [];
    for (let y = 1; y < 23; y++) for (let x = 1; x < 31; x++) points.push({ x, y });
    const emptyPreference = farmParcelPreferenceQuery(state, palace, points);
    const target = parcels(points.filter(point => emptyPreference(point.x, point.y) > 0)).find(group => group.length === 9)!;
    const x = Math.min(...target.map(point => point.x)), y = Math.min(...target.map(point => point.y));
    for (const point of square(x, y, 2)) add(state, 'camp', point);
    for (let added = 0; added < 5; added++) {
      const remaining = points.filter(point => !state.buildings.some(crop => crop.kind === 'camp' && crop.x === point.x && crop.y === point.y));
      const preference = farmParcelPreferenceQuery(state, palace, remaining);
      const chosen = [...remaining].sort((a, b) => preference(b.x, b.y) - preference(a.x, a.y))[0];
      expect(target).toContainEqual(chosen);
      expect(preference(chosen.x, chosen.y)).toBeGreaterThan(.9);
      add(state, 'camp', chosen);
    }
    expect(parcels(state.buildings.filter(building => building.kind === 'camp')).map(group => group.length)).toEqual([9]);
  });

  it('finishes a viable 2×3 partial square before beginning another parcel', () => {
    const state = fixture(), palace = state.buildings[0], target = square(4, 6, 3);
    for (const point of target.filter(point => point.y < 8)) add(state, 'camp', point);
    for (let added = 0; added < 3; added++) {
      const next = planAutomaticFarmSite(state, palace)!;
      expect(target).toContainEqual(next.point); add(state, 'camp', next.point);
    }
    expect(parcels(state.buildings.filter(building => building.kind === 'camp')).map(group => group.length)).toEqual([9]);
  });

  it('finishes a slightly more distant fourth corner before opening another square', () => {
    const state = fixture(), palace = state.buildings[0], corner = { x: 4, y: 3 };
    for (const point of [{ x: 5, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 3 }]) add(state, 'camp', point);
    expect(planAutomaticFarmSite(state, palace)?.point).toEqual(corner);
    // Square completion remains a preference: much richer soil can win.
    const richer = { x: 14, y: 10 }; state.world.tiles[richer.y * 32 + richer.x].fertility = 1;
    expect(planAutomaticFarmSite(state, palace)?.point).toEqual(richer);
  });

  it.each([{ x: 8, y: 3, size: 2 }, { x: 4, y: 6, size: 3 }])('keeps a completed $size×$size square separate from new parcels', ({ x, y, size }) => {
    const state = fixture(), completed = square(x, y, size);
    for (const point of completed) add(state, 'camp', point);
    const next = planAutomaticFarmSite(state, state.buildings[0])!;
    expect(Math.min(...completed.map(point => Math.max(Math.abs(point.x - next.point.x), Math.abs(point.y - next.point.y))))).toBeGreaterThanOrEqual(2);
  });

  it('scores planned starting plots exactly like completed farms', () => {
    const state = fixture(), palace = state.buildings[0], points: Point[] = [];
    const planted = [{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 7 }];
    for (let y = 1; y < 23; y++) for (let x = 1; x < 31; x++) {
      if (!planted.some(point => point.x === x && point.y === y)) points.push({ x, y });
    }
    const planned = farmParcelPreferenceQuery(state, palace, points, { plannedCells: new Set(planted.map(point => point.y * 32 + point.x)) });
    for (const point of planted) add(state, 'camp', point);
    const actual = farmParcelPreferenceQuery(state, palace, points);
    expect(points.map(point => planned(point.x, point.y))).toEqual(points.map(point => actual(point.x, point.y)));
  });

  it('does not mistake an already finished planned square for a pending completion', () => {
    const state = fixture(), palace = state.buildings[0], points: Point[] = [];
    const planted = square(8, 3, 2), plannedCells = new Set(planted.map(point => point.y * 32 + point.x));
    for (let y = 1; y < 23; y++) for (let x = 1; x < 31; x++) points.push({ x, y });
    const withPlanted = farmParcelPreferenceQuery(state, palace, points, { plannedCells });
    const emptyPoints = points.filter(point => !plannedCells.has(point.y * 32 + point.x));
    for (const point of planted) add(state, 'camp', point);
    const withoutPlanted = farmParcelPreferenceQuery(state, palace, emptyPoints);
    expect(emptyPoints.map(point => withPlanted(point.x, point.y))).toEqual(emptyPoints.map(point => withoutPlanted(point.x, point.y)));
    expect(Math.max(...emptyPoints.map(point => withPlanted(point.x, point.y)))).toBeGreaterThanOrEqual(.2);
  });

  it('uses narrow remaining strips when no complete parcel fits', () => {
    const state = fixture(), strip = [{ x: 13, y: 10 }, { x: 14, y: 10 }, { x: 15, y: 10 }];
    restrictPlots(state, strip);
    for (let index = 0; index < strip.length; index++) {
      const plan = planAutomaticFarmSite(state, state.buildings[0]); expect(plan).toBeDefined();
      expect(strip).toContainEqual(plan!.point); add(state, 'camp', plan!.point);
    }
    expect(planAutomaticFarmSite(state, state.buildings[0])).toBeUndefined();
  });

  it('uses exceptionally productive ground in a preferred gap rather than enforcing the parcel plan', () => {
    const state = fixture(), palace = state.buildings[0], points: Point[] = [];
    for (let y = 2; y < 22; y++) for (let x = 2; x < 30; x++) points.push({ x, y });
    const preference = farmParcelPreferenceQuery(state, palace, points), walking = palaceWalkingDistances(state, palace);
    const gap = points.find(point => preference(point.x, point.y) === 0
      && Math.hypot(point.x + .5 - palace.x - 1, point.y + .5 - palace.y - 1) > 2
      && farmWalkingDistance(walking, 32, point.x, point.y) <= 5)!;
    expect(gap).toBeDefined(); state.world.tiles[gap.y * 32 + gap.x].fertility = 1;
    expect(planAutomaticFarmSite(state, palace)?.point).toEqual(gap);
  });

  it.each([.51, .52, .53])('joins a field despite slightly richer isolated soil (%s fertility)', fertility => {
    const state = fixture(), clustered = { x: 4, y: 10 }, isolated = { x: 14, y: 10 };
    add(state, 'camp', { x: 3, y: 10 }); restrictPlots(state, [clustered, isolated]);
    state.world.tiles[clustered.y * 32 + clustered.x].fertility = .5;
    state.world.tiles[isolated.y * 32 + isolated.x].fertility = fertility;
    const plan = planAutomaticFarmSite(state, state.buildings[0])!;
    expect(fieldHarvestFoodForState(state, isolated.x, isolated.y)).toBeGreaterThan(fieldHarvestFoodForState(state, clustered.x, clustered.y));
    expect(plan.point).toEqual(clustered);
    expect(plan.expectedHarvest).toBeCloseTo(.8 * 4 / 3); // The preference never manufactures extra food.
    state.world.tiles[isolated.y * 32 + isolated.x].fertility = 1;
    expect(planAutomaticFarmSite(state, state.buildings[0])?.point).toEqual(isolated);
  });

  it('fills a three-sided hole before adding a single-neighbor extension of equal quality', () => {
    const state = fixture(), hole = { x: 15, y: 10 }, extension = { x: 16, y: 9 };
    for (const point of [{ x: 14, y: 10 }, { x: 15, y: 9 }, { x: 15, y: 11 }]) add(state, 'camp', point);
    restrictPlots(state, [hole, extension]);
    expect(planAutomaticFarmSite(state, state.buildings[0])?.point).toEqual(hole);
  });

  it('keeps irrigation more valuable than joining an unirrigated block', () => {
    const state = fixture(), clustered = { x: 4, y: 10 }, irrigated = { x: 14, y: 10 };
    for (const point of [{ x: 3, y: 10 }, { x: 4, y: 9 }, { x: 4, y: 11 }]) add(state, 'camp', point);
    add(state, 'irrigation', { x: 16, y: 10 }); restrictPlots(state, [clustered, irrigated]);
    add(state, 'road', { x: 16, y: 10 });
    expect(planAutomaticFarmSite(state, state.buildings[0])).toMatchObject({ point: irrigated, irrigatedPlots: 1 });
  });

  it('prefers reliable nearby delivery over a crop block with a long walking journey', () => {
    const state = fixture(), clustered = { x: 24, y: 10 }, nearby = { x: 4, y: 10 };
    for (const point of [{ x: 25, y: 10 }, { x: 24, y: 9 }, { x: 24, y: 11 }]) add(state, 'camp', point);
    restrictPlots(state, [clustered, nearby]);
    expect(planAutomaticFarmSite(state, state.buildings[0])?.point).toEqual(nearby);
  });

  it('reforms a library’s displaced fields together without pulling distant farmland toward it', () => {
    const state = fixture(), origin = { x: 14, y: 10 };
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) add(state, 'camp', { x: origin.x + dx, y: origin.y + dy });
    const distant = add(state, 'camp', { x: 25, y: 18 });
    const batch = planBuildingFarmRelocations(state, 'library', origin, 0)!;
    expect(batch.farms).toHaveLength(4);
    expect(cardinallyConnected(batch.farms.map(plan => plan.to))).toBe(true);
    expect(relocateBuildingFarms(state, batch)).toBe(true);
    expect(distant).toMatchObject({ x: 25, y: 18 });
  });

  it('keeps housing replacements farther out despite an attractive inner crop block', () => {
    const state = fixture(), camp = add(state, 'camp', { x: 14, y: 10 }), palace = state.buildings[0];
    for (const point of [{ x: 11, y: 9 }, { x: 12, y: 9 }, { x: 11, y: 8 }]) add(state, 'camp', point);
    const plan = planFarmRelocation(state, palace, camp, camp)!;
    expect(plan).toBeDefined();
    expect(Math.hypot(plan.to.x - palace.x, plan.to.y - palace.y)).toBeGreaterThan(Math.hypot(camp.x - palace.x, camp.y - palace.y));
  });

  it('limits clustering to a short walking detour during relocation', () => {
    const state = fixture(), camp = add(state, 'camp', { x: 14, y: 10 }), palace = state.buildings[0];
    for (const point of [{ x: 22, y: 10 }, { x: 23, y: 9 }, { x: 23, y: 11 }]) add(state, 'camp', point);
    const options = { nearby: true, reservedTiles: new Set([10 * 32 + 14]) };
    const plan = planFarmRelocation(state, palace, camp, camp, undefined, options)!;
    const walking = palaceWalkingDistances(state, palace);
    const nearest = Math.min(...Array.from(walking).filter(Number.isFinite));
    expect(farmWalkingDistance(walking, 32, plan.to.x, plan.to.y)).toBeLessThanOrEqual(nearest + FARM_CLUSTER_WALKING_BIAS);
    expect(farmCompactnessQuery(state, 0)(plan.to.x, plan.to.y)).toBe(0);
  });
});
