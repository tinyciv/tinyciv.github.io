import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { synchronizeFarms } from '../src/game/farms';
import { demolishBuildingsInArea } from '../src/game/area-tools';
import { factionDevelopmentReserve, updateFactionDevelopment } from '../src/game/faction-development';
import { governingPalace } from '../src/game/governor';
import { factionBuildingMaintenance, TAX_INCOME_MULTIPLIER } from '../src/game/maintenance';
import { BUILD_COSTS, cancelConstruction, updateGame } from '../src/game/simulation';
import { buildingReady, isFarmKind, type Building, type GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function realm(cityCount = 2, farms = true): GameState {
  const buildings: Building[] = [];
  let id = 10;
  for (let city = 0; city < cityCount; city++) {
    const x = 18 + city * 48, y = 28;
    buildings.push({ id: city + 1, kind: 'palace', faction: 0, x, y, hp: 650, maxHp: 650, capacity: 0,
      populationGrowth: -10000, governorNextPlanAt: 30, governorPermissions: { farms: true, housing: true } });
    for (const [dx, dy] of [[-3, -1], [-3, 2], [4, -1], [4, 2], [-4, -1], [-4, 2], [5, -1], [5, 2]]) buildings.push({ id: id++, kind: 'house', faction: 0,
      x: x + dx, y: y + dy, hp: 160, maxHp: 160, capacity: 2, residents: 2, houseLevel: 1 });
    if (farms) for (let i = 0; i < 6; i++) {
      // Close, irrigated orchards keep housing demand independent of delivery
      // losses; this suite measures city timers rather than ordinary grain.
      const point = { x: x - 2 + (i % 3) * 2, y: y + 4 + Math.floor(i / 3) * 2 };
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) buildings.push({ id: id++, kind: 'camp', faction: 0,
        x: point.x + dx, y: point.y + dy, hp: 100, maxHp: 100, capacity: 0, orchard: { startedAt: -120, readyAt: 0 } });
    }
    if (farms) for (const dx of [-2, 1, 3]) for (const dy of [3, 8]) buildings.push({ id: id++, kind: 'irrigation', faction: 0,
      x: x + dx, y: y + dy, hp: 100, maxHp: 100, capacity: 0 });
  }
  const state: GameState = {
    world: { width: 96, height: 64, seed: 'independent-city-clocks', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 96 * 64 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings, units: [{ id: 1000, kind: 'leader', faction: 0, x: 20.5, y: 28.5, hp: 100, maxHp: 100,
      morale: 100, attack: 0, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0,
      lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#d94d4d', affinity: 100, relation: 'self', food: 10000, gold: 10000,
      production: 0, population: cityCount * 16, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'independent-city-clocks', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0 },
    wildlife: { herds: [], nextRespawnAt: Infinity, sequence: 0, targetHerds: 0 },
  };
  synchronizeFarms(state);
  return state;
}
function stepTo(state: GameState, time: number): void {
  state.time = time - .05;
  // The skipped interval represents normal tending; this fixture isolates city
  // clocks and housing demand from courier travel and farm abandonment.
  for (const farm of state.buildings) if (isFarmKind(farm.kind) && buildingReady(farm)) farm.farmLastVisitedAt = state.time;
  updateGame(state, .05, idle);
}
function ordersByCity(state: GameState, kind: 'house' | 'camp'): number[] {
  return state.buildings.filter(building => building.kind === 'palace').map(palace => state.buildings.filter(building =>
    building.kind === kind && building.construction && governingPalace(state,
      { x: building.x + .5, y: building.y + .5 }, 0)?.id === palace.id).length);
}
function discardOrders(state: GameState): void { entityStore(state).buildings.replace(state.buildings.filter(building => !building.construction)); }

describe('independent city construction clocks', () => {
  it('gives each of two cities the same house-order rate as a single city', () => {
    const single = realm(1), multiple = realm(2);
    for (const time of [30, 60, 90]) {
      stepTo(single, time); stepTo(multiple, time);
      expect(ordersByCity(single, 'house')).toEqual([2]);
      expect(ordersByCity(multiple, 'house')).toEqual([2, 2]);
      discardOrders(single); discardOrders(multiple);
    }
  });

  it('lets both cities fund eight pending farm tiles without sharing a pending-farm cap', () => {
    const state = realm(2, false);
    stepTo(state, 30); expect(ordersByCity(state, 'camp')).toEqual([4, 4]);
    stepTo(state, 60); expect(ordersByCity(state, 'camp')).toEqual([8, 8]);
    stepTo(state, 90); expect(ordersByCity(state, 'camp')).toEqual([8, 8]);
  });

  it('uses each city’s own due time instead of resetting another city’s clock', () => {
    const state = realm(), second = state.buildings.find(building => building.id === 2)!;
    second.governorNextPlanAt = 45;
    stepTo(state, 30); expect(ordersByCity(state, 'house')).toEqual([2, 0]);
    expect(second.governorNextPlanAt).toBe(45);
    stepTo(state, 45); expect(ordersByCity(state, 'house')).toEqual([2, 2]);
    expect(state.buildings.find(building => building.id === 1)!.governorNextPlanAt).toBeCloseTo(60);
    expect(second.governorNextPlanAt).toBeCloseTo(75);
  });

  it('starts a newly completed palace’s own thirty-second clock', () => {
    const state = realm(), second = state.buildings.find(building => building.id === 2)!;
    second.construction = { startedAt: 0, duration: 90, waitingForBuilder: true };
    const planned: number[] = [];
    const callbacks = { farms: (_faction: unknown, palace: Building) => { planned.push(palace.id); }, houses: () => {},
      validate: () => ({ ok: false }), build: () => ({ ok: false }) };
    state.time = 10; updateFactionDevelopment(state, callbacks);
    expect(second.governorNextPlanAt).toBeUndefined();
    delete second.construction;
    state.time = 20; updateFactionDevelopment(state, callbacks);
    expect(second.governorNextPlanAt).toBe(50);
    state.time = 30; updateFactionDevelopment(state, callbacks); expect(planned).toEqual([1, 1, 1, 1]);
    state.time = 50; updateFactionDevelopment(state, callbacks); expect(planned).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it('keeps the vacancy slowdown local while the other city expands at full speed', () => {
    const state = realm(); state.factions[0].population = 24;
    for (const house of state.buildings) if (house.kind === 'house' && house.x < 40) house.residents = 1;
    synchronizeFarms(state);
    const totals = [0, 0];
    for (const time of [30, 60, 90, 120, 150]) {
      stepTo(state, time);
      const orders = ordersByCity(state, 'house');
      orders.forEach((count, city) => { totals[city] += count; });
      discardOrders(state);
    }
    expect(totals).toEqual([1, 10]);
  });

  it('does not let another city’s food shortage block housing where harvests support it', () => {
    const state = realm();
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind !== 'camp' || building.x < 40));
    state.buildings.find(building => building.id === 2)!.governorPermissions = { farms: false, housing: false };
    synchronizeFarms(state); stepTo(state, 30);
    expect(state.factions[0].yields.food).toBeLessThan(0);
    expect(ordersByCity(state, 'house')).toEqual([2, 0]);
  });

  it.each([0, 1])('shares gold and preserves the maintenance reserve when both city clocks are due (shortfall: %i)', shortfall => {
    const state = realm(), faction = state.factions[0], cost = BUILD_COSTS.house.gold;
    const maintenance = factionBuildingMaintenance(state, faction), taxes = faction.population * TAX_INCOME_MULTIPLIER;
    expect(maintenance).toBe(37.5);
    // Pay the due maintenance bill, retain the next bill, and fund at most one
    // house. Being one gold short must keep both governors out of the reserve.
    const goldAfterEconomy = cost + maintenance - shortfall;
    faction.gold = goldAfterEconomy + maintenance - taxes;
    stepTo(state, 30);
    const expectedOrders = shortfall ? 0 : 1;
    expect(ordersByCity(state, 'house').reduce((sum, count) => sum + count, 0)).toBe(expectedOrders);
    expect(faction.gold).toBe(goldAfterEconomy - expectedOrders * cost);
    expect(faction.gold).toBeGreaterThanOrEqual(maintenance);
    expect(state.buildings.filter(building => building.kind === 'palace').map(palace => palace.governorNextPlanAt)).toEqual([60, 60]);
  });

  it.each([
    ['cancel', 'camp'], ['cancel', 'house'], ['demolish', 'camp'], ['demolish', 'house'],
  ] as const)('%s of a %s pauses only its own city and leaves the other city expanding', (action, kind) => {
    const state = realm(2, kind === 'house');
    const first = state.buildings.find(building => building.id === 1)!, second = state.buildings.find(building => building.id === 2)!;
    const site: Building = { id: 3000, kind, faction: 0, x: 28, y: 20, hp: 100, maxHp: 100, capacity: kind === 'house' ? 4 : 0,
      construction: { startedAt: 0, duration: 20, waitingForBuilder: true, paidGold: BUILD_COSTS[kind].gold } };
    entityStore(state).buildings.add(site); state.time = 29.9;
    expect(action === 'cancel' ? cancelConstruction(state, site.id).ok : demolishBuildingsInArea(state, site, site).ok).toBe(true);
    expect(first.governorPauseUntil?.[kind]).toBeCloseTo(59.9);
    expect(second.governorPauseUntil?.[kind]).toBeUndefined();
    stepTo(state, 30);
    expect(ordersByCity(state, kind)).toEqual([0, kind === 'house' ? 2 : 4]);
    stepTo(state, 60);
    expect(ordersByCity(state, kind)[0]).toBe(kind === 'house' ? 2 : 4);
  });

  it('keeps rival six-second clocks and productive-work limits independent too', () => {
    const state = realm(2, false);
    state.factions[0].id = 1; state.factions[0].relation = 'peace';
    for (const building of state.buildings) building.faction = 1;
    const first = state.buildings.find(building => building.id === 1)!, second = state.buildings.find(building => building.id === 2)!;
    first.governorNextPlanAt = 3; second.governorNextPlanAt = 7;
    expect(factionDevelopmentReserve(state, state.factions[0])).toBe(8 * BUILD_COSTS.camp.gold + 37.5);
    for (let i = 0; i < 8; i++) entityStore(state).buildings.add({ id: 2000 + i, kind: 'camp', faction: 1,
      x: 28 + i % 4, y: 40 + Math.floor(i / 4), hp: 100, maxHp: 100, capacity: 0,
      construction: { startedAt: 0, duration: 10, waitingForBuilder: true } });
    const farms: number[] = [], houses: number[] = [];
    const callbacks = { farms: (_faction: unknown, palace: Building) => { farms.push(palace.id); },
      houses: (_faction: unknown, _elapsed: number, palace: Building) => { houses.push(palace.id); },
      validate: () => ({ ok: false }), build: () => ({ ok: false }) };
    for (const time of [3, 7, 9]) { state.time = time; updateFactionDevelopment(state, callbacks); }
    expect(farms).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1]); expect(houses).toEqual([2]);
    expect(first.governorNextPlanAt).toBe(15); expect(second.governorNextPlanAt).toBe(13);
  });
});
