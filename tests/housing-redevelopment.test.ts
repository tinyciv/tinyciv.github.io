import { entityStore } from '../src/game/entity-store';
import { PALACE_FOOD_PER_CYCLE } from '../src/game/city-support';
import { describe, expect, it } from 'vitest';
import { createGame, updateGame } from '../src/game/simulation';
import { ensureCollectors, synchronizeFarms } from '../src/game/farms';
import { planHouseSite } from '../src/game/housing';
import { type Building, type GameState, type World, tileAt } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const camp = (id: number, x: number, y: number): Building => ({ id, x, y, kind: 'camp', faction: 0, hp: 160, maxHp: 160, capacity: 0 });

/** The near farm supplies the nearest clear housing parcel; distant woodland
 * provides freely relocated replacement farmland. */
function realm(campCount = 3): GameState {
  const world: World = { width: 40, height: 32, seed: 'farm-redevelopment', source: 'fixture', spawns: [{ x: 10, y: 12 }],
    tiles: Array.from({ length: 1280 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) };
  const state = createGame(world), palace = state.buildings.find(building => building.kind === 'palace')!;
  palace.governorPermissions = { farms: false, housing: true };
  state.factions[0].gold = 10000; state.raiderCamps = [];
  // This relocation fixture surrounds the city with woodland. Supply enough
  // cultural reach for its near farm; border affordability is tested separately.
  state.factions[0].culture = 10000;
  entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' && unit.faction === 0));
  state.units[0].x = 9.5; state.units[0].y = 13.5;
  state.marauderPacks = [];
  entityStore(state).buildings.replace([palace, ...[camp(100, 16, 12), camp(101, 16, 20), camp(102, 20, 12)].slice(0, campCount)]);
  state.fields = [];
  for (const tile of state.world.tiles) { delete tile.farm; tile.overlay = 'forest'; }
  for (const building of state.buildings) tileAt(state.world, building.x, building.y)!.overlay = 'none';
  let roadId = 200;
  const outsideFarm = (x: number, y: number) => !state.buildings.some(b => b.kind === 'camp' && x >= b.x && x < b.x + 1 && y >= b.y && y < b.y + 1);
  for (let x = 12; x <= 23; x++) for (const y of [12, 13]) if (outsideFarm(x, y)) entityStore(state).buildings.add({ id: roadId++, kind: 'road', faction: 0, x, y, hp: 60, maxHp: 60, capacity: 0 });
  for (let y = 14; y <= 21; y++) for (const x of [16, 17]) if (outsideFarm(x, y)) entityStore(state).buildings.add({ id: roadId++, kind: 'road', faction: 0, x, y, hp: 60, maxHp: 60, capacity: 0 });
  state.world.revision = (state.world.revision ?? 0) + 1;
  state.factions[0].population = campCount;
  // Isolate replacement from births; genuine positive food surplus still gates housing.
  palace.populationGrowth = -100;
  synchronizeFarms(state); ensureCollectors(state);
  for (const field of state.fields!) field.nextHarvest = 1000;
  for (const unit of state.units) if (unit.collector) unit.repathAt = 1000;
  return state;
}

function economy(state: GameState): void {
  state.time = (state.tick + 1) * 30 - .05;
  updateGame(state, .05, idle);
}
const houses = (state: GameState) => state.buildings.filter(building => building.kind === 'house');
const physicalFood = (state: GameState) => (state.fields ?? []).reduce((sum, field) => sum + field.food, 0)
  + state.buildings.reduce((sum, building) => sum + (building.storedFood ?? 0), 0)
  + state.units.reduce((sum, unit) => sum + (unit.cargo ?? 0), 0);

describe('farm-to-house redevelopment', () => {
  it('moves the intact farm and preserves physical food, crop deadlines, population and its courier', () => {
    const state = realm(), palace = state.buildings[0], oldCamp = state.buildings.find(building => building.id === 100)!;
    const oldPosition = { x: oldCamp.x, y: oldCamp.y }, oldDistance = Math.hypot(oldCamp.x - palace.x, oldCamp.y - palace.y);
    const oldFields = state.fields!.filter(field => field.camp === oldCamp.id);
    const oldCells = oldFields.map(({ x, y }) => ({ x, y }));
    oldFields.forEach((field, index) => { field.food = index + 1; field.foodBatches = [{ amount: index + 1, expiresAt: 200 }]; field.expiresAt = 200; });
    oldCamp.storedFood = 9; oldCamp.storedFoodBatches = [{ amount: 9, expiresAt: 210 }];
    const courier = state.units.find(unit => unit.collectorCamp === oldCamp.id)!;
    const collectors = state.units.filter(unit => unit.collector);
    Object.assign(courier, { cargo: 7, cargoBatches: [{ amount: 7, expiresAt: 190 }], cargoExpiresAt: 190,
      cargoField: oldFields[0].id, inside: false, x: 14.5, y: 15.5,
      collectPhase: 'outbound', field: oldFields[0].id });
    oldFields[0].claimedBy = courier.id;
    state.selected = courier.id; state.selectedType = 'unit';
    const population = state.factions[0].population, treasury = state.factions[0].food, goods = physicalFood(state);
    const plan = planHouseSite(state, palace)!;
    expect(plan.replaceCampId).toBe(oldCamp.id);

    economy(state);

    const replacement = houses(state).find(house => house.x === plan.point.x && house.y === plan.point.y)!;
    expect(replacement).toMatchObject({ capacity: 3, redevelopedFarm: true, construction: { waitingForBuilder: true } });
    expect(replacement.id).not.toBe(oldCamp.id);
    expect(oldCamp.kind).toBe('camp');
    expect({ x: oldCamp.x, y: oldCamp.y }).not.toEqual(oldPosition);
    expect(Math.hypot(oldCamp.x - palace.x, oldCamp.y - palace.y)).toBeGreaterThan(oldDistance);
    expect(state.factions[0].population).toBe(population);
    expect(state.factions[0].food).toBe(treasury + PALACE_FOOD_PER_CYCLE - population);
    expect(physicalFood(state)).toBe(goods);
    expect(state.fields!.filter(field => field.camp === oldCamp.id)).toHaveLength(1);
    for (const point of oldCells) expect(tileAt(state.world, point.x, point.y)?.farm).toBeUndefined();
    expect(state.units).toContain(courier);
    expect(courier.collectorCamp).toBe(oldCamp.id);
    expect(state.fields!.find(field => field.id === courier.field)?.claimedBy).toBe(courier.id);
    expect(courier.cargoBatches).toEqual([{ amount: 7, expiresAt: 190 }]);
    expect(oldFields.every(field => field.nextHarvest === 1000)).toBe(true);
    expect(state.units.filter(unit => unit.collector)).toEqual(collectors);
    expect(state.selected).toBe(courier.id);
    expect(state.factions[0].yields.food).toBeGreaterThan(0);
  });

  it('orders normal construction in the reclaimed parcel and grants its extra bed after completion and a well upgrade', () => {
    const state = realm();
    entityStore(state).buildings.add(camp(103, 20, 20));
    state.factions[0].population = 3; synchronizeFarms(state);
    economy(state);
    const replacement = houses(state).find(house => house.redevelopedFarm)!;
    expect(houses(state)).toHaveLength(2);
    expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(4);
    // Construction staffing observes the new order on its bounded sample.
    updateGame(state, 2 / 3, idle);
    const builder = state.units.find(unit => unit.builder && unit.buildSite === replacement.id);
    expect(builder?.home).toBe(state.buildings[0].id);
    expect(builder?.inside).toBe(false);
    expect(builder?.buildPhase).toBe('outbound');
    state.buildings[0].governorPermissions!.housing = false;
    for (let step = 0; step < 900 && houses(state).some(house => house.construction); step++) updateGame(state, .1, idle);
    expect(houses(state).every(house => !house.construction)).toBe(true);
    expect(replacement.capacity).toBe(3);
    entityStore(state).buildings.add({ id: 9000, kind: 'well', faction: 0, x: replacement.x + 2, y: replacement.y, hp: 100, maxHp: 100, capacity: 0 });
    synchronizeFarms(state); synchronizeFarms(state);
    expect(replacement).toMatchObject({ houseLevel: 2, capacity: 4, redevelopedFarm: true });
  });

  it.each([{ camps: 1, population: 4 }, { camps: 2, population: 4 }])(
    'keeps every productive farm when adding housing ($camps camps, $population people)', ({ camps, population }) => {
      const state = realm(camps), oldCamp = state.buildings.find(building => building.id === 100)!;
      state.factions[0].population = population;
      synchronizeFarms(state);
      expect(planHouseSite(state, state.buildings[0])?.replaceCampId).toBe(oldCamp.id);
      economy(state);
      expect(state.factions[0].yields.food).toBeGreaterThan(0);
      expect(oldCamp.kind).toBe('camp');
      expect(houses(state).some(house => house.redevelopedFarm && house.capacity === 3)).toBe(true);
      expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(camps);
      expect(state.fields).toHaveLength(camps);
      expect(state.factions[0].population).toBe(population);
    });
});
