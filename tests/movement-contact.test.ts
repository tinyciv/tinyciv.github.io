import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { createGame, getLeader, moveUnit, updateFriendlyYield, updateGame } from '../src/game/simulation';
import { canMove, findPath } from '../src/game/pathfinding';
import { type Building, type GameState, type World, distance } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  const world: World = { width: 48, height: 32, seed: 'movement-contact', source: 'playtest regression', spawns: [{ x: 7, y: 7 }], tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .6, variation: .4, food: 2, production: 2, gold: 1 })) };
  const state = createGame(world);
  entityStore(state).units.replace(state.units.filter(unit => !unit.collector && unit.marauderPack === undefined));
  state.marauderPacks = []; entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace')); state.fields = []; state.factions[0].population = 0;
  for (const tile of state.world.tiles) delete tile.farm;
  const leader = getLeader(state)!, warrior = state.units.find(unit => unit.kind === 'warrior')!;
  entityStore(state).units.replace([leader, warrior]); Object.assign(leader, { x: 20.5, y: 20.5 }); Object.assign(warrior, { x: 21.5, y: 20.5 });
  return state;
}
const advance = (state: GameState, seconds: number) => { for (let i = 0; i < seconds * 10; i++) updateGame(state, .1, idle); };
function enemy(state: GameState) {
  const warrior = state.units.find(unit => unit.kind === 'warrior')!;
  Object.assign(warrior, { faction: -2, marauderPack: 1000, order: 'wander' });
  return warrior;
}
function building(state: GameState, kind: 'wall' | 'house', x: number, y: number): Building {
  const result: Building = { id: 1000 + state.buildings.length, faction: -2, kind, x, y, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.add(result); return result;
}

describe('playtest movement and physical melee contact', () => {
  it.each(['warrior', 'archer', 'militia'] as const)('lets the Leader pass a held friendly %s without moving it or changing its stance', kind => {
    const state = fixture(), leader = getLeader(state)!, soldier = state.units[1];
    Object.assign(soldier, { kind, order: 'hold', retinueStance: 'hold' });
    const origin = { x: soldier.x, y: soldier.y };
    let overlapped = false;
    for (let i = 0; i < 60; i++) {
      state.time += .1;
      moveUnit(state, leader, { x: 27.5, y: 20.5 }, .1, true);
      expect(updateFriendlyYield(state, soldier, .1)).toBe(false);
      overlapped ||= Math.floor(leader.x) === Math.floor(soldier.x) && Math.floor(leader.y) === Math.floor(soldier.y);
      expect(distance(soldier, origin)).toBe(0);
      expect(soldier.retinueStance).toBe('hold'); expect(soldier.order).toBe('hold');
    }
    expect(overlapped).toBe(true); expect(leader.x).toBeGreaterThan(27.3);
  });

  it.each([['warrior', 0], ['leader', -2]] as const)('does not let a %s push a held unit of faction %s', (kind, faction) => {
    const state = fixture(), mover = state.units[0], soldier = state.units[1];
    entityStore(state).setUnitRole(mover, { kind }); Object.assign(soldier, { faction, order: 'hold', retinueStance: 'hold' });
    const origin = { x: soldier.x, y: soldier.y };
    for (let i = 0; i < 20; i++) {
      state.time += .1; moveUnit(state, mover, { x: 27.5, y: 20.5 }, .1, true);
      expect(updateFriendlyYield(state, soldier, .1)).toBe(false);
    }
    expect(mover.x).toBeLessThan(21); expect(distance(soldier, origin)).toBe(0);
  });

  it('lets direct control pass a following escort without teleporting the escort', () => {
    const state = fixture(), leader = getLeader(state)!, warrior = state.units[1];
    for (let i = 0; i < 30; i++) {
      const previous = { x: warrior.x, y: warrior.y };
      updateGame(state, .1, { ...idle, right: true });
      expect(distance(previous, warrior)).toBeLessThanOrEqual(warrior.speed * .1 + .12);
    }
    expect(leader.x).toBeGreaterThan(29);
    expect(warrior.order).toBe('follow');
    expect(distance(leader, warrior)).toBeLessThan(4);
  });

  it('keeps a following escort inside a one-cell passage as the Leader passes', () => {
    const state = fixture(), leader = getLeader(state)!, warrior = state.units[1];
    for (let x = 17; x < 40; x++) for (const y of [19, 21]) building(state, 'wall', x, y).faction = 0;
    for (let i = 0; i < 30; i++) {
      const previous = { x: warrior.x, y: warrior.y };
      updateGame(state, .1, { ...idle, right: true });
      expect(canMove(state, previous, warrior, 0)).toBe(true);
      expect(Math.floor(warrior.y)).toBe(20);
    }
    expect(leader.x).toBeGreaterThan(26);
  });

  it('preserves an explicit held post while the Leader passes', () => {
    const state = fixture(), leader = getLeader(state)!, warrior = state.units[1]; warrior.order = 'hold';
    for (let i = 0; i < 20; i++) updateGame(state, .1, { ...idle, right: true });
    expect(warrior.x).toBe(21.5); expect(warrior.y).toBe(20.5); expect(leader.x).toBeGreaterThan(26); expect(warrior.order).toBe('hold');
  });

  it('moves a directly controlled leader through a ford at forty-five percent speed', () => {
    const state = fixture(), leader = getLeader(state)!;
    entityStore(state).units.replace([leader]);
    const tile = state.world.tiles[20 * state.world.width + 20];
    tile.terrain = 'river'; tile.overlay = 'ford';
    state.world.revision = (state.world.revision ?? 0) + 1;
    updateGame(state, .1, { ...idle, right: true });
    expect(leader.x - 20.5).toBeCloseTo(leader.speed * .1 * .45, 8);
  });

  it('leaves a held escort at its post when the Leader crosses a slow ford', () => {
    const state = fixture(), leader = getLeader(state)!, warrior = state.units[1]; warrior.order = 'hold';
    for (const tile of state.world.tiles) { tile.terrain = 'river'; tile.overlay = 'ford'; }
    state.world.revision = (state.world.revision ?? 0) + 1;
    for (let i = 0; i < 200; i++) updateGame(state, .1, { ...idle, right: true });
    expect(leader.x).toBeGreaterThan(25);
    expect(warrior.order).toBe('hold');
    expect(distance(warrior, { x: 21.5, y: 20.5 })).toBeLessThan(.12);
  });

  it.each(['forest', 'jungle'] as const)('allows melee contact across a %s overlay edge', overlay => {
    const state = fixture(), leader = getLeader(state)!, warrior = enemy(state);
    state.world.tiles[20 * state.world.width + 21].overlay = overlay;
    state.world.revision = (state.world.revision ?? 0) + 1;
    expect(findPath(state, leader, warrior, 0)).toHaveLength(1);
    advance(state, 1);
    expect(leader.hp).toBeLessThan(100); expect(warrior.hp).toBeLessThan(100);
  });

  it('does not make melee contact with a nearby enemy through a solid wall', () => {
    const state = fixture(), leader = getLeader(state)!, warrior = enemy(state);
    leader.x = 20.8; leader.attack = 0; warrior.x = 22.2; warrior.range = 1.65;
    for (let y = 0; y < state.world.height; y++) building(state, 'wall', 21, y).faction = 0;
    leader.target = warrior.id;
    updateGame(state, .5, idle);
    expect(leader.hp).toBe(100); expect(warrior.hp).toBe(100);
  });

  it('does not let an enemy behind solid buildings suppress defense against an exposed enemy', () => {
    const state = fixture(), leader = getLeader(state)!, blocked = enemy(state);
    leader.x = 20.99; blocked.x = 22.01;
    const exposed = { ...blocked, id: blocked.id + 100, x: 19.7, y: 20.5 }; entityStore(state).units.add(exposed);
    for (let y = 0; y < state.world.height; y++) building(state, 'house', 21, y).faction = 0;
    state.world.revision = (state.world.revision ?? 0) + 1;
    advance(state, .3);
    expect(blocked.hp).toBe(100);
    expect(exposed.hp).toBeLessThan(100);
    expect(leader.target).toBeUndefined();
  });

  it('lets an escort defend itself instead of targeting an unreachable enemy across a river', () => {
    const state = fixture(), leader = getLeader(state)!, escort = state.units[1];
    Object.assign(leader, { x: 17.5, y: 20.5 });
    Object.assign(escort, { x: 20.99, y: 20.5 });
    const blocked = { ...escort, id: 900, faction: -2, marauderPack: 1000, x: 22.01, order: 'wander' as const };
    const exposed = { ...blocked, id: 901, x: 19.7 };
    entityStore(state).units.add(blocked, exposed);
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 21].terrain = 'river';
    state.world.revision = (state.world.revision ?? 0) + 1;
    advance(state, 2);
    expect(escort.target).toBe(exposed.id);
    expect(exposed.hp).toBeLessThan(100);
    expect(blocked.hp).toBe(100);
  });

  it('keeps unreachable explicit attack goals small and serializable', () => {
    const state = fixture(), leader = getLeader(state)!, warrior = enemy(state);
    warrior.x = 27.5;
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 21].terrain = 'river';
    state.world.revision = (state.world.revision ?? 0) + 1;
    leader.target = warrior.id;
    advance(state, 4);
    expect(leader.pathGoal).toEqual({ x: warrior.x, y: warrior.y });
    expect(JSON.stringify(leader.pathGoal).length).toBeLessThan(40);
    const loaded = JSON.parse(JSON.stringify(state)) as GameState;
    expect(loaded.units.find(unit => unit.id === leader.id)!.pathGoal).toEqual({ x: warrior.x, y: warrior.y });
  });

  it('still attacks a wall face and the perimeter of a building', () => {
    for (const kind of ['wall', 'house'] as const) {
      const state = fixture(), leader = getLeader(state)!; entityStore(state).units.replace([leader]);
      const target = building(state, kind, 21, 20); leader.target = target.id;
      // Keep the wall hostile while testing contact with its face; abandoned
      // walls now become neutral when their last local building is gone.
      if (kind === 'wall') building(state, 'house', 27, 22);
      advance(state, .3);
      expect(target.hp).toBeLessThan(target.maxHp);
    }
  });

  it('throws over a wall at a building behind it without damaging the wall', () => {
    const state = fixture(), leader = getLeader(state)!; entityStore(state).units.replace([leader]); leader.x = 20.8;
    for (let y = 0; y < state.world.height; y++) building(state, 'wall', 21, y);
    const target = building(state, 'house', 22, 20); leader.target = target.id;
    advance(state, 1);
    expect(target.hp).toBeLessThan(target.maxHp);
    const wall = state.buildings.find(b => b.kind === 'wall' && b.y === 20)!;
    expect(wall.hp).toBe(wall.maxHp);
  });

  it('does not throw at a building through another solid building', () => {
    const state = fixture(), leader = getLeader(state)!; entityStore(state).units.replace([leader]); leader.x = 20.8;
    for (let y = 0; y < state.world.height; y++) building(state, 'house', 21, y);
    const target = building(state, 'house', 22, 20); leader.target = target.id;
    advance(state, 1);
    expect(target.hp).toBe(100);
  });

  it('releases an impossible move order so the leader can defend itself', () => {
    const state = fixture(), leader = getLeader(state)!, warrior = enemy(state);
    warrior.x = 20.5; warrior.y = 19.5;
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 21].terrain = 'river';
    state.world.revision = (state.world.revision ?? 0) + 1;
    leader.destination = { x: 24.5, y: 20.5 };
    expect(findPath(state, leader, leader.destination, 0)).toEqual([]);
    advance(state, 1);
    expect(leader.destination).toBeUndefined();
    expect(warrior.hp).toBeLessThan(100);
    expect(leader.x).toBe(20.5);
  });

  it('keeps a reachable order while a unit temporarily occupies its route', () => {
    const state = fixture(), leader = getLeader(state)!, warrior = state.units[1]; warrior.order = 'hold';
    for (let x = 0; x < state.world.width; x++) for (const y of [19, 21]) building(state, 'wall', x, y).faction = 0;
    leader.destination = { x: 24.5, y: 20.5 };
    advance(state, 1);
    expect(leader.destination).toEqual({ x: 24.5, y: 20.5 });
    warrior.y = 17.5;
    advance(state, 3);
    expect(leader.x).toBeCloseTo(24.5);
    expect(leader.destination).toBeUndefined();
  });
});

describe('cooperative unit traffic', () => {
  const noSharedCells = (state: GameState) => {
    const units = state.units.filter(unit => unit.hp > 0 && !unit.inside && !(unit.kind === 'leader' && unit.faction === 0));
    expect(new Set(units.map(unit => `${Math.floor(unit.x)},${Math.floor(unit.y)}`)).size).toBe(units.length);
  };

  it('lets the leader pass an idle peasant without displacing the peasant', () => {
    const state = fixture(), leader = getLeader(state)!, worker = state.units[1];
    entityStore(state).setUnitRole(worker, { kind: 'worker' }); worker.order = 'work';
    for (let x = 18; x <= 25; x++) for (const y of [19, 21]) building(state, 'wall', x, y).faction = 0;
    leader.destination = { x: 28.5, y: 20.5 };
    for (let i = 0; i < 90; i++) updateGame(state, .1, idle);
    expect(leader.x).toBeCloseTo(28.5);
    expect(worker.order).toBe('work');
    expect(worker.x).toBe(21.5);
  });

  it('passes a chain of held allies in a narrow corridor without entering walls or moving the allies', () => {
    const state = fixture(), leader = getLeader(state)!, first = state.units[1]; first.order = 'hold';
    entityStore(state).units.add(...Array.from({ length: 3 }, (_, i) => ({ ...first, id: first.id + 100 + i, x: 22.5 + i })));
    for (let x = 17; x < 35; x++) for (const y of [19, 21]) building(state, 'wall', x, y).faction = 0;
    for (let i = 0; i < 80; i++) {
      const before = state.units.map(unit => ({ ...unit }));
      updateGame(state, .1, { ...idle, right: true }); noSharedCells(state);
      for (const previous of before.filter(value => !value.inside)) {
        const unit = state.units.find(value => value.id === previous.id)!;
        expect(canMove(state, previous, unit, unit.faction)).toBe(true);
        if (unit.kind !== 'leader') expect(distance(previous, unit)).toBe(0);
      }
    }
    expect(leader.x).toBeGreaterThan(30);
    expect(state.units.filter(unit => unit.kind === 'warrior').every(unit => unit.order === 'hold')).toBe(true);
  });

  it('lets opposing friendly traffic pass using a one-cell side pocket', () => {
    const state = fixture(), left = getLeader(state)!, right = state.units[1];
    entityStore(state).setUnitRole(right, { kind: 'leader' }); right.x = 24.5; right.destination = { x: 18.5, y: 20.5 };
    left.destination = { x: 28.5, y: 20.5 };
    for (let x = 15; x <= 33; x++) for (const y of [18, 19, 21]) if (!(x === 23 && y === 19)) building(state, 'wall', x, y).faction = 0;
    for (let i = 0; i < 140; i++) { updateGame(state, .1, idle); noSharedCells(state); }
    expect(Math.abs(left.x - 28.5)).toBeLessThan(.22); expect(Math.abs(right.x - 18.5)).toBeLessThan(.22);
  });

  it('completes perpendicular Leader crossing orders without abandoning either order', () => {
    const state = fixture(), horizontal = getLeader(state)!, vertical = state.units[1];
    entityStore(state).setUnitRole(vertical, { kind: 'leader' }); vertical.x = 23.5; vertical.y = 17.5; vertical.destination = { x: 23.5, y: 25.5 };
    horizontal.destination = { x: 29.5, y: 20.5 };
    for (let i = 0; i < 80; i++) { updateGame(state, .1, idle); noSharedCells(state); }
    expect(distance(horizontal, { x: 29.5, y: 20.5 })).toBeLessThan(.22);
    expect(distance(vertical, { x: 23.5, y: 25.5 })).toBeLessThan(.22);
  });

  it('brings a large retinue through a gate without permanently pinning the leader', () => {
    const state = fixture(), leader = getLeader(state)!, first = state.units[1];
    first.x = 19.5; first.y = 20.5;
    entityStore(state).units.add(...Array.from({ length: 10 }, (_, i) => ({ ...first, id: first.id + 100 + i, x: 17.5 + i % 3, y: 17.5 + Math.floor(i / 3) })));
    // Keep every initial unit in a unique cell.
    state.units.at(-1)!.x = 16.5;
    for (let y = 0; y < state.world.height; y++) if (y !== 20) building(state, 'wall', 23, y).faction = 0;
    leader.destination = { x: 29.5, y: 20.5 };
    for (let i = 0; i < 220; i++) { updateGame(state, .1, idle); noSharedCells(state); }
    expect(leader.x).toBeCloseTo(29.5);
    expect(state.units.filter(unit => unit.kind === 'warrior').every(unit => unit.x > 23)).toBe(true);
    expect(Math.max(...state.units.filter(unit => unit.kind === 'warrior').map(unit => distance(unit, leader)))).toBeLessThan(4.5);
  });
});
