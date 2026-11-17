import { describe, expect, it } from 'vitest';
// Registers the settlement host (palace construction and invalidation).
import '../src/game/simulation';
import { initializeVillages, performVillageAction, villageCamp, villageDiplomacyStatus } from '../src/game/villages';
import { setSettlementAffiliation, setVillageRelation, settlements, villageTreasury } from '../src/game/settlement-bridge';
import { settlementStep } from '../src/game/settlement-step';
import { confederationThresholdText, villageDiplomacyActions } from '../src/ui/village-diplomacy';
import type { GameState } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 72, height: 60, seed: 'village-confederation', source: 'test', revision: 0, spawns: [],
      tiles: Array.from({ length: 72 * 60 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 100, kind: 'palace', faction: 0, x: 8, y: 8, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 1, kind: 'leader', faction: 0, x: 10.5, y: 12.5, hp: 100, attack: 20, defense: 4, speed: 3.6, morale: 100,
      range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Roma', color: '#ff0000', relation: 'self', population: 20, food: 500, gold: 5000, production: 0, culture: 0,
      yields: { food: 0, gold: 0, production: 0 }, defeated: false, nextRaid: Infinity }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'village-confederation', rngState: 101,
  };
}
function allied() {
  const state = fixture(); initializeVillages(state);
  const village = state.villages![0], camp = villageCamp(state, village)!;
  state.units[0].x = camp.x + .5; state.units[0].y = camp.y + 1.5;
  state.time = 1; settlementStep(state);
  setVillageRelation(state, village, 0, 'allied');
  return { state, village, camp };
}

describe('village confederation', () => {
  it('shows the exact deterministic threshold from Rust', () => {
    const { state, camp } = allied();
    const status = villageDiplomacyStatus(state, camp)!;
    expect(status.acceptThreshold).toBe(Math.max(60, status.independence - 10));
    expect(confederationThresholdText(status)).toContain(`accepts at ${Math.round(status.acceptThreshold)} or more`);
    expect(villageDiplomacyActions(status)).toEqual(['trade', 'ally', 'confederate', 'war']);
    expect(status.confederate.cost).toBe(status.tribute);
  });

  it('refuses below the threshold at no charge and starts a 90 s cooldown', () => {
    const { state, village, camp } = allied();
    setSettlementAffiliation(state, camp.id, 0, 20);
    const gold = state.factions[0].gold;
    const result = performVillageAction(state, camp, 'confederate');
    expect(result.ok).toBe(false); expect(result.message).toContain('refuses for now');
    expect(state.factions[0].gold).toBe(gold);
    const status = villageDiplomacyStatus(state, camp)!;
    expect(status.confederate.available).toBe(false); expect(status.cooldownUntil).toBe(state.time + 90);
    expect(village.confederatedInto).toBeUndefined();
  });

  it('accepts at the threshold: charges tribute once and turns the village into a city with a palace on its civic lot', () => {
    const { state, village, camp } = allied();
    setSettlementAffiliation(state, camp.id, 0, 100);
    const status = villageDiplomacyStatus(state, camp)!, gold = state.factions[0].gold, treasury = villageTreasury(state, village);
    expect(status.confederate.available).toBe(true);
    const villagers = state.units.filter(unit => unit.villageId === village.id && unit.hp > 0 && unit.kind === 'worker').length;
    const result = performVillageAction(state, camp, 'confederate');
    expect(result.ok).toBe(true);
    // Tribute is charged once; the village treasury transfers to the realm.
    expect(state.factions[0].gold).toBeCloseTo(gold - status.tribute + treasury);
    const palace = state.buildings.find(b => b.id === village.confederatedInto)!;
    expect(palace).toMatchObject({ kind: 'palace', faction: 0, cityName: village.name, villageIdentity: village.identity });
    expect([palace.x, palace.y]).toEqual([village.layout!.lotX, village.layout!.lotY]);
    expect(state.buildings.some(b => b.villageId === village.id && b.hp > 0)).toBe(false);
    expect(state.units.filter(unit => unit.villageId === village.id && unit.hp > 0)).toHaveLength(0);
    expect(state.units.filter(unit => unit.faction === 0 && unit.kind === 'worker').length).toBeGreaterThanOrEqual(villagers);
    expect(state.factions.find(f => f.id === village.faction)?.defeated).toBe(true);
    // The confederated city keeps its identity bonus.
    settlementStep(state);
    const bonus = { growers: 'food', merchants: 'trade', builders: 'construction', scholars: 'research' } as const;
    expect(state.factions[0].villageBonuses?.[bonus[village.identity]]).toBeGreaterThan(0);
    // A second request is impossible: the village is gone.
    const after = state.factions[0].gold;
    expect(performVillageAction(state, camp, 'confederate').ok).toBe(false);
    expect(state.factions[0].gold).toBe(after);
  });

  it('fails a blocked civic lot without charge or Rust mutation', () => {
    const { state, village, camp } = allied();
    setSettlementAffiliation(state, camp.id, 0, 100);
    const lot = village.layout!;
    state.world.tiles[lot.lotY * state.world.width + lot.lotX].terrain = 'ocean'; state.world.revision = 1;
    const gold = state.factions[0].gold;
    expect(performVillageAction(state, camp, 'confederate')).toEqual({ ok: false, message: 'The village green is blocked.' });
    expect(state.factions[0].gold).toBe(gold); expect(village.confederatedInto).toBeUndefined();
    expect(settlements(state).villageStatus(village, 0, gold, 0)[19]).toBe(0);
  });
});
