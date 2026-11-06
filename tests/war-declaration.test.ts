import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { commandAttackAt, diplomacyAction, warDeclarationTargetAt } from '../src/game/simulation';
import { updateFog } from '../src/game/fog';
import { villageDiplomacyStatus } from '../src/game/villages';
import { neutralVillageEntityAt } from '../src/game/hit-testing';
import { alliedVillageCamps } from '../src/game/village-marker';
import type { Building, GameState, Unit } from '../src/game/types';

function fixture(): GameState {
  const leader: Unit = { id: 1, kind: 'leader', faction: 0, x: 8.5, y: 10.5, hp: 100, maxHp: 100, morale: 100,
    attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
  const structure = (id: number, faction: number, kind: Building['kind'], x: number, y: number): Building =>
    ({ id, faction, kind, x, y, hp: 160, maxHp: 160, capacity: 0 });
  const state: GameState = {
    world: { width: 48, height: 32, seed: 'war-popup', source: 'test', spawns: [], tiles: Array.from({ length: 48 * 32 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 3, production: 0, gold: 0, variation: .3 })) },
    units: [leader], buildings: [structure(2, 0, 'palace', 3, 10), structure(3, 1, 'palace', 36, 20), structure(4, 1, 'house', 12, 10)],
    factions: [0, 1].map(id => ({ id, name: `Realm ${id}`, color: id ? '#f44' : '#48f', relation: id ? 'peace' : 'self', affinity: 70,
      population: 5, food: 500, gold: 500, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, defeated: false })),
    time: 10, tick: 0, paused: false, speed: 1, seed: 'war-popup', rngState: 1, events: [], particles: [], fields: [],
    selected: 1, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
  };
  updateFog(state); return state;
}

describe('building war declarations', () => {
  it.each(['house', 'palace', 'well', 'wall', 'woodenTower'] as const)('offers war on a visible peaceful %s without issuing orders', kind => {
    const state = fixture(), target = state.buildings[2], leader = state.units[0]; entityStore(state).setBuildingKind(target, kind);
    leader.destination = { x: 6.5, y: 10.5 };
    const orders = JSON.stringify(leader);
    expect(warDeclarationTargetAt(state, 12.5, 10.5)).toBe(target);
    expect(state.factions[1].relation).toBe('peace'); expect(JSON.stringify(leader)).toBe(orders);
  });

  it('declares war from a visible outlying house while confederation still requires a palace visit', () => {
    const state = fixture();
    expect(diplomacyAction(state, 1, 'war').ok).toBe(false);
    expect(diplomacyAction(state, 1, 'confederate', 4).ok).toBe(false);
    expect(diplomacyAction(state, 1, 'war', 4).ok).toBe(true);
    expect(state.factions[1]).toMatchObject({ relation: 'war', nextRaid: 25 });
    expect(state.units[0].target).toBeUndefined();
    expect(warDeclarationTargetAt(state, 12.5, 10.5)).toBeUndefined();
    expect(commandAttackAt(state, 12.5, 10.5)).toBe(true);
    expect(state.units[0].forcedAttack?.target).toBe(4);
    expect(diplomacyAction(state, 1, 'war', 4).ok).toBe(false);
  });

  it('never exposes hidden, dead, friendly, defeated, confederated, or already hostile buildings', () => {
    for (const condition of ['hidden', 'dead', 'friendly', 'defeated', 'confederated', 'war'] as const) {
      const state = fixture(), building = state.buildings[2];
      if (condition === 'hidden') { building.x = 40; building.y = 28; }
      if (condition === 'dead') building.hp = 0;
      if (condition === 'friendly') building.faction = 0;
      if (condition === 'defeated') state.factions[1].defeated = true;
      if (condition === 'war' || condition === 'confederated') state.factions[1].relation = condition;
      expect(warDeclarationTargetAt(state, building.x + .5, building.y + .5), condition).toBeUndefined();
      expect(diplomacyAction(state, 1, 'war', building.id).ok, condition).toBe(false);
    }
  });

  it('revalidates the selected building and does not trigger through a unit in front', () => {
    const state = fixture(), target = state.buildings[2];
    expect(warDeclarationTargetAt(state, 12.5, 10.5)).toBe(target);
    entityStore(state).units.add({ ...state.units[0], id: 5, kind: 'warrior', x: 12.5, y: 10.5 });
    expect(warDeclarationTargetAt(state, 12.5, 10.5)).toBeUndefined();
    target.faction = 0;
    expect(diplomacyAction(state, 1, 'war', target.id).ok).toBe(false);
    expect(state.factions[1].relation).toBe('peace');
  });
});

function villageFixture(): GameState {
  const state = fixture();
  state.factions[0].gold = 4000;
  state.factions[1].villageId = 1;
  entityStore(state).buildings.replace(state.buildings.map(building => building.id === 3
    ? { ...building, kind: 'villageTent', villageId: 1, x: 18, y: 10 }
    : building.id === 4 ? { ...building, kind: 'villageTent', villageId: 1 } : building));
  state.villages = [{ id: 1, faction: 1, campId: 3, x: 18, y: 10, name: 'Willow tribe', identity: 'scholars', relation: 'neutral',
    nextGrowthAt: 1000, nextThinkAt: 1000, nextRecruitAt: 1000 }];
  updateFog(state);
  return state;
}

describe('village agreements through the building diplomacy popup', () => {
  it('uses villagers as visible diplomatic representatives and revalidates them before payment', () => {
    const state = villageFixture();
    const villager: Unit = { ...state.units[0], id: 5, kind: 'worker', faction: 1, villageId: 1, x: 12.5, y: 9.5 };
    entityStore(state).units.add(villager);
    expect(neutralVillageEntityAt(state, { x: 12.5, y: 9.15 })).toBe(villager);
    expect(diplomacyAction(state, 1, 'trade', villager.id).ok).toBe(true);
    expect(state.factions[0].gold).toBe(3750);
    villager.hp = 0;
    expect(diplomacyAction(state, 1, 'ally', villager.id).ok).toBe(false);
    expect(state.factions[0].gold).toBe(3750);
  });

  it('only offers peaceful, living villages and marks surviving allied camps', () => {
    const state = villageFixture(), tent = state.buildings[2], point = { x: 12.5, y: 10.5 };
    expect(neutralVillageEntityAt(state, point)).toBe(tent);
    expect(alliedVillageCamps(state)).toEqual([]);
    state.villages![0].relation = 'allied';
    expect(neutralVillageEntityAt(state, point)).toBe(tent);
    expect(alliedVillageCamps(state)).toEqual([state.buildings[1]]);
    state.villages![0].relation = 'war';
    expect(neutralVillageEntityAt(state, point)).toBeUndefined();
    expect(alliedVillageCamps(state)).toEqual([]);
    state.villages![0].relation = 'allied'; state.buildings[1].hp = 0;
    expect(neutralVillageEntityAt(state, point)).toBeUndefined();
    expect(alliedVillageCamps(state)).toEqual([]);
  });

  it('allows trade and alliance from a visible tent without requiring a separate campfire visit', () => {
    const state = villageFixture(), tent = state.buildings[2], leader = state.units[0];
    const orders = JSON.stringify(leader);
    expect(villageDiplomacyStatus(state, tent)?.trade.available).toBe(false);
    expect(villageDiplomacyStatus(state, tent, true)?.trade.available).toBe(true);
    expect(warDeclarationTargetAt(state, 12.5, 10.5)).toBe(tent);
    expect(diplomacyAction(state, 1, 'trade', tent.id).ok).toBe(true);
    expect(state.factions[0].gold).toBe(3750);
    expect(state.villages![0]).toMatchObject({ trading: true, relation: 'trade' });
    expect(state.tradeRoutes?.filter(route => route.villageId === 1)).toHaveLength(1);
    expect(warDeclarationTargetAt(state, 12.5, 10.5)).toBe(tent);
    expect(diplomacyAction(state, 1, 'ally', tent.id).ok).toBe(true);
    expect(state.factions[0].gold).toBe(750);
    expect(state.villages![0]).toMatchObject({ trading: true, relation: 'allied' });
    expect(state.factions[0].villageBonuses?.research).toBe(.15);
    expect(JSON.stringify(leader)).toBe(orders);
    expect(diplomacyAction(state, 1, 'trade', tent.id).ok).toBe(false);
    expect(diplomacyAction(state, 1, 'ally', tent.id).ok).toBe(false);
    expect(state.factions[0].gold).toBe(750);
    expect(diplomacyAction(state, 1, 'war', tent.id).ok).toBe(true);
    expect(state.villages![0]).toMatchObject({ trading: false, relation: 'war' });
    expect(state.factions[0].villageBonuses?.research).toBe(0);
    expect(state.tradeRoutes?.filter(route => route.villageId === 1)).toHaveLength(0);
  });

  it.each(['hidden', 'destroyed', 'foreign', 'dead camp', 'dead leader', 'insufficient gold'] as const)
    ('revalidates %s before buying either agreement', condition => {
      for (const action of ['trade', 'ally'] as const) {
        const state = villageFixture(), tent = state.buildings[2];
        if (condition === 'hidden') { tent.x = 40; tent.y = 28; }
        if (condition === 'destroyed') tent.hp = 0;
        if (condition === 'foreign') tent.faction = 0;
        if (condition === 'dead camp') state.buildings[1].hp = 0;
        if (condition === 'dead leader') state.units[0].hp = 0;
        if (condition === 'insufficient gold') state.factions[0].gold = 249;
        const gold = state.factions[0].gold;
        expect(diplomacyAction(state, 1, action, tent.id).ok).toBe(false);
        expect(state.factions[0].gold).toBe(gold);
        expect(state.villages![0].relation).toBe('neutral');
      }
    });

  it('does not treat village agreements as ordinary civilization confederation', () => {
    const state = fixture();
    expect(diplomacyAction(state, 1, 'trade', 4).ok).toBe(false);
    expect(diplomacyAction(state, 1, 'ally', 4).ok).toBe(false);
    expect(state.factions[1].relation).toBe('peace');
  });
});
