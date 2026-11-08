import { describe, expect, it, vi } from 'vitest';
import { villageTradeQuote } from '../src/game/village-trade-quote';
import { MERCHANT_SPEED, villageTradePayout } from '../src/game/trade';
import { entityStore } from '../src/game/entity-store';
import { markWorldChanged } from '../src/game/world-revisions';
import * as navigation from '../src/game/pathfinding';
import { type Building, type GameState } from '../src/game/types';
import { withDevelopedResources } from './helpers/developed-resources';

const city = (id: number, x: number, faction = 0): Building => ({ id, kind: 'palace', faction, x, y: 7,
  hp: 650, maxHp: 650, capacity: 20, unhousedResidents: 20 });
function fixture(): GameState {
  return {
    world: { width: 36, height: 20, seed: 'village-quote', source: 'test', revision: 0, spawns: [],
      tiles: Array.from({ length: 720 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [city(1, 3), { id: 2, kind: 'villageTent', faction: 1, villageId: 1, x: 27, y: 7,
      hp: 500, maxHp: 500, capacity: 0 }], units: [],
    factions: [0, 1].map(id => ({ id, name: id ? 'Village' : 'Rome', color: '#fff', affinity: 100,
      relation: id ? 'peace' : 'self', villageId: id ? 1 : undefined, population: 20, food: 500, gold: 1000,
      production: 0, culture: 20, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false })),
    villages: [{ id: 1, faction: 1, campId: 2, name: 'Village', identity: 'growers', requiredResource: 'copper',
      relation: 'neutral', x: 27, y: 7, nextGrowthAt: Infinity, nextRecruitAt: Infinity, nextThinkAt: 0 }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'village-quote', rngState: 9,
  };
}

describe('village trade income quotes', () => {
  it('quotes both outcomes before an agreement from the actual payout and full travel cycle', () => {
    const state = fixture(), before = JSON.stringify(state), village = state.villages![0];
    const quote = villageTradeQuote(state, village);
    expect(quote).toMatchObject({ requiredResource: 'copper', hasResource: false, routeAvailable: true, originId: 1 });
    expect(quote.distance).toBeGreaterThan(10);
    expect(quote.roundTripSeconds).toBeCloseTo(quote.distance! * 2 / MERCHANT_SPEED + 3);
    expect(quote.withoutResourceGoldPer30).toBeCloseTo(villageTradePayout(state, village, 0, quote.distance!, false) * 60 / quote.roundTripSeconds!);
    expect(quote.withResourceGoldPer30).toBeCloseTo(quote.withoutResourceGoldPer30 * 4);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('updates resource access and bonuses immediately without repeating route searches', () => {
    const state = fixture(), village = state.villages![0], search = vi.spyOn(navigation, 'findPath');
    try {
      const original = villageTradeQuote(state, village), searches = search.mock.calls.length;
      expect(searches).toBeGreaterThan(0);
      expect(villageTradeQuote(state, village)).toEqual(original);
      expect(search).toHaveBeenCalledTimes(searches);
      withDevelopedResources(state, ['copper', 'olives']);
      const supplied = villageTradeQuote(state, village);
      expect(supplied.hasResource).toBe(true);
      expect(supplied.withoutResourceGoldPer30).toBeCloseTo(original.withoutResourceGoldPer30 * 1.02);
      expect(supplied.withResourceGoldPer30).toBeCloseTo(supplied.withoutResourceGoldPer30 * 4);
      expect(search).toHaveBeenCalledTimes(searches);
    } finally { search.mockRestore(); }
  });

  it('includes existing road speed and invalidates the route estimate when roads change', () => {
    const state = fixture(), village = state.villages![0], before = villageTradeQuote(state, village);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 36; x++) entityStore(state).buildings.add({
      id: 100 + y * 36 + x, kind: 'road', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
    markWorldChanged(state.world, 'structure');
    const after = villageTradeQuote(state, village);
    expect(after.roundTripSeconds).toBeCloseTo(after.distance! * 2 / (MERCHANT_SPEED * 1.5) + 3);
    expect(after.roundTripSeconds!).toBeLessThan(before.roundTripSeconds!);
    expect(after.withoutResourceGoldPer30).toBeGreaterThan(before.withoutResourceGoldPer30);
  });

  it('uses the retained route origin until that settlement is lost', () => {
    const state = fixture(), village = state.villages![0];
    entityStore(state).buildings.add(city(3, 18));
    expect(villageTradeQuote(state, village).originId).toBe(3);
    state.tradeRoutes = [{ id: -1, faction: 0, villageId: 1, origin: 1, partner: 2, target: 2,
      distance: 0, journeys: 0, nextDepartureAt: 0 }];
    expect(villageTradeQuote(state, village).originId).toBe(1);
    state.buildings[0].hp = 0; markWorldChanged(state.world, 'structure');
    expect(villageTradeQuote(state, village).originId).toBe(3);
  });

  it('reports no route across impassable terrain and refreshes after it opens', () => {
    const state = fixture(), village = state.villages![0];
    for (let y = 0; y < 20; y++) state.world.tiles[y * 36 + 15].terrain = 'river';
    markWorldChanged(state.world, 'geometry');
    expect(villageTradeQuote(state, village)).toMatchObject({ routeAvailable: false,
      withoutResourceGoldPer30: 0, withResourceGoldPer30: 0 });
    state.world.tiles[7 * 36 + 15].overlay = 'ford'; markWorldChanged(state.world, 'geometry');
    const accessible = villageTradeQuote(state, village);
    expect(accessible.routeAvailable).toBe(true);
    expect(accessible.roundTripSeconds!).toBeGreaterThan(accessible.distance! * 2 / MERCHANT_SPEED + 3);
    village.destroyed = true;
    expect(villageTradeQuote(state, village).routeAvailable).toBe(false);
  });

  it('uses the viewing faction and does not borrow another faction’s city or resource', () => {
    const state = fixture(), village = state.villages![0];
    withDevelopedResources(state, ['copper']);
    state.factions.push({ ...state.factions[0], id: 2, relation: 'peace' });
    state.playerFaction = 2;
    expect(villageTradeQuote(state, village)).toMatchObject({ hasResource: false, routeAvailable: false });
    entityStore(state).buildings.add(city(3, 18, 2)); markWorldChanged(state.world, 'structure');
    expect(villageTradeQuote(state, village)).toMatchObject({ hasResource: false, routeAvailable: true, originId: 3 });
    expect(villageTradeQuote(state, village, 0).hasResource).toBe(true);
  });
});
