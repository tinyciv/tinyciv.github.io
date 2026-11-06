import { describe, expect, it } from 'vitest';
import { citySummaries } from '../src/game/cities';
import { ECONOMY_INTERVAL } from '../src/game/economy-constants';
import { entityStore } from '../src/game/entity-store';
import { factionBuildingMaintenance, TAX_INCOME_MULTIPLIER } from '../src/game/maintenance';
import { goldFlowSummary } from '../src/game/gold-ledger';
import { movementMultiplier } from '../src/game/pathfinding';
import { updateRaiderMotivation } from '../src/game/raider-motivations';
import { moveUnit, updateGame } from '../src/game/simulation';
import { domesticTradePayout, MERCHANT_SPEED, updateMerchant, updateTradeRoutes } from '../src/game/trade';
import type { Building, GameState, MarauderPack, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const building = (id: number, kind: Building['kind'], x: number, y = 10): Building => ({
  id, kind, x, y, faction: 0, hp: 650, maxHp: 650, capacity: kind === 'palace' ? 4 : 0,
});
const person = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, x, y, faction, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 0,
  speed: 0, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
function fixture(populations = [10]): GameState {
  return {
    world: { width: 100, height: 28, seed: 'maintenance-integration', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 100 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: populations.map((population, index) => ({ ...building(index + 1, 'palace', 8 + index * 20),
      unhousedResidents: population, populationGrowth: -10000, governorPermissions: { farms: false, housing: false } })),
    units: [person(10000, 'leader', 3.5, 24.5)], fields: [],
    factions: [{ id: 0, name: 'Roma', color: '#f00', affinity: 100, relation: 'self', food: 10000, gold: 1000,
      production: 0, population: populations.reduce((sum, count) => sum + count, 0), yields: { food: 0, production: 0, gold: 0 },
      nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'maintenance-integration', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 },
  };
}
/** Exercise the real economy boundary without spending minutes moving units.
 * Merchant deliveries, births, governors and raids are excluded in this fixture. */
function nextEconomyTick(state: GameState): void {
  state.time = (state.tick + 1) * ECONOMY_INTERVAL - .1;
  updateGame(state, .1, idle);
}

describe('maintenance through the live economy', () => {
  it('bills each extra city and completed tower once, with one capital exemption and no population surcharge', () => {
    const state = fixture([10, 10, 10]); state.factions[0].gold = 25;
    entityStore(state).buildings.add(building(10, 'woodenTower', 13), building(11, 'tower', 33),
      { ...building(12, 'woodenTower', 53), construction: { startedAt: 0, duration: 90, waitingForBuilder: true } },
      { ...building(13, 'tower', 54), hp: 0 });
    expect(factionBuildingMaintenance(state, state.factions[0])).toBe(85);
    nextEconomyTick(state);
    expect(state.factions[0].gold).toBe(-39);
    expect(state.factions[0].incomeTotals?.gold).toBe(21);
    expect(goldFlowSummary(state, state.factions[0])).toMatchObject({
      inputs: [{ category: 'taxes', amount: 21 }],
      totalInputs: 21, totalOutlays: 85, net: -64,
    });
    expect(goldFlowSummary(state, state.factions[0]).outlays).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'settlements', amount: 75 }),
      expect.objectContaining({ category: 'defenses', amount: 10 }),
    ]));
    expect(state.factions[0].yields.gold).toBe(-64);
    expect(citySummaries(state).map(city => city.gold)).toEqual([2, -35.5, -30.5]);
    nextEconomyTick(state);
    expect(state.factions[0].gold).toBe(-103);
    expect(state.factions[0].incomeTotals?.gold).toBe(42);
    expect(goldFlowSummary(state, state.factions[0])).toMatchObject({ totalInputs: 42, totalOutlays: 170, net: -128 });
    expect(state.factions[0].population).toBe(30);
  });

  it('keeps maintenance arrears through subsequent ticks and repays them with later tax income', () => {
    const state = fixture([10, 10]); state.factions[0].gold = 5;
    for (let i = 0; i < 3; i++) nextEconomyTick(state);
    expect(state.factions[0].gold).toBe(-65.5);
    state.buildings.find(candidate => candidate.id === 2)!.hp = 0;
    nextEconomyTick(state);
    expect(state.factions[0].gold).toBe(-51.5);
    expect(state.factions[0].yields.gold).toBe(14);
  });

  it('combines all three guard service tiers with taxes without charging the militia or the post twice', () => {
    const state = fixture([30]);
    for (const level of [0, 1, 2] as const) entityStore(state).buildings.add({ ...building(10 + level, 'guardPost', 11 + level, 12),
      guardPost: { level, funded: true, nextUpkeepAt: 30, needsRecruits: true } });
    updateGame(state, .1, idle);
    expect(state.units.filter(unit => unit.kind === 'militia')).toHaveLength(16);
    expect(state.factions[0].gold).toBe(1000);
    nextEconomyTick(state);
    expect(state.factions[0].gold).toBe(956);
    expect(goldFlowSummary(state, state.factions[0])).toMatchObject({
      totalInputs: 21, totalOutlays: 65, net: -44,
      outlays: [{ category: 'defenses', amount: 65 }],
    });
    expect(state.factions[0].yields.gold).toBe(-44);
    expect(citySummaries(state)[0].gold).toBe(-44);
    nextEconomyTick(state);
    expect(state.factions[0].gold).toBe(912);
    expect(state.units.filter(unit => unit.kind === 'militia')).toHaveLength(16);
  });

  it('does not forgive a negative treasury when a thief reaches the settlement', () => {
    const state = fixture(); state.factions[0].gold = -75;
    const thief: Unit = { ...person(200, 'warrior', 7.5, 10.5, -2), marauderPack: 50 };
    const pack: MarauderPack = { id: 50, name: 'Thieves', color: '#111', targetFaction: 0, targetBuilding: 1,
      raid: true, motivation: 'theft', phase: 'approach', home: { x: 1.5, y: 1.5 }, waypoint: { x: 9, y: 11 },
      raidGoal: { x: 7.5, y: 10.5 }, nextWanderAt: 0, startingTroops: 0, leaderId: thief.id };
    state.marauderPacks!.push(pack); entityStore(state).units.add(thief);
    expect(updateRaiderMotivation(state, thief, .1, { move() {}, attack() {}, visible: () => true })).toBe(true);
    expect(pack.raidObjectiveDone).toBe(true);
    expect(thief.stolenGold).toBe(0);
    expect(state.factions[0].gold).toBe(-75);
    expect(goldFlowSummary(state, state.factions[0]).totalOutlays).toBe(0);
  });

  it('separates gross taxes, Science and actual retinue upkeep without double billing', () => {
    const state = fixture([20]), faction = state.factions[0], before = faction.gold;
    faction.purchasedRetinueSlots = 2;
    entityStore(state).buildings.add(building(20, 'library', 12, 14));
    entityStore(state).units.add(person(200, 'warrior', 5.5, 22.5), person(201, 'archer', 6.5, 22.5));
    nextEconomyTick(state);
    const summary = goldFlowSummary(state, faction);
    expect(summary.inputs).toMatchObject([{ category: 'taxes', amount: 14 }]);
    expect(summary.outlays).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'army', amount: 11.5 }),
      expect.objectContaining({ category: 'science', amount: 3.5 }),
    ]));
    expect(summary.totalOutlays).toBe(15);
    expect(summary.net).toBe(-1);
    expect(faction.gold - before).toBe(summary.net);
  });
});

describe('domestic trade and expansion balance', () => {
  /** Existing roads give merchants 1.5× speed, with a 1.5s stop at either city.
   * This is recurring gold per economy interval, not a rounded single arrival. */
  function routeRate(state: GameState, tiles: number, a: number, b: number): number {
    const roadSpeed = MERCHANT_SPEED * movementMultiplier(state, 20.5, 10.5);
    return domesticTradePayout(tiles, a, b) * ECONOMY_INTERVAL / (tiles / roadSpeed + 1.5);
  }

  it('breaks even between 21 and 22 new residents on a 40-tile road to a 100-person capital', () => {
    const state = fixture([100, 21]); entityStore(state).buildings.add(building(50, 'road', 20));
    const fee = factionBuildingMaintenance(state, state.factions[0]);
    const lower = 21 * TAX_INCOME_MULTIPLIER + routeRate(state, 40, 100, 21) - fee;
    const upper = 22 * TAX_INCOME_MULTIPLIER + routeRate(state, 40, 100, 22) - fee;
    expect(lower).toBeCloseTo(-7.264, 2);
    expect(upper).toBeCloseTo(.403, 2);
    expect(lower).toBeLessThan(0); expect(upper).toBeGreaterThan(0);
    expect(Math.abs(lower)).toBeLessThan(8); expect(Math.abs(upper)).toBeLessThan(1);
  });

  it('bounds recurring trade output for both enormous populations and enormous distances', () => {
    const state = fixture(); entityStore(state).buildings.add(building(50, 'road', 20));
    const theoreticalLimit = 1.5 * 1.5 * MERCHANT_SPEED * 1.5 * ECONOMY_INTERVAL;
    const rates = [50, 100, 1000, 1e6].map(distance => routeRate(state, distance, 1e12, 1e12));
    for (const rate of rates) expect(rate).toBeLessThan(theoreticalLimit);
    expect(rates.at(-1)).toBeCloseTo(theoreticalLimit, 3);
    expect(rates).toEqual([...rates].sort((a, b) => a - b));
    const populationRates = [10, 100, 1000, 1e12].map(population => routeRate(state, 40, population, population));
    expect(populationRates).toEqual([...populationRates].sort((a, b) => a - b));
    expect(populationRates.at(-1)).toBeLessThan(theoreticalLimit);
  });

  it.each([21, 22])('keeps the measured road-caravan contribution near expansion break-even at %i residents', population => {
    const state = fixture([100, population]); state.buildings[1].x = 51;
    for (let x = 10; x <= 50; x++) entityStore(state).buildings.add(building(100 + x, 'road', x));
    updateTradeRoutes(state);
    const route = state.tradeRoutes![0], merchant = state.units.find(unit => unit.id === route.merchantId)!;
    const arrivals: { time: number; gold: number }[] = [];
    for (let step = 0; step < 4000 && arrivals.length < 12; step++) {
      state.time += .1;
      const before = route.journeys;
      updateMerchant(state, merchant, .1, moveUnit);
      if (route.journeys > before) arrivals.push({ time: state.time, gold: state.factions[0].gold });
    }
    expect(arrivals).toHaveLength(12);
    // Drop the initial departure: every remaining interval includes one stop
    // and one completed physical journey in the normal movement system.
    const first = arrivals[0], last = arrivals.at(-1)!;
    const measured = (last.gold - first.gold) / (last.time - first.time) * ECONOMY_INTERVAL;
    expect(measured).toBeCloseTo(routeRate(state, 40, 100, population), 0);
    const marginal = population * TAX_INCOME_MULTIPLIER + measured - factionBuildingMaintenance(state, state.factions[0]);
    expect(Math.abs(marginal)).toBeLessThan(8);
    expect(population === 21 ? marginal < 0 : marginal > 0).toBe(true);
  });

  it('credits the exact fractional planned payout against debt on arrival, independent of extra walking', () => {
    const state = fixture([100, 30]); state.buildings[1].x = 51; state.factions[0].gold = -10;
    updateTradeRoutes(state);
    const route = state.tradeRoutes![0], merchant = state.units.find(unit => unit.id === route.merchantId)!;
    updateMerchant(state, merchant, .1, () => {});
    const quote = route.legValue!;
    expect(quote.distance).toBeCloseTo(40);
    expect(quote.gold).toBeCloseTo(domesticTradePayout(40, 100, 30));
    expect(quote.gold).not.toBe(Math.round(quote.gold));
    merchant.x = route.goal!.x; merchant.y = route.goal!.y;
    route.distance = 500;
    updateMerchant(state, merchant, .1, () => {});
    expect(route.journeys).toBe(1);
    expect(state.factions[0].gold).toBeCloseTo(-10 + quote.gold, 10);
  });
});
