import { synchronizeFarms } from '../src/game/farms';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { moveUnit, updateGame } from '../src/game/simulation';
import { constructionEdges } from '../src/game/builders';
import { canMove, invalidateNavigation } from '../src/game/pathfinding';
import { domesticTradePayout, MERCHANT_REPLACEMENT_SECONDS, recordMerchantRoad, tradePayout, updateMerchant, updateTradeRoutes } from '../src/game/trade';
import { distance, type Building, type GameState, type Unit } from '../src/game/types';

const city = (id: number, x: number, y = 10, faction = 0): Building => ({ id, kind: 'palace', x, y, faction,
  hp: 650, maxHp: 650, capacity: 0, cityName: `City ${id}`, governorPermissions: { farms: false, housing: false } });
const person = (id: number, kind: Unit['kind'], faction: number, x: number, y: number): Unit => ({ id, kind, faction, x, y,
  hp: 100, maxHp: 100, morale: 100, attack: kind === 'merchant' ? 0 : 17, defense: 0, speed: 3, range: 1.1,
  order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  return {
    world: { width: 72, height: 28, seed: 'trade', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 72 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [city(1, 6), city(2, 34)], units: [],
    factions: [{ id: 0, name: 'Trade realm', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 0,
      production: 0, population: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'trade', rngState: 1,
    marauderPacks: [], raiderCamps: [], fields: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
}
function oneMerchant(state: GameState): Unit {
  updateTradeRoutes(state);
  expect(state.tradeRoutes).toHaveLength(1);
  expect(state.units).toHaveLength(1);
  return state.units[0];
}
function populate(state: GameState): void {
  for (const city of state.buildings.filter(building => building.kind === 'palace' && building.faction === 0)) {
    city.capacity = 100; city.unhousedResidents = 100;
  }
  state.factions[0].population = 100 * state.buildings.filter(building => building.kind === 'palace' && building.faction === 0).length;
}
function walk(state: GameState, merchant: Unit, seconds: number, roads = false): void {
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    state.time += .1;
    const from = { x: merchant.x, y: merchant.y };
    updateMerchant(state, merchant, .1, moveUnit);
    expect(canMove(state, from, merchant, merchant.faction)).toBe(true);
    if (roads) recordMerchantRoad(state, merchant, from);
  }
}

describe('city trade route planning', () => {
  it('includes regional specialties in the actual delivered gold', () => {
    const state = fixture(); populate(state);
    for (let y = 8; y <= 10; y++) state.world.tiles[y * state.world.width + 5].resource = 'clay';
    const merchant = oneMerchant(state), route = state.tradeRoutes![0];
    updateMerchant(state, merchant, .1, () => {});
    const planned = route.legValue!.distance;
    Object.assign(merchant, route.goal);
    updateMerchant(state, merchant, .1, () => {});
    expect(state.factions[0].gold).toBeCloseTo(domesticTradePayout(planned, 100, 100, 1.05));
    expect(route.journeys).toBe(1);
    expect(state.factions[0].incomeTotals?.gold).toBe(state.factions[0].gold);
  });
  it('dispatches a merchant through city entrances occupied by civilians', () => {
    const state = fixture();
    entityStore(state).units.replace(constructionEdges(state, state.buildings[0]).map((edge, index) =>
      person(100 + index, index % 2 ? 'merchant' : 'worker', 0, edge.x, edge.y)));
    const residents = [...state.units];
    expect(residents.length).toBeGreaterThan(0);
    updateTradeRoutes(state);
    const merchant = state.units.find(unit => unit.tradeRoute !== undefined);
    expect(merchant).toBeDefined();
    expect(residents.some(unit => distance(unit, merchant!) < .01)).toBe(true);
    expect(state.tradeRoutes).toHaveLength(1);
  });

  it('keeps farthest friendly partners while sharing one caravan for reciprocal city choices', () => {
    const state = fixture(); entityStore(state).buildings.add(city(3, 60), { ...city(4, 22), construction: { startedAt: 0, duration: 90 } }, city(5, 50, 20, 1));
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
    updateTradeRoutes(state);
    expect(state.tradeRoutes?.map(route => [route.origin, route.partner])).toEqual([[1, 3], [2, 1]]);
    expect(state.units.filter(unit => unit.kind === 'merchant')).toHaveLength(2);
    expect(state.units.every(unit => unit.attack === 0 && unit.tradeRoute !== undefined)).toBe(true);
    for (let i = 0; i < 120; i++) { state.time += .1; updateTradeRoutes(state); }
    expect(state.units).toHaveLength(2); expect(state.tradeRoutes).toHaveLength(2);
    const resumed = structuredClone(state);
    updateTradeRoutes(resumed);
    expect(resumed.units).toHaveLength(2); expect(resumed.tradeRoutes).toHaveLength(2);
  });

  it('retires a duplicate reverse route without paying a kill bounty or replacing the survivor', () => {
    const state = fixture(), first = oneMerchant(state), route = state.tradeRoutes![0];
    const reverse = { ...first, id: first.id + 1, tradeRoute: 2, x: 33.5 };
    entityStore(state).units.add(reverse);
    state.tradeRoutes!.push({ ...route, id: 2, origin: 2, partner: 1, target: 1, merchantId: reverse.id });
    state.time = 5; updateTradeRoutes(state);
    expect(state.tradeRoutes).toEqual([route]);
    expect(route.merchantId).toBe(first.id);
    expect(first.hp).toBeGreaterThan(0); expect(reverse.hp).toBe(0);
    expect(state.factions[0].gold).toBe(0);
    state.time = 80; updateTradeRoutes(state);
    expect(state.tradeRoutes).toHaveLength(1);
    expect(state.units.filter(unit => unit.hp > 0)).toEqual([first]);
  });

  it.each([1, 3])('keeps one unordered pair after city %i is lost and surviving routes are replanned', lostCity => {
    const state = fixture(); entityStore(state).buildings.add(city(3, 60)); updateTradeRoutes(state);
    expect(state.tradeRoutes).toHaveLength(2);
    state.buildings.find(building => building.id === lostCity)!.hp = 0;
    updateTradeRoutes(state);
    const survivors = [1, 2, 3].filter(id => id !== lostCity);
    expect(state.tradeRoutes).toHaveLength(1);
    const route = state.tradeRoutes![0];
    expect([route.origin, route.partner].sort()).toEqual(survivors);
    expect(state.units.filter(unit => unit.hp > 0 && unit.kind === 'merchant')).toHaveLength(1);
    const survivorId = route.merchantId;
    for (let time = 5; time <= 80; time += 5) { state.time = time; updateTradeRoutes(state); }
    expect(state.tradeRoutes).toHaveLength(1); expect(route.merchantId).toBe(survivorId);
    expect(state.units.filter(unit => unit.hp > 0 && unit.kind === 'merchant')).toHaveLength(1);
    expect(state.factions[0].gold).toBe(0);
  });

  it('waits when a city is alone, unfinished, enclosed, or across unbridged water', () => {
    const state = fixture(); entityStore(state).buildings.replace(state.buildings.slice(0, -1)); updateTradeRoutes(state);
    expect(state.tradeRoutes).toHaveLength(0);
    entityStore(state).buildings.add({ ...city(2, 34), construction: { startedAt: 0, duration: 90 } }); updateTradeRoutes(state);
    expect(state.units).toHaveLength(0);
    state.buildings[1].construction = undefined;
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 22].terrain = 'river';
    state.world.revision!++; state.time += 5; updateTradeRoutes(state);
    expect(state.units).toHaveLength(0);
    entityStore(state).buildings.add({ id: 3, kind: 'bridge', faction: 0, x: 22, y: 10, hp: 100, maxHp: 100, capacity: 0 });
    state.time += 5; updateTradeRoutes(state);
    expect(state.units).toHaveLength(1);
  });

  it('replaces a killed trader only after four minutes, without creating a reverse caravan', () => {
    const state = fixture(); updateTradeRoutes(state);
    const first = state.units[0]; first.hp = 0; state.time = 5; updateTradeRoutes(state);
    const route = state.tradeRoutes!.find(route => route.origin === 1)!;
    expect(MERCHANT_REPLACEMENT_SECONDS).toBe(240);
    expect(route.merchantId).toBeUndefined(); expect(route.nextDepartureAt).toBe(5 + MERCHANT_REPLACEMENT_SECONDS);
    for (let time = 10; time < 245; time += 5) {
      state.time = time; updateTradeRoutes(state);
      expect(state.units.filter(unit => unit.hp > 0)).toHaveLength(0);
      expect(route.nextDepartureAt).toBe(245);
      expect(state.tradeRoutes).toHaveLength(1);
    }
    state.time = 245; updateTradeRoutes(state);
    expect(state.units.filter(unit => unit.hp > 0)).toHaveLength(1);
    expect(route.merchantId).not.toBe(first.id);
    expect(state.tradeRoutes).toHaveLength(1);
    expect(state.tradeCooldowns).toEqual({});
    state.time = 500; updateTradeRoutes(state);
    expect(state.units.filter(unit => unit.hp > 0)).toHaveLength(1);
    expect(state.tradeRoutes).toHaveLength(1);
  });

  it('retains the casualty delay when a city pair disappears, returns reversed, and is saved', () => {
    let state = fixture(); const first = oneMerchant(state);
    first.hp = 0; state.time = 10;
    state.buildings[1].faction = 1;
    updateTradeRoutes(state);
    expect(state.tradeRoutes).toHaveLength(0);
    expect(state.tradeCooldowns).toEqual({ '1:2': 250 });
    // The next owner receives the same physical route in the opposite direction.
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
    state.buildings[0].faction = 1;
    entityStore(state).buildings.replace([...state.buildings].reverse()); entityStore(state).units.replace([]); state.time = 20;
    updateTradeRoutes(state);
    expect(state.tradeRoutes).toHaveLength(1);
    expect(state.tradeRoutes![0]).toMatchObject({ origin: 2, partner: 1, faction: 1, nextDepartureAt: 250 });
    expect(state.units).toHaveLength(0);
    state = structuredClone(state);
    state.time = 245; updateTradeRoutes(state);
    expect(state.units).toHaveLength(0);
    state.time = 250; updateTradeRoutes(state);
    expect(state.units).toHaveLength(1);
    expect(state.units[0]).toMatchObject({ kind: 'merchant', faction: 1, bornAt: 250 });
    expect(state.tradeCooldowns).toEqual({});
  });

  it('expires casualty deadlines even when the city pair never returns', () => {
    const state = fixture(); const first = oneMerchant(state);
    first.hp = 0; state.buildings[1].hp = 0; state.time = 5;
    updateTradeRoutes(state);
    expect(state.tradeCooldowns).toEqual({ '1:2': 245 });
    state.time = 245; updateTradeRoutes(state);
    expect(state.tradeCooldowns).toEqual({});
    expect(state.tradeRoutes).toHaveLength(0);
  });

  it('closes routes after a city falls and never pays for retiring its merchants', () => {
    const state = fixture(); updateTradeRoutes(state);
    state.buildings[1].hp = 0; updateTradeRoutes(state);
    expect(state.tradeRoutes).toHaveLength(0);
    expect(state.units.every(unit => unit.hp === 0)).toBe(true);
    expect(state.factions[0].gold).toBe(0);
    expect(state.tradeCooldowns).toBeUndefined();
  });
});

describe('physical trading journeys', () => {
  it('retains the original distance payout for village agreements', () => {
    expect(tradePayout(20)).toBe(24); expect(tradePayout(100)).toBe(200);
    expect(tradePayout(50)).toBe(75); expect(tradePayout(10)).toBe(11);
    expect(tradePayout(20) / 20).toBeGreaterThan(tradePayout(10) / 10);
    expect(tradePayout(0)).toBe(0); expect(tradePayout(NaN)).toBe(0);
  });

  it('earns only after reaching a city, then walks back and earns again', () => {
    const state = fixture(); populate(state);
    const merchant = oneMerchant(state), route = state.tradeRoutes![0];
    walk(state, merchant, 1);
    const quoted = route.legValue!.gold;
    expect(state.factions[0].gold).toBe(0); expect(route.distance).toBeGreaterThan(0);
    let first = 0;
    while (route.journeys < 1 && state.time < 60) {
      state.time += .1; updateMerchant(state, merchant, .1, moveUnit);
      first = state.factions[0].gold;
    }
    expect(route.journeys).toBe(1); expect(first).toBeCloseTo(quoted); expect(first).toBeGreaterThan(0); expect(route.target).toBe(route.origin);
    const arrival = { x: merchant.x, y: merchant.y };
    walk(state, merchant, 1);
    expect(distance(arrival, merchant)).toBe(0); expect(state.factions[0].gold).toBe(first);
    walk(state, merchant, 30);
    expect(route.journeys).toBeGreaterThanOrEqual(2); expect(state.factions[0].gold).toBeGreaterThan(first);
  });

  it('quotes the planned winding passage instead of straight-line distance', () => {
    const state = fixture(); populate(state);
    for (let y = 0; y < 25; y++) state.world.tiles[y * state.world.width + 22].terrain = 'river';
    state.world.revision!++;
    const merchant = oneMerchant(state), route = state.tradeRoutes![0];
    const straight = distance(merchant, state.buildings[1]);
    updateMerchant(state, merchant, .1, () => {});
    const quote = route.legValue!;
    let traveled = 0;
    while (route.journeys === 0 && state.time < 80) {
      state.time += .1; const before = { x: merchant.x, y: merchant.y };
      updateMerchant(state, merchant, .1, moveUnit); traveled += distance(before, merchant);
      expect(canMove(state, before, merchant, 0)).toBe(true);
    }
    expect(route.journeys).toBe(1); expect(traveled).toBeGreaterThan(straight + 8);
    expect(quote.distance).toBeGreaterThan(straight + 8);
    expect(state.factions[0].gold).toBeCloseTo(domesticTradePayout(quote.distance, 100, 100));
  });

  it('waits without income or teleporting when a crossing closes during the trip', () => {
    const state = fixture(), merchant = oneMerchant(state);
    walk(state, merchant, 1);
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 22].terrain = 'river';
    state.world.revision!++; invalidateNavigation(state);
    walk(state, merchant, 30);
    expect(merchant.x).toBeLessThan(22); expect(state.factions[0].gold).toBe(0);
    expect(state.tradeRoutes![0].journeys).toBe(0);
  });
});

describe('merchant roads', () => {
  it('lays actual visited cells outside borders without requiring an existing road', () => {
    const state = fixture(), merchant = oneMerchant(state);
    Object.assign(merchant, { x: 22.5, y: 10.5 });
    expect(recordMerchantRoad(state, merchant)).toBe(true);
    expect(state.buildings.find(building => building.kind === 'road')).toMatchObject({ x: 22, y: 10, faction: 0 });
    expect(recordMerchantRoad(state, merchant)).toBe(false);
    merchant.x++; expect(recordMerchantRoad(state, merchant)).toBe(true);
    expect(state.factions[0].gold).toBe(0);
  });

  it('paves stairs but never a river, bridge, occupied building, or a solid reserved footprint', () => {
    const state = fixture(), merchant = oneMerchant(state);
    state.world.tiles[8 * 72 + 20].terrain = 'river';
    state.world.tiles[8 * 72 + 22].stair = 'east'; state.world.tiles[8 * 72 + 22].ridge = 1;
    entityStore(state).buildings.add({ ...city(4, 24, 8), kind: 'camp' }, { ...city(5, 28, 8), kind: 'house', construction: { startedAt: 0, duration: 20 } },
      { ...city(6, 32, 8), kind: 'bridge' });
    for (const [x, y] of [[20, 8], [28, 8], [32, 8], [6, 10]]) {
      merchant.x = x + .5; merchant.y = y + .5;
      expect(recordMerchantRoad(state, merchant)).toBe(false);
    }
    expect(state.buildings.filter(building => building.kind === 'road')).toHaveLength(0);
    merchant.x = 22.5; merchant.y = 8.5;
    expect(recordMerchantRoad(state, merchant)).toBe(true);
    expect(state.buildings.filter(building => building.kind === 'road')).toMatchObject([{ x: 22, y: 8 }]);
  });

  it('relocates walked farm cells for free while preserving crops and irrigation', () => {
    const state = fixture(), merchant = oneMerchant(state), farm = { ...city(4, 24, 8), kind: 'camp' as const };
    const ditch = { ...city(5, 24, 8), kind: 'irrigation' as const };
    entityStore(state).buildings.add(farm, ditch); synchronizeFarms(state);
    const field = state.fields![0]; field.food = .8; field.foodBatches = [{ amount: .8, expiresAt: 25 }];
    const deadline = field.nextHarvest;
    Object.assign(merchant, { x: 24.5, y: 8.5 });
    expect(recordMerchantRoad(state, merchant)).toBe(true);
    expect({ x: farm.x, y: farm.y }).not.toEqual({ x: 24, y: 8 });
    expect(state.world.tiles[8 * 72 + 24].farm).toBeUndefined();
    expect(state.fields![0]).toMatchObject({ x: farm.x, y: farm.y, food: .8, nextHarvest: deadline });
    expect(state.buildings).toContain(farm); expect(state.buildings).toContain(ditch);
    expect(state.buildings.filter(b => b.kind === 'road')).toMatchObject([{ x: 24, y: 8 }]);
    expect(state.factions[0].gold).toBe(0);
  });

  it('leaves a farm intact when a new caravan road has nowhere to relocate it', () => {
    const state = fixture(), merchant = oneMerchant(state), farm = { ...city(4, 24, 8), kind: 'camp' as const };
    entityStore(state).buildings.add(farm); synchronizeFarms(state);
    for (const tile of state.world.tiles) tile.terrain = 'ocean';
    state.world.tiles[8 * 72 + 24].terrain = 'grassland';
    Object.assign(merchant, { x: 24.5, y: 8.5 }); invalidateNavigation(state);
    expect(recordMerchantRoad(state, merchant)).toBe(false);
    expect(farm).toMatchObject({ x: 24, y: 8 });
    expect(state.buildings.filter(b => b.kind === 'road')).toHaveLength(0);
  });

  it('keeps another faction’s farm and ownership when a caravan clears its route', () => {
    const state = fixture(), merchant = oneMerchant(state);
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
    const foreignCity = city(4, 50, 10, 1), farm = { ...city(5, 48, 8, 1), kind: 'camp' as const };
    entityStore(state).buildings.add(foreignCity, farm); synchronizeFarms(state);
    Object.assign(merchant, { x: 48.5, y: 8.5 });
    expect(recordMerchantRoad(state, merchant)).toBe(true);
    expect({ x: farm.x, y: farm.y }).not.toEqual({ x: 48, y: 8 });
    expect(farm.faction).toBe(1);
    expect(state.fields!.find(field => field.camp === farm.id)?.faction).toBe(1);
  });
});

describe('merchants in the live simulation', () => {
  function liveFixture(): GameState {
    const state = fixture();
    entityStore(state).units.add(person(100, 'leader', 0, 4.5, 3.5));
    state.factions[0].nextRetinueAt = Infinity;
    state.wildlife = { herds: [], nextRespawnAt: Infinity, sequence: 0, targetHerds: 0 };
    return state;
  }

  it('moves an existing caravan at half speed while retaining the normal road bonus', () => {
    const state = liveFixture(); updateTradeRoutes(state);
    const merchant = state.units.find(unit => unit.kind === 'merchant')!;
    merchant.speed = 2.6;
    let from = { x: merchant.x, y: merchant.y };
    updateGame(state, .1, idle);
    expect(merchant.speed).toBe(1.3);
    expect(distance(from, merchant)).toBeCloseTo(.13, 6);
    from = { x: merchant.x, y: merchant.y };
    updateGame(state, .1, idle);
    expect(distance(from, merchant)).toBeCloseTo(.195, 6);
    expect(state.factions[0].gold).toBe(0);
  });

  it.each(['ford', 'gate'] as const)('takes the single caravan both ways through a one-lane %s', passage => {
    const state = liveFixture();
    if (passage === 'ford') {
      for (let y = 0; y < state.world.height; y++) for (let x = 20; x <= 22; x++) {
        const tile = state.world.tiles[y * state.world.width + x]; tile.terrain = 'river';
        if (y === 12) { tile.overlay = 'ford'; tile.fordAxis = 'horizontal'; }
      }
    } else {
      for (let y = 0; y < state.world.height; y++) entityStore(state).buildings.add({ id: 200 + y, kind: 'wall', faction: 0,
        x: 20, y, hp: 225, maxHp: 225, capacity: 0 });
      entityStore(state).buildings.add({ id: 250, kind: 'road', faction: 0, x: 20, y: 12, hp: 100, maxHp: 100, capacity: 0 });
      // Keep the wall sections owned even outside the cities' eight-tile support.
      for (let y = 1; y < state.world.height; y += 6) entityStore(state).buildings.add({ id: 300 + y, kind: 'monument', faction: 0,
        x: 18, y, hp: 250, maxHp: 250, capacity: 0 });
    }
    state.world.revision!++;
    for (let i = 0; i < 1500; i++) updateGame(state, .1, idle);
    const routes = state.tradeRoutes!;
    expect(state.gameOver).toBe(false);
    expect(routes).toHaveLength(1);
    expect(routes[0].journeys).toBeGreaterThanOrEqual(2);
    expect(state.units.filter(unit => unit.kind === 'merchant')).toHaveLength(1);
    expect(state.buildings.filter(building => building.kind === 'road' && building.x > 12 && building.x < 28).length).toBeGreaterThan(8);
    if (passage === 'ford') expect(state.buildings.some(building => building.kind === 'road' && building.x >= 20 && building.x <= 22)).toBe(false);
  });

  it.each([0, 1])('pays exactly 200 gold to faction %i when its soldier kills a merchant', killerFaction => {
    const state = liveFixture(); entityStore(state).buildings.replace([city(1, 6), city(2, 40, 10, 1)]);
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war', nextRaid: Infinity });
    // Keep the bounty target in contact; free merchants now flee before a hit.
    const merchant = { ...person(110, 'merchant', 1 - killerFaction, 22.5, 13.5), hp: 1, maxHp: 70, speed: 0 };
    const attacker = { ...person(111, 'warrior', killerFaction, 21.5, 13.5), speed: 0 };
    entityStore(state).units.add(merchant, attacker);
    const populations = state.factions.map(faction => faction.population);
    updateGame(state, .1, idle);
    expect(merchant.hp).toBeLessThanOrEqual(0);
    expect(state.factions[killerFaction].gold).toBe(200);
    expect(state.factions[1 - killerFaction].gold).toBe(0);
    expect(state.factions.map(faction => faction.population)).toEqual(populations);
    updateGame(state, .1, idle);
    expect(state.factions[killerFaction].gold).toBe(200);
  });
});
