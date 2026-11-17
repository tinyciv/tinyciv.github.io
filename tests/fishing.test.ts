import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { initializeFishing, updateFishing, FISHING_BOAT_CAPACITY, whalingMovementSpeed } from '../src/game/fishing';
import type { GameState } from '../src/game/types';

function fixture(width = 24, height = 18): GameState {
  return {
    world: { width, height, revision: 0, seed: 'fishing', source: 'test', spawns: [],
      tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: Math.floor(i / width) < 4 ? 'grassland' : 'coast', overlay: 'none',
        elevation: .1, moisture: .5, food: 0, production: 0, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', faction: 0, x: 1, y: 0, hp: 650, maxHp: 650, capacity: 4 },
      { id: 2, kind: 'dock', faction: 0, x: 5, y: 3, dockFacing: 2, hp: 250, maxHp: 250, capacity: 0 },
    ], units: [],
    factions: [{ id: 0, name: 'Player', color: '#ee4040', affinity: 100, relation: 'self', food: 0, gold: 1000, production: 0,
      population: 25, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, defeated: false,
      research: { focus: 'sailing', levels: { sailing: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, gameOver: false, victory: false, events: [], particles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, seed: 'fishing', rngState: 123,
    fields: [], raiderCamps: [], marauderPacks: [], villages: [], retinueStance: 'hold', movementMode: 'travel',
  } as unknown as GameState;
}
function advance(state: GameState, seconds: number, dt = .1): number {
  let food = 0;
  for (let elapsed = 0; elapsed < seconds - 1e-8;) {
    const step = Math.min(dt, seconds - elapsed); state.time += step; food += updateFishing(state, step); elapsed += step;
  }
  return food;
}

function restock(state: GameState, stock: number, collapsed = false): void {
  const snapshot = structuredClone(state.fishing!);
  for (const z of snapshot.zones) { z.stock = stock; z.collapsed = collapsed; }
  state.fishing = snapshot;
}

describe('native hidden fisheries', () => {
  it('creates shared lake/ocean stocks independently of docks', () => {
    const state = fixture(); initializeFishing(state);
    const ids = state.fishing!.zones.map(z => z.id);
    entityStore(state).buildings.add({ ...state.buildings[1], id: 3, x: 14 }); advance(state, 2);
    expect(state.fishing!.zones.map(z => z.id)).toEqual(ids);
    expect(state.fishing!.boats).toHaveLength(2);
    expect(new Set(state.fishing!.boats.map(b => b.dock)).size).toBe(2);
  });
  it('recovers depleted stock, with fewer splash proxies at lower health', () => {
    const state = fixture(); entityStore(state).buildings.retain(b => b.kind !== 'dock'); initializeFishing(state);
    const healthySplashes = state.fishing!.fish.length;
    restock(state, 20); updateFishing(state, 0);
    expect(state.fishing!.fish.length).toBeLessThan(healthySplashes);
    advance(state, 30);
    expect(state.fishing!.zones.every(z => z.stock > 20 && z.stock <= z.capacity)).toBe(true);
    expect(state.factions[0].food).toBe(0);
  });
  it('never regenerates a collapsed stock, including after JSON restoration', () => {
    const state = fixture(); entityStore(state).buildings.retain(b => b.kind !== 'dock'); initializeFishing(state);
    restock(state, 0, true); advance(state, 30);
    const loaded = JSON.parse(JSON.stringify(state)) as GameState; advance(loaded, 30);
    expect(loaded.fishing!.zones.every(z => z.collapsed && z.stock === 0)).toBe(true);
    expect(loaded.fishing!.fish).toHaveLength(0);
  });
  it('credits food only after a loaded vessel physically returns and unloads', () => {
    const state = fixture(); initializeFishing(state);
    for (let i = 0; i < 400 && !state.fishing!.boats.some(b => b.cargo > 0); i++) advance(state, .1);
    expect(state.fishing!.boats[0].cargo).toBe(FISHING_BOAT_CAPACITY);
    expect(state.factions[0].food).toBe(0);
    for (let i = 0; i < 400 && state.factions[0].food === 0; i++) advance(state, .1);
    expect(state.factions[0].food).toBe(FISHING_BOAT_CAPACITY);
    expect(state.buildings[0].foodDelivered).toBe(FISHING_BOAT_CAPACITY);
  });
  it('stops service after its dock is destroyed', () => {
    const state = fixture(); advance(state, 3); expect(state.fishing!.boats).toHaveLength(1);
    state.buildings[1].hp = 0; advance(state, 2);
    expect(state.fishing!.boats).toHaveLength(0);
  });
  it('does not generate whale resources in freshwater lakes', () => {
    const state = fixture(); for (const t of state.world.tiles) if (t.terrain === 'coast') t.terrain = 'lake';
    initializeFishing(state); expect(state.fishing!.zones.length).toBeGreaterThan(0); expect(state.fishing!.whales).toHaveLength(0);
  });
  it('refreshes a fixed five-percent movement bonus until its exact expiry', () => {
    const state = fixture(); state.time = 10; state.factions[0].whalingUntil = 70;
    expect(whalingMovementSpeed(state, 0, 4)).toBeCloseTo(4.2);
    state.time = 70; expect(whalingMovementSpeed(state, 0, 4)).toBe(4);
    state.factions[0].whalingUntil = 130; expect(whalingMovementSpeed(state, 0, 4)).toBeCloseTo(4.2);
  });
});
