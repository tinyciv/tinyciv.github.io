import { describe, expect, it } from 'vitest';
import { invalidateDecisions } from '../src/game/decision-schedule';
import { entityStore, resetEntities } from '../src/game/entity-store';
import { FARM_TRAVEL_EDIT_BATCH, FARM_TRAVEL_MAX_DELAY, farmTravelRevision, palaceWalkingDistances } from '../src/game/farm-travel';
import { canWalk } from '../src/game/pathfinding';
import { updateGame } from '../src/game/simulation';
import type { Building, GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  return {
    world: { width: 40, height: 20, revision: 0, seed: 'farm-refresh', source: 'test', spawns: [],
      tiles: Array.from({ length: 800 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 6, hp: 650, maxHp: 650, capacity: 0,
      governorPermissions: { farms: false, housing: false } }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 2.5, y: 12.5, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
      moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 0, gold: 0,
      production: 0, population: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity,
      nextRetinueAt: Infinity, defeated: false }],
    fields: [], time: 10, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: 2,
    selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed: 'farm-refresh', rngState: 1, marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
}
function add(state: GameState, kind: Building['kind'], x: number, y = 6): Building {
  const building: Building = { id: 100 + state.buildings.length, kind, faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.add(building);
  state.world.revision!++;
  return building;
}

describe('coalesced farming travel maps', () => {
  it('keeps a planning map for nineteen ordinary edits, then publishes the twentieth', () => {
    const state = fixture(), palace = state.buildings[0], before = palaceWalkingDistances(state, palace);
    const token = farmTravelRevision(state), destination = 6 * 40 + 35;
    for (let i = 0; i < FARM_TRAVEL_EDIT_BATCH - 1; i++) {
      add(state, 'road', 5 + i);
      invalidateDecisions(state); // Explicit paving commands still coalesce.
      expect(palaceWalkingDistances(state, palace)).toBe(before);
      expect(farmTravelRevision(state)).toBe(token);
    }
    add(state, 'road', 24);
    const refreshed = palaceWalkingDistances(state, palace);
    expect(refreshed).not.toBe(before);
    expect(farmTravelRevision(state)).not.toBe(token);
    expect(refreshed[destination]).toBeLessThan(before[destination]);
    expect(palaceWalkingDistances(state, palace)).toBe(refreshed);
  });

  it('counts a batch of edits even when nobody queries between them', () => {
    const state = fixture(), palace = state.buildings[0], before = palaceWalkingDistances(state, palace);
    for (let i = 0; i < FARM_TRAVEL_EDIT_BATCH; i++) add(state, 'road', 5 + i);
    expect(palaceWalkingDistances(state, palace)).not.toBe(before);
  });

  it('does not count unrelated unit arrivals as world edits', () => {
    const state = fixture(), palace = state.buildings[0], before = palaceWalkingDistances(state, palace);
    add(state, 'road', 12);
    expect(palaceWalkingDistances(state, palace)).toBe(before);
    for (let i = 0; i < FARM_TRAVEL_EDIT_BATCH; i++) {
      entityStore(state).units.add({ ...state.units[0], id: 1000 + i, kind: 'warrior' });
      expect(palaceWalkingDistances(state, palace)).toBe(before);
    }
  });

  it('eventually publishes a final ordinary edit without refreshing unchanged worlds', () => {
    const state = fixture(), palace = state.buildings[0], before = palaceWalkingDistances(state, palace);
    add(state, 'camp', 15, 14);
    expect(palaceWalkingDistances(state, palace)).toBe(before);
    state.time += FARM_TRAVEL_MAX_DELAY - .001;
    expect(palaceWalkingDistances(state, palace)).toBe(before);
    state.time += .001;
    const refreshed = palaceWalkingDistances(state, palace);
    expect(refreshed).not.toBe(before);
    state.time += 100;
    expect(palaceWalkingDistances(state, palace)).toBe(refreshed);
  });

  it('uses game time so pausing and simulation speed preserve the deadline', () => {
    const state = fixture(), palace = state.buildings[0], before = palaceWalkingDistances(state, palace);
    add(state, 'road', 12);
    expect(palaceWalkingDistances(state, palace)).toBe(before);
    state.paused = true;
    updateGame(state, 30, idle);
    expect(state.time).toBe(10);
    expect(palaceWalkingDistances(state, palace)).toBe(before);
    state.paused = false; state.speed = 2;
    updateGame(state, (FARM_TRAVEL_MAX_DELAY - .02) / 2, idle);
    expect(palaceWalkingDistances(state, palace)).toBe(before);
    updateGame(state, .01, idle);
    expect(palaceWalkingDistances(state, palace)).not.toBe(before);
  });

  it('refreshes bridges and wall gates immediately while movement sees live obstacles', () => {
    const state = fixture(), palace = state.buildings[0];
    for (let y = 0; y < 20; y++) state.world.tiles[y * 40 + 18].terrain = 'lake';
    const blocked = palaceWalkingDistances(state, palace);
    expect(blocked[6 * 40 + 25]).toBe(Infinity);
    add(state, 'bridge', 18);
    expect(canWalk(state, 18, 6, 0)).toBe(true);
    const bridged = palaceWalkingDistances(state, palace);
    expect(bridged[6 * 40 + 25]).toBeLessThan(Infinity);
    add(state, 'wall', 12);
    expect(canWalk(state, 12, 6, 0)).toBe(false);
    const walled = palaceWalkingDistances(state, palace);
    expect(walled).not.toBe(bridged);
    add(state, 'road', 12);
    expect(canWalk(state, 12, 6, 0)).toBe(true);
    expect(palaceWalkingDistances(state, palace)).not.toBe(walled);
  });

  it('refreshes palace ownership, diplomacy and unexplained terrain revisions immediately', () => {
    const state = fixture(), palace = state.buildings[0];
    let previous = palaceWalkingDistances(state, palace);
    palace.faction = 1;
    expect(palaceWalkingDistances(state, palace)).not.toBe(previous);
    previous = palaceWalkingDistances(state, palace);
    state.factions[0].relation = 'war';
    expect(palaceWalkingDistances(state, palace)).not.toBe(previous);
    previous = palaceWalkingDistances(state, palace);
    state.world.tiles[8 * 40 + 10].terrain = 'lake'; state.world.revision!++;
    const refreshed = palaceWalkingDistances(state, palace);
    expect(refreshed).not.toBe(previous);
    expect(refreshed[8 * 40 + 10]).toBe(Infinity);
  });

  it('observes same-step wall death and road-gate removal without revision hooks', () => {
    const state = fixture(), palace = state.buildings[0], wall = add(state, 'wall', 12);
    let previous = palaceWalkingDistances(state, palace);
    const revision = state.world.revision, time = state.time;
    wall.hp = 0;
    expect(palaceWalkingDistances(state, palace)).not.toBe(previous);
    expect(canWalk(state, 12, 6, 0)).toBe(true);
    wall.hp = 100;
    const road = add(state, 'road', 12);
    previous = palaceWalkingDistances(state, palace);
    road.hp = 0;
    expect(palaceWalkingDistances(state, palace)).not.toBe(previous);
    expect(canWalk(state, 12, 6, 0)).toBe(false);
    expect(state.time).toBe(time);
    expect(state.world.revision).toBe(revision! + 1); // Only the explicit road addition advanced it.
  });

  it('resets on time/revision rewinds, world replacement and entity-store replacement', () => {
    const state = fixture(), palace = state.buildings[0];
    const token = farmTravelRevision(state), before = palaceWalkingDistances(state, palace);
    state.time--;
    expect(farmTravelRevision(state)).not.toBe(token);
    expect(palaceWalkingDistances(state, palace)).not.toBe(before);
    let previous = palaceWalkingDistances(state, palace);
    state.world = structuredClone(state.world);
    expect(palaceWalkingDistances(state, palace)).not.toBe(previous);
    add(state, 'road', 12); farmTravelRevision(state);
    previous = palaceWalkingDistances(state, palace); state.world.revision = 0;
    expect(palaceWalkingDistances(state, palace)).not.toBe(previous);
    previous = palaceWalkingDistances(state, palace); resetEntities(state);
    expect(palaceWalkingDistances(state, palace)).not.toBe(previous);
  });

  it('shares one full inspection across palace queries within an unchanged step', () => {
    const state = fixture(), palace = state.buildings[0], road = add(state, 'road', 12);
    palaceWalkingDistances(state, palace);
    let reads = 0;
    Object.defineProperty(road, 'kind', { configurable: true, get: () => { reads++; return 'road'; } });
    for (let i = 0; i < 20; i++) farmTravelRevision(state);
    expect(reads).toBe(0);
    state.time += .01;
    farmTravelRevision(state);
    expect(reads).toBeGreaterThan(0);
    const once = reads;
    for (let i = 0; i < 20; i++) farmTravelRevision(state);
    expect(reads).toBe(once);
  });
});
