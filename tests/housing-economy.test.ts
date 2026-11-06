import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { createGame, housingCapacity, migrateGame, updateGame } from '../src/game/simulation';
import { ensureCollectors, fieldHarvestYield, harvestFoodPerEconomyCycle, synchronizeFarms } from '../src/game/farms';
import { buildingReady, buildingSize, isFarmKind, type GameState, type World } from '../src/game/types';
import { PALACE_FOOD_PER_CYCLE } from '../src/game/city-support';

const idle = { up: false, down: false, left: false, right: false };
function realm(ampleFood = true): GameState {
  const world: World = { width: 40, height: 32, seed: 'housing-economy', source: 'fixture', spawns: [{ x: 10, y: 12 }],
    tiles: Array.from({ length: 1280 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) };
  const state = createGame(world);
  state.factions[0].gold = 10000; state.factions[0].population = 5; state.raiderCamps = []; state.villages = [];
  const retainedHomes = new Set(state.buildings.filter(building => building.kind === 'house' && building.faction === 0).slice(0, 4).map(home => home.id));
  entityStore(state).buildings.replace(state.buildings.filter(building => building.faction === 0
    && !isFarmKind(building.kind) && (building.kind !== 'house' || retainedHomes.has(building.id))));
  entityStore(state).units.replace(state.units.filter(unit => unit.faction === 0 && unit.kind !== 'worker')); state.marauderPacks = [];
  state.fields = [];
  for (const tile of state.world.tiles) delete tile.farm;
  state.fogRaids = { nextAt: 1e9, waves: 0, pressureVersion: 1 };
  const palace = state.buildings.find(building => building.kind === 'palace')!;
  // Explicit small-village fixtures retain four homes. Established irrigated
  // orchards supply the surplus tests; ordinary two-farm fixtures remain short.
  for (let i = 0; i < (ampleFood ? 12 : 2); i++) {
    const point = { x: palace.x - 5 + (i % 6) * 2, y: palace.y + 5 + Math.floor(i / 6) * 2 };
    for (let cell = 0; cell < 4; cell++) entityStore(state).buildings.add({ id: 2000 + i * 4 + cell, kind: 'camp', faction: 0,
      x: point.x + cell % 2, y: point.y + Math.floor(cell / 2), hp: 100, maxHp: 100, capacity: 0,
      ...(ampleFood ? { orchard: { startedAt: -120, readyAt: 0 } } : {}) });
  }
  if (ampleFood) for (let i = 0; i < 6; i++) for (let row = 0; row < 2; row++) entityStore(state).buildings.add({
    id: 2100 + i * 2 + row, kind: 'irrigation', faction: 0, x: palace.x - 5 + i * 2, y: palace.y + 4 + row * 5,
    hp: 100, maxHp: 100, capacity: 0 });
  synchronizeFarms(state);
  return state;
}
function economy(state: GameState): void {
  state.time = (state.tick + 1) * 30 - .05;
  for (const farm of state.buildings) if (isFarmKind(farm.kind) && buildingReady(farm)) farm.farmLastVisitedAt = state.time;
  updateGame(state, .05, idle);
}
const palace = (state: GameState) => state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!;
const houses = (state: GameState) => state.buildings.filter(building => building.kind === 'house' && building.faction === 0);

describe('automatic residential housing', () => {
  it.each(['grassland', 'desert'] as const)('doubles eligible population growth on %s without clipping births', terrain => {
    const state = realm(), faction = state.factions[0];
    palace(state).capacity = 50; // Isolate the birth rate from reduced house capacity.
    for (const tile of state.world.tiles) tile.terrain = terrain;
    const before = faction.population, surplus = PALACE_FOOD_PER_CYCLE + harvestFoodPerEconomyCycle(state.fields!.reduce((sum, field) => sum + fieldHarvestYield(state, field), 0)) - before;
    const expectedGrowth = Math.min(2.4, .14 + surplus / 13) * 3;
    economy(state);
    expect(faction.population - before + palace(state).populationGrowth!).toBeCloseTo(expectedGrowth);
    if (terrain === 'grassland') {
      economy(state);
      expect(faction.population - before).toBe(14);
      expect(palace(state).populationGrowth!).toBeCloseTo(.4);
    }
  });
  it('orders two two-person houses with a surplus and completes them using palace builders', () => {
    const state = realm(); state.factions[0].gold = 125;
    state.factions[0].population = 12; synchronizeFarms(state);
    const roads = state.buildings.filter(building => building.kind === 'road');
    const fields = state.fields!.map(field => `${field.x},${field.y}`);
    economy(state);
    expect(state.factions[0].yields.food).toBeGreaterThan(0);
    expect(houses(state)).toHaveLength(6);
    const house = houses(state).find(home => home.construction)!;
    expect(house.capacity).toBe(2); expect(buildingSize(house)).toBe(1);
    expect(house.construction).toMatchObject({ waitingForBuilder: true, paidGold: 62.5, duration: 40 / 3 });
    expect(housingCapacity(state)).toBe(12);
    expect(fields).not.toContain(`${house.x},${house.y}`);
    expect(roads.some(road => road.x === house.x && road.y === house.y)).toBe(false);
    expect(new Set(houses(state).map(home => `${home.x},${home.y}`)).size).toBe(6);
    for (let step = 0; step < 600 && houses(state).some(home => home.construction); step++) updateGame(state, .1, idle);
    expect(houses(state).every(home => !home.construction)).toBe(true);
    expect(housingCapacity(state)).toBe(16);
    expect(state.units.some(unit => unit.builder)).toBe(true);
  });

  it('waits for food deliveries even when potential harvests exceed consumption', () => {
    const state = realm(); state.factions[0].food = 5;
    economy(state);
    expect(state.factions[0].yields.food).toBeGreaterThan(0);
    expect(state.factions[0].food).toBe(PALACE_FOOD_PER_CYCLE);
    expect(houses(state)).toHaveLength(4);
  });

  it('orders only one house when gold cannot pay for the second', () => {
    const state = realm(); state.factions[0].gold = 62.5;
    state.factions[0].population = 12; synchronizeFarms(state);
    economy(state);
    expect(houses(state)).toHaveLength(5);
    expect(state.factions[0].gold).toBeGreaterThanOrEqual(0);
    expect(state.factions[0].gold).toBeLessThan(125);
  });

  // Forty-eight irrigated orchard cells now produce 76.8 meals per cycle;
  // the settlement garden adds 4, so 81 residents already exhaust the surplus.
  it.each([81, 84])('does not build on zero or negative net food, even with a large stockpile (population %i)', population => {
    const state = realm();
    state.factions[0].population = population; state.factions[0].food = 10000;
    synchronizeFarms(state); economy(state);
    expect(state.factions[0].yields.food).toBeLessThanOrEqual(0);
    expect(houses(state)).toHaveLength(4);
  });

  it('stops new orders when the surplus ends and resumes when it returns', () => {
    const state = realm(); state.factions[0].population = 12;
    synchronizeFarms(state); economy(state);
    for (const house of houses(state)) delete house.construction;
    state.factions[0].population = 84; synchronizeFarms(state); economy(state);
    expect(houses(state)).toHaveLength(6);
    state.factions[0].population = 18; synchronizeFarms(state); economy(state);
    expect(houses(state)).toHaveLength(8);
    expect(houses(state).filter(building => building.construction)).toHaveLength(2);
    economy(state);
    expect(houses(state)).toHaveLength(8);
  });

  it('prioritizes new farmland over housing before the current food surplus runs out', () => {
    const state = realm(false); state.factions[0].population = 8; palace(state).populationGrowth = -100;
    synchronizeFarms(state); economy(state);
    expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(12);
    expect(state.buildings.some(building => building.kind === 'camp' && building.construction)).toBe(true);
    expect(houses(state)).toHaveLength(4);
    expect(state.factions[0].population).toBe(8);
  });

  it('orders needed farms each economy cycle and counts pending plots toward demand', () => {
    const state = realm(false);
    for (let tick = 1; tick <= 4; tick++) {
      const farms = state.buildings.filter(building => building.kind === 'camp');
      for (const farm of farms) delete farm.construction;
      state.factions[0].population = farms.length * 1.25;
      palace(state).populationGrowth = -100;
      synchronizeFarms(state); economy(state);
      expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(8 + tick * 4);
    }
  });

  it('preserves residential houses across saves without adding fields or camp peasants', () => {
    const state = realm(); economy(state);
    const house = houses(state)[0]; delete house.construction;
    state.factions[0].population = 12;
    synchronizeFarms(state);
    // Reconcile the deliberately changed population before comparing reload
    // behavior; collectors now share each city's finite resident workforce.
    ensureCollectors(state);
    const fieldIds = state.fields!.map(field => field.id);
    const collectors = state.units.filter(unit => unit.collector).length;
    expect(house.residents).toBe(2);
    migrateGame(state);
    expect(house.kind).toBe('house'); expect(house.residents).toBe(2);
    expect(state.fields!.map(field => field.id)).toEqual(fieldIds);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(collectors);
    expect(state.fields!.some(field => field.camp === house.id)).toBe(false);
  });
});
