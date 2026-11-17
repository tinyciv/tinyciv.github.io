import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { canMove, buildingBlockerView, invalidateNavigation } from '../src/game/pathfinding';
import { withSimulationReads } from '../src/game/simulation-reads';
import { beginUnitFrame, endUnitFrame, unitOccupancy, cellOccupant, lastCollidingUnitInCell, refreshIndexedUnit } from '../src/game/spatial';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { markWorldChanged } from '../src/game/world-revisions';
import { scoutRealm } from './helpers/scouts';

function fixture() {
  const state = scoutRealm();
  entityStore(state).buildings.replace([]);
  return state;
}

describe('resident Rust movement geometry', () => {
  it('observes same-step walls, owned gates and forbidden edits without replacing prior blocker snapshots', () => {
    const state = fixture(), store = entityStore(state);
    const from = { x: 4.5, y: 4.5 }, to = { x: 7.5, y: 4.5 };
    withSimulationReads(state, () => {
      expect(canMove(state, from, to, 0)).toBe(true);
      const wall = { id: 2000, kind: 'wall' as const, faction: 0, x: 6, y: 4, hp: 100, maxHp: 100, capacity: 0 };
      store.buildings.add(wall); invalidateNavigation(state);
      expect(canMove(state, from, to, 0)).toBe(false);
      const closed = buildingBlockerView(state, 0);
      store.buildings.add({ ...wall, id: 2001, kind: 'road' }); invalidateNavigation(state);
      expect(canMove(state, from, to, 0)).toBe(true);
      expect(canMove(state, from, to, 1)).toBe(false);
      expect(canMove(state, from, to, 0, closed)).toBe(false);
      setForbiddenRectangle(state, { x: 5, y: 4 }, { x: 5, y: 4 }, true);
      expect(canMove(state, from, to, 0, undefined, true)).toBe(false);
      expect(canMove(state, from, to, 0)).toBe(true);
      setForbiddenRectangle(state, { x: 5, y: 4 }, { x: 5, y: 4 }, false);
      expect(canMove(state, from, to, 0, undefined, true)).toBe(true);
    });
  });

  it('retains live arbitrary blocker layers while keeping normal topology resident', () => {
    const state = fixture(), from = { x: 4.5, y: 4.5 }, to = { x: 7.5, y: 4.5 };
    const occupied = new Set<number>();
    withSimulationReads(state, () => {
      expect(canMove(state, from, to, 0, occupied)).toBe(true);
      occupied.add(4 * state.world.width + 6);
      expect(canMove(state, from, to, 0, occupied)).toBe(false);
      occupied.clear();
      expect(canMove(state, from, to, 0, occupied)).toBe(true);
    });
  });

  it('keeps outer sweep cells intact when an extra blocker performs a nested query', () => {
    const state = fixture(), from = { x: 4.5, y: 4.5 }, to = { x: 7.5, y: 4.5 };
    let nested = false;
    const blockers = { has(cell: number) {
      if (!nested) {
        nested = true;
        expect(canMove(state, { x: 20.5, y: 20.5 }, { x: 23.5, y: 20.5 }, 0, new Set())).toBe(true);
      }
      return cell === 4 * state.world.width + 6;
    } };
    withSimulationReads(state, () => expect(canMove(state, from, to, 0, blockers)).toBe(false));
  });

  it('shares raw sweep storage without sharing editor terrain or building permissions', () => {
    const first = fixture(), second = fixture(), from = { x: 4.5, y: 4.5 }, to = { x: 7.5, y: 4.5 };
    delete first.world.revision; delete second.world.revision;
    entityStore(second).buildings.add({ id: 4000, kind: 'wall', faction: 0, x: 6, y: 4, hp: 100, maxHp: 100, capacity: 0 });
    expect(canMove(first, from, to, 0)).toBe(true);
    expect(canMove(second, from, to, 0)).toBe(false);
    first.world.tiles[4 * first.world.width + 6].terrain = 'lake';
    expect(canMove(first, from, to, 0)).toBe(false);
    first.world.tiles[4 * first.world.width + 6].terrain = 'grassland';
    expect(canMove(first, from, to, 0)).toBe(true);
  });

  it('patches a distant structural edit without reading unrelated terrain or rebuilding each short sweep', () => {
    const state = fixture(), from = { x: 4.5, y: 4.5 }, to = { x: 7.5, y: 4.5 };
    withSimulationReads(state, () => {
      expect(canMove(state, from, to, 0)).toBe(true);
      const distant = state.world.tiles[state.world.tiles.length - 1], terrain = distant.terrain;
      let reads = 0;
      Object.defineProperty(distant, 'terrain', { configurable: true, get: () => { reads++; return terrain; } });
      entityStore(state).buildings.add({ id: 3000, kind: 'house', faction: 0, x: 30, y: 25, hp: 100, maxHp: 100, capacity: 2 });
      markWorldChanged(state.world, 'structure');
      for (let probe = 0; probe < 120; probe++) expect(canMove(state, from, to, 0)).toBe(true);
      expect(reads).toBe(0);
    });
  });
});

describe('resident Rust occupancy publications', () => {
  it('observes live policy edits and late recruits without scanning remote units or changing sensing membership', () => {
    const state = fixture(), store = entityStore(state), [requester, first, remote] = state.units;
    Object.assign(requester, { kind: 'warrior', x: 8.5, y: 12.5 });
    Object.assign(first, { x: 9.5, y: 12.5 }); Object.assign(remote, { x: 35.5, y: 25.5 });
    store.units.replace([requester, first, remote]);
    beginUnitFrame(state);
    try {
      const occupied = unitOccupancy(state, requester), cell = 12 * state.world.width + 9;
      let reads = 0; const health = remote.hp;
      Object.defineProperty(remote, 'hp', { configurable: true, get: () => { reads++; return health; } });
      expect(occupied.has(cell)).toBe(true);
      first.hp = 0; expect(occupied.has(cell)).toBe(false);
      first.hp = 100; first.inside = true; expect(occupied.has(cell)).toBe(false);
      first.inside = false; expect(cellOccupant(state, first, requester)).toBe(first);
      const recruit = { ...first, id: Number.MAX_SAFE_INTEGER, x: first.x };
      store.units.add(recruit);
      expect(lastCollidingUnitInCell(state, cell, requester)).toBe(recruit);
      expect(cellOccupant(state, first, requester)).toBe(first);
      refreshIndexedUnit(state, recruit);
      first.hp = 0; expect(cellOccupant(state, first, requester)).toBe(recruit);
      expect(reads).toBe(0);
    } finally { endUnitFrame(state); }
  });
});
