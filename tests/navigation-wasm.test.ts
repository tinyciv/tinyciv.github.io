import { entityStore } from '../src/game/entity-store';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { installNavigationWasm, navigationWasmStatus, setNavigationWasmEnabled } from '../src/game/navigation-wasm';
import { canWalk, findPath, withNavigationFrame } from '../src/game/pathfinding';
import type { GameState, Point } from '../src/game/types';

beforeAll(async () => { await installNavigationWasm(Uint8Array.from(readFileSync('public/wasm/navigation.wasm'))); });
function world(seed: number): GameState {
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const state = { world: { width: 28, height: 22, seed: 'native-paths', source: 'test', revision: 1, spawns: [],
    tiles: Array.from({ length: 616 }, () => ({ terrain: random() < .14 ? 'lake' : 'grassland',
      overlay: random() < .15 ? 'forest' : random() < .1 ? 'swamp' : 'none', elevation: .4, moisture: .5, variation: .5, food: 1, production: 1, gold: 0 })) },
    buildings: [], units: [], factions: [{ id: 0, relation: 'self' }], time: 0,
  } as unknown as GameState;
  for (let y = 2; y < 20; y++) entityStore(state).buildings.add({ id: 100 + y, kind: 'wall', faction: 0, x: 14, y, hp: 100, maxHp: 100, capacity: 0 });
  for (let x = 2; x < 26; x++) entityStore(state).buildings.add({ id: 200 + x, kind: 'road', faction: 0, x, y: 10, hp: 100, maxHp: 100, capacity: 0 });
  return state;
}
function compare(state: GameState, from: Point, to: Point, partial: boolean, cardinal: boolean, blockers: Set<number>, soft: Set<number>, congestion: Map<number, number>) {
  setNavigationWasmEnabled(false);
  const expected = findPath(state, from, to, 0, partial, blockers, soft, congestion);
  setNavigationWasmEnabled(true);
  expect(findPath(state, from, to, 0, partial, blockers, soft, congestion)).toEqual(expected);
}

describe('WebAssembly navigation', () => {
  it('matches weighted JS paths, stable heap ties, partial goals, and cardinal fallback', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const state = world(seed), blockers = new Set([34, 109, 311, 351]), soft = new Set([190, 283, 400]);
      const congestion = new Map([[193, .8], [290, 1.6], [310, .1], [400, .8]]);
      withNavigationFrame(state, () => {
        for (let i = 0; i < 70; i++) {
          const from = { x: (i * 11 % 28) + .4, y: (i * 7 % 22) + .6 };
          const to = { x: (i * 13 + 17) % 32 - 1.5, y: (i * 3 + 9) % 25 - .5 };
          compare(state, from, to, !!(i & 1), !!(i & 2), blockers, soft, congestion);
        }
      });
    }
    expect(navigationWasmStatus().searches).toBeGreaterThan(100);
  });

  it('refreshes native topology after a same-tick breach, road speed change, or terrain edit', () => {
    const state = world(50), from = { x: 2.5, y: 10.5 }, to = { x: 25.5, y: 10.5 };
    for (const tile of state.world.tiles) { tile.terrain = 'grassland'; tile.overlay = 'none'; }
    for (let step = 0; step < 4; step++) {
      compare(state, from, to, true, false, new Set(), new Set(), new Map());
      if (step === 0) state.buildings.find(b => b.kind === 'wall' && b.y === 10)!.hp = 0;
      if (step === 1) entityStore(state).buildings.replace(state.buildings.filter(b => b.kind !== 'road'));
      if (step === 2) { state.world.tiles[10 * 28 + 7].terrain = 'lake'; state.world.revision!++; }
    }
  });

  it('preserves the one-cell-high archery range footprint in both backends', () => {
    const state = world(3);
    entityStore(state).buildings.replace([{ id: 1, kind: 'archeryRange', faction: 0, x: 8, y: 5, hp: 100, maxHp: 100, capacity: 0 }]);
    for (let i = 0; i < state.world.tiles.length; i++) {
      state.world.tiles[i].terrain = Math.floor(i / 28) === 6 ? 'grassland' : 'lake';
      state.world.tiles[i].overlay = 'none';
    }
    for (const x of [7, 10]) state.world.tiles[5 * 28 + x].terrain = 'grassland';
    expect(canWalk(state, 8.5, 6.5, 0)).toBe(true);
    expect(canWalk(state, 9.5, 6.5, 0)).toBe(true);
    const before = navigationWasmStatus().searches;
    compare(state, { x: 7.5, y: 5.5 }, { x: 10.5, y: 5.5 }, false, false, new Set(), new Set(), new Map());
    expect(findPath(state, { x: 7.5, y: 5.5 }, { x: 10.5, y: 5.5 }, 0)).toHaveLength(3);
    expect(navigationWasmStatus().searches).toBeGreaterThan(before);
  });

  it('retains callback blocker semantics without trying to serialize a function into the kernel', () => {
    const state = world(2), from = { x: 2.5, y: 10.5 }, to = { x: 21.5, y: 10.5 };
    for (const tile of state.world.tiles) { tile.terrain = 'grassland'; tile.overlay = 'none'; }
    const opaque = { has: (index: number) => index % 29 === 0 };
    setNavigationWasmEnabled(false); const expected = findPath(state, from, to, 0, true, opaque);
    const before = navigationWasmStatus(); setNavigationWasmEnabled(true);
    expect(findPath(state, from, to, 0, true, opaque)).toEqual(expected);
    expect(navigationWasmStatus().unsupported).toBeGreaterThan(before.unsupported);
  });
});
