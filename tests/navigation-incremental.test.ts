import { expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { buildingBlockerView, canTraverseEdge, canWalk, findPath, invalidateNavigation, movementMultiplier,
  terrainNavigationEdges, travelTimeMap, wallBreachingNavigation } from '../src/game/pathfinding';
import { markWorldChanged } from '../src/game/world-revisions';
import type { Building, GameState, World } from '../src/game/types';

function fixture(width = 16, height = 16): GameState {
  const world: World = { width, height, revision: 1, seed: 'incremental-navigation', source: 'fixture', spawns: [],
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) };
  return { world, units: [], buildings: [], factions: [], time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    gameOver: false, victory: false, seed: world.seed, rngState: 1 };
}
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building =>
  ({ id, kind, x, y, faction, hp: 100, maxHp: 100, capacity: 0 });
const origin = { x: .5, y: .5 };
const times = (state: GameState, faction = 0) => Array.from(travelTimeMap(state, origin, faction, 1, Infinity));
const freshTimes = (state: GameState, faction = 0) => times(structuredClone(state), faction);

it('retains isolated strategic access views while source state and hostility change', () => {
  const state = fixture(12, 6), store = entityStore(state);
  for (let y = 0; y < 6; y++) store.buildings.add(building(y * 3 + 1, 'wall', 4, y, 1),
    building(y * 3 + 2, 'wall', 7, y, 2), building(y * 3 + 3, 'wall', 9, y, -1));
  const hostile = new Set([1]);
  const faction = () => wallBreachingNavigation(state, { kind: 'faction', faction: 0, hostile: owner => hostile.has(owner) });
  const raider = wallBreachingNavigation(state, { kind: 'raider' }), attack = faction();
  expect(wallBreachingNavigation(state, { kind: 'raider' })).toBe(raider);
  expect(faction()).toBe(attack);
  expect(attack).not.toBe(raider);
  expect(findPath(state, origin, { x: 6.5, y: 2.5 }, 0)).toEqual([]);
  expect(findPath(attack, origin, { x: 6.5, y: 2.5 }, 0).length).toBeGreaterThan(0);
  expect(findPath(attack, origin, { x: 8.5, y: 2.5 }, 0)).toEqual([]);
  expect(findPath(raider, origin, { x: 8.5, y: 2.5 }, -2).length).toBeGreaterThan(0);
  expect(findPath(raider, origin, { x: 10.5, y: 2.5 }, -2)).toEqual([]);
  hostile.clear();
  expect(faction()).toBe(attack);
  expect(findPath(attack, origin, { x: 6.5, y: 2.5 }, 0)).toEqual([]);
  state.time = 21;
  expect(attack.time).toBe(21);
  store.buildings.add(building(100, 'house', 2, 2));
  expect(wallBreachingNavigation(state, { kind: 'raider' })).toBe(raider);
  expect(canWalk(raider, 2.5, 2.5, -2)).toBe(false);
  // Stable access views still see newly replaced authoritative building objects.
  store.buildings.replace(state.buildings.map(value => ({ ...value })));
  expect(wallBreachingNavigation(state, { kind: 'raider' }).buildings.find(value => value.id === 100)).toBe(store.buildings.get(100));
});

it('updates cost layers locally and keeps faction grids current across missed edits', () => {
  const state = fixture(), store = entityStore(state);
  store.buildings.add(building(1, 'road', 15, 15));
  times(state, 0); times(state, 1);
  const distant = state.world.tiles[255], terrain = distant.terrain;
  let reads = 0;
  Object.defineProperty(distant, 'terrain', { configurable: true, get: () => { reads++; return terrain; } });
  store.buildings.add(building(2, 'road', 2, 2)); markWorldChanged(state.world);
  times(state, 0);
  expect(reads).toBe(0); // A whole-grid cost pass would re-read the distant road.
  store.buildings.add(building(3, 'irrigation', 3, 2)); markWorldChanged(state.world);
  times(state, 0);
  expect(reads).toBe(0);
  expect(times(state, 1)).toEqual(freshTimes(state, 1));
  expect(times(state, 0)).toEqual(freshTimes(state, 0));
});

it('preserves overlapping contributions and immutable blocker views on removal', () => {
  const state = fixture(), store = entityStore(state), cell = 4 * 16 + 4;
  const road = building(1, 'road', 4, 4), otherRoad = building(2, 'road', 4, 4), wall = building(3, 'wall', 4, 4);
  const house = building(4, 'house', 4, 4);
  store.buildings.add(road, otherRoad, wall, house);
  const before = buildingBlockerView(state, 0);
  expect(before.has(cell)).toBe(true);
  store.buildings.retain(value => value !== house && value !== road);
  expect(movementMultiplier(state, 4.5, 4.5)).toBe(1.5);
  expect(canWalk(state, 4.5, 4.5, 0)).toBe(true);
  expect(canWalk(state, 4.5, 4.5, 1)).toBe(false);
  expect(before.has(cell)).toBe(true);
  expect(times(state, 0)).toEqual(freshTimes(state, 0));
  store.buildings.retain(value => value !== otherRoad);
  expect(canWalk(state, 4.5, 4.5, 0)).toBe(false);
  expect(times(state, 0)).toEqual(freshTimes(state, 0));
});

it('sees road-gate ownership and construction transitions without terrain edits', () => {
  const state = fixture(), store = entityStore(state), gate = building(1, 'wall', 4, 4), road = building(2, 'road', 4, 4);
  road.construction = { startedAt: 0, duration: 10, waitingForBuilder: true };
  store.buildings.add(gate, road);
  expect(canWalk(state, 4.5, 4.5, 0)).toBe(true);
  expect(movementMultiplier(state, 4.5, 4.5)).toBe(1);
  times(state, 0); times(state, 1);
  gate.faction = 1; invalidateNavigation(state);
  expect(canWalk(state, 4.5, 4.5, 0)).toBe(false);
  expect(canWalk(state, 4.5, 4.5, 1)).toBe(true);
  delete road.construction; invalidateNavigation(state);
  expect(movementMultiplier(state, 4.5, 4.5)).toBe(1.5);
  expect(times(state, 0)).toEqual(freshTimes(state, 0));
  expect(times(state, 1)).toEqual(freshTimes(state, 1));
});

it('refreshes localized terrain and the full stair dependency halo', () => {
  const state = fixture(), { world } = state;
  times(state);
  const distant = world.tiles[255], terrain = distant.terrain;
  let reads = 0;
  Object.defineProperty(distant, 'terrain', { configurable: true, get: () => { reads++; return terrain; } });
  world.tiles[34].overlay = 'forest'; markWorldChanged(world, 'sight', [34]);
  times(state);
  expect(reads).toBe(0);
  const edited: number[] = [];
  for (let y = 3; y <= 8; y++) for (let x = 3; x <= 8; x++) {
    const cell = y * 16 + x; world.tiles[cell].ridge = 1; edited.push(cell);
  }
  world.tiles[5 * 16 + 3].stair = 'east';
  markWorldChanged(world, 'geometry', edited);
  const directions = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const check = () => {
    const mask = terrainNavigationEdges(world);
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) for (let d = 0; d < directions.length; d++) {
      const [dx, dy] = directions[d];
      expect(!!(mask[y * 16 + x] & (1 << d))).toBe(canTraverseEdge(world, { x, y }, { x: x + dx, y: y + dy }));
    }
    expect(times(state)).toEqual(freshTimes(state));
  };
  check();
  // Two cells away from the stair, this invalidates its upper approach's ledge.
  world.tiles[5 * 16 + 5].ridge = undefined; markWorldChanged(world, 'geometry', [5 * 16 + 5]);
  check();
});

it('falls back safely after structural change history rolls over', () => {
  const state = fixture(), store = entityStore(state);
  times(state, 0); times(state, 1);
  for (let i = 0; i < 70; i++) {
    store.buildings.add(building(i + 1, i % 2 ? 'road' : 'irrigation', i % 16, Math.floor(i / 16)));
    markWorldChanged(state.world); times(state, 0);
  }
  expect(times(state, 1)).toEqual(freshTimes(state, 1));
});
