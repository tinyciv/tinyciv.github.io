import { afterEach, describe, expect, it, vi } from 'vitest';
import * as cities from '../src/game/cities';
import * as navigation from '../src/game/pathfinding';
import { entityStore } from '../src/game/entity-store';
import { domesticTradePayout, domesticTradePopulationShares, updateMerchant, updateTradeRoutes } from '../src/game/trade';
import type { Building, GameState, TradeRoute, Unit } from '../src/game/types';

const city = (id: number, x: number, population: number): Building => ({ id, kind: 'palace', faction: 0, x, y: 14,
  hp: 650, maxHp: 650, capacity: population, unhousedResidents: population, governorPermissions: { farms: false, housing: false } });
function fixture(first = 100, second = 30): GameState {
  return {
    world: { width: 100, height: 36, seed: 'domestic-trade', source: 'test', revision: 0, spawns: [],
      tiles: Array.from({ length: 3600 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) },
    buildings: [city(1, 4, first), city(2, 47, second)], units: [], fields: [],
    factions: [{ id: 0, name: 'Roma', color: '#c44', relation: 'self', affinity: 100, population: first + second,
      food: 1000, gold: 0, culture: 0, production: 0, yields: { food: 0, gold: 0, production: 0 }, defeated: false, nextRaid: Infinity }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'domestic-trade', rngState: 1,
  };
}
function caravan(state: GameState): { route: TradeRoute; merchant: Unit } {
  updateTradeRoutes(state);
  const route = state.tradeRoutes![0], merchant = state.units.find(unit => unit.id === route.merchantId)!;
  return { route, merchant };
}
const depart = (state: GameState, merchant: Unit) => updateMerchant(state, merchant, .1, () => {});
function arrive(state: GameState, route: TradeRoute, merchant: Unit): void {
  Object.assign(merchant, route.goal);
  updateMerchant(state, merchant, .1, () => {});
}
afterEach(() => vi.restoreAllMocks());

describe('population-supported domestic trade', () => {
  it('uses harmonic endpoint demand and caps the distance premium after 50 tiles', () => {
    expect(domesticTradePayout(40, 100, 30)).toBeCloseTo(40.32);
    expect(domesticTradePayout(40, 30, 100)).toBeCloseTo(40.32);
    expect(domesticTradePayout(40, 100, 30, 1.2 * 1.15 * 1.25)).toBeCloseTo(40.32 * 1.725);
    const dense = 1e9;
    expect(domesticTradePayout(100, dense, dense)).toBeCloseTo(domesticTradePayout(50, dense, dense) * 2);
    expect(domesticTradePayout(1000, dense, dense) / 1000).toBeLessThan(2.25);
    expect(domesticTradePayout(10, dense, dense) / 10).toBeLessThan(domesticTradePayout(50, dense, dense) / 50);
    expect(domesticTradePayout(100, Number.MAX_VALUE, Number.MAX_VALUE)).toBe(225);
  });

  it.each([[19, 6], [20, 6], [25, 29.5], [30, 40.32]])('matures a %i-resident endpoint symmetrically', (population, expected) => {
    expect(domesticTradePayout(40, 100, population)).toBeCloseTo(expected);
    expect(domesticTradePayout(40, population, 100)).toBeCloseTo(expected);
  });

  it('caps final young-city revenue after distance, specialty, research and village bonuses', () => {
    for (const population of [1, 19, 19.999, 20]) for (const tiles of [40, 100, 1000]) {
      const bonus = 1.25 * 1.2 * 1.15;
      expect(domesticTradePayout(tiles, 100, population, bonus)).toBeLessThanOrEqual(6);
      expect(domesticTradePayout(tiles, population, 100, bonus)).toBeLessThanOrEqual(6);
    }
    // The cap must follow every multiplier, even on an unusually long boosted route.
    expect(domesticTradePayout(1e9, 19, 1e9, 1e6)).toBe(6);
    expect(domesticTradePayout(40, 100, 30, 1.25 * 1.2 * 1.15)).toBeCloseTo(40.32 * 1.25 * 1.2 * 1.15);
  });

  it.each(['origin', 'partner'] as const)('delivers at most six gold with a young %s despite every ordinary trade bonus', endpoint => {
    const state = fixture(endpoint === 'origin' ? 19 : 100, endpoint === 'partner' ? 19 : 100);
    state.factions[0].research = { focus: 'coinage', levels: { coinage: 1 }, progress: {} };
    state.factions[0].villageBonuses = { food: 0, trade: .15, construction: 0, research: 0 };
    for (const [index, resource] of (['clay', 'iron', 'stone', 'salt', 'fish'] as const).entries())
      for (let y = 11; y <= 13; y++) state.world.tiles[y * state.world.width + 3 + index].resource = resource;
    const { route, merchant } = caravan(state); depart(state, merchant);
    expect(route.legValue!.gold).toBe(6);
    arrive(state, route, merchant);
    expect(state.factions[0].gold).toBe(6);
    expect(state.factions[0].incomeTotals?.gold).toBe(6);
    expect(state.particles.at(-1)?.text).toBe('+6 gold');
  });

  it('bases maturity on actual residents before a mature hub shares demand among its routes', () => {
    const state = fixture(30, 100);
    entityStore(state).buildings.add(city(3, 80, 30)); state.factions[0].population += 30;
    updateTradeRoutes(state);
    const route = state.tradeRoutes!.find(candidate => candidate.origin === 1)!;
    const merchant = state.units.find(unit => unit.id === route.merchantId)!;
    depart(state, merchant);
    expect(route.legValue).toMatchObject({ originShare: 15, partnerShare: 30 });
    const quote = route.legValue!;
    // Shared harmonic demand is 20, so the mature population factor is 20/70.
    expect(quote.gold).toBeCloseTo(quote.distance * 2.25 * 20 / 70);
    expect(quote.gold).toBeGreaterThan(6);
  });

  it('does not create revenue from empty cities or invalid values', () => {
    for (const [d, a, b] of [[40, 0, 100], [40, 100, 0], [0, 10, 10], [-1, 10, 10], [Infinity, 10, 10], [40, NaN, 10], [40, 10, Infinity]])
      expect(domesticTradePayout(d, a, b)).toBe(0);
    const state = fixture(100, 0), { route, merchant } = caravan(state);
    depart(state, merchant); expect(route.legValue!.gold).toBe(0);
    arrive(state, route, merchant);
    expect(state.factions[0].gold).toBe(0); expect(route.journeys).toBe(1);
  });

  it('uses actual city residents, not beds or the faction total at both endpoints', () => {
    const state = fixture();
    for (const palace of state.buildings) { palace.unhousedResidents = 0; palace.capacity = 500; }
    entityStore(state).buildings.add(
      { id: 3, kind: 'house', faction: 0, x: 4, y: 11, hp: 100, maxHp: 100, capacity: 200, residents: 100 },
      { id: 4, kind: 'house', faction: 0, x: 47, y: 11, hp: 100, maxHp: 100, capacity: 200, residents: 30 });
    const { route, merchant } = caravan(state); depart(state, merchant);
    expect(route.legValue).toMatchObject({ originShare: 100, partnerShare: 30 });
    expect(route.legValue!.gold).toBeCloseTo(domesticTradePayout(route.legValue!.distance, 100, 30));
  });

  it('shares a hub among all incident routes without charging capacity to empty connections', () => {
    const state = fixture();
    entityStore(state).buildings.add(city(3, 80, 20)); state.factions[0].population += 20;
    updateTradeRoutes(state);
    expect(state.tradeRoutes!.map(route => [route.origin, route.partner])).toEqual([[1, 3], [2, 1]]);
    const shares = domesticTradePopulationShares(state);
    expect([...shares]).toEqual([[1, 50], [2, 30], [3, 20]]);
    const harmonicSum = state.tradeRoutes!.reduce((sum, route) => sum + 2 / (1 / shares.get(route.origin)! + 1 / shares.get(route.partner)!), 0);
    expect(harmonicSum).toBeLessThanOrEqual(state.factions[0].population / 2);
    state.buildings[2].unhousedResidents = 0; state.factions[0].population -= 20;
    expect([...domesticTradePopulationShares(state)]).toEqual([[1, 100], [2, 30], [3, 0]]);
  });

  it('releases population capacity when a caravan dies and restores it on replacement', () => {
    const state = fixture(); entityStore(state).buildings.add(city(3, 80, 20)); state.factions[0].population += 20;
    updateTradeRoutes(state);
    const route = state.tradeRoutes!.find(candidate => candidate.partner === 3)!;
    expect(domesticTradePopulationShares(state).get(1)).toBe(50);
    state.units.find(unit => unit.id === route.merchantId)!.hp = 0;
    expect(domesticTradePopulationShares(state).get(1)).toBe(100);
    state.time = 5; updateTradeRoutes(state);
    state.time = route.nextDepartureAt; updateTradeRoutes(state);
    expect(domesticTradePopulationShares(state).get(1)).toBe(50);
  });

  it('reuses one resident scan per pass and refreshes when the next pass or population changes', () => {
    const state = fixture(); caravan(state);
    const scan = vi.spyOn(cities, 'cityResidents');
    const first = domesticTradePopulationShares(state);
    expect(domesticTradePopulationShares(state)).toBe(first); expect(scan).toHaveBeenCalledTimes(1);
    state.time += .1;
    expect(domesticTradePopulationShares(state)).not.toBe(first); expect(scan).toHaveBeenCalledTimes(2);
    state.factions[0].population += 1; state.buildings[1].unhousedResidents!++;
    expect(domesticTradePopulationShares(state).get(2)).toBe(31); expect(scan).toHaveBeenCalledTimes(3);
  });

  it('keeps the departure population and route quote fixed until delivery, then refreshes on return', () => {
    const state = fixture(), { route, merchant } = caravan(state); depart(state, merchant);
    const first = { ...route.legValue! };
    expect(first.distance).toBe(40); expect(first.gold).toBeCloseTo(40.32);
    state.buildings[1].unhousedResidents = 60; state.factions[0].population = 160;
    route.distance = 500;
    arrive(state, route, merchant);
    expect(state.factions[0].gold).toBeCloseTo(first.gold);
    expect(route.legValue).toBeUndefined();
    const arrival = { x: merchant.x, y: merchant.y };
    state.time = 1.4; depart(state, merchant);
    expect(route.legValue).toBeUndefined(); expect(merchant).toMatchObject(arrival);
    state.time = 1.5; depart(state, merchant);
    expect(route.legValue).toMatchObject({ originShare: 100, partnerShare: 60, distance: 40 });
    const second = route.legValue!.gold;
    arrive(state, route, merchant);
    expect(route.journeys).toBe(2); expect(state.factions[0].gold).toBeCloseTo(first.gold + second);
  });

  it('does not repeat quote pathfinding or population scans while a leg is in progress', () => {
    const state = fixture(), { route, merchant } = caravan(state);
    const population = vi.spyOn(cities, 'cityResidents'), path = vi.spyOn(navigation, 'findPath');
    depart(state, merchant);
    const quote = route.legValue, searches = path.mock.calls.length;
    expect(searches).toBeGreaterThan(0); expect(population).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i++) { state.time += .1; depart(state, merchant); }
    expect(route.legValue).toBe(quote);
    expect(path).toHaveBeenCalledTimes(searches); expect(population).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['origin', 'captured'], ['origin', 'destroyed'], ['partner', 'captured'], ['partner', 'destroyed'],
  ] as const)('cancels the quote immediately when the %s is %s, before the planner runs', (endpoint, event) => {
    const state = fixture(), { route, merchant } = caravan(state); depart(state, merchant);
    expect(route.legValue!.gold).toBeGreaterThan(0);
    const city = state.buildings.find(building => building.id === route[endpoint])!;
    if (event === 'captured') city.faction = 1;
    else city.hp = 0;
    arrive(state, route, merchant);
    expect(state.factions[0].gold).toBe(0); expect(route.journeys).toBe(0);
    expect(route.legValue).toBeUndefined(); expect(merchant.moving).toBe(false);
  });

  it('a killed caravan cannot redeem its quote and its replacement starts a fresh leg', () => {
    const state = fixture(), { route, merchant } = caravan(state); depart(state, merchant);
    merchant.hp = 0; arrive(state, route, merchant);
    expect(state.factions[0].gold).toBe(0); expect(route.journeys).toBe(0);
    state.time = 5; updateTradeRoutes(state);
    expect(route.legValue).toBeUndefined(); expect(route.nextDepartureAt).toBe(245);
    state.time = 245; updateTradeRoutes(state);
    const replacement = state.units.find(unit => unit.id === route.merchantId)!;
    expect(replacement.id).not.toBe(merchant.id); expect(route.legValue).toBeUndefined();
    depart(state, replacement);
    expect(route.legValue).toMatchObject({ distance: 40, originShare: 100, partnerShare: 30 });
    expect(route.legValue!.gold).toBeCloseTo(40.32);
  });

  it('retains sub-gold deliveries rather than rounding each one away', () => {
    const state = fixture(1, 1);
    state.buildings[1].x = 15;
    const { route, merchant } = caravan(state);
    let earned = 0;
    for (let i = 0; i < 6; i++) {
      depart(state, merchant);
      const quoted = route.legValue!.gold;
      expect(quoted).toBeGreaterThan(0); expect(quoted).toBeLessThan(1);
      earned += quoted; arrive(state, route, merchant); state.time += 1.5;
    }
    expect(state.factions[0].gold).toBeCloseTo(earned, 12);
    expect(state.factions[0].gold).not.toBe(Math.round(earned));
    expect(state.particles.every(particle => particle.text !== '+0 gold')).toBe(true);
  });
});
