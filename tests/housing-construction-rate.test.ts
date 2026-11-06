import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildAt, createGame, updateGame } from '../src/game/simulation';
import { synchronizeFarms } from '../src/game/farms';
import { citySummaries } from '../src/game/cities';
import { planHouseSite } from '../src/game/housing';
import { buildingReady, isFarmKind, type Building, type GameState, type World } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const houses = (state: GameState) => state.buildings.filter(building => building.kind === 'house' && building.faction === 0);
function realm(population = 20): GameState {
  const world: World = { width: 72, height: 44, seed: 'housing-rate', source: 'test', spawns: [{ x: 12, y: 17 }],
    tiles: Array.from({ length: 72 * 44 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) };
  const state = createGame(world);
  const retainedHomes = new Set(houses(state).slice(0, 8).map(home => home.id));
  entityStore(state).buildings.replace(state.buildings.filter(building => building.faction === 0
    && !isFarmKind(building.kind) && (building.kind !== 'house' || retainedHomes.has(building.id))));
  entityStore(state).units.replace(state.units.filter(unit => unit.faction === 0 && unit.kind !== 'worker'));
  state.raiderCamps = []; state.marauderPacks = []; state.villages = [];
  state.fields = [];
  for (const tile of state.world.tiles) delete tile.farm;
  Object.assign(state.factions[0], { gold: 10000, food: 10000, population });
  for (const palace of state.buildings.filter(building => building.kind === 'palace')) palace.populationGrowth = -10000;
  // Eight established level-two homes retain three beds each without qualifying for the
  // population, guard-post, and enclosure requirements of the higher tiers.
  for (const home of houses(state)) home.houseLevel = 2;
  const palace = state.buildings.find(building => building.kind === 'palace')!;
  // Keep this fixed-capacity fixture well fed under the revised delivery model.
  for (let i = 0; i < 12; i++) {
    const point = { x: palace.x - 5 + (i % 6) * 2, y: palace.y + 5 + Math.floor(i / 6) * 2 };
    for (let cell = 0; cell < 4; cell++) entityStore(state).buildings.add({ id: 2000 + i * 4 + cell, kind: 'camp', faction: 0,
      x: point.x + cell % 2, y: point.y + Math.floor(cell / 2), hp: 100, maxHp: 100, capacity: 0,
      orchard: { startedAt: -120, readyAt: 0 } });
  }
  for (let i = 0; i < 6; i++) for (let row = 0; row < 2; row++) entityStore(state).buildings.add({
    id: 2100 + i * 2 + row, kind: 'irrigation', faction: 0, x: palace.x - 5 + i * 2, y: palace.y + 4 + row * 5,
    hp: 100, maxHp: 100, capacity: 0 });
  synchronizeFarms(state);
  return state;
}
function economy(state: GameState): void {
  state.time = (state.tick + 1) * 30 - .05;
  // Sample construction clocks without simulating the intervening courier trips.
  // Keep these supply fixtures tended so abandonment does not replace the
  // vacant-bed rule as the housing bottleneck.
  for (const farm of state.buildings) if (isFarmKind(farm.kind) && buildingReady(farm)) farm.farmLastVisitedAt = state.time;
  updateGame(state, .05, idle);
}
const queued = (state: GameState) => houses(state).filter(home => home.construction);
function discardOrders(state: GameState): void {
  entityStore(state).buildings.replace(state.buildings.filter(building => !building.construction));
}

describe('automatic housing rate follows each city’s vacant capacity', () => {
  it('issues ten percent as many orders over the same ten economy ticks', () => {
    const excess = realm(20), needed = realm(21);
    expect(citySummaries(excess)[0]).toMatchObject({ population: 20, housing: 28 });
    expect(citySummaries(needed)[0]).toMatchObject({ population: 21, housing: 28 });
    let slowOrders = 0, normalOrders = 0;
    for (let tick = 1; tick <= 10; tick++) {
      economy(excess); economy(needed);
      expect(queued(excess)).toHaveLength(tick % 5 === 0 ? 1 : 0);
      slowOrders += queued(excess).length; normalOrders += queued(needed).length;
      // Keep both populations and completed capacity fixed while measuring order rates.
      discardOrders(excess); discardOrders(needed);
    }
    expect(normalOrders).toBe(20);
    expect(slowOrders).toBe(2);
  });

  it('keeps normal speed at the exact threshold and resumes immediately when demand returns', () => {
    const state = realm(20);
    economy(state); economy(state);
    expect(queued(state)).toHaveLength(0);
    state.factions[0].population = 21; synchronizeFarms(state);
    // Seven vacant beds is exactly 25% of twenty-eight beds, so "exceeds" must be strict.
    economy(state);
    expect(queued(state)).toHaveLength(2);
    expect(state.buildings.find(building => building.kind === 'palace')!.automaticHouseCredit).toBe(0);
  });

  it('does not let an empty city suppress construction in a populated city of the same faction', () => {
    const state = realm(16), originalPalace = state.buildings.find(building => building.kind === 'palace')!;
    const palace: Building = { ...originalPalace, id: 10000, x: 54, y: 18, cityName: 'Second city' };
    const homes: Building[] = [[51, 17], [51, 20], [58, 17], [58, 20], [52, 17], [52, 20], [59, 17], [59, 20]].map(([x, y], i) => ({
      id: 10001 + i, kind: 'house', faction: 0, x, y, hp: 160, maxHp: 160, capacity: 2, houseLevel: 1, residents: 2,
    }));
    // Place the population in this city explicitly; reconciliation preserves residents.
    for (const home of houses(state)) home.residents = 0;
    entityStore(state).buildings.replace([...homes, ...state.buildings, palace]);
    for (let i = 0; i < 6; i++) {
      const point = { x: palace.x - 2 + (i % 3) * 2, y: palace.y + 4 + Math.floor(i / 3) * 2 };
      for (let cell = 0; cell < 4; cell++) entityStore(state).buildings.add({ id: 11000 + i * 4 + cell, kind: 'camp', faction: 0,
        x: point.x + cell % 2, y: point.y + Math.floor(cell / 2), hp: 100, maxHp: 100, capacity: 0,
        orchard: { startedAt: -120, readyAt: 0 } });
    }
    for (const dx of [-2, 1, 3]) for (const dy of [3, 8]) entityStore(state).buildings.add({
      id: 11100 + (dx + 2) * 10 + dy, kind: 'irrigation', faction: 0, x: palace.x + dx, y: palace.y + dy,
      hp: 100, maxHp: 100, capacity: 0 });
    synchronizeFarms(state);
    expect(citySummaries(state).map(city => [city.population, city.housing])).toEqual([[0, 28], [16, 20]]);
    economy(state);
    expect(queued(state)).toHaveLength(2);
    expect(queued(state).every(home => Math.hypot(home.x - palace.x, home.y - palace.y) < 11)).toBe(true);
  });

  it('preserves fractional pacing through a save and never banks a construction burst', () => {
    let state = realm(20);
    for (let tick = 0; tick < 3; tick++) economy(state);
    state = JSON.parse(JSON.stringify(state)) as GameState;
    economy(state); expect(queued(state)).toHaveLength(0);
    economy(state); expect(queued(state)).toHaveLength(1);
    discardOrders(state);
    for (let tick = 0; tick < 12; tick++) { state.factions[0].gold = 0; economy(state); }
    expect(queued(state)).toHaveLength(0);
    state.factions[0].gold = 10000; economy(state);
    expect(queued(state)).toHaveLength(1);
  });

  it('does not throttle manual house orders or their reduced construction time', () => {
    const state = realm(), palace = state.buildings.find(building => building.kind === 'palace')!;
    const plan = planHouseSite(state, palace)!;
    expect(buildAt(state, 'house', plan.point.x, plan.point.y).ok).toBe(true);
    expect(queued(state)).toHaveLength(1);
    expect(queued(state)[0].construction?.duration).toBe(40 / 3);
  });
});
