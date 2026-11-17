import { describe, expect, it, vi } from 'vitest';
import { atWar, updateGame } from '../src/game/simulation';
import { isRaidObjective, selectRaidTarget } from '../src/game/raid-targeting';
import { updateRaiderGroupMotivation, updateRaiderMotivation } from '../src/game/raider-motivations';
import { updateVillageUnit } from '../src/game/villages';
import { hostileView, setVillageRelation } from '../src/game/settlement-bridge';
import { type Building, type GameState, type MarauderPack, type NeutralVillage, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, faction: number, kind: Unit['kind'], x: number, y: number): Unit => ({
  id, faction, kind, x, y, hp: 100, maxHp: 100, morale: 100, attack: 20, defense: 4, speed: 0,
  range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, faction: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, faction, kind, x, y, hp: 650, maxHp: 650, capacity: 0, governorPermissions: { farms: false, housing: false },
});
function fixture(relation: NeutralVillage['relation'] = 'neutral') {
  const camp = { ...building(20, 1, 'villageTent', 13, 12), villageId: 1 };
  const villager = { ...person(30, 1, 'worker', 11.5, 12.5), villageId: 1 };
  const guard = { ...person(31, 1, 'warrior', 10.5, 13.5), villageId: 1 };
  const raider = { ...person(100, -2, 'warrior', 10.5, 12.5), marauderPack: 50, order: 'raid' as const };
  const pack: MarauderPack = { id: 50, name: 'Raiders', color: '#111', targetFaction: 0, targetBuilding: 2, raid: true,
    motivation: 'assault', phase: 'approach', home: { x: 2.5, y: 2.5 }, waypoint: { x: 29, y: 21 }, nextWanderAt: 0 };
  const state: GameState = {
    world: { width: 40, height: 32, seed: 'neutral-raiders', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 40 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    units: [person(1, 0, 'leader', 29.5, 24.5), villager, guard, raider],
    buildings: [building(2, 0, 'palace', 28, 20), camp, { ...building(21, 1, 'villageTent', 10, 11), villageId: 1 },
      { ...building(22, 1, 'woodenTower', 13, 14), villageId: 1 }],
    factions: [0, 1].map(id => ({ id, villageId: id ? 1 : undefined, name: `Faction ${id}`, color: '#fff', affinity: 50,
      relation: id ? 'peace' : 'self', food: 500, gold: 0, production: 0, population: 0, culture: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false })),
    villages: [{ id: 1, faction: 1, campId: 20, name: 'Camp', identity: 'growers', relation, x: 13, y: 12 }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], projectiles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'neutral-raiders', rngState: 731,
    marauderPacks: [pack], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 },
  };
  return { state, camp, villager, guard, raider, pack };
}

describe('raiders and independent villages', () => {
  it.each(['neutral', 'trade', 'war'] as const)('ignores a %s village when choosing objectives and during live combat', relation => {
    const { state, camp, villager, guard, raider, pack } = fixture(relation);
    expect(atWar(state, -2, 1)).toBe(false); expect(atWar(state, 1, -2)).toBe(false);
    expect(isRaidObjective(state, camp)).toBe(false);
    expect(selectRaidTarget(state, raider)?.id).toBe(2);
    // An already-issued order must be discarded too, not only future waves.
    pack.targetBuilding = camp.id; pack.targetFaction = camp.faction; raider.target = villager.id;
    for (let step = 0; step < 20; step++) updateGame(state, .1, idle);
    expect(pack.targetBuilding).toBe(2);
    expect([camp.hp, villager.hp, guard.hp, raider.hp]).toEqual([650, 100, 100, 100]);
    expect(state.projectiles).toHaveLength(0);
    expect(raider.target).not.toBe(villager.id); expect(raider.target).not.toBe(guard.id);
  });

  it.each(['harass', 'theft', 'siege'] as const)('keeps %s specialists from attacking or retreating from independent villagers', motivation => {
    const { state, raider, pack } = fixture();
    pack.motivation = motivation; pack.raidGoal = { x: 27.5, y: 20.5 }; pack.rally = { x: 10.5, y: 12.5 };
    const orders = { move: vi.fn(), attack: vi.fn(), visible: vi.fn(() => true) };
    updateRaiderGroupMotivation(state, pack, [raider]);
    updateRaiderMotivation(state, raider, .1, orders);
    expect(orders.attack).not.toHaveBeenCalled(); expect(pack.returning).not.toBe(true);
  });

  it('prevents independent villagers from provoking raiders, but preserves allied local defense', () => {
    const { state, guard, raider } = fixture();
    const orders = { hostile: (a: number, b: number) => hostileView(state, a, b) ?? false,
      visible: () => true, move: vi.fn(), engage: vi.fn() };
    updateVillageUnit(state, guard, .1, orders);
    expect(orders.engage).not.toHaveBeenCalled();
    setVillageRelation(state, state.villages![0], 0, 'allied');
    expect(atWar(state, 1, -2)).toBe(true); expect(atWar(state, -2, 1)).toBe(true);
    // Nearby hostiles come from the Rust 1 Hz census sample, so let one sense pass run.
    for (let step = 0; step < 12; step++) updateGame(state, .1, idle);
    guard.villageNextThinkAt = 0;
    updateVillageUnit(state, guard, .1, orders);
    expect(orders.engage).toHaveBeenCalledWith(guard, raider, .1);
  });
});
