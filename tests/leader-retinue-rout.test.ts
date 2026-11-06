import { describe, expect, it } from 'vitest';
import { beginBattleRout } from '../src/game/battle-morale';
import { entityStore } from '../src/game/entity-store';
import { toggleInfantryFormation } from '../src/game/infantry-drill';
import { canWalk } from '../src/game/pathfinding';
import { updateGame } from '../src/game/simulation';
import { scoutRealm } from './helpers/scouts';
import type { GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture() {
  const state = scoutRealm(), leader = state.units[0], source = state.units[1];
  Object.assign(leader, { x: 20.5, y: 18.5, speed: 0, attack: 0, morale: 100, order: 'hold' });
  const retinue: Unit[] = Array.from({ length: 8 }, (_, index) => ({
    ...source, id: 20 + index, x: 5.5 + index * 4, y: 24.5,
    kind: (['warrior', 'archer', 'spearman', 'horseman'] as const)[index % 4],
    range: index % 4 === 1 ? 4 : 1.1, speed: 0, attack: 0,
    order: index % 2 ? 'follow' : 'hold', retinueStance: index % 2 ? 'aggressive' : 'hold',
  }));
  entityStore(state).units.replace([leader, ...retinue]);
  entityStore(state).buildings.replace([{ id: 100, kind: 'palace', faction: 0, x: 2, y: 2, hp: 650, maxHp: 650,
    capacity: 4, populationGrowth: -1e9, governorPermissions: { farms: false, housing: false } }]);
  state.factions[0].research!.levels.infantryDrill = 1;
  return { state, leader, retinue, source };
}
function advance(state: GameState, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += .1) updateGame(state, .1, idle);
}

describe('Leader retreat orders for the whole retinue', () => {
  it('immediately routes every regular role and stance at any distance, releasing all combat and formation orders', () => {
    const { state, leader, retinue } = fixture();
    expect(toggleInfantryFormation(state).ok).toBe(true);
    for (const unit of [leader, ...retinue]) {
      unit.target = 900; unit.destination = { x: 30, y: 12 }; unit.path = [{ x: 25, y: 14 }];
      unit.pathGoal = { x: 30, y: 12 }; unit.forcedAttack = { target: 900 };
      unit.attackReturn = { x: 28, y: 18 }; unit.recallIssuedAt = 1;
    }
    const priorOrders = retinue.map(unit => unit.order);
    beginBattleRout(state, leader);
    expect(leader.infantryFormation!.active).toBe(false);
    for (const [index, unit] of retinue.entries()) {
      expect(unit).toMatchObject({ order: 'flee', routed: true, morale: 0, routOrder: priorOrders[index] });
      expect(unit.retinueStance).toBe(index % 2 ? 'aggressive' : 'hold');
    }
    for (const unit of [leader, ...retinue]) {
      for (const field of ['target', 'destination', 'path', 'pathGoal', 'forcedAttack', 'attackReturn', 'recallIssuedAt', 'infantryDrillLeader'] as const)
        expect(unit[field], `${unit.kind} retains ${field}`).toBeUndefined();
    }
  });

  it('does not commandeer guards, scouts, villagers, dead soldiers, other factions, or marauder bands', () => {
    const { state, leader, source } = fixture();
    const excluded: Unit[] = [
      { ...source, id: 40, kind: 'militia', guardPost: 500 }, { ...source, id: 41, guardPost: 500 },
      { ...source, id: 42, kind: 'scout', scoutLodge: 501 }, { ...source, id: 43, villageId: 50 },
      { ...source, id: 44, faction: 1 }, { ...source, id: 45, faction: -2, marauderPack: 1 },
      { ...source, id: 46, marauderPack: 2 }, { ...source, id: 47, hp: 0 },
      { ...source, id: 48, kind: 'worker' },
    ];
    entityStore(state).units.add(...excluded);
    const before = structuredClone(excluded);
    beginBattleRout(state, leader);
    expect(excluded).toEqual(before);
  });

  it.each([false, true])('propagates a real morale collapse during the same simulation step (Leader last: %s)', leaderLast => {
    const { state, leader, retinue, source } = fixture();
    Object.assign(leader, { hp: 10, morale: .01 });
    const enemy: Unit = { ...source, id: 80, faction: -2, x: leader.x + 1, y: leader.y,
      attack: 0, speed: 0, hp: 1000, maxHp: 1000, order: 'hold', cooldown: 1000 };
    entityStore(state).units.replace(leaderLast ? [...retinue, enemy, leader] : [leader, ...retinue, enemy]);
    updateGame(state, .1, idle);
    expect(leader.order).toBe('flee');
    for (const unit of retinue) expect(unit).toMatchObject({ order: 'flee', routed: true });
  });

  it('holds even recovered soldiers in retreat until the Leader rallies, then restores their prior orders', () => {
    const { state, leader, retinue } = fixture();
    const priorOrders = retinue.map(unit => unit.order);
    beginBattleRout(state, leader);
    advance(state, 18);
    expect(leader.order).toBe('flee');
    expect(retinue.every(unit => unit.morale > 48 && unit.order === 'flee' && unit.routed)).toBe(true);
    // The Leader reaches a settlement door and rallies in the actual unit loop.
    Object.assign(leader, { x: 4.5, y: 2.5, destination: undefined, path: undefined });
    advance(state, .3);
    expect(leader.order).toBe('hold'); expect(leader.routed).toBe(false);
    retinue.forEach((unit, index) => {
      expect(unit.order).toBe(priorOrders[index]); expect(unit.routed).toBe(false);
      expect(unit.routOrder).toBeUndefined();
    });
  });

  it('catches a direct Leader flee order and newly arriving recruits before they can attack', () => {
    const { state, leader, retinue, source } = fixture();
    leader.order = 'flee';
    const enemy = { ...source, id: 80, faction: -2, x: 30.5, y: 14.5, hp: 1000, maxHp: 1000, attack: 0, speed: 0, cooldown: 1000 };
    const recruit: Unit = { ...source, id: 81, x: 30.5, y: 15.5, attack: 100, speed: 0,
      target: enemy.id, forcedAttack: { target: enemy.id }, joiningRetinue: true };
    entityStore(state).units.replace([...retinue, recruit, enemy, leader]);
    updateGame(state, .1, idle);
    expect(recruit.order).toBe('flee'); expect(recruit.forcedAttack).toBeUndefined();
    expect(enemy.hp).toBe(1000);
    expect(retinue.every(unit => unit.order === 'flee')).toBe(true);
  });

  it('evacuates entered trainees to separate walkable exits and cancels outbound training without changing their role', () => {
    const { state, leader, retinue } = fixture();
    entityStore(state).buildings.add({ id: 200, kind: 'archeryRange', faction: 0, x: 12, y: 10, hp: 200, maxHp: 200, capacity: 0 });
    const entered = retinue.slice(0, 3), outbound = retinue[3];
    for (const unit of entered) Object.assign(unit, { x: 13, y: 10.5, inside: true,
      training: { range: 200, role: 'archer', enteredAt: state.time } });
    Object.assign(outbound, { training: { range: 200, role: 'archer' }, x: 9.5, y: 10.5 });
    const kinds = [...entered, outbound].map(unit => unit.kind);
    beginBattleRout(state, leader);
    updateGame(state, .1, idle);
    for (const [index, unit] of [...entered, outbound].entries()) {
      expect(unit.order).toBe('flee'); expect(unit.routed).toBe(true);
      expect(unit.inside).toBe(false); expect(unit.training).toBeUndefined();
      expect(unit.kind).toBe(kinds[index]); expect(canWalk(state, unit.x, unit.y, 0)).toBe(true);
    }
    expect(new Set(entered.map(unit => `${Math.floor(unit.x)},${Math.floor(unit.y)}`)).size).toBe(entered.length);
  });
});

it.each(['destroyed', 'captured'] as const)('does not rally at a cached refuge that was %s between planning samples', condition => {
  const { state, leader } = fixture(), palace = state.buildings[0];
  beginBattleRout(state, leader);
  updateGame(state, .1, idle); // Cache this palace's refuge edges.
  if (condition === 'destroyed') palace.hp = 0;
  else palace.faction = 1;
  Object.assign(leader, { x: 4.5, y: 2.5, destination: undefined, path: undefined });
  updateGame(state, .1, idle);
  expect(leader.order).toBe('flee');
  expect(leader.routed).toBe(true);
});
