import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildingAtPoint } from '../src/game/hit-testing';
import { buildingBlockers } from '../src/game/pathfinding';
import { interactAt, selectAt } from '../src/game/simulation';
import { type Building, type GameState, type Unit } from '../src/game/types';

const structure = (id: number, kind: Building['kind'], x = 10, y = 10, faction = 0): Building => ({
  id, kind, x, y, faction, hp: 100, maxHp: 100, capacity: 0,
});
const unit = (id: number, kind: Unit['kind'], x: number, y: number): Unit => ({
  id, kind, faction: 0, x, y, hp: 100, morale: 100, attack: 25, defense: 4,
  speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0,
});
function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'tower-pointing', source: 'test', spawns: [],
      tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [unit(1, 'leader', 7.5, 10.5)], buildings: [],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 500, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'tower-pointing', rngState: 1, fields: [], marauderPacks: [],
  };
}

describe('pointing at tall structures', () => {
  it('selects the mounted tower top and its wall face independently in either build order', () => {
    const state = fixture(), tower = structure(2, 'woodenTower'), wall = structure(3, 'wall');
    for (const buildings of [[tower, wall], [wall, tower]]) {
      entityStore(state).buildings.replace(buildings);
      for (const point of [{ x: 10.5, y: 9.5 }, { x: 10.5, y: 10.1 }])
        expect(buildingAtPoint(state, point)).toBe(tower);
      expect(buildingAtPoint(state, { x: 10.5, y: 10.8 })).toBe(wall);
      selectAt(state, 10.5, 9.5); expect(state.selected).toBe(tower.id);
      selectAt(state, 10.5, 10.8); expect(state.selected).toBe(wall.id);
    }
  });

  it('keeps either shared construction order selectable for cancellation', () => {
    const state = fixture();
    for (const pending of ['woodenTower', 'wall'] as const) for (const reverse of [false, true]) {
      const tower = structure(2, 'woodenTower'), wall = structure(3, 'wall');
      const site = pending === 'woodenTower' ? tower : wall;
      site.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
      entityStore(state).buildings.replace(reverse ? [wall, tower] : [tower, wall]);
      expect(buildingAtPoint(state, { x: 10.5, y: pending === 'woodenTower' ? 10.2 : 9.5 })).toBe(tower);
      expect(buildingAtPoint(state, { x: 10.5, y: 10.8 })).toBe(wall);
    }
  });

  it('restores full-tile selection when either wall/tower layer is destroyed', () => {
    const state = fixture(), tower = structure(2, 'woodenTower'), wall = structure(3, 'wall');
    entityStore(state).buildings.replace([tower, wall]); wall.hp = 0;
    expect(buildingAtPoint(state, { x: 10.5, y: 10.8 })).toBe(tower);
    wall.hp = 100; tower.hp = 0;
    expect(buildingAtPoint(state, { x: 10.5, y: 10.1 })).toBe(wall);
    expect(buildingAtPoint(state, { x: 10.5, y: 9.5 })).toBeUndefined();
  });

  it.each(['tower', 'woodenTower'] as const)('selects and attacks the visible upper storey of a %s without adding collision cells', kind => {
    const state = fixture(), tower = structure(2, kind, 10, 10, -2);
    entityStore(state).buildings.add(tower);
    selectAt(state, 10.5, 9.5);
    expect(state.selected).toBe(tower.id); expect(state.selectedType).toBe('building');
    expect(state.units[0].target).toBeUndefined();
    interactAt(state, 10.5, 9.5);
    expect(state.units[0].target).toBe(tower.id);
    expect([...buildingBlockers(state, 0)]).toEqual([10 * 32 + 10]);
  });

  it('selects the southern tower obscuring a northern building, independent of array order', () => {
    const state = fixture(), house = structure(2, 'house', 10, 9), tower = structure(3, 'woodenTower');
    for (const buildings of [[house, tower], [tower, house]]) {
      entityStore(state).buildings.replace(buildings);
      expect(buildingAtPoint(state, { x: 10.5, y: 9.75 })?.id).toBe(tower.id);
    }
  });

  it('keeps units selectable in front of overlapping tower artwork', () => {
    const state = fixture(), warrior = unit(3, 'warrior', 10.5, 10.1);
    entityStore(state).buildings.add(structure(2, 'woodenTower')); entityStore(state).units.add(warrior);
    selectAt(state, 10.5, 9.75);
    expect(state.selected).toBe(warrior.id); expect(state.selectedType).toBe('unit');
    interactAt(state, 10.5, 9.75);
    expect(state.selected).toBe(warrior.id); expect(state.units[0].target).toBeUndefined();
  });

  it('does not extend the click area of an unfinished tower into the tile behind it', () => {
    const state = fixture(), tower = structure(2, 'tower');
    tower.construction = { startedAt: 0, duration: 25 };
    entityStore(state).buildings.add(tower);
    expect(buildingAtPoint(state, { x: 10.5, y: 9.5 })).toBeUndefined();
    expect(buildingAtPoint(state, { x: 10.5, y: 10.5 })).toBe(tower);
  });

  it('does not reveal hidden enemy towers through their upper-storey click area', () => {
    const state = fixture(), tower = structure(2, 'tower', 28, 20, -2);
    entityStore(state).buildings.add(tower);
    expect(buildingAtPoint(state, { x: 28.5, y: 19.5 })).toBeUndefined();
    selectAt(state, 28.5, 19.5); expect(state.selected).toBeNull();
    interactAt(state, 28.5, 19.5); expect(state.units[0].target).toBeUndefined();
  });

  it('ignores ground routes and destroyed structures', () => {
    const state = fixture(), tower = { ...structure(2, 'tower'), hp: 0 };
    entityStore(state).buildings.add(tower, structure(3, 'road'), structure(4, 'bridge'));
    expect(buildingAtPoint(state, { x: 10.5, y: 10.5 })).toBeUndefined();
  });
});

describe('selecting construction sites for cancellation', () => {
  it.each(['road', 'bridge', 'wall', 'camp', 'house'] as const)('selects an unfinished %s without issuing a move or attack order', kind => {
    const state = fixture(), site = structure(2, kind);
    site.construction = { startedAt: 0, duration: 15, waitingForBuilder: true };
    entityStore(state).buildings.add(site);
    selectAt(state, 10.5, 10.5);
    expect(state.selected).toBe(site.id);
    expect(state.selectedType).toBe('building');
    expect(state.units[0].target).toBeUndefined();
    expect(state.units[0].destination).toBeUndefined();
  });

  it('selects the farm cell for construction or activities, but not neighboring ground', () => {
    const state = fixture(), site = structure(2, 'camp');
    site.construction = { startedAt: 0, duration: 15 };
    entityStore(state).buildings.add(site);
    for (let y = 10; y <= 10; y++) for (let x = 10; x <= 10; x++) {
      selectAt(state, x + .5, y + .5);
      expect(state.selected).toBe(site.id);
      expect(state.selectedType).toBe('building');
    }
    for (const point of [{ x: 9.5, y: 10.5 }, { x: 11, y: 10.5 }, { x: 10.5, y: 9.5 }, { x: 10.5, y: 11 }])
      expect(buildingAtPoint(state, point)).toBeUndefined();
    delete site.construction;
    expect(buildingAtPoint(state, { x: 10.5, y: 10.5 })).toBe(site);
  });

  it.each(['road', 'wall'] as const)('selects the unfinished %s gate layer regardless of array order', kind => {
    const state = fixture(), site = structure(2, kind), finished = structure(3, kind === 'road' ? 'wall' : 'road');
    site.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
    for (const buildings of [[site, finished], [finished, site]]) {
      entityStore(state).buildings.replace(buildings);
      selectAt(state, 10.5, 10.5);
      expect(state.selected).toBe(site.id);
    }
  });

  it('ignores hidden enemy construction and destroyed sites', () => {
    const state = fixture(), hidden = structure(2, 'camp', 28, 20, -2), destroyed = structure(3, 'road');
    hidden.construction = destroyed.construction = { startedAt: 0, duration: 15 };
    destroyed.hp = 0;
    entityStore(state).buildings.add(hidden, destroyed);
    expect(buildingAtPoint(state, { x: 27.5, y: 19.5 })).toBeUndefined();
    expect(buildingAtPoint(state, { x: 10.5, y: 10.5 })).toBeUndefined();
  });
});

describe('selecting houses with front-left wells', () => {
  it('selects the well overhang or the house entrance independently of build order', () => {
    const state = fixture(), house = structure(2, 'house'), well = structure(3, 'well');
    for (const buildings of [[house, well], [well, house]]) {
      entityStore(state).buildings.replace(buildings);
      for (const point of [{ x: 9.9, y: 10.7 }, { x: 10.2, y: 10.8 }, { x: 10.2, y: 11.05 }]) {
        selectAt(state, point.x, point.y);
        expect(state.selected).toBe(well.id);
      }
      selectAt(state, 10.5, 10.9);
      expect(state.selected).toBe(house.id);
      expect(buildingAtPoint(state, { x: 9.9, y: 10.2 })).toBeUndefined();
      expect(buildingAtPoint(state, { x: 10.2, y: 11.2 })).toBeUndefined();
    }
    expect([...buildingBlockers(state, 0)]).toEqual([10 * 32 + 10]);
  });

  it.each(['house', 'well'] as const)('keeps an unfinished %s independently selectable', kind => {
    const state = fixture(), house = structure(2, 'house'), well = structure(3, 'well');
    (kind === 'house' ? house : well).construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    for (const buildings of [[house, well], [well, house]]) {
      entityStore(state).buildings.replace(buildings);
      expect(buildingAtPoint(state, { x: 10.6, y: 10.7 })).toBe(house);
      expect(buildingAtPoint(state, { x: 9.9, y: 10.8 })).toBe(well);
    }
  });

  it('picks a foreground well above an adjacent house without taking its whole cell', () => {
    const state = fixture(), house = structure(2, 'house'), neighbor = structure(3, 'house', 9, 10), well = structure(4, 'well');
    for (const buildings of [[house, well, neighbor], [well, neighbor, house], [neighbor, house, well]]) {
      entityStore(state).buildings.replace(buildings);
      expect(buildingAtPoint(state, { x: 9.9, y: 10.8 })).toBe(well);
      expect(buildingAtPoint(state, { x: 9.5, y: 10.8 })).toBe(neighbor);
    }
  });

  it('returns to standalone pointing when the house is gone and ignores foreign hosts', () => {
    const state = fixture(), house = structure(2, 'house'), well = structure(3, 'well');
    entityStore(state).buildings.replace([house, well]); house.hp = 0;
    expect(buildingAtPoint(state, { x: 10.5, y: 10.5 })).toBe(well);
    expect(buildingAtPoint(state, { x: 9.9, y: 10.8 })).toBeUndefined();
    house.hp = 100; house.faction = 1;
    expect(buildingAtPoint(state, { x: 9.9, y: 10.8 })).toBeUndefined();
  });
});
