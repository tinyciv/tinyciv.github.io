import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { commandAttackAt, commandMove, migrateGame, recallRetinue, setRetinueOrder, setRetinueStance, updateGame } from '../src/game/simulation';
import { distance, type GameState, type InputState, type Unit } from '../src/game/types';

const idle: InputState = { up: false, down: false, left: false, right: false };
const soldier = (id: number, faction: number, x: number, y: number): Unit => ({
  id, faction, x, y, kind: 'warrior', hp: 100, maxHp: 100, morale: 100, attack: 20, defense: 5,
  speed: 3.96, range: 1.2, order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
function fixture(): GameState {
  return {
    world: { width: 48, height: 32, seed: 'recall', source: 'test', spawns: [],
      tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 3, production: 0, gold: 0, variation: .5 })) },
    units: [{ ...soldier(1, 0, 20.5, 16.5), kind: 'leader', speed: 3.6, range: 0 },
      { ...soldier(2, 0, 19.5, 17.5), retinueStance: 'aggressive' }, { ...soldier(3, -2, 18.5, 17.5), speed: 0, cooldown: 1000, order: 'hold' }],
    buildings: [{ id: 10, kind: 'palace', faction: 0, x: 4, y: 4, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: 3, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'recall', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], retinueStance: 'aggressive',
  };
}
const advance = (state: GameState, seconds: number, input = idle) => {
  for (let i = 0; i < Math.round(seconds * 10); i++) updateGame(state, .1, input);
};

describe('retinue recall', () => {
  it.each(['hold', 'defensive', 'aggressive'] as const)('preserves %s while traveling and resumes it at the new rally position', stance => {
    const state = fixture(), [leader, warrior] = state.units;
    entityStore(state).units.replace([leader, warrior]); warrior.x = 14.5;
    setRetinueStance(state, stance);
    const oldPost = { x: warrior.x, y: warrior.y };
    recallRetinue(state);
    expect(state.retinueStance).toBe(stance); expect(warrior.retinueStance).toBe(stance);
    expect(warrior.order).toBe('follow');
    advance(state, 1, { ...idle, right: true });
    expect(warrior.x).toBeGreaterThan(oldPost.x + 2);
    expect(warrior.recallIssuedAt).toBeDefined(); expect(warrior.retinueStance).toBe(stance);
    // Repeated recalls must not replace a remembered hold order with follow.
    recallRetinue(state);
    for (let i = 0; i < 80 && warrior.recallIssuedAt !== undefined; i++) advance(state, .1);
    expect(warrior.recallIssuedAt).toBeUndefined(); expect(warrior.recallReturnOrder).toBeUndefined();
    expect(state.retinueStance).toBe(stance); expect(warrior.retinueStance).toBe(stance);
    expect(warrior.order).toBe(stance === 'hold' ? 'hold' : 'follow');
    expect(distance(warrior, leader)).toBeLessThan(3);
    const rally = { x: warrior.x, y: warrior.y };
    if (stance === 'defensive') {
      expect(warrior.defensiveAnchor).toEqual(rally);
      expect(distance(warrior.defensiveAnchor!, oldPost)).toBeGreaterThan(5);
    }
    advance(state, 1);
    if (stance !== 'aggressive') expect(distance(warrior, rally)).toBeLessThan(.01);
  });

  it('preserves mixed individual stances without replacing the global stance', () => {
    const state = fixture(), [leader, warrior] = state.units;
    state.retinueStance = 'defensive';
    const held = { ...soldier(4, 0, 14.5, 14.5), retinueStance: 'hold' as const, order: 'hold' as const };
    const defender = { ...soldier(5, 0, 14.5, 19.5), retinueStance: 'defensive' as const, defensiveAnchor: { x: 14.5, y: 19.5 } };
    entityStore(state).units.replace([leader, warrior, held, defender]);
    recallRetinue(state);
    expect(state.retinueStance).toBe('defensive');
    expect([warrior, held, defender].map(unit => unit.retinueStance)).toEqual(['aggressive', 'hold', 'defensive']);
    advance(state, 7);
    expect([warrior, held, defender].every(unit => unit.recallIssuedAt === undefined)).toBe(true);
    expect([warrior, held, defender].map(unit => unit.retinueStance)).toEqual(['aggressive', 'hold', 'defensive']);
    expect(held.order).toBe('hold'); expect(defender.defensiveAnchor).toEqual({ x: defender.x, y: defender.y });
    expect(state.retinueStance).toBe('defensive');
  });

  it('restores an individually held order without inventing or changing its stance', () => {
    const state = fixture(), [leader, warrior] = state.units;
    entityStore(state).units.replace([leader, warrior]); warrior.x = 14.5;
    setRetinueOrder(state, 'hold', warrior.id);
    expect(warrior.retinueStance).toBeUndefined();
    recallRetinue(state); advance(state, 5);
    expect(warrior.recallIssuedAt).toBeUndefined(); expect(warrior.order).toBe('hold');
    expect(warrior.retinueStance).toBeUndefined(); expect(state.retinueStance).toBe('aggressive');
    const post = { x: warrior.x, y: warrior.y }; advance(state, 1);
    expect(distance(warrior, post)).toBeLessThan(.01);
  });

  it('finishes an incoming recruit’s recall before adopting hold stance', () => {
    const state = fixture(), [leader, recruit] = state.units;
    entityStore(state).units.replace([leader, recruit]); recruit.x = 14.5; recruit.joiningRetinue = true;
    setRetinueStance(state, 'hold'); recallRetinue(state);
    advance(state, 1, { ...idle, right: true });
    expect(recruit.retinueStance).toBe('hold'); expect(recruit.order).toBe('follow');
    expect(recruit.recallIssuedAt).toBeDefined();
    advance(state, 6);
    expect(recruit.joiningRetinue).toBeUndefined(); expect(recruit.recallIssuedAt).toBeUndefined();
    expect(recruit.order).toBe('hold'); expect(recruit.retinueStance).toBe('hold');
  });

  it('preserves an individual hold order when E interrupts a forced attack', () => {
    const state = fixture(), [leader, warrior, enemy] = state.units;
    setRetinueOrder(state, 'hold', warrior.id);
    expect(commandAttackAt(state, enemy.x, enemy.y - .35)).toBe(true);
    expect(warrior.forcedAttack?.target).toBe(enemy.id);
    recallRetinue(state);
    expect(warrior.forcedAttack).toBeUndefined(); expect(warrior.recallReturnOrder).toBe('hold');
    expect(warrior.retinueStance).toBeUndefined(); expect(state.retinueStance).toBe('aggressive');
    entityStore(state).units.replace([leader, warrior]);
    advance(state, 3);
    expect(warrior.order).toBe('hold'); expect(warrior.recallIssuedAt).toBeUndefined();
    expect(warrior.retinueStance).toBeUndefined();
  });

  it('lets an explicit new stance cancel recall and its remembered return order', () => {
    const state = fixture(), warrior = state.units[1];
    setRetinueStance(state, 'hold'); recallRetinue(state);
    expect(warrior.recallReturnOrder).toBe('hold');
    setRetinueStance(state, 'defensive');
    expect(warrior.recallIssuedAt).toBeUndefined(); expect(warrior.recallReturnOrder).toBeUndefined();
    expect(warrior.retinueStance).toBe('defensive'); expect(warrior.order).toBe('follow');
    expect(state.retinueStance).toBe('defensive');
  });

  it('immediately disengages every living friendly warrior regardless of selection, without changing civilians or enemies', () => {
    const state = fixture(), warrior = state.units[1], enemy = state.units[2];
    warrior.target = enemy.id; warrior.destination = { x: 18.5, y: 17.5 }; warrior.path = [warrior.destination];
    warrior.pathGoal = warrior.destination; warrior.attackTime = .3; warrior.moving = true;
    const held = { ...soldier(4, 0, 19.5, 15.5), order: 'hold' as const };
    const worker = { ...soldier(5, 0, 10.5, 10.5), kind: 'worker' as const, order: 'work' as const };
    entityStore(state).units.add(held, worker); const untouched = structuredClone([state.units[0], enemy, worker]);
    recallRetinue(state);
    for (const unit of [warrior, held]) {
      expect(unit.order).toBe('follow'); expect(unit.recallIssuedAt).toBe(0);
      expect(unit.target).toBeUndefined(); expect(unit.destination).toBeUndefined();
      expect(unit.path).toBeUndefined(); expect(unit.pathGoal).toBeUndefined();
      expect(unit.attackTime).toBe(0); expect(unit.moving).toBe(false);
    }
    expect([state.units[0], enemy, worker]).toEqual(untouched);
    updateGame(state, .1, idle);
    expect(enemy.hp).toBe(100); expect(warrior.target).toBeUndefined();
  });

  it.each([false, true])('ignores enemies in melee range throughout keyboard travel (warrior first: %s)', warriorFirst => {
    const state = fixture(), [leader, warrior, enemy] = state.units;
    if (warriorFirst) entityStore(state).units.replace([warrior, leader, enemy]);
    warrior.target = enemy.id; recallRetinue(state);
    advance(state, 2, { ...idle, right: true });
    expect(leader.x).toBeGreaterThan(27); expect(warrior.x).toBeGreaterThan(25);
    expect(distance(warrior, leader)).toBeLessThan(4);
    expect(warrior.recallIssuedAt).toBeDefined(); expect(warrior.target).toBeUndefined();
    expect(enemy.hp).toBe(100);
  });

  it('follows a right-click destination without attacking, then resumes defense after stopping and regrouping', () => {
    const state = fixture(), [leader, warrior, enemy] = state.units;
    recallRetinue(state); expect(commandMove(state, 28.5, 16.5)).toBe(true);
    advance(state, 1);
    expect(leader.destination).toBeDefined(); expect(warrior.recallIssuedAt).toBeDefined();
    expect(enemy.hp).toBe(100); expect(warrior.target).toBeUndefined();
    advance(state, 3);
    expect(leader.destination).toBeUndefined(); expect(warrior.recallIssuedAt).toBeUndefined();
    expect(distance(warrior, leader)).toBeLessThan(3);
    enemy.x = warrior.x - 1; enemy.y = warrior.y;
    advance(state, .3);
    expect(enemy.hp).toBeLessThan(100); expect(warrior.target).toBe(enemy.id);
  });

  it('returns to a stationary Leader before reacquiring nearby enemies', () => {
    const state = fixture(), [leader, warrior, enemy] = state.units;
    warrior.x = 14.5; enemy.x = 13.5; recallRetinue(state);
    advance(state, .8);
    expect(enemy.hp).toBe(100); expect(warrior.x).toBeGreaterThan(16);
    expect(warrior.recallIssuedAt).toBeDefined(); expect(warrior.target).toBeUndefined();
    for (let i = 0; i < 30 && warrior.recallIssuedAt !== undefined; i++) advance(state, .1);
    expect(warrior.recallIssuedAt).toBeUndefined(); expect(distance(warrior, leader)).toBeLessThan(3);
    expect(enemy.hp).toBe(100);
    advance(state, 2);
    expect(warrior.retinueStance).toBe('aggressive'); expect(enemy.hp).toBeLessThan(100);
  });

  it('finishes regrouping and engages when a stale move order leaves the Leader stopped', () => {
    const state = fixture(), [leader, warrior, enemy] = state.units;
    leader.speed = 0; commandMove(state, 28.5, 16.5); recallRetinue(state);
    advance(state, 1.5);
    expect(leader.destination).toBeDefined(); expect(leader.moving).toBe(false);
    expect(warrior.recallIssuedAt).toBeUndefined();
    advance(state, 1);
    expect(enemy.hp).toBeLessThan(100);
  });

  it('resumes defense near a stopped Leader when an enemy occupies the formation slot', () => {
    const state = fixture(), [, warrior, enemy] = state.units;
    warrior.x = 20.5; warrior.y = 18.5; enemy.x = 19.5; enemy.y = 17.5;
    recallRetinue(state); advance(state, 3);
    expect(warrior.recallIssuedAt).toBeUndefined();
    expect(enemy.hp).toBeLessThan(100); expect(warrior.target).toBe(enemy.id);
  });

  it('lets explicit hold/follow replace recall, while preserving a routed warrior’s morale retreat', () => {
    const state = fixture(), warrior = state.units[1];
    warrior.order = 'flee'; warrior.routOrder = 'hold'; warrior.morale = 12;
    recallRetinue(state);
    expect(warrior).toMatchObject({ order: 'flee', routOrder: 'follow', morale: 12, recallIssuedAt: 0 });
    setRetinueOrder(state, 'hold', warrior.id);
    expect(warrior).toMatchObject({ order: 'flee', routOrder: 'hold', morale: 12 });
    expect(warrior.recallIssuedAt).toBeUndefined();
  });

  it('preserves recall across saving/loading and does not issue orders after game over', () => {
    const state = fixture(); recallRetinue(state);
    const restored = migrateGame(JSON.parse(JSON.stringify(state)) as GameState);
    expect(restored.units.find(unit => unit.id === 2)?.recallIssuedAt).toBe(0);
    state.gameOver = true; state.units[1].order = 'hold'; delete state.units[1].recallIssuedAt;
    recallRetinue(state);
    expect(state.units[1].order).toBe('hold'); expect(state.units[1].recallIssuedAt).toBeUndefined();
  });
});
