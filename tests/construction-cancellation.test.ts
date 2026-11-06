import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { buildAt, cancelConstruction, migrateGame, moveUnit, updateGame, validateBuildAt } from '../src/game/simulation';
import { cancellationRefund, constructionProgress } from '../src/game/construction-cancellation';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { CAMP_FIELD_OFFSETS, isPendingCampField, synchronizeFarms } from '../src/game/farms';
import { canWalk, movementMultiplier } from '../src/game/pathfinding';
import { queueConstruction } from '../src/game/structures';
import { updateFog } from '../src/game/fog';
import type { Building, GameState } from '../src/game/types';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'cancel-construction', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 14.5, y: 12.5, hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 1000, production: 0,
      population: 5, culture: 10000, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'cancel-construction', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: 10000, waves: 0, pressureVersion: 2 },
  };
  state.factions.forEach(unlockBuildingResearch);
  updateFog(state); return state;
}
function extra(state: GameState, kind: Building['kind'], x: number, y: number): Building {
  const building: Building = { id: Math.max(...state.buildings.map(b => b.id), ...state.units.map(u => u.id)) + 1,
    kind, faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.add(building); return building;
}
function order(state: GameState, kind: Building['kind'] = 'house', x = 11, y = 8): Building {
  expect(buildAt(state, kind, x, y).ok).toBe(true);
  return state.buildings.at(-1)!;
}
function advanceBuilders(state: GameState, seconds: number): void {
  for (let remaining = seconds; remaining > 1e-6; remaining -= .1) {
    state.time += .1;
    for (const worker of state.units) if (worker.builder && worker.hp > 0) updateBuilder(state, worker, .1, moveUnit);
  }
}

describe('construction cancellation', () => {
  it('refunds the full paid price of an unstarted order and releases its reservation and selected panel', () => {
    const state = fixture(), house = order(state);
    expect(house.construction!.paidGold).toBe(65);
    expect(state.factions[0].gold).toBe(935);
    expect(validateBuildAt(state, 'house', 11, 8).ok).toBe(false);
    state.selected = house.id; state.selectedType = 'building';
    state.time = 120;
    expect(cancelConstruction(state, house.id)).toEqual({ ok: true, refund: 65 });
    expect(state.factions[0].gold).toBe(1000);
    expect(state.buildings.some(building => building.id === house.id)).toBe(false);
    expect(validateBuildAt(state, 'house', 11, 8).ok).toBe(true);
    expect(state.selected).toBe(2); expect(state.selectedType).toBe('unit');
    expect(cancelConstruction(state, house.id)).toEqual({ ok: false, refund: 0 });
    expect(state.factions[0].gold).toBe(1000);
  });

  it('clears the assigned peasant journey and hostile targets, then returns that peasant to the palace', () => {
    const state = fixture(), site = order(state, 'woodenTower', 12, 10);
    const worker = state.units.find(unit => unit.builder)!;
    advanceBuilders(state, 1);
    expect(worker).toMatchObject({ buildSite: site.id, buildPhase: 'outbound', inside: false });
    expect(worker.path?.length).toBeGreaterThan(0);
    const attacker = { ...state.units[0], id: 90, kind: 'warrior' as const, faction: -2, target: site.id,
      destination: { x: 12.5, y: 10.5 }, path: [{ x: 12.5, y: 10.5 }], pathGoal: { x: 12.5, y: 10.5 }, attackTime: 1, moving: true };
    entityStore(state).units.add(attacker);
    expect(cancelConstruction(state, site.id)).toEqual({ ok: true, refund: 40 });
    expect(worker).toMatchObject({ buildSite: undefined, repairSite: undefined, buildPhase: 'returning',
      target: undefined, destination: undefined, path: undefined, pathGoal: undefined, moving: false });
    expect(attacker).toMatchObject({ target: undefined, destination: undefined, path: undefined, pathGoal: undefined, attackTime: 0, moving: false });
    advanceBuilders(state, 10);
    expect(worker).toMatchObject({ home: 1, inside: true, buildPhase: 'idle', buildSite: undefined });
    expect(state.units.filter(unit => unit.builder)).toEqual([worker]);
  });

  it('lets the released worker return and take the next waiting order without adding a peasant', () => {
    const state = fixture(), first = order(state, 'woodenTower', 12, 10), next = order(state, 'woodenTower', 16, 10);
    const worker = state.units.find(unit => unit.builder)!;
    advanceBuilders(state, 1);
    expect(worker.buildSite).toBe(first.id);
    expect(cancelConstruction(state, first.id).ok).toBe(true);
    for (let step = 0; step < 150 && worker.buildSite !== next.id; step++) advanceBuilders(state, .1);
    expect(worker).toMatchObject({ buildSite: next.id, buildPhase: 'outbound', inside: false });
    expect(next.construction!.builderId).toBe(worker.id);
    expect(state.units.filter(unit => unit.builder)).toEqual([worker]);
  });

  it.each([
    { phase: 'active', time: 15, pausedAt: undefined, waitingForBuilder: false, expected: 40.63 },
    { phase: 'paused', time: 100, pausedAt: 17, waitingForBuilder: true, expected: 30.88 },
  ])('refunds only remaining work, with fractional gold preserved, for $phase construction', ({ time, pausedAt, waitingForBuilder, expected }) => {
    const state = fixture(), house = order(state);
    Object.assign(house.construction!, { startedAt: 10, pausedAt, waitingForBuilder });
    state.time = time;
    expect(cancellationRefund(state, house)).toBe(expected);
    expect(cancelConstruction(state, house.id)).toEqual({ ok: true, refund: expected });
    expect(state.factions[0].gold).toBe(935 + expected);
    expect(canWalk(state, house.x + .5, house.y + .5, 0)).toBe(true);
  });

  it.each(['completed', 'enemy', 'dead', 'game over', 'missing'] as const)('cannot cancel a %s building or alter its gold', reason => {
    const state = fixture(), site = order(state);
    if (reason === 'completed') delete site.construction;
    if (reason === 'enemy') site.faction = -2;
    if (reason === 'dead') site.hp = 0;
    if (reason === 'game over') state.gameOver = true;
    const before = state.factions[0].gold;
    expect(cancelConstruction(state, reason === 'missing' ? 999 : site.id)).toEqual({ ok: false, refund: 0 });
    expect(state.buildings).toContain(site);
    expect(state.factions[0].gold).toBe(before);
  });

  it('frees the crop reservation and their traffic reservations without creating crop fields', () => {
    const state = fixture(), farm = order(state, 'camp', 13, 8);
    expect(farm.construction!.paidGold).toBe(15);
    state.traffic = {};
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
      expect(isPendingCampField(state, farm.x + dx, farm.y + dy)).toBe(true);
      state.traffic[(farm.y + dy) * state.world.width + farm.x + dx] = [0];
    }
    expect(cancelConstruction(state, farm.id)).toEqual({ ok: true, refund: 15 });
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
      expect(isPendingCampField(state, farm.x + dx, farm.y + dy)).toBe(false);
      expect(state.world.tiles[(farm.y + dy) * state.world.width + farm.x + dx].farm).toBeUndefined();
    }
    expect(state.fields).toHaveLength(0); expect(state.traffic).toEqual({});
    expect(validateBuildAt(state, 'camp', farm.x, farm.y).ok).toBe(true);
    expect(state.factions[0].gold).toBe(1000);
  });

  it('leaves the completed road in place when cancelling an active gate wall', () => {
    const state = fixture(), road = extra(state, 'road', 12, 10), wall = order(state, 'wall', 12, 10);
    wall.construction!.waitingForBuilder = false;
    state.time = 1;
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(true);
    expect(canWalk(state, 12.5, 10.5, -2)).toBe(false);
    expect(cancelConstruction(state, wall.id)).toEqual({ ok: true, refund: 22.5 });
    expect(state.buildings).toContain(road);
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(true);
    expect(canWalk(state, 12.5, 10.5, -2)).toBe(true);
    expect(movementMultiplier(state, 12.5, 10.5)).toBe(1.5);
  });

  it('closes an existing wall to both friendly and enemy passage when its road order is cancelled', () => {
    const state = fixture(); extra(state, 'road', 11, 10);
    const wall = extra(state, 'wall', 12, 10), road = order(state, 'road', 12, 10);
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(true);
    expect(canWalk(state, 12.5, 10.5, -2)).toBe(false);
    expect(cancelConstruction(state, road.id)).toEqual({ ok: true, refund: 10 });
    expect(state.buildings).toContain(wall);
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(false);
    expect(canWalk(state, 12.5, 10.5, -2)).toBe(false);
    expect(movementMultiplier(state, 12.5, 10.5)).toBe(1);
  });

  it('moves an occupant safely off a gate before cancelling the road that keeps it passable', () => {
    const state = fixture(); extra(state, 'road', 11, 10); extra(state, 'wall', 12, 10);
    const road = order(state, 'road', 12, 10), leader = state.units[0];
    leader.x = 12.5; leader.y = 10.5;
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
    expect(cancelConstruction(state, road.id)).toEqual({ ok: true, refund: 10 });
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
    expect(Math.floor(leader.x) !== 12 || Math.floor(leader.y) !== 10).toBe(true);
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(false);
  });

  it('keeps an enclosed gate open without refunding or teleporting its occupant when cancellation is unsafe', () => {
    const state = fixture(); extra(state, 'road', 11, 10); extra(state, 'wall', 12, 10);
    const road = order(state, 'road', 12, 10), leader = state.units[0];
    leader.x = 12.5; leader.y = 10.5;
    // Open land exists beyond this ring, but the occupant cannot cross it.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) state.world.tiles[(10 + dy) * state.world.width + 12 + dx].terrain = 'lake';
    }
    const gold = state.factions[0].gold;
    expect(cancelConstruction(state, road.id)).toEqual({ ok: false, refund: 0 });
    expect(state.factions[0].gold).toBe(gold);
    expect(state.buildings).toContain(road);
    expect(leader).toMatchObject({ x: 12.5, y: 10.5 });
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
    // Once an actual exit opens, the same cancellation can safely complete.
    state.world.tiles[10 * state.world.width + 11].terrain = 'grassland';
    expect(cancelConstruction(state, road.id)).toEqual({ ok: true, refund: 10 });
    expect(leader).toMatchObject({ x: 11.5, y: 10.5 });
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
  });

  it.each([['camp', 15, 13, 8], ['house', 65, 11, 8]] as const)('preserves the actual paid price of a new %s through save migration', (kind, paid, x, y) => {
    const state = fixture(), site = order(state, kind, x, y);
    const restored = migrateGame(JSON.parse(JSON.stringify(state)) as GameState);
    const loaded = restored.buildings.find(building => building.id === site.id)!;
    expect(loaded.construction!.paidGold).toBe(paid);
    expect(cancelConstruction(restored, loaded.id)).toEqual({ ok: true, refund: paid });
    expect(restored.factions[0].gold).toBe(1000);
  });

  it.each([['camp', 300, 13, 8], ['house', 500, 11, 8]] as const)('recovers the original %s price for legacy orders without a recorded payment', (kind, paid, x, y) => {
    const state = fixture(), site = order(state, kind, x, y);
    delete site.construction!.paidGold;
    state.factions[0].gold = 1000 - paid;
    const restored = migrateGame(JSON.parse(JSON.stringify(state)) as GameState);
    const loaded = restored.buildings.find(building => building.id === site.id)!;
    expect(loaded.construction!.paidGold).toBe(paid);
    migrateGame(restored);
    expect(cancelConstruction(restored, loaded.id)).toEqual({ ok: true, refund: paid });
    expect(restored.factions[0].gold).toBe(1000);
  });

  it('never grants gold for an unpaid tower order, including a legacy save', () => {
    const state = fixture(), tower = extra(state, 'tower', 17, 8);
    queueConstruction(tower, state.time); ensureBuilders(state);
    expect(tower.construction!.paidGold).toBe(0);
    delete tower.construction!.paidGold;
    const restored = migrateGame(JSON.parse(JSON.stringify(state)) as GameState);
    expect(restored.buildings.find(building => building.id === tower.id)!.construction!.paidGold).toBe(0);
    expect(cancelConstruction(restored, tower.id)).toEqual({ ok: true, refund: 0 });
    expect(restored.factions[0].gold).toBe(1000);
  });

  it('clamps progress and never refunds more than the recorded payment or a negative amount', () => {
    const state = fixture(), site = order(state);
    site.construction!.waitingForBuilder = false;
    site.construction!.startedAt = 10;
    state.time = 5;
    expect(constructionProgress(state, site)).toBe(0); expect(cancellationRefund(state, site)).toBe(65);
    state.time = 100;
    expect(constructionProgress(state, site)).toBe(1); expect(cancellationRefund(state, site)).toBe(0);
    site.construction!.paidGold = -10;
    expect(cancellationRefund(state, site)).toBe(0);
  });

  it.each([['camp', 15, 13, 8], ['house', 65, 11, 8]] as const)('still accepts manual %s orders during the automatic expansion pause', (kind, price, x, y) => {
    const state = fixture(), site = order(state, kind, x, y);
    expect(cancelConstruction(state, site.id).ok).toBe(true);
    expect(state.buildings.find(building => building.kind === 'palace')!.governorPauseUntil?.[kind]).toBe(30);
    expect(buildAt(state, kind, x, y).ok).toBe(true);
    expect(state.factions[0].gold).toBe(1000 - price);
    expect(state.buildings.at(-1)).toMatchObject({ kind, x, y, construction: { paidGold: price, waitingForBuilder: true } });
  });

  it('skips the next house economy tick after cancellation, then resumes building with a food surplus', () => {
    const state = fixture(), house = order(state);
    // Fund housing with enough nearby farmland under the lower-yield economy.
    for (const [x, y] of [[2, 8], [2, 12], [4, 6], [6, 6], [8, 6], [8, 13], [10, 13], [12, 13]])
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) extra(state, 'camp', x + dx, y + dy);
    synchronizeFarms(state);
    state.time = 29.9;
    expect(cancelConstruction(state, house.id).ok).toBe(true);
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(state.tick).toBe(1);
    expect(state.factions[0].yields.food).toBeGreaterThan(0);
    expect(state.buildings.filter(building => building.kind === 'house')).toHaveLength(0);
    state.time = 59.9;
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(state.tick).toBe(2);
    expect(state.buildings.filter(building => building.kind === 'house' && building.construction)).toHaveLength(2);
  });

  it('skips a needed farm expansion during its cancellation pause and resumes at the next eligible economy tick', () => {
    const state = fixture(), farm = order(state, 'camp', 13, 8);
    state.time = 59.9; state.tick = 1;
    expect(cancelConstruction(state, farm.id).ok).toBe(true);
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(state.tick).toBe(2);
    expect(state.factions[0].yields.food).toBeLessThan(0);
    expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(0);
    state.time = 119.9; state.tick = 3;
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(state.tick).toBe(4);
    expect(state.buildings.filter(building => building.kind === 'camp' && building.construction)).toHaveLength(4);
  });
});
