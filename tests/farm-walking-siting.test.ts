import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { farmCityQuery, farmWalkingDistance, palaceWalkingDistances } from '../src/game/farm-travel';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { ensureCollectors, fieldHarvestFoodForState, fieldHarvestYield, synchronizeFarms } from '../src/game/farms';
import { citySummaries } from '../src/game/cities';
import { type Building, type GameState, type Point } from '../src/game/types';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 40, height: 32, seed: 'farm-walk', source: 'test', revision: 0, spawns: [], tiles: Array.from({ length: 1280 }, () =>
      ({ terrain: 'lake', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 10, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Home', color: '#f43', affinity: 100, relation: 'self', population: 10,
      food: 100, gold: 1000, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    units: [], fields: [], time: 0, tick: 0, speed: 1, paused: false, events: [], particles: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'farm-walk', rngState: 1,
  };
  for (const point of [{ x: 10, y: 10 }, { x: 5, y: 10 }, { x: 15, y: 10 }]) clearPlot(state, point);
  for (let x = 5; x <= 12; x++) dry(state, x, 10);
  for (let y = 10; y <= 25; y++) { dry(state, 12, y); dry(state, 15, y); }
  for (let x = 12; x <= 15; x++) dry(state, x, 25);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 40; x++) {
    if (state.world.tiles[y * 40 + x].terrain !== 'grassland' || x >= 10 && x <= 11 && y >= 10 && y <= 11 || y === 10 && (x === 5 || x === 15)) continue;
    add(state, 'road', x, y);
  }
  return state;
}
function dry(state: GameState, x: number, y: number): void { state.world.tiles[y * 40 + x].terrain = 'grassland'; }
function clearPlot(state: GameState, point: Point): void {
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) dry(state, point.x + dx, point.y + dy);
}
function add(state: GameState, kind: Building['kind'], x: number, y: number): Building {
  const building: Building = { id: state.buildings.length + 10, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.add(building); return building;
}

describe('farm walking-distance planning', () => {
  it('prefers a farther-looking plot over a close bank requiring a long water detour', () => {
    const state = fixture(), palace = state.buildings[0], walking = palaceWalkingDistances(state, palace);
    expect(farmWalkingDistance(walking, 40, 15, 10)).toBeGreaterThan(15);
    expect(farmWalkingDistance(walking, 40, 5, 10)).toBeLessThan(5);
    add(state, 'irrigation', 17, 10);
    expect(planAutomaticFarmSite(state, palace)?.point).toEqual({ x: 5, y: 10 });
  });

  it('reevaluates the same close bank after a bridge shortens its walking route', () => {
    const state = fixture(), palace = state.buildings[0];
    add(state, 'irrigation', 17, 10);
    expect(planAutomaticFarmSite(state, palace)?.point).toEqual({ x: 5, y: 10 });
    add(state, 'bridge', 13, 10); add(state, 'bridge', 14, 10);
    const plan = planAutomaticFarmSite(state, palace)!;
    expect(plan.point).toEqual({ x: 15, y: 10 });
    expect(plan.walkingDistance).toBeLessThan(5);
    expect(plan.expectedHarvest).toBeGreaterThan(.8);
  });

  it('assigns the courier and city food credit to the closest palace by walking', () => {
    const state = fixture();
    for (let x = 15; x <= 24; x++) dry(state, x, 10);
    clearPlot(state, { x: 23, y: 10 });
    const second = add(state, 'palace', 23, 10), farm = add(state, 'camp', 15, 10);
    second.capacity = 10; second.unhousedResidents = 10;
    expect(farmCityQuery(state, 0)(farm)?.id).toBe(second.id);
    synchronizeFarms(state); ensureCollectors(state);
    expect(state.units.find(unit => unit.collectorCamp === farm.id)?.home).toBe(second.id);
    expect(citySummaries(state).find(city => city.palace.id === second.id)?.food).toBeCloseTo(4 + .4 * 4 / 3 - 10);
  });

  it('applies a village harvest bonus consistently to owned crops and placement estimates', () => {
    const state = fixture(); add(state, 'camp', 5, 10);
    state.factions[0].villageBonuses = { food: .1, trade: 0, construction: 0, research: 0 };
    synchronizeFarms(state);
    expect(fieldHarvestFoodForState(state, 5, 10, 0)).toBeCloseTo(.88 * 4 / 3);
    expect(fieldHarvestYield(state, state.fields![0])).toBeCloseTo(.88 * 4 / 3);
  });
});
