import { describe, expect, it } from 'vitest';
import { desiredRetinueSize, nextRecruitRole, retinueComposition } from '../src/game/archery';
import { citySummaries } from '../src/game/cities';
import { entityStore } from '../src/game/entity-store';
import { factionCommittedBudget } from '../src/game/faction-budget';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { purchaseRetinueSlot, retinueSlotPurchaseStatus, retinueSlotUpkeep, RETINUE_SLOT_UPKEEP_INTERVAL } from '../src/game/retinue-purchases';
import { synchronizeRetinueSquads } from '../src/game/retinue-squads';
import { updateGame } from '../src/game/simulation';
import { isRetinueMember, type Building, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], x: number, y: number): Unit => ({ id, kind, faction: 0, x, y,
  hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 5, speed: 2, range: 1.1, order: 'hold', cooldown: 0,
  lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 });
function fixture(): GameState {
  const settlement: Building = { id: 1, kind: 'palace', faction: 0, x: 8, y: 10, hp: 650, maxHp: 650,
    capacity: 0, populationGrowth: -10000, governorPermissions: { farms: false, housing: false } };
  return {
    world: { width: 48, height: 32, seed: 'paid-retinue', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [settlement], units: [person(100, 'leader', 9, 13)], fields: [],
    factions: [{ id: 0, name: 'Roma', color: '#f00', affinity: 100, relation: 'self', food: 1000, gold: 3000,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity,
      nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'paid-retinue', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 },
  };
}
function economyTick(state: GameState): void {
  state.time = (state.tick + 1) * 30 - .1;
  updateGame(state, .1, idle);
}
const retinue = (state: GameState) => state.units.filter(unit => unit.faction === 0 && unit.hp > 0 && isRetinueMember(unit));

describe('purchased faction retinue capacity', () => {
  it('charges 1000 per slot without granting a soldier, resetting recruitment or changing population', () => {
    const state = fixture(), faction = state.factions[0], settlement = state.buildings[0];
    faction.nextRetinueAt = 12; faction.incomeTotals = { gold: 700, food: 20, culture: 0 };
    expect(retinueSlotPurchaseStatus(state, settlement)).toEqual({ available: true, reason: '', slots: 0, upkeep: 0 });
    expect(purchaseRetinueSlot(state, settlement).ok).toBe(true);
    expect(purchaseRetinueSlot(state, settlement).ok).toBe(true);
    expect(faction).toMatchObject({ gold: 1000, purchasedRetinueSlots: 2, population: 0, nextRetinueAt: 12, yields: { gold: -10 } });
    expect(faction.incomeTotals.gold).toBe(700);
    expect(retinue(state)).toHaveLength(0);
    expect(desiredRetinueSize(faction)).toBe(6);
    expect(retinueSlotPurchaseStatus(state, settlement)).toMatchObject({ available: true, slots: 2, upkeep: 10 });
  });

  it.each(['poor', 'foreign', 'wrong kind', 'removed', 'unfinished', 'destroyed', 'distant', 'dead Leader', 'defeated', 'game over'] as const)
  ('rejects an unavailable purchase without changing state: %s', reason => {
    const state = fixture(), settlement = state.buildings[0];
    if (reason === 'poor') state.factions[0].gold = 999.99;
    if (reason === 'foreign') settlement.faction = 1;
    if (reason === 'wrong kind') settlement.kind = 'house';
    if (reason === 'removed') entityStore(state).buildings.replace([]);
    if (reason === 'unfinished') settlement.construction = { startedAt: 0, duration: 90 };
    if (reason === 'destroyed') settlement.hp = 0;
    if (reason === 'distant') state.units[0].y = 15.01;
    if (reason === 'dead Leader') state.units[0].hp = 0;
    if (reason === 'defeated') state.factions[0].defeated = true;
    if (reason === 'game over') state.gameOver = true;
    const before = structuredClone(state);
    expect(retinueSlotPurchaseStatus(state, settlement).available).toBe(false);
    expect(purchaseRetinueSlot(state, settlement).ok).toBe(false);
    expect(state).toEqual(before);
  });

  it('accepts an exact-price purchase at the three-tile boundary, including while paused', () => {
    const state = fixture(); state.paused = true; state.factions[0].gold = 1000; state.units[0].y = 15;
    expect(purchaseRetinueSlot(state, state.buildings[0]).ok).toBe(true);
    expect(state.factions[0].gold).toBe(0);
    expect(purchaseRetinueSlot(state, state.buildings[0])).toEqual({ ok: false, message: 'Need 1000 gold.' });
  });

  it('keeps purchased capacity through population changes and losing the selling settlement', () => {
    const state = fixture(), faction = state.factions[0], settlement = state.buildings[0];
    expect(purchaseRetinueSlot(state, settlement).ok).toBe(true);
    const base = [0, 100, 500, 1000].map(population => desiredRetinueSize({ ...faction, population, purchasedRetinueSlots: 0 }));
    expect([0, 100, 500, 1000].map(population => desiredRetinueSize({ ...faction, population }))).toEqual(base.map(value => value + 1));
    settlement.faction = 1; settlement.hp = 0;
    expect(desiredRetinueSize(faction)).toBe(5);
    expect(retinueSlotUpkeep(faction)).toBe(5);
    const restored = parseGameSave(serializeGameSave(state));
    expect(restored.factions[0].purchasedRetinueSlots).toBe(1);
    expect(desiredRetinueSize(restored.factions[0])).toBe(5);
  });

  it('uses purchased capacity for combat allocations independently of scout lodges', () => {
    const state = fixture(), faction = state.factions[0];
    faction.purchasedRetinueSlots = 2; faction.archerFraction = .5;
    faction.research = { focus: 'scoutLodge', levels: { scoutLodge: 1, archeryRange: 1 }, progress: {} };
    entityStore(state).buildings.add({ ...state.buildings[0], id: 2, kind: 'scoutLodge', x: 12 });
    expect(retinueComposition(state, 0)).toMatchObject({ total: 6, archers: 3, warriors: 3 });
    expect(nextRecruitRole(state, faction)).toBe('archer');
  });

  it('fills paid slots one at a time on the existing recruitment clock and inherits squad experience', () => {
    const state = fixture(), faction = state.factions[0];
    entityStore(state).units.add(...Array.from({ length: 4 }, (_, i) => ({ ...person(200 + i, 'warrior', 12 + i, 14), kills: 100 })));
    synchronizeRetinueSquads(state);
    faction.nextRetinueAt = 5;
    purchaseRetinueSlot(state, state.buildings[0]); purchaseRetinueSlot(state, state.buildings[0]);
    state.time = 4.8; updateGame(state, .1, idle);
    expect(retinue(state)).toHaveLength(4);
    state.time = 4.9; updateGame(state, .4, idle);
    expect(retinue(state)).toHaveLength(5);
    const recruit = retinue(state).find(unit => unit.id > 203)!;
    expect(recruit.kills).toBe(100); expect(recruit.retinueSquad).toBeDefined();
    const next = faction.nextRetinueAt!;
    state.time = next - .2; updateGame(state, .1, idle); expect(retinue(state)).toHaveLength(5);
    state.time = next - .1; updateGame(state, .4, idle); expect(retinue(state)).toHaveLength(6);
    state.time = faction.nextRetinueAt! - .1; updateGame(state, .1, idle); expect(retinue(state)).toHaveLength(6);
  });

  it('bills vacant capacity only from available gold and excludes fees from gross income', () => {
    const state = fixture(), faction = state.factions[0];
    faction.purchasedRetinueSlots = 2; faction.gold = 3;
    expect(RETINUE_SLOT_UPKEEP_INTERVAL).toBe(30);
    state.time = 29.8; updateGame(state, .1, idle); expect(faction.gold).toBe(3);
    economyTick(state); expect(faction.gold).toBe(0);
    economyTick(state); expect(faction.gold).toBe(0);
    expect(faction.yields.gold).toBe(-10); expect(faction.incomeTotals?.gold ?? 0).toBe(0);
    expect(retinue(state)).toHaveLength(0);
    expect(citySummaries(state)[0].gold).toBe(-10);
    expect(factionCommittedBudget(state, faction)).toEqual({ upkeep: 10, surplus: -10 });
  });

  it.each([0, 1])('reserves the next capacity bill before automatic farm orders (gold shortfall: %i)', shortfall => {
    const state = fixture(), faction = state.factions[0], settlement = state.buildings[0];
    faction.population = 20; faction.purchasedRetinueSlots = 2;
    settlement.unhousedResidents = 20; settlement.governorPermissions = { farms: true, housing: false };
    settlement.governorNextPlanAt = 30;
    // This tick pays 14 tax minus 10 upkeep, leaving one 15-gold farm and
    // the next 10-gold capacity bill, or one gold less than that allowance.
    faction.gold = 21 - shortfall;
    economyTick(state);
    expect(state.buildings.filter(building => building.kind === 'camp' && building.construction)).toHaveLength(shortfall ? 0 : 1);
    expect(faction.gold).toBe(shortfall ? 24 : 10);
  });

  it('adds capacity fees to ordinary soldier wages and attributes them once to the oldest completed city', () => {
    const state = fixture(), faction = state.factions[0], first = state.buildings[0];
    faction.purchasedRetinueSlots = 2; faction.gold = 100; faction.population = 20; first.unhousedResidents = 20;
    entityStore(state).buildings.add({ ...first, id: 2, x: 30, unhousedResidents: 0 });
    entityStore(state).units.add({ ...person(200, 'warrior', 12, 14), home: first.id });
    expect(citySummaries(state).map(city => city.gold)).toEqual([3.5, -37.5]);
    expect(factionCommittedBudget(state, faction)).toEqual({ upkeep: 47.5, surplus: -34 });
    economyTick(state);
    expect(faction.gold).toBe(66); expect(faction.yields.gold).toBe(-34);
    expect(citySummaries(state).reduce((sum, city) => sum + city.gold, 0)).toBe(faction.yields.gold);
    first.hp = 0;
    const remaining = citySummaries(state);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].gold).toBe(3.5);
  });
});
