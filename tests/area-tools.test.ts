import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildingsInArea, cancelConstructionInArea, clearArea, demolishBuildingsInArea, tilesInRectangle } from '../src/game/area-tools';
import { ensureBuilders } from '../src/game/builders';
import { ensureCollectors, synchronizeFarms } from '../src/game/farms';
import { canWalk, invalidateNavigation } from '../src/game/pathfinding';
import { queueConstruction } from '../src/game/structures';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import type { Building, GameState } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 24, height: 20, seed: 'area-tools', source: 'test', spawns: [], tiles: Array.from({ length: 480 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 3, y: 8, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 6.5, y: 9.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 1000, production: 0,
      population: 5, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'area-tools', rngState: 1,
  };
}
function add(state: GameState, kind: Building['kind'], x: number, y: number, faction = 0): Building {
  const building: Building = { id: Math.max(...state.buildings.map(b => b.id), ...state.units.map(u => u.id)) + 1,
    kind, faction, x, y, hp: 100, maxHp: 100, capacity: kind === 'house' ? 4 : 0 };
  entityStore(state).buildings.add(building); return building;
}

describe('rectangular area tools', () => {
  it('covers the entire rectangle in either drag direction and clamps it to the map', () => {
    const state = fixture();
    const points = tilesInRectangle(state, { x: 4.9, y: 6.1 }, { x: 2.2, y: 3.9 });
    expect(points).toHaveLength(12);
    expect(points).toContainEqual({ x: 3, y: 5 });
    expect(points).toEqual(tilesInRectangle(state, { x: 2.2, y: 3.9 }, { x: 4.9, y: 6.1 }));
    expect(tilesInRectangle(state, { x: -5, y: -2 }, { x: 1, y: 1 })).toHaveLength(4);
    expect(tilesInRectangle(state, { x: -5, y: -2 }, { x: -1, y: -1 })).toEqual([]);
    expect(tilesInRectangle(state, { x: NaN, y: 2 }, { x: 5, y: 5 })).toEqual([]);
  });

  it('cancels only friendly unfinished orders, refunds remaining work, and releases jobs and targeting', () => {
    const state = fixture(), full = add(state, 'house', 8, 8), partial = add(state, 'woodenTower', 9, 9);
    queueConstruction(full, 0, 125); queueConstruction(partial, 0, 40);
    partial.construction!.waitingForBuilder = false;
    const complete = add(state, 'house', 8, 9), enemy = add(state, 'wall', 9, 8, 1);
    queueConstruction(enemy, 0, 6);
    const outside = add(state, 'house', 10, 10); queueConstruction(outside, 0, 125);
    ensureBuilders(state);
    const builder = state.units.find(unit => unit.builder)!;
    Object.assign(builder, { buildSite: full.id, inside: false, buildPhase: 'outbound', target: full.id,
      destination: { x: 8, y: 8 }, path: [{ x: 8, y: 8 }], moving: true });
    state.selected = full.id; state.selectedType = 'building';
    state.projectiles = [{ x: 7, y: 8, start: { x: 7, y: 8 }, end: { x: 8, y: 8 }, attacker: 90, target: full.id,
      faction: 1, damage: 3, elapsed: 0, duration: 1 }];
    state.time = 7.5;
    expect(cancelConstructionInArea(state, { x: 9, y: 9 }, { x: 8, y: 8 })).toMatchObject({ ok: true, count: 2, refund: 145, skipped: 0 });
    expect(state.factions[0].gold).toBe(1145);
    expect(state.buildings).toEqual([state.buildings[0], complete, enemy, outside]);
    expect(builder).toMatchObject({ buildSite: undefined, target: undefined, destination: undefined, path: undefined, buildPhase: 'returning' });
    expect(state.projectiles).toEqual([]);
    expect(state.selected).toBe(2); expect(state.selectedType).toBe('unit');
    expect(cancelConstructionInArea(state, { x: 8, y: 8 }, { x: 9, y: 9 }).count).toBe(0);
    expect(state.factions[0].gold).toBe(1145);
  });

  it('demolishes a farm from its crop tile and removes fields, couriers, yields and road reservations without a refund', () => {
    const state = fixture(), farm = add(state, 'camp', 10, 9);
    synchronizeFarms(state); ensureCollectors(state);
    expect(state.fields).toHaveLength(1);
    expect(state.units.some(unit => unit.collectorCamp === farm.id)).toBe(true);
    const corner = { x: 10, y: 9 }, key = corner.y * state.world.width + corner.x;
    state.traffic = { [key]: [0, 1] };
    expect(buildingsInArea(state, corner, corner)).toEqual([farm]);
    expect(demolishBuildingsInArea(state, corner, corner)).toMatchObject({ ok: true, count: 1, refund: 0 });
    expect(state.factions[0].gold).toBe(1000);
    expect(state.factions[0].yields.food).toBe(-5);
    expect(state.buildings.find(building => building.kind === 'palace')!.governorPauseUntil?.camp).toBe(30);
    expect(state.fields).toEqual([]);
    expect(state.units.some(unit => unit.collectorCamp === farm.id)).toBe(false);
    expect(state.world.tiles.some(tile => tile.farm !== undefined)).toBe(false);
    expect(state.traffic).toEqual({});
  });

  it('removes both layers of a friendly gate and foreign property inside borders without displacing occupants', () => {
    const state = fixture(), road = add(state, 'road', 8, 8), wall = add(state, 'wall', 8, 8);
    const enemy = add(state, 'house', 9, 8, 1), leader = state.units[0];
    leader.x = 8.5; leader.y = 8.5;
    expect(demolishBuildingsInArea(state, { x: 8, y: 8 }, { x: 9, y: 8 })).toMatchObject({ count: 3, skipped: 0 });
    expect(state.buildings).not.toContain(road); expect(state.buildings).not.toContain(wall); expect(state.buildings).not.toContain(enemy);
    expect(leader).toMatchObject({ x: 8.5, y: 8.5 });
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
  });

  it('keeps an occupied bridge if there is no safe shore, then evacuates its occupant when an exit exists', () => {
    const state = fixture(), bridge = add(state, 'bridge', 12, 9), leader = state.units[0];
    for (let y = 3; y < 16; y++) for (let x = 6; x < 19; x++) state.world.tiles[y * 24 + x].terrain = 'lake';
    state.world.tiles[9 * 24 + 12].terrain = 'river';
    leader.x = 12.5; leader.y = 9.5;
    expect(demolishBuildingsInArea(state, bridge, bridge)).toMatchObject({ count: 0, skipped: 1 });
    expect(state.buildings).toContain(bridge); expect(leader).toMatchObject({ x: 12.5, y: 9.5 });
    state.world.tiles[9 * 24 + 11].terrain = 'grassland'; invalidateNavigation(state);
    expect(demolishBuildingsInArea(state, bridge, bridge)).toMatchObject({ count: 1, skipped: 0 });
    expect(leader).toMatchObject({ x: 11.5, y: 9.5 });
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
    expect(canWalk(state, 12.5, 9.5, 0)).toBe(false);
  });

  it('reassigns palace workers to another palace and ends the realm only when its final palace is demolished', () => {
    const state = fixture(), first = state.buildings[0], second = add(state, 'palace', 15, 8);
    ensureBuilders(state);
    const worker = state.units.find(unit => unit.builder)!;
    expect(worker.home).toBe(first.id);
    expect(demolishBuildingsInArea(state, { x: 4, y: 9 }, { x: 4, y: 9 }).count).toBe(1);
    expect(worker.home).toBe(second.id); expect(state.gameOver).toBe(false);
    expect(demolishBuildingsInArea(state, second, second).count).toBe(1);
    expect(state.gameOver).toBe(true); expect(state.victory).toBe(false); expect(state.factions[0].defeated).toBe(true);
    expect(state.units.some(unit => unit.builder || unit.collector)).toBe(false);
  });

  it('recomputes housing and pauses automatic replacement after demolition', () => {
    const state = fixture(), first = add(state, 'house', 8, 8), second = add(state, 'house', 9, 8);
    synchronizeFarms(state);
    expect(demolishBuildingsInArea(state, first, first).count).toBe(1);
    expect(state.factions[0].population).toBe(2);
    expect(second.residents).toBe(2);
    expect(state.buildings.find(building => building.kind === 'palace')!.governorPauseUntil?.house).toBe(30);
    expect(state.gameOver).toBe(false);
  });
});

describe('unified clearing', () => {
  it('clears mixed targets, refunds only friendly unfinished work, and never refunds or queues twice', () => {
    const state = fixture(), full = add(state, 'house', 8, 8), partial = add(state, 'woodenTower', 9, 9);
    add(state, 'house', 3, 6);
    queueConstruction(full, 0, 125); queueConstruction(partial, 0, 40);
    partial.construction!.waitingForBuilder = false;
    const complete = add(state, 'house', 8, 9), enemy = add(state, 'guardPost', 7, 8, 1);
    queueConstruction(enemy, 0, 200);
    const outside = add(state, 'woodenTower', 22, 15, 1);
    state.world.tiles[9 * 24 + 12].overlay = 'forest';
    state.time = 7.5;
    const start = { x: 7, y: 8 }, end = { x: 22, y: 15 };
    expect(clearArea(state, end, start)).toMatchObject({ ok: true, count: 5, refund: 145, skipped: 0 });
    expect(state.factions[0].gold).toBe(1145);
    for (const removed of [full, partial, complete, enemy]) expect(state.buildings).not.toContain(removed);
    expect(state.buildings).toContain(outside);
    expect(state.treeClearings).toEqual([{ x: 12, y: 9, faction: 0 }]);
    expect(state.world.tiles[9 * 24 + 12].overlay).toBe('forest');
    expect(state.units.some(unit => unit.builder)).toBe(true);
    expect(clearArea(state, start, end)).toMatchObject({ ok: false, count: 0, refund: 0, skipped: 0 });
    expect(state.factions[0].gold).toBe(1145);
    expect(state.treeClearings).toHaveLength(1);
  });

  it('removes a completed gate wall before cancelling its road, without moving a trapped occupant', () => {
    const state = fixture(), road = add(state, 'road', 8, 8), wall = add(state, 'wall', 8, 8);
    queueConstruction(road, 0, 2);
    for (let y = 7; y <= 9; y++) for (let x = 7; x <= 9; x++)
      if (x !== 8 || y !== 8) state.world.tiles[y * 24 + x].terrain = 'lake';
    const leader = state.units[0]; leader.x = 8.5; leader.y = 8.5;
    expect(clearArea(state, road, road)).toMatchObject({ ok: true, count: 2, refund: 2, skipped: 0 });
    expect(state.buildings).not.toContain(road); expect(state.buildings).not.toContain(wall);
    expect(leader).toMatchObject({ x: 8.5, y: 8.5 });
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
  });

  it('retains a rejected road cancellation and its refund when an unowned wall would trap its occupant', () => {
    const state = fixture(), road = add(state, 'road', 20, 9), wall = add(state, 'wall', 20, 9, 1);
    queueConstruction(road, 0, 2);
    for (let y = 8; y <= 10; y++) for (let x = 19; x <= 21; x++)
      if (x !== 20 || y !== 9) state.world.tiles[y * 24 + x].terrain = 'lake';
    const leader = state.units[0]; leader.x = 20.5; leader.y = 9.5;
    expect(buildingsInArea(state, road, road, 0, true)).toEqual([road]);
    expect(clearArea(state, road, road)).toMatchObject({ ok: false, count: 0, refund: 0, skipped: 1 });
    expect(state.buildings).toContain(road); expect(state.buildings).toContain(wall);
    expect(state.factions[0].gold).toBe(1000);
    expect(leader).toMatchObject({ x: 20.5, y: 9.5 });
    state.world.tiles[9 * 24 + 19].terrain = 'grassland'; invalidateNavigation(state);
    expect(clearArea(state, road, road)).toMatchObject({ ok: true, count: 1, refund: 2, skipped: 0 });
    expect(state.buildings).not.toContain(road); expect(state.buildings).toContain(wall);
    expect(leader).toMatchObject({ x: 19.5, y: 9.5 });
    expect(clearArea(state, road, road)).toMatchObject({ count: 0, refund: 0 });
    expect(state.factions[0].gold).toBe(1002);
  });

  it.each([false, true])('preserves an occupied bridge without a safe exit (construction: %s)', unfinished => {
    const state = fixture(), bridge = add(state, 'bridge', 12, 9), leader = state.units[0];
    if (unfinished) queueConstruction(bridge, 0, 30);
    for (let y = 8; y <= 10; y++) for (let x = 11; x <= 13; x++) state.world.tiles[y * 24 + x].terrain = 'lake';
    leader.x = 12.5; leader.y = 9.5;
    expect(clearArea(state, bridge, bridge)).toMatchObject({ count: 0, refund: 0, skipped: 1 });
    expect(state.buildings).toContain(bridge);
    state.world.tiles[9 * 24 + 11].terrain = 'grassland'; invalidateNavigation(state);
    // An unfinished bridge does not make water walkable; its artificially
    // placed occupant must leave before that reservation can be cancelled.
    if (unfinished) { leader.x = 11.5; leader.y = 9.5; }
    expect(clearArea(state, bridge, bridge)).toMatchObject({ count: 1, refund: unfinished ? 30 : 0, skipped: 0 });
    expect(state.buildings).not.toContain(bridge);
    expect(leader).toMatchObject({ x: 11.5, y: 9.5 });
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
  });

  it('preserves tree range and forbidden-zone restrictions without counting empty ground as skipped', () => {
    const state = fixture();
    for (const x of [10, 12, 20]) state.world.tiles[9 * 24 + x].overlay = 'forest';
    setForbiddenRectangle(state, { x: 12, y: 9 }, { x: 12, y: 9 }, true);
    expect(clearArea(state, { x: 10, y: 9 }, { x: 20, y: 9 })).toMatchObject({ count: 1, refund: 0, skipped: 2 });
    expect(state.treeClearings).toEqual([{ x: 10, y: 9, faction: 0 }]);
    expect(state.factions[0].gold).toBe(1000);
  });
});
