import { describe, expect, it } from 'vitest';
import { repairRate } from '../src/game/builders';
import { updateDefenseResearch } from '../src/game/defense-research';
import { entityStore } from '../src/game/entity-store';
import { beginFogFrame, endFogFrame, updateFog } from '../src/game/fog';
import { worldRevisions } from '../src/game/world-revisions';
import { RESEARCH_BRANCHES, updateResearch } from '../src/game/research';
import { grantIncome } from '../src/game/resource-income';
import {
  canUpgradeSettlement, isKeep, KEEP_MAX_HP, SETTLEMENT_MAX_HP,
  settlementLabel, settlementUpgradeStatus, upgradeSettlement, keepHousingUpgradeStatus, purchaseKeepHousing,
  KEEP_HOUSING, KEEP_HOUSING_BONUS, KEEP_HOUSING_COST,
} from '../src/game/settlement-upgrades';
import { housingCapacity } from '../src/game/simulation';
import { applyGameCommand } from '../src/multiplayer/commands';
import { buildingHeight, buildingWidth, type Building, type GameState, type Unit } from '../src/game/types';

function fixture() {
  const settlement: Building = {
    id: 1, kind: 'palace', faction: 0, x: 8, y: 8, hp: SETTLEMENT_MAX_HP, maxHp: SETTLEMENT_MAX_HP,
    capacity: 4, cityName: 'Willowhearth', initialCity: true, cultureAtFounding: 20,
    unhousedResidents: 4, populationGrowth: .5, governorNextPlanAt: 45,
    governorPermissions: { farms: false, housing: true }, armor: 2,
  };
  const leader: Unit = {
    id: 10, kind: 'leader', faction: 0, x: 10.5, y: 11, hp: 100, maxHp: 100,
    attack: 25, defense: 5, morale: 100, speed: 3.6, range: 4, order: 'hold', cooldown: 0,
    lastCombat: -60, moving: false, facing: 0, attackTime: 0,
  };
  const state: GameState = {
    world: { width: 24, height: 24, seed: 'keep-upgrade', source: 'test', spawns: [],
      tiles: Array.from({ length: 24 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [settlement], units: [leader],
    factions: [{ id: 0, name: 'Player', color: '#3988ff', relation: 'self', affinity: 100,
      food: 100, gold: 0, production: 0, population: 4, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false, research: { focus: 'woodenTower', levels: { wall: 1, woodenTower: 1 }, progress: {} } }],
    time: 30, tick: 0, paused: true, speed: 1, events: [], particles: [], selected: 1, selectedType: 'building',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'keep-upgrade', rngState: 1,
  };
  return { state, settlement, leader, player: state.factions[0] };
}

describe('Settlement to Keep upgrade', () => {
  it('refreshes the visible building immediately while paused without rebuilding terrain or sight', () => {
    const { state, settlement } = fixture();
    state.world.revision = 0;
    beginFogFrame(state);
    const before = updateFog(state).buildings.find(building => building.id === settlement.id)!;
    expect(before.palaceLevel).toBeUndefined();
    const revisions = { ...worldRevisions(state.world) }, time = state.time;
    expect(upgradeSettlement(state, settlement).ok).toBe(true);
    const after = updateFog(state).buildings.find(building => building.id === settlement.id)!;
    expect(after).toMatchObject({ palaceLevel: 2, maxHp: KEEP_MAX_HP });
    expect(state.time).toBe(time);
    expect(worldRevisions(state.world)).toEqual(revisions);
    endFogFrame(state);
  });

  it('unlocks only from completed Fortification, without requiring a surviving library or gold', () => {
    const { state, settlement, player } = fixture();
    const cost = RESEARCH_BRANCHES.find(branch => branch.id === 'woodenTower')!.tiers[0].points;
    player.research = { focus: 'woodenTower', priorities: ['woodenTower'], allocation: 1, levels: {}, progress: { woodenTower: cost - .1 } };
    expect(settlementUpgradeStatus(state, settlement)).toEqual({ available: false, reason: 'Research Fortification first.' });
    expect(upgradeSettlement(state, settlement).ok).toBe(false);
    expect(settlement.palaceLevel).toBeUndefined();
    entityStore(state).buildings.add({ id: 2, kind: 'library', faction: 0, x: 16, y: 16, hp: 250, maxHp: 250, capacity: 0 });
    state.paused = false;
    grantIncome(player, { gold: .05 }, state); updateResearch(state,30);
    expect(canUpgradeSettlement(state, settlement)).toBe(false);
    grantIncome(player, { gold: .05 }, state); updateResearch(state,30);
    expect(player.research.levels.woodenTower).toBe(1);
    expect(player.research.levels.wall).toBeUndefined();
    entityStore(state).buildings.retain(building => building.id !== 2);
    state.paused = true;
    expect(state.buildings.some(building => building.kind === 'library')).toBe(false);
    expect(player.gold).toBeCloseTo(0);
    expect(canUpgradeSettlement(state, settlement)).toBe(true);
    expect(upgradeSettlement(state, settlement).ok).toBe(true);
    expect(player.gold).toBeCloseTo(0);
  });

  it.each([.1, .4, 1])('preserves the city and its health fraction %s while raising maximum health tenfold once', fraction => {
    const { state, settlement, player } = fixture();
    settlement.hp *= fraction;
    const original = structuredClone(settlement), originalFaction = structuredClone(player);
    expect(upgradeSettlement(state, settlement)).toEqual({ ok: true, message: 'Willowhearth upgraded to a Keep.' });
    expect(settlement).toEqual({ ...original, palaceLevel: 2, maxHp: KEEP_MAX_HP, hp: KEEP_MAX_HP * fraction, capacity: KEEP_HOUSING });
    expect(KEEP_MAX_HP).toBe(6500);
    expect([buildingWidth(settlement), buildingHeight(settlement)]).toEqual([2, 2]);
    expect(player).toEqual(originalFaction);
    expect(state.buildings[0]).toBe(settlement);
    const upgraded = structuredClone(settlement);
    expect(upgradeSettlement(state, settlement)).toEqual({ ok: false, message: 'Already a Keep.' });
    expect(settlement).toEqual(upgraded);
  });

  it('uses the actual footing and the same Leader reach check for status and action', () => {
    const { state, settlement, leader } = fixture();
    leader.x = settlement.x + buildingWidth(settlement) + 3;
    leader.y = settlement.y + 1;
    expect(canUpgradeSettlement(state, settlement)).toBe(true);
    leader.x += .001;
    const unavailable = settlementUpgradeStatus(state, settlement);
    expect(unavailable).toEqual({ available: false, reason: 'Move your Leader within 3 tiles of the settlement.' });
    expect(upgradeSettlement(state, settlement)).toEqual({ ok: false, message: unavailable.reason });
    expect(settlement.palaceLevel).toBeUndefined();
    leader.x -= .001;
    leader.inside = true;
    expect(canUpgradeSettlement(state, settlement)).toBe(false);
    leader.inside = false;
    leader.hp = 0;
    expect(canUpgradeSettlement(state, settlement)).toBe(false);
  });

  it.each([
    ['foreign settlement', (state: GameState, building: Building) => { building.faction = 1; }],
    ['different building kind', (_state: GameState, building: Building) => { building.kind = 'house'; }],
    ['removed settlement', (state: GameState) => { entityStore(state).buildings.replace([]); }],
    ['dead settlement', (_state: GameState, building: Building) => { building.hp = 0; }],
    ['unfinished settlement', (_state: GameState, building: Building) => { building.construction = { startedAt: 0, duration: 90 }; }],
    ['defeated player', (state: GameState) => { state.factions[0].defeated = true; }],
    ['missing player', (state: GameState) => { state.factions = []; }],
    ['finished game', (state: GameState) => { state.gameOver = true; }],
  ] as const)('rejects %s without modifying health, levels, or treasury', (_label, invalidate) => {
    const { state, settlement } = fixture();
    invalidate(state, settlement);
    const before = structuredClone({ building: settlement, factions: state.factions });
    expect(canUpgradeSettlement(state, settlement)).toBe(false);
    expect(upgradeSettlement(state, settlement).ok).toBe(false);
    expect({ building: settlement, factions: state.factions }).toEqual(before);
  });

  it('requires the actual in-state entity and finds the player by identity rather than array position', () => {
    const { state, settlement, player } = fixture();
    state.factions.unshift({ ...structuredClone(player), id: 8, relation: 'war', research: undefined });
    expect(canUpgradeSettlement(state, { ...settlement })).toBe(false);
    expect(canUpgradeSettlement(state, settlement)).toBe(true);
    expect(upgradeSettlement(state, settlement).ok).toBe(true);
  });

  it('keeps normal percentage-based repairs and does not compound defensive research', () => {
    const { state, settlement, player } = fixture();
    settlement.hp = 260;
    const originalRate = repairRate(settlement);
    upgradeSettlement(state, settlement);
    expect(repairRate(settlement)).toBeCloseTo(originalRate * 10);
    expect((settlement.maxHp - settlement.hp) / repairRate(settlement)).toBeCloseTo(54);
    player.research!.levels.reinforcedDefenses = 1;
    updateDefenseResearch(state);
    updateDefenseResearch(state);
    expect(settlement).toMatchObject({ maxHp: 6500, hp: 2600, palaceLevel: 2 });
  });

  it('labels only upgraded palaces as Keeps', () => {
    const { settlement } = fixture();
    expect(settlementLabel(settlement)).toBe('Settlement');
    expect(isKeep({ ...settlement, palaceLevel: 1 })).toBe(false);
    expect(settlementLabel({ ...settlement, palaceLevel: 2 })).toBe('Keep');
    expect(isKeep({ kind: 'house', palaceLevel: 2 })).toBe(false);
  });

  it('provides ten beds, then buys fifteen more once without adding people, food or health', () => {
    const { state, settlement, player } = fixture(); player.gold = KEEP_HOUSING_COST + 250;
    settlement.hp = SETTLEMENT_MAX_HP * .4;
    expect(housingCapacity(state)).toBe(4);
    expect(upgradeSettlement(state, settlement).ok).toBe(true);
    expect(housingCapacity(state)).toBe(10);
    const before = structuredClone({ player, settlement });
    expect(purchaseKeepHousing(state, settlement).ok).toBe(true);
    expect(housingCapacity(state)).toBe(KEEP_HOUSING + KEEP_HOUSING_BONUS);
    expect(settlement).toEqual({ ...before.settlement, capacity: 25, keepHousingExpanded: true });
    expect(player).toEqual({ ...before.player, gold: 250,
      goldLedger: [{ time: state.time, inputs: {}, outlays: { upgrades: KEEP_HOUSING_COST } }] });
    expect(purchaseKeepHousing(state, settlement)).toEqual({ ok: false, message: 'Keep housing is fully expanded.' });
    expect(player.gold).toBe(250); expect(settlement.capacity).toBe(25);
    const loaded = structuredClone(state);
    expect(purchaseKeepHousing(loaded, loaded.buildings[0]).ok).toBe(false);
  });

  it.each(['ordinary settlement', 'insufficient gold', 'outside reach', 'foreign Keep', 'unfinished Keep', 'destroyed Keep'] as const)(
    'rejects a housing purchase for %s without spending or changing capacity', reason => {
      const { state, settlement, player, leader } = fixture(); player.gold = KEEP_HOUSING_COST;
      if (reason !== 'ordinary settlement') upgradeSettlement(state, settlement);
      if (reason === 'insufficient gold') player.gold--;
      if (reason === 'outside reach') leader.x = 22;
      if (reason === 'foreign Keep') settlement.faction = 1;
      if (reason === 'unfinished Keep') settlement.construction = { startedAt: 0, duration: 90 };
      if (reason === 'destroyed Keep') settlement.hp = 0;
      const before = structuredClone({ player, settlement });
      expect(keepHousingUpgradeStatus(state, settlement).available).toBe(false);
      expect(purchaseKeepHousing(state, settlement).ok).toBe(false);
      expect({ player, settlement }).toEqual(before);
    });

  it('authorizes the Keep housing command to its multiplayer owner and prevents duplicate payment', () => {
    const { state, settlement, leader, player } = fixture(); upgradeSettlement(state, settlement);
    settlement.faction = leader.faction = player.id = 1; player.gold = 1500;
    state.factions.push({ ...structuredClone(player), id: 0, gold: 9000 });
    entityStore(state).units.add({ ...leader, id: 11, faction: 0 });
    state.multiplayer = { humanFactionIds: [0, 1], inputs: {}, controls: {}, winner: null };
    expect(applyGameCommand(state, 0, { type: 'keep-housing', buildingId: settlement.id }).ok).toBe(false);
    expect(player.gold).toBe(1500);
    expect(applyGameCommand(state, 1, { type: 'keep-housing', buildingId: settlement.id }).ok).toBe(true);
    expect(player.gold).toBe(500); expect(settlement.capacity).toBe(25);
    expect(applyGameCommand(state, 1, { type: 'keep-housing', buildingId: settlement.id }).ok).toBe(false);
    expect(player.gold).toBe(500);
  });
});
