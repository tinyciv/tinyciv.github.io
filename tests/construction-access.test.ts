import { entityStore } from '../src/game/entity-store';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { canReachConstruction, constructionEdges } from '../src/game/builders';
import { buildingWorkForbidden } from '../src/game/forbidden-work';
import { findPath, hasStaticPathBetween, workNavigationState } from '../src/game/pathfinding';
import { installNavigationWasm, setNavigationWasmEnabled } from '../src/game/navigation-wasm';
import { withSimulationReads } from '../src/game/simulation-reads';
import { type Building, type GameState, distance } from '../src/game/types';

beforeAll(async () => {
  await installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/simulation.wasm')));
});
afterEach(() => setNavigationWasmEnabled(true));

const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building =>
  ({ id, kind, x, y, faction, hp: 100, maxHp: 100, capacity: 0 });
function fixture(): GameState {
  return {
    world: { width: 24, height: 18, seed: 'construction-access', source: 'test', spawns: [],
      tiles: Array.from({ length: 24 * 18 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    buildings: [building(1, 'palace', 3, 7)], units: [], fields: [],
    factions: [{ id: 0, name: 'Test', color: '#f00', affinity: 100, relation: 'self', food: 100, gold: 100,
      production: 0, population: 5, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'construction-access', rngState: 1,
  };
}

/** Preserve the former entrance-pair weighted-path contract as an oracle. */
function pairwiseAccess(state: GameState, palace: Building, proposed: Building): boolean {
  if (buildingWorkForbidden(state, proposed, palace.faction)) return false;
  const planned = workNavigationState(state.buildings.includes(proposed) ? state
    : { ...state, buildings: [...state.buildings, proposed] }, true);
  const exits = constructionEdges(planned, palace, true), edges = constructionEdges(planned, proposed, true);
  return edges.some(edge => exits.some(exit => distance(exit, edge) < .12
    || findPath(planned, exit, edge, palace.faction, false, undefined, undefined, undefined, false, true).length > 0));
}

describe('construction access components', () => {
  it.each([false, true])('matches entrance-pair paths through walls, water, gates, ledges and forbidden cells (native=%s)', native => {
    setNavigationWasmEnabled(native);
    let random = 72831;
    const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 0x100000000; };
    for (let sample = 0; sample < 16; sample++) {
      const state = fixture();
      for (let y = 0; y < 18; y++) {
        const tile = state.world.tiles[y * 24 + 11];
        tile.terrain = 'river';
        if (sample % 4 !== 0 && y === 2 + sample % 13) tile.overlay = 'ford';
      }
      for (let i = 0; i < 24; i++) {
        const x = 6 + Math.floor(next() * 15), y = Math.floor(next() * 18);
        entityStore(state).buildings.add(building(100 + i, i % 3 === 0 ? 'house' : 'wall', x, y, i % 4 === 0 ? 1 : 0));
        if (i % 4 === 1) entityStore(state).buildings.add(building(200 + i, 'road', x, y));
      }
      for (let x = 13; x < 19; x++) state.world.tiles[9 * 24 + x].ridge = 1;
      if (sample % 3 === 0) state.forbiddenZones = { cells: Array.from({ length: 18 }, (_, y) => y * 24 + 15), revision: 1 };
      const proposed = building(-1, sample % 2 ? 'library' : 'camp', 18, 5 + sample % 5), before = JSON.stringify(state);
      const expected = pairwiseAccess(state, state.buildings[0], proposed);
      expect(canReachConstruction(state, state.buildings[0], proposed), `sample ${sample}`).toBe(expected);
      expect(withSimulationReads(state, () => canReachConstruction(state, state.buildings[0], proposed))).toBe(expected);
      expect(JSON.stringify(state)).toBe(before);
    }
  });

  it('reserves the proposed solid before testing the only palace exits', () => {
    const state = fixture(), palace = state.buildings[0]; palace.x = 2; palace.y = 2;
    state.world.tiles.forEach(tile => { tile.terrain = 'lake'; });
    for (let y = 2; y <= 3; y++) for (let x = 2; x < 15; x++) state.world.tiles[y * 24 + x].terrain = 'grassland';
    const proposed = building(-1, 'library', 4, 2);
    expect(hasStaticPathBetween(state, constructionEdges(state, palace), constructionEdges(state, proposed), 0)).toBe(true);
    expect(pairwiseAccess(state, palace, proposed)).toBe(false);
    expect(canReachConstruction(state, palace, proposed)).toBe(false);
    // Builders retain their existing ability to pass through housing.
    proposed.kind = 'house';
    expect(canReachConstruction(state, palace, proposed)).toBe(true);
  });

  it('reconciles same-array edits, replacements and new worlds without retaining a prior reservation', () => {
    const state = fixture(), palace = state.buildings[0], proposed = building(-1, 'library', 18, 7);
    const barrier = Array.from({ length: 18 }, (_, y) => building(100 + y, 'wall', 11, y));
    entityStore(state).buildings.add(...barrier);
    expect(canReachConstruction(state, palace, proposed)).toBe(false);
    barrier[8].hp = 0;
    expect(canReachConstruction(state, palace, proposed)).toBe(true);
    barrier[8].hp = 100; barrier[8].x = 10;
    expect(canReachConstruction(state, palace, proposed)).toBe(true);
    barrier[8].x = 11;
    expect(canReachConstruction(state, palace, proposed)).toBe(false);
    entityStore(state).buildings.replace(state.buildings.map(b => b === barrier[8] ? building(500, 'road', 11, 8) : b));
    expect(canReachConstruction(state, palace, proposed)).toBe(true);
    entityStore(state).buildings.replace([palace]);
    state.world = { ...state.world, tiles: state.world.tiles.map(tile => ({ ...tile, terrain: 'lake' })) };
    expect(canReachConstruction(state, palace, proposed)).toBe(false);
    state.world.tiles.forEach(tile => { tile.terrain = 'grassland'; });
    expect(canReachConstruction(state, palace, proposed)).toBe(true);
    proposed.x = 5; proposed.y = 7;
    expect(canReachConstruction(state, palace, proposed)).toBe(pairwiseAccess(state, palace, proposed));
    proposed.x = 18;
    expect(canReachConstruction(state, palace, proposed)).toBe(true);
    expect(state.buildings).toEqual([palace]);
  });

  it('finds shared or diagonal components while ignoring invalid entrances', () => {
    const state = fixture();
    state.world.tiles.forEach(tile => { tile.terrain = 'lake'; });
    for (let i = 1; i < 7; i++) state.world.tiles[i * 24 + i].terrain = 'grassland';
    const origins = [{ x: NaN, y: 1 }, { x: -1, y: 1 }, { x: 1.5, y: 1.5 }];
    expect(hasStaticPathBetween(state, origins, [{ x: 6.5, y: 6.5 }], 0)).toBe(true);
    expect(hasStaticPathBetween(state, origins, [{ x: 1.5, y: 1.5 }], 0)).toBe(true);
    expect(hasStaticPathBetween(state, origins, [{ x: 7.5, y: 7.5 }, { x: Infinity, y: 1 }], 0)).toBe(false);
    state.forbiddenZones = { cells: [3 * 24 + 3], revision: 1 };
    expect(hasStaticPathBetween(state, origins, [{ x: 6.5, y: 6.5 }], 0, true)).toBe(false);
  });
});
