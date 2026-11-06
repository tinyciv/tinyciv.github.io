import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { canPlaceHouseAt, planHouseSite } from '../src/game/housing';
import { palaceEnclosures } from '../src/game/enclosures';
import type { Building, GameState, Point, Unit } from '../src/game/types';

const WIDTH = 32, HEIGHT = 28;
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, kind, x, y, faction: 0, hp: 160, maxHp: 160, capacity: kind === 'house' ? 4 : 0,
});
function fixture(): GameState {
  return {
    world: { width: WIDTH, height: HEIGHT, seed: 'enclosed-housing', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: WIDTH * HEIGHT }, () => ({ terrain: 'grassland', overlay: 'forest', elevation: .3,
        moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    buildings: [building(1, 'palace', 10, 10)], units: [], fields: [],
    factions: [{ id: 0, name: 'City', color: '#38f', relation: 'self', affinity: 100, food: 500, gold: 1000,
      production: 0, population: 4, culture: 10000, yields: { food: 20, gold: 4, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'enclosed-housing', rngState: 1,
  };
}
function ring(state: GameState, x0 = 8, y0 = 7, x1 = 20, y1 = 17, gate: Point = { x: 8, y: 10 }): Building[] {
  const walls: Building[] = [];
  let id = Math.max(...state.buildings.map(building => building.id)) + 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
    const wall = building(id++, 'wall', x, y); walls.push(wall); entityStore(state).buildings.add(wall);
  }
  entityStore(state).buildings.add(building(id, 'road', gate.x, gate.y));
  return walls;
}
function clear(state: GameState, ...points: Point[]): void {
  for (const { x, y } of points) state.world.tiles[y * WIDTH + x].overlay = 'none';
}
function farm(state: GameState, point: Point): Building {
  const camp = building(Math.max(...state.buildings.map(building => building.id)) + 1, 'camp', point.x, point.y);
  entityStore(state).buildings.add(camp);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = camp.x + dx, y = camp.y + dy, id = y * WIDTH + x;
    state.fields!.push({ id, camp: camp.id, faction: 0, x, y, planted: true, food: 3, nextHarvest: 30 });
    Object.assign(state.world.tiles[id], { farm: 0, overlay: 'none' });
  }
  return camp;
}

const inside = { x: 17, y: 12 }, outside = { x: 6, y: 10 };

describe('enclosure-first automatic housing', () => {
  it('chooses a farther enclosed site while manual outdoor placement stays allowed', () => {
    const state = fixture(), palace = state.buildings[0]; ring(state); clear(state, inside, outside);
    expect(palaceEnclosures(state).regions[0].palaces).toEqual([palace.id]);
    expect(canPlaceHouseAt(state, palace, inside)).toBe(true);
    expect(canPlaceHouseAt(state, palace, outside)).toBe(true);
    const before = JSON.stringify(state);
    expect(planHouseSite(state, palace)).toEqual({ point: inside });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('returns to ordinary compact scoring after a breach and rechecks repaired walls', () => {
    const state = fixture(), palace = state.buildings[0], walls = ring(state); clear(state, inside, outside);
    expect(planHouseSite(state, palace)).toEqual({ point: inside });
    walls[0].hp = 0;
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    expect(planHouseSite(state, palace)).toEqual({ point: outside });
    walls[0].hp = 100;
    expect(planHouseSite(state, palace)).toEqual({ point: inside });
  });

  it.each(['occupied', 'disallowed'] as const)('falls back outdoors when the enclosed candidate is %s', reason => {
    const state = fixture(), palace = state.buildings[0]; ring(state); clear(state, inside, outside);
    if (reason === 'occupied') entityStore(state).buildings.add(building(1000, 'woodenTower', inside.x, inside.y));
    const allowed = (point: Point): boolean => reason !== 'disallowed' || point.x !== inside.x || point.y !== inside.y;
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    expect(planHouseSite(state, palace, undefined, allowed)).toEqual({ point: outside });
  });

  it('does not use an insecure region containing enemy troops as preferred housing', () => {
    const state = fixture(), palace = state.buildings[0]; ring(state); clear(state, inside, outside);
    entityStore(state).units.add({ id: 1000, kind: 'warrior', faction: -2, x: 18.5, y: 15.5, hp: 100 } as Unit);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    expect(planHouseSite(state, palace)).toEqual({ point: outside });
  });

  it('considers a permissible enclosed farm conversion before open outdoor sites', () => {
    const state = fixture(), palace = state.buildings[0]; ring(state); clear(state, outside);
    const camp = farm(state, inside), before = JSON.stringify(state);
    expect(planHouseSite(state, palace)).toMatchObject({ point: inside, replaceCampId: camp.id, farmMove: { camp: camp.id } });
    expect(JSON.stringify(state)).toBe(before);
    expect(planHouseSite(state, palace, () => false)).toEqual({ point: outside });
  });

  it('does not replace a closer outdoor farm while a suitable enclosed open site exists', () => {
    const state = fixture(), palace = state.buildings[0]; ring(state); clear(state, inside);
    farm(state, outside);
    expect(planHouseSite(state, palace)).toEqual({ point: inside });
  });

  it('prefers its own palace enclosure over a closer site in a neighboring friendly city', () => {
    const state = fixture(), palace = state.buildings[0]; palace.x = 9;
    ring(state, 3, 5, 11, 20, { x: 11, y: 12 });
    const otherPalace = building(1000, 'palace', 17, 10); entityStore(state).buildings.add(otherPalace);
    ring(state, 13, 7, 22, 18, { x: 13, y: 12 });
    const home = { x: 4, y: 16 }, neighbor = { x: 14, y: 10 }; clear(state, home, neighbor);
    expect(palaceEnclosures(state).regions).toHaveLength(2);
    expect(canPlaceHouseAt(state, palace, neighbor)).toBe(true);
    expect(planHouseSite(state, palace)).toEqual({ point: home });
    expect(planHouseSite(state, otherPalace)).toEqual({ point: neighbor });
  });
});
