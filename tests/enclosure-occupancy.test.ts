import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { isHouseEnclosed, palaceEnclosures } from '../src/game/enclosures';
import { canMove, findPath } from '../src/game/pathfinding';
import { type Building, type GameState, type Unit } from '../src/game/types';

const WIDTH = 40, HEIGHT = 30;
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, capacity: kind === 'house' ? 4 : 0,
});
const unit = (id: number, x: number, y: number, faction = -2): Unit => ({
  id, kind: 'warrior', faction, x, y, hp: 65, maxHp: 65, attack: 10, defense: 2, morale: 100,
  speed: 2.35, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
function island(): GameState {
  return {
    world: { width: WIDTH, height: HEIGHT, seed: 'enclosure-occupancy', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
        const x = index % WIDTH, y = Math.floor(index / WIDTH);
        return { terrain: x >= 3 && x <= 36 && y >= 3 && y <= 26 ? 'grassland' : 'ocean',
          overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 };
      }) },
    units: [], buildings: [building(1, 'palace', 9, 9), building(2, 'house', 8, 12)],
    factions: [{ id: 0, name: 'City', color: '#38f', affinity: 100, relation: 'self', food: 1000, gold: 0,
      production: 0, population: 1, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false, events: [], particles: [], projectiles: [],
    fields: [], marauderPacks: [], raiderCamps: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    seed: 'enclosure-occupancy', rngState: 1,
  };
}
function ring(state: GameState, x0 = 6, y0 = 6, x1 = 14, y1 = 14): Building[] {
  let id = Math.max(99, ...state.buildings.map(building => building.id)) + 1;
  const walls: Building[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
    const wall = building(id++, 'wall', x, y); walls.push(wall); entityStore(state).buildings.add(wall);
  }
  return walls;
}

describe('enclosure security against living intruders', () => {
  it('rejects island wilderness containing raiders even when a coastal spur joins a real wall ring', () => {
    const state = island(); ring(state);
    state.buildings[0].x = 24; state.buildings[0].y = 18;
    state.buildings[1].x = 23; state.buildings[1].y = 20;
    for (let x = 3; x < 6; x++) entityStore(state).buildings.add(building(500 + x, 'wall', x, 10));
    const raider = unit(1000, 26.5, 9.5); entityStore(state).units.add(raider);
    const target = { x: 23.5, y: 18.5 }, path = findPath(state, raider, target, raider.faction);
    expect(path.at(-1)).toEqual(target);
    let previous = { x: raider.x, y: raider.y };
    for (const next of path) { expect(canMove(state, previous, next, raider.faction)).toBe(true); previous = next; }
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);
  });

  it('keeps a protected city cached while enemies move outside, and an occupied result cached while they move inside', () => {
    const state = island(); ring(state);
    const raider = unit(1000, 20.5, 10.5); entityStore(state).units.add(raider);
    const protectedCity = palaceEnclosures(state);
    expect(protectedCity.regions).toHaveLength(1);
    raider.x = 22.3; raider.y = 17.8;
    expect(palaceEnclosures(state)).toBe(protectedCity);

    raider.x = 12.5; raider.y = 12.5;
    const occupied = palaceEnclosures(state);
    expect(occupied.regions).toHaveLength(0);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);
    raider.x = 7.8; raider.y = 8.3;
    expect(palaceEnclosures(state)).toBe(occupied);
    raider.hp = 0;
    expect(palaceEnclosures(state)).toBe(protectedCity);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
  });

  it('rechecks unit ownership, allied access, and indoor presence without changing geometry', () => {
    const state = island(); ring(state);
    state.factions.push({ ...state.factions[0], id: 1, name: 'Ally', relation: 'confederated' });
    state.factions.push({ ...state.factions[0], id: 2, name: 'Rival', relation: 'peace' });
    const visitor = unit(1000, 12.5, 12.5, 0); entityStore(state).units.add(visitor);
    const protectedCity = palaceEnclosures(state);
    expect(protectedCity.regions).toHaveLength(1);
    visitor.faction = 1;
    expect(palaceEnclosures(state)).toBe(protectedCity);
    visitor.faction = -1;
    expect(palaceEnclosures(state)).toBe(protectedCity);
    visitor.faction = 2;
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    visitor.inside = true;
    expect(palaceEnclosures(state)).toBe(protectedCity);
    visitor.inside = false; visitor.faction = -2;
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    entityStore(state).units.replace([]);
    expect(palaceEnclosures(state)).toBe(protectedCity);
  });

  it('only suspends the city connected to an intruder and preserves the other city mask', () => {
    const state = island(); ring(state);
    entityStore(state).buildings.add(building(500, 'palace', 25, 9), building(501, 'house', 24, 12));
    ring(state, 22, 6, 30, 14);
    const first = state.buildings[1], second = state.buildings.find(building => building.id === 501)!;
    expect(palaceEnclosures(state).regions).toHaveLength(2);
    const raider = unit(1000, 12.5, 12.5); entityStore(state).units.add(raider);
    const enclosed = palaceEnclosures(state);
    expect(enclosed.regions).toHaveLength(1);
    expect(enclosed.regions[0].palaces).toEqual([500]);
    expect(enclosed.cells).toHaveLength(49);
    expect(isHouseEnclosed(state, first)).toBe(false);
    expect(isHouseEnclosed(state, second)).toBe(true);
    raider.x = 28.5;
    expect(isHouseEnclosed(state, first)).toBe(true);
    expect(isHouseEnclosed(state, second)).toBe(false);
  });

  it('does not restore stale protection when an intruder dies after the city walls were breached', () => {
    const state = island(), walls = ring(state);
    const raider = unit(1000, 12.5, 12.5); entityStore(state).units.add(raider);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    walls.find(wall => wall.x === 14 && wall.y === 10)!.hp = 0;
    raider.hp = 0;
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);
  });
});
