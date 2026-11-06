import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { commandAttackAt, commandMove, setRetinueStance, toggleMovementMode, updateGame } from '../src/game/simulation';
import { retinueFormation } from '../src/game/formation';
import { updateFog } from '../src/game/fog';
import { type GameState, type Unit, distance } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const soldier = (id: number, faction: number, x: number, y: number): Unit => ({
  id, faction, x, y, kind: 'warrior', hp: 100, maxHp: 100, morale: 100, attack: 20, defense: 5,
  speed: 3.96, range: 1.1, order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
function fixture(): GameState {
  return {
    world: { width: 64, height: 40, seed: 'stances', source: 'test', spawns: [],
      tiles: Array.from({ length: 64 * 40 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 3, production: 0, gold: 0, variation: .5 })) },
    units: [{ ...soldier(1, 0, 20.5, 20.5), kind: 'leader', speed: 3.6, range: 4 },
      soldier(2, 0, 18.5, 18.5), soldier(3, 0, 18.5, 22.5)],
    buildings: [{ id: 10, kind: 'palace', faction: 0, x: 4, y: 4, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: 1, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'stances', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [],
  };
}
const advance = (state: GameState, seconds: number, input = idle) => {
  for (let i = 0; i < Math.round(seconds * 20); i++) updateGame(state, .05, input);
};
const enemyAt = (state: GameState, x: number, y: number) => {
  const enemy = { ...soldier(50, -2, x, y), hp: 1000, maxHp: 1000, attack: 0, speed: 0, order: 'hold' as const };
  entityStore(state).units.add(enemy); updateFog(state); return enemy;
};

describe('retinue stances and explicit attack orders', () => {
  it('defends within five tiles of the original position and returns after combat', () => {
    const state = fixture(), warrior = state.units[1]; entityStore(state).units.replace([state.units[0], warrior]);
    const start = { x: warrior.x, y: warrior.y }, enemy = enemyAt(state, 23.3, 18.5);
    setRetinueStance(state, 'defensive');
    for (let i = 0; i < 80; i++) { updateGame(state, .05, idle); expect(distance(warrior, start)).toBeLessThanOrEqual(5.00001); }
    expect(enemy.hp).toBeLessThan(1000); expect(warrior.x).toBeGreaterThan(start.x + 3);
    enemy.x = 28.5; updateFog(state); advance(state, 2);
    expect(distance(warrior, start)).toBeLessThan(.2);
  });

  it('ignores enemies beyond the five-tile post, then retaliates against an attacker without leaving its leash', () => {
    const state = fixture(), [leader, warrior] = state.units;
    entityStore(state).units.replace([leader, warrior]); leader.attack = 0; leader.cooldown = 1e9;
    state.factions[0].nextRetinueAt = 1e9;
    const anchor = { x: warrior.x, y: warrior.y }, enemy = enemyAt(state, anchor.x + 6, anchor.y);
    setRetinueStance(state, 'defensive'); advance(state, 1);
    expect(distance(warrior, anchor)).toBeLessThan(.01); expect(enemy.hp).toBe(1000);
    state.projectiles = [{ x: enemy.x, y: enemy.y, start: { x: enemy.x, y: enemy.y }, end: { x: leader.x, y: leader.y },
      attacker: enemy.id, target: leader.id, faction: enemy.faction, damage: 1, duration: .01, elapsed: 0, kind: 'arrow' }];
    let retaliated = false;
    for (let i = 0; i < 70; i++) {
      updateGame(state, .05, idle); expect(distance(warrior, anchor)).toBeLessThanOrEqual(5.00001);
      retaliated ||= warrior.target === enemy.id;
    }
    expect(retaliated).toBe(true); expect(enemy.hp).toBeLessThan(1000);
    enemy.x = anchor.x + 10; updateFog(state); advance(state, 3);
    expect(distance(warrior, anchor)).toBeLessThan(.2);
  });

  it('holds against enemies and stays at its post while the Leader passes', () => {
    const state = fixture(), leader = state.units[0], warrior = state.units[1]; entityStore(state).units.replace([leader, warrior]);
    warrior.x = 21.5; warrior.y = 20.5;
    const start = { x: warrior.x, y: warrior.y }; enemyAt(state, 25.5, 20.5);
    setRetinueStance(state, 'hold'); advance(state, 1);
    expect(warrior.x).toBe(start.x); expect(warrior.y).toBe(start.y);
    let overlapped = false;
    for (let i = 0; i < 30; i++) {
      updateGame(state, .05, { ...idle, right: true });
      overlapped ||= Math.floor(leader.x) === Math.floor(warrior.x) && Math.floor(leader.y) === Math.floor(warrior.y);
      expect(distance(warrior, start)).toBe(0);
      expect(warrior.retinueStance).toBe('hold'); expect(warrior.order).toBe('hold');
    }
    expect(overlapped).toBe(true); expect(leader.x).toBeGreaterThan(start.x + 1);
    advance(state, 3);
    expect(distance(warrior, start)).toBeLessThan(.12);
  });

  it('aggressively pursues visible enemies even while away from the Leader', () => {
    const state = fixture(), warrior = state.units[1]; entityStore(state).units.replace([state.units[0], warrior]);
    const enemy = enemyAt(state, 12.5, 18.5);
    setRetinueStance(state, 'aggressive'); advance(state, 2);
    expect(enemy.hp).toBeLessThan(1000); expect(warrior.x).toBeLessThan(14);
  });

  it('forces held escorts and the Leader to attack the clicked target', () => {
    const state = fixture(), [leader, ...warriors] = state.units;
    const enemy = enemyAt(state, 24.5, 20.5); setRetinueStance(state, 'hold');
    expect(commandAttackAt(state, enemy.x, enemy.y - .35)).toBe(true);
    expect([leader, ...warriors].every(unit => unit.forcedAttack?.target === enemy.id)).toBe(true);
    advance(state, 3);
    expect(1000 - enemy.hp).toBeGreaterThan(100 * .7); expect(warriors.some(unit => unit.lastCombat > 0)).toBe(true);
  });

  it('preserves the original movement and stance when a clicked target is unreachable', () => {
    const state = fixture(), [leader, warrior] = state.units; entityStore(state).units.replace([leader, warrior]);
    leader.x = 10.5; warrior.x = 9.5; warrior.y = 18.5;
    const enemy = enemyAt(state, 18.5, 20.5);
    for (let y = 0; y < 40; y++) for (let x = 12; x <= 16; x++) state.world.tiles[y * 64 + x].terrain = 'ocean';
    state.world.revision = 1; setRetinueStance(state, 'defensive');
    commandMove(state, 8.5, 20.5); const destination = { ...leader.destination! };
    expect(commandAttackAt(state, enemy.x, enemy.y - .35)).toBe(true);
    expect(leader.destination).toEqual(destination); expect(leader.forcedAttack).toBeUndefined();
    expect(warrior.retinueStance).toBe('defensive'); expect(warrior.forcedAttack).toBeUndefined();
  });

  it('orders the whole group to attack an enemy building, including hostile palaces', () => {
    const state = fixture();
    const target = { id: 60, faction: -2, kind: 'palace' as const, x: 24, y: 20, hp: 650, maxHp: 650, capacity: 0 };
    entityStore(state).buildings.add(target); updateFog(state);
    expect(commandAttackAt(state, 24.5, 20.5)).toBe(true);
    expect(state.units.every(unit => unit.forcedAttack?.target === target.id)).toBe(true);
    advance(state, 3);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(state.diplomacy).toBeNull();
  });

  it('abandons a pursuit if its route closes and resumes the prior ground destination', () => {
    const state = fixture(), leader = state.units[0]; entityStore(state).units.replace([leader]);
    leader.x = 10.5; const enemy = enemyAt(state, 18.5, 20.5);
    commandMove(state, 8.5, 20.5); commandAttackAt(state, enemy.x, enemy.y - .35);
    advance(state, .1); expect(leader.forcedAttack).toBeDefined();
    for (let y = 0; y < 40; y++) for (let x = 12; x <= 16; x++) state.world.tiles[y * 64 + x].terrain = 'ocean';
    state.world.revision = 1; advance(state, .1);
    expect(leader.forcedAttack).toBeUndefined(); expect(leader.destination).toEqual({ x: 8.5, y: 20.5 });
  });
});

describe('toggleable mob movement', () => {
  it('paces a centered escort with the Leader and restores full travel speed', () => {
    const state = fixture(), leader = state.units[0];
    expect(toggleMovementMode(state)).toBe('formation'); advance(state, 4);
    const start = leader.x; advance(state, 3, { ...idle, right: true });
    expect(leader.x - start).toBeCloseTo(3.6 * .75 * 3, 2);
    const warriors = state.units.filter(unit => unit.kind === 'warrior');
    expect(warriors.some(unit => unit.x < leader.x - .8)).toBe(true);
    expect(warriors.some(unit => unit.x > leader.x + .8)).toBe(true);
    expect(distance({ x: (warriors[0].x + warriors[1].x) / 2, y: (warriors[0].y + warriors[1].y) / 2 }, leader)).toBeLessThan(.35);
    expect(warriors.every(unit => distance(unit, leader) < 2.2)).toBe(true);
    expect(toggleMovementMode(state)).toBe('travel'); advance(state, 4);
    // Let escorts clear the Leader's lane while reforming for unrestricted travel.
    advance(state, 1, { ...idle, right: true });
    const travelStart = leader.x; advance(state, 1, { ...idle, right: true });
    expect(leader.x - travelStart).toBeCloseTo(3.6, 2);
  });

  it('keeps the crowd centered through a turn instead of rotating a rank across the Leader', () => {
    const state = fixture(), leader = state.units[0]; toggleMovementMode(state); advance(state, 4);
    advance(state, .3, { ...idle, up: true });
    expect(retinueFormation(state, leader).heading).toBeCloseTo(-Math.PI / 2);
    advance(state, 4, { ...idle, up: true });
    const warriors = state.units.filter(unit => unit.kind === 'warrior');
    expect(warriors.some(unit => unit.y < leader.y - .8)).toBe(true);
    expect(warriors.some(unit => unit.y > leader.y + .8)).toBe(true);
    const goals = retinueFormation(state, leader).goals;
    expect(warriors.every(unit => distance(unit, goals.get(unit.id)!) < .6)).toBe(true);
  });

  it('allows members to leave the mob to attack and rejoin after the threat disappears', () => {
    const state = fixture(), leader = state.units[0]; toggleMovementMode(state); advance(state, 4);
    const enemy = enemyAt(state, leader.x + 1, leader.y - 5);
    advance(state, 2);
    expect(enemy.hp).toBeLessThan(1000);
    expect(state.units.some(unit => unit.faction === 0 && unit.kind === 'warrior' && unit.target === enemy.id)).toBe(true);
    // The whole rally now engages this fight, including the farther rear
    // escort. Give that soldier enough travel time to regain its moving slot.
    enemy.hp = 0; advance(state, 6, { ...idle, right: true });
    const goals = retinueFormation(state, leader).goals;
    expect(state.units.filter(unit => unit.kind === 'warrior').every(unit => distance(unit, goals.get(unit.id)!) < .8)).toBe(true);
  });

  it('keeps eight warriors compact through turns and preserves positions after a casualty', () => {
    const state = fixture(), leader = state.units[0];
    leader.x = 30.5; leader.y = 30.5;
    entityStore(state).units.replace([leader, ...Array.from({ length: 8 }, (_, index) => soldier(100 + index, 0, 28.5 - Math.floor(index / 4), 28.5 + index % 4))]);
    toggleMovementMode(state); advance(state, 8);
    advance(state, 2, { ...idle, right: true }); advance(state, 6, { ...idle, up: true });
    let warriors = state.units.filter(unit => unit.kind === 'warrior');
    expect(warriors.every(unit => distance(unit, leader) < 2.5), JSON.stringify(warriors.map(unit => [unit.x, unit.y]))).toBe(true);
    expect(warriors.some(unit => unit.y < leader.y - .7)).toBe(true);
    expect(warriors.some(unit => unit.y > leader.y + .7)).toBe(true);
    warriors[3].hp = 0; advance(state, 3);
    warriors = state.units.filter(unit => unit.kind === 'warrior');
    expect(warriors).toHaveLength(7);
    const goals = retinueFormation(state, leader).goals;
    expect(warriors.every(unit => distance(unit, goals.get(unit.id)!) < .8)).toBe(true);
    const cells = warriors.map(unit => Math.floor(unit.y) * state.world.width + Math.floor(unit.x));
    expect(new Set(cells).size).toBe(7);
  });
});

describe('palace retinue recruitment', () => {
  it('creates missing escorts one at a time at the palace every ten seconds', () => {
    const state = fixture(), palace = state.buildings[0];
    state.factions[0].nextRetinueAt = 10;
    advance(state, 9.9);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(2);
    for (let i = 0; i < 4 && !state.units.some(unit => unit.joiningRetinue); i++) advance(state, .1);
    const first = state.units.find(unit => unit.joiningRetinue)!;
    expect(first).toBeDefined(); expect(first.bornAt).toBeGreaterThanOrEqual(10 - 1e-7);
    expect(first.bornAt).toBeLessThan(10.4);
    expect(distance(first, { x: palace.x + 1, y: palace.y + 1 })).toBeLessThan(2.2);
    expect(distance(first, state.units[0])).toBeGreaterThan(10);
    advance(state, 9.9);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(3);
    for (let i = 0; i < 4 && state.units.filter(unit => unit.kind === 'warrior').length < 4; i++) advance(state, .1);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(4);
    const born = state.units.filter(unit => unit.kind === 'warrior' && unit.bornAt !== undefined).map(unit => unit.bornAt!);
    expect(born[1] - born[0]).toBeGreaterThanOrEqual(10 - 1e-7);
    expect(born[1] - born[0]).toBeLessThan(10.4);
  });

  it('sends recruits to a distant Leader before applying hold stance', () => {
    const state = fixture(), leader = state.units[0];
    setRetinueStance(state, 'hold'); state.factions[0].nextRetinueAt = 2;
    advance(state, 2.4);
    const recruit = state.units.find(unit => unit.joiningRetinue)!;
    expect(recruit.order).toBe('follow'); expect(recruit.retinueStance).toBe('hold');
    advance(state, 12);
    expect(recruit.joiningRetinue).toBeUndefined(); expect(recruit.order).toBe('hold');
    expect(distance(recruit, leader)).toBeLessThanOrEqual(3);
    const position = { x: recruit.x, y: recruit.y }; advance(state, 1);
    expect(distance(recruit, position)).toBeLessThan(.01);
  });

  it('finishes joining at an outer mob slot without remaining permanently passive', () => {
    const state = fixture(), leader = state.units[0];
    entityStore(state).units.replace([leader, ...Array.from({ length: 8 }, (_, index) => soldier(100 + index, 0, 18.5 - Math.floor(index / 4), 18.5 + index % 4))]);
    state.factions[0].population = 100; state.factions[0].nextRetinueAt = 2;
    toggleMovementMode(state); advance(state, 20);
    const recruit = state.units.find(unit => unit.kind === 'warrior' && unit.bornAt !== undefined)!;
    expect(recruit).toBeDefined();
    expect(recruit.joiningRetinue).toBeUndefined();
    expect(distance(recruit, retinueFormation(state, leader).goals.get(recruit.id)!)).toBeLessThan(.6);
  });

  it('does not recruit without a living palace or into a blocked exit', () => {
    const state = fixture(), palace = state.buildings[0]; state.factions[0].nextRetinueAt = 0;
    for (let y = palace.y - 1; y <= palace.y + 2; y++) for (let x = palace.x - 1; x <= palace.x + 2; x++)
      if (x < palace.x || y < palace.y || x >= palace.x + 2 || y >= palace.y + 2)
        state.world.tiles[y * state.world.width + x].terrain = 'ocean';
    state.world.revision = 1; advance(state, 3);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(2);
    palace.hp = 0; advance(state, .1);
    expect(state.units.filter(unit => unit.kind === 'warrior')).toHaveLength(2);
  });
});
