import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { moveUnit, updateGame } from '../src/game/simulation';
import { updateTradeRoutes, updateMerchant, MERCHANT_REPLACEMENT_SECONDS } from '../src/game/trade';
import { performVillageAction, recordVillageTrade, updateVillages, villageAllianceCost, villageDiplomacyStatus } from '../src/game/villages';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { type Building, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], faction: number, x: number, y: number): Unit => ({ id, kind, faction, x, y,
  hp: 100, maxHp: 100, morale: 100, attack: 16, defense: 2, speed: 3, range: 1.1, order: 'hold', cooldown: 0,
  lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
const palace = (id: number, x: number): Building => ({ id, kind: 'palace', faction: 0, x, y: 10, hp: 650, maxHp: 650, capacity: 0,
  governorPermissions: { farms: false, housing: false } });
function fixture(): GameState {
  return {
    world: { width: 72, height: 28, seed: 'village-trade', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 72 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [palace(1, 6), palace(2, 28), { id: 3, kind: 'villageTent', faction: 1, villageId: 1, x: 50, y: 10, hp: 500, maxHp: 500, capacity: 0 }],
    units: [person(10, 'leader', 0, 50.5, 12.5), { ...person(11, 'worker', 1, 50.5, 11.5), villageId: 1, home: 3 }],
    factions: [{ id: 0, name: 'Rome', color: '#ff0000', affinity: 100, relation: 'self', population: 0, food: 500, gold: 5000,
      production: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false },
    { id: 1, villageId: 1, name: 'Sabine Hearth', color: '#ffffff', affinity: 50, relation: 'peace', population: 1, food: 0, gold: 0,
      production: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    villages: [{ id: 1, faction: 1, campId: 3, name: 'Sabine Hearth', identity: 'growers', relation: 'neutral', x: 50, y: 10,
      nextGrowthAt: Infinity, nextRecruitAt: Infinity, nextThinkAt: 0 }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'village-trade', rngState: 9,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
  };
}
function openTrade(state: GameState) {
  expect(performVillageAction(state, state.buildings[2], 'trade').ok).toBe(true);
  const route = state.tradeRoutes!.find(r => r.villageId === 1)!;
  return { route, merchant: state.units.find(u => u.id === route.merchantId)! };
}

describe('village trade integration', () => {
  it('adds one village caravan while preserving the regular city connection', () => {
    const state = fixture(), { route, merchant } = openTrade(state);
    expect(route).toMatchObject({ origin: 2, partner: 3, villageId: 1, faction: 0 });
    expect(state.tradeRoutes).toHaveLength(2);
    expect(state.tradeRoutes!.find(r => r.villageId === undefined)).toMatchObject({ origin: 1, partner: 2 });
    for (let time = 5; time <= 60; time += 5) { state.time = time; updateTradeRoutes(state); }
    expect(state.tradeRoutes).toHaveLength(2);
    expect(state.units.filter(u => u.kind === 'merchant' && u.hp > 0)).toHaveLength(2);
    expect(route.merchantId).toBe(merchant.id);
  });

  it.each([[100, 120, 2990], [3, 3, 3000]])('triples the base %i-tile village delivery after rounding without paying for partial travel', (tiles, payout, allianceCost) => {
    const state = fixture(), { route, merchant } = openTrade(state), gold = state.factions[0].gold;
    state.time = .1; updateMerchant(state, merchant, .1, moveUnit);
    expect(route.distance).toBeGreaterThan(0); expect(state.factions[0].gold).toBe(gold);
    expect(state.factions[1].gold).toBe(0);
    expect(villageAllianceCost(state.villages![0])).toBe(3000);
    route.distance = tiles; route.goal = { x: merchant.x, y: merchant.y };
    updateMerchant(state, merchant, .1, () => {});
    expect(state.factions[0].gold - gold).toBe(payout);
    expect(state.factions[1].gold).toBe(payout);
    expect(state.villages![0].tradeGoldByFaction).toEqual({ 0: payout });
    expect(villageAllianceCost(state.villages![0])).toBe(allianceCost);
    expect(route.journeys).toBe(1); expect(route.target).toBe(route.origin);
    expect(route.distance).toBe(0);
    updateMerchant(state, merchant, .1, () => {});
    expect(state.factions[1].gold).toBe(payout);
  });

  it('discounts alliance from lifetime delivered trade, even after spending, with a 500 gold floor', () => {
    const state = fixture(), village = state.villages![0], camp = state.buildings[2]; openTrade(state);
    recordVillageTrade(state, village, 0, 10009);
    expect(villageDiplomacyStatus(state, camp)).toMatchObject({ tradedGold: 10009, allianceDiscount: 1000, ally: { cost: 2000 } });
    state.factions[1].gold = 0;
    expect(villageAllianceCost(village)).toBe(2000);
    recordVillageTrade(state, village, 0, 20000);
    expect(villageAllianceCost(village)).toBe(500);
    const restored = parseGameSave(serializeGameSave(state));
    expect(restored.villages![0].tradeGoldByFaction).toEqual({ 0: 30009 });
    expect(restored.factions[1].gold).toBe(20000);
    expect(villageAllianceCost(restored.villages![0])).toBe(500);
    restored.factions[0].gold = 499;
    expect(performVillageAction(restored, restored.buildings[2], 'ally')).toEqual({ ok: false, message: 'Need 500 gold.' });
    restored.factions[0].gold = 500;
    expect(performVillageAction(restored, restored.buildings[2], 'ally').ok).toBe(true);
    expect(restored.factions[0].gold).toBe(0);
    expect(performVillageAction(restored, restored.buildings[2], 'ally').ok).toBe(false);
  });

  it('lets rival factions fund a village through a separate caravan without discounting the player’s alliance', () => {
    const state = fixture();
    state.factions.push({ ...state.factions[0], id: 2, name: 'Rival', relation: 'peace', population: 20, gold: 2000 });
    entityStore(state).buildings.add({ ...palace(4, 60), faction: 2 });
    const { route: playerRoute, merchant: playerMerchant } = openTrade(state);
    expect(state.tradeRoutes!.filter(route => route.villageId === 1)).toHaveLength(1);
    state.time = 90; updateTradeRoutes(state);
    const rivalRoute = state.tradeRoutes!.find(route => route.villageId === 1 && route.faction === 2)!;
    expect(rivalRoute).toBeDefined(); expect(rivalRoute.id).not.toBe(playerRoute.id);
    expect(state.factions[2].gold).toBe(1750);
    const rivalMerchant = state.units.find(unit => unit.id === rivalRoute.merchantId)!;
    rivalRoute.distance = 100; rivalRoute.goal = { x: rivalMerchant.x, y: rivalMerchant.y };
    updateMerchant(state, rivalMerchant, .1, () => {});
    expect(state.factions[2].gold).toBe(1870); expect(state.factions[1].gold).toBe(120);
    expect(state.villages![0].tradeGoldByFaction).toEqual({ 2: 120 });
    expect(villageAllianceCost(state.villages![0])).toBe(3000);
    for (let time = 95; time < 200; time += 5) { state.time = time; updateTradeRoutes(state); }
    expect(state.tradeRoutes!.filter(route => route.villageId === 1)).toHaveLength(2);
    expect(state.factions[2].gold).toBe(1870);
    // Player war does not end an independent village's other agreements.
    performVillageAction(state, state.buildings[2], 'war');
    expect(playerMerchant.hp).toBe(0); expect(rivalMerchant.hp).toBeGreaterThan(0);
    expect(state.tradeRoutes!.filter(route => route.villageId === 1)).toHaveLength(1);
  });

  it('rejects invalid or interrupted trade credits and excludes agreement fees from discounts', () => {
    const state = fixture(), village = state.villages![0];
    recordVillageTrade(state, village, 0, 1000);
    expect(state.factions[1].gold).toBe(0);
    openTrade(state);
    for (const amount of [NaN, Infinity, -100, 0]) recordVillageTrade(state, village, 0, amount);
    expect(state.factions[1].gold).toBe(0); expect(villageAllianceCost(village)).toBe(3000);
    performVillageAction(state, state.buildings[2], 'war'); recordVillageTrade(state, village, 0, 1000);
    expect(state.factions[1].gold).toBe(0);
  });

  it('physically reaches the village then returns to its palace, paying only on arrival', () => {
    const state = fixture(), { route, merchant } = openTrade(state), gold = state.factions[0].gold;
    for (let i = 0; i < 20; i++) { state.time += .1; updateMerchant(state, merchant, .1, moveUnit); }
    expect(state.factions[0].gold).toBe(gold); expect(route.journeys).toBe(0);
    for (let i = 0; i < 800 && route.journeys < 1; i++) { state.time += .1; updateMerchant(state, merchant, .1, moveUnit); }
    expect(route.journeys).toBe(1); expect(route.target).toBe(route.origin);
    const first = state.factions[0].gold; expect(first).toBeGreaterThan(gold);
    for (let i = 0; i < 800 && route.journeys < 2; i++) { state.time += .1; updateMerchant(state, merchant, .1, moveUnit); }
    expect(route.journeys).toBe(2); expect(route.target).toBe(route.partner);
    expect(state.factions[0].gold).toBeGreaterThan(first);
  });

  it.each(['war', 'destroyed camp'] as const)('retires the village route after %s without a kill bounty or partial payout', reason => {
    const state = fixture(), { route, merchant } = openTrade(state), gold = state.factions[0].gold;
    route.distance = 100;
    if (reason === 'war') expect(performVillageAction(state, state.buildings[2], 'war').ok).toBe(true);
    else { state.buildings[2].hp = 0; updateVillages(state); }
    expect(state.tradeRoutes!.filter(r => r.villageId === 1)).toHaveLength(0);
    expect(merchant.hp).toBe(0); expect(state.factions[0].gold).toBe(gold);
    expect(state.tradeRoutes!.filter(r => r.villageId === undefined)).toHaveLength(1);
  });

  it('waits four minutes to replace a killed village caravan without interrupting normal city trade', () => {
    const state = fixture(), { route, merchant } = openTrade(state);
    merchant.hp = 0; state.time = 5; updateTradeRoutes(state);
    expect(route.nextDepartureAt).toBe(5 + MERCHANT_REPLACEMENT_SECONDS);
    expect(route.merchantId).toBeUndefined();
    for (let time = 10; time < 245; time += 5) {
      state.time = time; updateTradeRoutes(state);
      expect(state.units.filter(u => u.kind === 'merchant' && u.hp > 0 && u.tradeRoute === route.id)).toHaveLength(0);
    }
    state.time = 245; updateTradeRoutes(state);
    expect(route.merchantId).toBeDefined(); expect(route.merchantId).not.toBe(merchant.id);
    expect(state.units.filter(u => u.kind === 'merchant' && u.hp > 0)).toHaveLength(2);
    expect(state.tradeRoutes).toHaveLength(2);
  });

  it('reassigns a village to the nearest surviving city after losing the origin, without duplicate caravans', () => {
    const state = fixture(), { merchant } = openTrade(state), gold = state.factions[0].gold;
    state.buildings[1].hp = 0; updateTradeRoutes(state);
    expect(state.tradeRoutes).toHaveLength(1);
    expect(state.tradeRoutes![0]).toMatchObject({ villageId: 1, origin: 1, partner: 3 });
    expect(merchant.hp).toBe(0); expect(state.factions[0].gold).toBe(gold);
    const survivor = state.tradeRoutes![0].merchantId;
    for (let time = 5; time < 60; time += 5) { state.time = time; updateTradeRoutes(state); }
    expect(state.tradeRoutes).toHaveLength(1); expect(state.tradeRoutes![0].merchantId).toBe(survivor);
    expect(state.units.filter(u => u.kind === 'merchant' && u.hp > 0)).toHaveLength(1);
  });

  it('preserves the casualty cooldown when a village changes its trade origin', () => {
    const state = fixture(), { merchant } = openTrade(state);
    merchant.hp = 0; state.buildings[1].hp = 0; state.time = 5; updateTradeRoutes(state);
    expect(state.tradeRoutes).toHaveLength(1);
    expect(state.tradeRoutes![0]).toMatchObject({ origin: 1, partner: 3, nextDepartureAt: 245 });
    expect(state.tradeRoutes![0].merchantId).toBeUndefined();
    state.time = 240; updateTradeRoutes(state);
    expect(state.units.filter(u => u.kind === 'merchant' && u.hp > 0)).toHaveLength(0);
    state.time = 245; updateTradeRoutes(state);
    expect(state.units.filter(u => u.kind === 'merchant' && u.hp > 0)).toHaveLength(1);
  });

  it('allied villagers actually fight an approaching enemy in the game update loop', () => {
    const state = fixture(); performVillageAction(state, state.buildings[2], 'ally');
    state.units[0].x = 14.5; state.units[0].y = 14.5;
    const villager = state.units.find(u => u.villageId === 1)!;
    const enemy = { ...person(10000, 'warrior', -2, 51.3, 11.5), attack: 0, order: 'hold' as const };
    entityStore(state).units.add(enemy);
    const hp = enemy.hp;
    for (let i = 0; i < 20; i++) updateGame(state, .1, idle);
    expect(enemy.hp).toBeLessThan(hp);
    expect(villager.target).toBe(enemy.id);
    expect(state.units.some(u => u.kind === 'leader' && u.faction === 1)).toBe(false);
  });
});
