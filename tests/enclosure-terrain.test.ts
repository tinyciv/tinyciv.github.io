import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { palaceEnclosures } from '../src/game/enclosures';
import { canMove, canWalk, findPath } from '../src/game/pathfinding';
import { type Building, type GameState, type Tile } from '../src/game/types';

const ENEMY = -2;
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, kind, faction: 0, x, y, hp: 100, maxHp: 100, capacity: kind === 'house' ? 4 : 0,
});
function fixture(): GameState {
  return {
    world: { width: 30, height: 26, seed: 'enclosure-terrain', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 30 * 26 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 10, 10), building(2, 'house', 14, 12)], units: [],
    factions: [{ id: 0, name: 'Test', color: '#38f', affinity: 100, relation: 'self', food: 1000, gold: 0,
      production: 0, population: 1, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false, events: [], particles: [],
    projectiles: [], fields: [], marauderPacks: [], raiderCamps: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, seed: 'enclosure-terrain', rngState: 1,
  };
}
const tile = (state: GameState, x: number, y: number): Tile => state.world.tiles[y * state.world.width + x];
function wall(state: GameState, x: number, y: number): Building {
  const result = building(Math.max(...state.buildings.map(item => item.id)) + 1, 'wall', x, y);
  entityStore(state).buildings.add(result); return result;
}

const origin = { x: 25.5, y: 12.5 }, interior = { x: 9.5, y: 12.5 };
function expectEnemyAccess(state: GameState, accessible: boolean): void {
  const path = findPath(state, origin, interior, ENEMY);
  if (!accessible) { expect(path).toEqual([]); return; }
  expect(path.length).toBeGreaterThan(0);
  expect(path.at(-1)).toEqual(interior);
  let previous = origin;
  for (const next of path) { expect(canMove(state, previous, next, ENEMY)).toBe(true); previous = next; }
}

/** The city's rocky boundary leaves one eastern approach with a U-shaped wall. */
function defendedPocket(): GameState {
  const state = fixture();
  for (let y = 7; y <= 18; y++) for (let x = 7; x <= 18; x++)
    if ((x === 7 || x === 18 || y === 7 || y === 18) && (x !== 18 || y !== 12)) tile(state, x, y).rockRelief = 0;
  for (let y = 10; y <= 14; y++) wall(state, 21, y);
  for (const y of [10, 14]) for (let x = 19; x <= 20; x++) wall(state, x, y);
  state.world.revision!++;
  return state;
}

function naturalBoundary(state: GameState, apply: (tile: Tile) => void): void {
  for (let y = 6; y <= 18; y++) for (let x = 6; x <= 18; x++) {
    if (x === 18) wall(state, x, y);
    else if (x === 6 || y === 6 || y === 18) apply(tile(state, x, y));
  }
  state.world.revision!++;
}

describe('enclosure and enemy terrain traversal agree', () => {
  it('protects a rocky pocket with walls around its approach and loses protection when the approach is breached', () => {
    const state = defendedPocket();
    expect(canMove(state, { x: 19.5, y: 12.5 }, { x: 18.5, y: 12.5 }, ENEMY)).toBe(true);
    expectEnemyAccess(state, false);
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    state.buildings.find(item => item.kind === 'wall' && item.x === 21 && item.y === 12)!.hp = 0;
    expectEnemyAccess(state, true);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('invalidates the enclosure when a new gap opens in the rocks', () => {
    const state = defendedPocket(), approach = { x: 12.5, y: 6.5 }, gap = { x: 12.5, y: 7.5 };
    expect(canMove(state, approach, gap, ENEMY)).toBe(false);
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    delete tile(state, 12, 7).rockRelief; state.world.revision!++;
    expect(canMove(state, approach, gap, ENEMY)).toBe(true);
    expectEnemyAccess(state, true);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('updates a rock or ore opening without a separate wall or relief change', () => {
    const state = defendedPocket();
    const barrier = state.buildings.find(item => item.kind === 'wall' && item.x === 21 && item.y === 12)!;
    barrier.hp = 0;
    tile(state, 21, 12).resource = 'stone';
    state.world.revision!++;
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    delete tile(state, 21, 12).resource;
    state.world.revision!++;
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it('does not count a wall beside a rock as a defense when removing it cannot open a path', () => {
    const state = defendedPocket();
    tile(state, 18, 12).rockRelief = 0;
    wall(state, 8, 12); state.world.revision!++;
    expectEnemyAccess(state, false);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it.each(['volcano', 'glacier'] as const)('uses impassable %s tiles as part of a defended boundary', overlay => {
    const state = fixture(); naturalBoundary(state, cell => { cell.overlay = overlay; });
    expect(canWalk(state, 6, 12, ENEMY)).toBe(false);
    expectEnemyAccess(state, false);
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    tile(state, 6, 12).overlay = 'none'; state.world.revision!++;
    expect(canWalk(state, 6, 12, ENEMY)).toBe(true);
    expectEnemyAccess(state, true);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });

  it.each(['ocean', 'coast', 'lake', 'river'] as const)('a finished %s bridge opens the defense just as it opens enemy pathing', terrain => {
    const state = fixture(); naturalBoundary(state, cell => { cell.terrain = terrain; });
    const bridge = building(1000, 'bridge', 6, 12);
    bridge.construction = { startedAt: 0, duration: 12, waitingForBuilder: true };
    entityStore(state).buildings.add(bridge);
    expect(canWalk(state, 6, 12, ENEMY)).toBe(false);
    expectEnemyAccess(state, false);
    expect(palaceEnclosures(state).regions).toHaveLength(1);
    delete bridge.construction;
    expect(canWalk(state, 6, 12, ENEMY)).toBe(true);
    expectEnemyAccess(state, true);
    expect(palaceEnclosures(state).regions).toHaveLength(0);
  });
});
