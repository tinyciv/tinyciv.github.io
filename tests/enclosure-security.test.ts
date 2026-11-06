import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { houseBirthProgress, isHouseEnclosed, palaceEnclosures } from '../src/game/enclosures';
import { canMove, findPath } from '../src/game/pathfinding';
import { raiderCampActive } from '../src/game/raider-camps';
import { type Building, type GameState, type Point, type RaiderCamp } from '../src/game/types';

const WIDTH = 40, HEIGHT = 32;
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, capacity: kind === 'house' ? 4 : 0,
});

function island(): GameState {
  const state: GameState = {
    world: { width: WIDTH, height: HEIGHT, seed: 'enclosure-security', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
        const x = index % WIDTH, y = Math.floor(index / WIDTH);
        return { terrain: x >= 3 && x <= 36 && y >= 3 && y <= 28 ? 'grassland' : 'ocean',
          overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 };
      }) },
    units: [], buildings: [building(1, 'palace', 10, 10), building(2, 'house', 8, 15)],
    factions: [{ id: 0, name: 'City', color: '#38f', affinity: 100, relation: 'self', food: 1000, gold: 0,
      production: 0, population: 1, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false, events: [], particles: [], projectiles: [],
    fields: [], marauderPacks: [], raiderCamps: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    seed: 'enclosure-security', rngState: 1,
  };
  return state;
}

function ring(state: GameState, x0 = 3, y0 = 7, x1 = 17, y1 = 18): Building[] {
  const walls: Building[] = [];
  let id = Math.max(99, ...state.buildings.map(building => building.id)) + 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
    const wall = building(id++, 'wall', x, y);
    walls.push(wall); entityStore(state).buildings.add(wall);
  }
  return walls;
}

function sealedPeninsula(): GameState {
  const state = island();
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const mainland = x >= 3 && x <= 29 && y >= 3 && y <= 28;
    const peninsula = x >= 30 && x <= 36 && y >= 9 && y <= 18;
    state.world.tiles[y * WIDTH + x].terrain = mainland || peninsula ? 'grassland' : 'ocean';
  }
  state.world.revision!++;
  for (let y = 9; y <= 18; y++) entityStore(state).buildings.add(building(100 + y, 'wall', 30, y));
  return state;
}

function camp(state: GameState, x: number, y: number): { camp: RaiderCamp; core: Building } {
  const core = building(900, 'woodenTower', x + 1, y + 1, -2);
  const camp: RaiderCamp = { id: 1, size: 'small', name: 'Island raiders', x: x - 1, y, width: 3, height: 3,
    gate: { x, y }, houses: [], coreTowers: [core.id], nextRaidAt: 100, waves: 0 };
  entityStore(state).buildings.add(core); state.raiderCamps!.push(camp);
  expect(raiderCampActive(state, camp)).toBe(true);
  return { camp, core };
}

/** Verify complete movement, not just a nonempty partial A* result. */
function expectEnemyRoute(state: GameState, from: Point, to: Point, reachable: boolean): void {
  const path = findPath(state, from, to, -2);
  if (!reachable) { expect(path).toEqual([]); return; }
  expect(path.length).toBeGreaterThan(0);
  expect(path.at(-1)).toEqual(to);
  let previous = from;
  for (const waypoint of path) {
    expect(canMove(state, previous, waypoint, -2)).toBe(true);
    previous = waypoint;
  }
}

describe('enclosure security on naturally bounded land', () => {
  it('does not turn an entire island into a walled city when one wall touches its coast', () => {
    const state = island();
    entityStore(state).buildings.add(building(3, 'wall', 3, 12));
    expectEnemyRoute(state, { x: 30.5, y: 12.5 }, { x: 12.5, y: 12.5 }, true);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);
    expect(houseBirthProgress(state, state.buildings[1])).toBe(1);
  });

  it('removes the bonus after a breach even when the unwalled exterior is an island', () => {
    const state = island(), walls = ring(state);
    const from = { x: 24.5, y: 12.5 }, to = { x: 12.5, y: 12.5 };
    expectEnemyRoute(state, from, to, false);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
    expect(palaceEnclosures(state).cells).not.toContain(12 * WIDTH + 24);
    walls.find(wall => wall.x === 17 && wall.y === 12)!.hp = 0;
    expectEnemyRoute(state, from, to, true);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);
  });

  it('rejects a diagonal breach on an island using the same corner passage as enemy movement', () => {
    const state = island(), walls = ring(state);
    walls.find(wall => wall.x === 17 && wall.y === 7)!.hp = 0;
    expectEnemyRoute(state, { x: 18.5, y: 6.5 }, { x: 12.5, y: 12.5 }, true);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('still accepts a peninsula defended by a wall across its land approach and water elsewhere', () => {
    const state = sealedPeninsula();
    state.buildings[0].x = 33; state.buildings[0].y = 12;
    state.buildings[1].x = 33; state.buildings[1].y = 16;
    expectEnemyRoute(state, { x: 24.5, y: 13.5 }, { x: 32.5, y: 13.5 }, false);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
    const enclosed = palaceEnclosures(state);
    expect(enclosed.regions).toHaveLength(1);
    expect(enclosed.cells).toHaveLength(60);
    expect(enclosed.cells).not.toContain(13 * WIDTH + 24);
  });

  it('does not count a hostile settlement on the same open island as protected city ground', () => {
    const state = island();
    entityStore(state).buildings.add(building(3, 'wall', 3, 12));
    state.factions.push({ ...state.factions[0], id: 1, name: 'Enemy', relation: 'war' });
    entityStore(state).buildings.add(building(4, 'palace', 28, 20, 1));
    camp(state, 24, 11);
    expectEnemyRoute(state, { x: 24.5, y: 11.5 }, { x: 12.5, y: 12.5 }, true);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it.each(['peace', 'war'] as const)('rejects the broad mainland side when a %s faction palace shares that side', relation => {
    const state = sealedPeninsula();
    state.factions.push({ ...state.factions[0], id: 1, name: 'Other city', relation });
    entityStore(state).buildings.add(building(4, 'palace', 23, 19, 1));
    expectEnemyRoute(state, { x: 23.5, y: 18.5 }, { x: 12.5, y: 12.5 }, true);
    expectEnemyRoute(state, { x: 32.5, y: 13.5 }, { x: 12.5, y: 12.5 }, false);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('rejects the broad mainland side when an active raider camp shares that side', () => {
    const state = sealedPeninsula(); camp(state, 24, 13);
    expectEnemyRoute(state, { x: 24.5, y: 13.5 }, { x: 12.5, y: 12.5 }, true);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('rechecks active camp gates and removes stale threat state as camps move, die or disappear', () => {
    const state = island(); ring(state);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
    const source = camp(state, 14, 13);
    expectEnemyRoute(state, { x: 14.5, y: 13.5 }, { x: 12.5, y: 12.5 }, true);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);

    source.camp.x = 23; source.camp.gate.x = 24; source.core.x = 25;
    expectEnemyRoute(state, { x: 24.5, y: 13.5 }, { x: 12.5, y: 12.5 }, false);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
    source.camp.x = 13; source.camp.gate.x = 14; source.core.x = 15;
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);

    source.camp.destroyed = true;
    expect(raiderCampActive(state, source.camp)).toBe(false);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
    source.camp.destroyed = false;
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);
    source.core.hp = 0;
    expect(raiderCampActive(state, source.camp)).toBe(false);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
    source.core.hp = 100;
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);
    state.raiderCamps = [];
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
  });

  it('recognizes a thick wall as one defense and only opens after both layers are breached', () => {
    const state = island(), outer = ring(state, 5, 5, 19, 20), inner = ring(state, 6, 6, 18, 19);
    const from = { x: 24.5, y: 12.5 }, to = { x: 12.5, y: 12.5 };
    expectEnemyRoute(state, from, to, false);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
    outer.find(wall => wall.x === 19 && wall.y === 12)!.hp = 0;
    expectEnemyRoute(state, from, to, false);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(true);
    inner.find(wall => wall.x === 18 && wall.y === 12)!.hp = 0;
    expectEnemyRoute(state, from, to, true);
    expect(isHouseEnclosed(state, state.buildings[1])).toBe(false);
  });
});
