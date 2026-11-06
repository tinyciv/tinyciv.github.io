import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { createGame, getLeader, setRetinueOrder, updateGame } from '../src/game/simulation';
import { retinueFormation } from '../src/game/formation';
import { canMove } from '../src/game/pathfinding';
import { type GameState, type Unit, type World, distance } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(count = 4): GameState {
  const world: World = { width: 72, height: 48, seed: 'formation-journey', source: 'fixture', spawns: [{ x: 6, y: 6 }], tiles: Array.from({ length: 72 * 48 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .6, variation: .4, food: 2, production: 2, gold: 1 })) };
  const state = createGame(world), leader = getLeader(state)!, warrior = state.units.find(unit => unit.kind === 'warrior')!;
  state.marauderPacks = []; entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace')); state.fields = []; state.factions[0].population = 0; state.factions[0].nextRetinueAt = Infinity;
  for (const tile of world.tiles) delete tile.farm;
  Object.assign(leader, { x: 20.5, y: 20.5, facing: 0 });
  entityStore(state).units.replace([leader, ...Array.from({ length: count }, (_, i) => ({ ...warrior, id: 500 + i, x: 17.5 - Math.floor(i / 4), y: 18.5 + i % 4, facing: 0 }))]);
  return state;
}
const followers = (state: GameState): Unit[] => state.units.filter(unit => unit.kind === 'warrior');
function safeStep(state: GameState, right = false): void {
  const before = new Map(state.units.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
  updateGame(state, .1, { ...idle, right });
  const cells = state.units.filter(unit => !unit.inside).map(unit => Math.floor(unit.y) * state.world.width + Math.floor(unit.x));
  expect(new Set(cells).size).toBe(cells.length);
  for (const unit of state.units) if (!unit.inside && before.has(unit.id)) expect(canMove(state, before.get(unit.id)!, unit, unit.faction), JSON.stringify({ time: state.time, unit: unit.id, from: before.get(unit.id), to: { x: unit.x, y: unit.y } })).toBe(true);
}

describe('retinue marching formation', () => {
  it('marches abreast behind the leader and faces the travel direction', () => {
    const state = fixture(), leader = getLeader(state)!;
    for (let i = 0; i < 40; i++) safeStep(state);
    // A compact stationary rally needs a moment to open into the travel rank.
    for (let i = 0; i < 80; i++) safeStep(state, true);
    const escort = followers(state);
    expect(leader.x).toBeGreaterThan(44);
    expect(Math.max(...escort.map(unit => unit.x)) - Math.min(...escort.map(unit => unit.x))).toBeLessThan(1.6);
    expect(Math.max(...escort.map(unit => unit.y)) - Math.min(...escort.map(unit => unit.y))).toBeGreaterThan(3.5);
    expect(escort.every(unit => distance(unit, leader) < 4), JSON.stringify({ leader: [leader.x, leader.y], followers: escort.map(u => ({ x: u.x, y: u.y, facing: u.facing, goal: u.pathGoal })) })).toBe(true);
    expect(escort.every(unit => Math.abs(unit.facing) < .1)).toBe(true);
  });

  it('turns the formation during slow ford travel at 60 frames per second', () => {
    const state = fixture(), leader = getLeader(state)!;
    for (const tile of state.world.tiles) { tile.terrain = 'river'; tile.overlay = 'ford'; }
    state.world.revision = (state.world.revision ?? 0) + 1;
    expect(retinueFormation(state, leader).heading).toBe(0);
    for (let i = 0; i < 120; i++) updateGame(state, 1 / 60, { ...idle, up: true });
    expect(leader.y).toBeLessThan(20);
    expect(retinueFormation(state, leader).heading).toBeCloseTo(-Math.PI / 2);
  });

  it.each(['travel', 'formation'] as const)('files through a bent one-cell crossing in %s mode then reforms', mode => {
    const state = fixture(6), leader = getLeader(state)!; state.movementMode = mode;
    for (let y = 0; y < state.world.height; y++) for (let x = 25; x < state.world.width; x++) {
      const crossing = y === 20 && x <= 35 || x === 35 && y >= 20 && y <= 30 || x >= 35 && y >= 30;
      if (!crossing) state.world.tiles[y * state.world.width + x].terrain = 'river';
    }
    state.world.revision = (state.world.revision ?? 0) + 1;
    leader.destination = { x: 43.5, y: 36.5 };
    let sawColumn = false, sawSingleFile = false;
    for (let i = 0; i < 260; i++) {
      safeStep(state);
      if (leader.x > 26 && leader.x < 34) {
        sawColumn ||= retinueFormation(state, leader).mode === 'column';
        const inCrossing = followers(state).filter(unit => unit.x >= 25 && unit.x < 34);
        if (inCrossing.length >= 3) { expect(inCrossing.every(unit => Math.floor(unit.y) === 20)).toBe(true); sawSingleFile = true; }
      }
    }
    expect(sawColumn).toBe(true); expect(sawSingleFile).toBe(true);
    expect(distance(leader, { x: 43.5, y: 36.5 })).toBeLessThan(.2);
    expect(followers(state).every(unit => unit.x >= 35 && unit.y >= 30 && distance(unit, leader) < 4.5)).toBe(true);
    expect(retinueFormation(state, leader).mode).toBe('mob');
  });

  it('keeps a long column on its breadcrumbs around successive bends', () => {
    const state = fixture(32), leader = getLeader(state)!;
    for (let y = 0; y < state.world.height; y++) for (let x = 25; x < state.world.width; x++) {
      const crossing = y === 20 && x <= 40 || x === 40 && y >= 20 && y <= 35 || x >= 40 && y === 35;
      if (!crossing) state.world.tiles[y * state.world.width + x].terrain = 'river';
    }
    state.world.revision = (state.world.revision ?? 0) + 1;
    const sample = (x: number, y: number) => {
      state.time += .1; Object.assign(leader, { x, y, moving: true });
      return retinueFormation(state, leader);
    };
    for (let x = 20.5; x <= 40.5; x += .25) sample(x, 20.5);
    for (let y = 20.75; y <= 35.5; y += .25) sample(40.5, y);
    for (let x = 40.75; x <= 60.5; x += .25) sample(x, 35.5);
    const formation = retinueFormation(state, leader), goals = [...formation.goals.values()];
    expect(formation.mode).toBe('column'); expect(goals).toHaveLength(32);
    expect(new Set(goals.map(point => `${point.x},${point.y}`)).size).toBe(goals.length);
    expect(goals.some(point => point.y === 20.5)).toBe(true);
    expect(goals.some(point => point.x === 40.5 && point.y > 20.5 && point.y < 35.5)).toBe(true);
    expect(goals.some(point => point.y === 35.5 && point.x > 40.5)).toBe(true);
    for (const point of goals) {
      expect(point.x % 1).toBe(.5); expect(point.y % 1).toBe(.5);
      expect(state.world.tiles[Math.floor(point.y) * state.world.width + Math.floor(point.x)].terrain).toBe('grassland');
    }
  });

  it('keeps existing slots stable when recruits join and honors held soldiers', () => {
    const state = fixture(2), leader = getLeader(state)!;
    for (let i = 0; i < 30; i++) safeStep(state);
    const first = followers(state)[0], second = followers(state)[1], original = { x: first.x, y: first.y };
    setRetinueOrder(state, 'hold', second.id);
    const held = { x: second.x, y: second.y };
    entityStore(state).units.add({ ...first, id: 700, x: 16.5, y: 18.5, path: undefined, pathGoal: undefined });
    for (let i = 0; i < 40; i++) safeStep(state);
    expect(distance(first, original)).toBeLessThan(.2);
    expect(distance(second, held)).toBeLessThan(.2); expect(second.order).toBe('hold');
    expect(distance(state.units.find(unit => unit.id === 700)!, leader)).toBeLessThan(4);
    for (let i = 0; i < 30; i++) safeStep(state, true);
    expect(distance(first, leader)).toBeLessThan(4);
    expect(distance(second, held)).toBeLessThan(.2);
  });

  it('queues distinct cells on a narrow diagonal and unfolds after a turn', () => {
    const state = fixture(6), leader = getLeader(state)!;
    for (let y = 0; y < state.world.height; y++) for (let x = 25; x < state.world.width; x++) {
      if (!(x <= 35 && y === x - 5 || x >= 35 && y >= 30)) state.world.tiles[y * state.world.width + x].terrain = 'river';
    }
    state.world.revision = (state.world.revision ?? 0) + 1;
    leader.destination = { x: 45.5, y: 36.5 };
    let diagonalMembers = 0;
    for (let i = 0; i < 280; i++) {
      safeStep(state);
      diagonalMembers = Math.max(diagonalMembers, followers(state).filter(unit => unit.x >= 25 && unit.x < 34).length);
    }
    expect(diagonalMembers).toBeGreaterThanOrEqual(3);
    expect(distance(leader, { x: 45.5, y: 36.5 })).toBeLessThan(.2);
    expect(followers(state).every(unit => distance(unit, leader) < 4.5)).toBe(true);
    expect(retinueFormation(state, leader).mode).toBe('mob');
  });

  it('keeps the retinue together while crossing forest and slow river fords', () => {
    const state = fixture(), leader = getLeader(state)!;
    for (let y = 0; y < state.world.height; y++) for (let x = 25; x < 31; x++) {
      const tile = state.world.tiles[y * state.world.width + x];
      tile.overlay = x < 28 ? 'forest' : 'ford';
      if (x >= 28) tile.terrain = 'river';
    }
    state.world.revision = (state.world.revision ?? 0) + 1;
    leader.destination = { x: 36.5, y: 24.5 };
    const crossings = new Map(followers(state).map(unit => [unit.id, new Set<string>()]));
    for (let i = 0; i < 260; i++) {
      safeStep(state);
      for (const unit of followers(state)) {
        const overlay = state.world.tiles[Math.floor(unit.y) * state.world.width + Math.floor(unit.x)].overlay;
        if (overlay === 'forest' || overlay === 'ford') crossings.get(unit.id)!.add(overlay);
      }
    }
    expect(distance(leader, { x: 36.5, y: 24.5 })).toBeLessThan(.2);
    expect([...crossings.values()].every(overlays => overlays.size === 2)).toBe(true);
    expect(followers(state).every(unit => distance(unit, leader) < 4)).toBe(true);
  });

});
