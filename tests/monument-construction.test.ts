import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { buildingSightRadius, updateFog } from '../src/game/fog';
import { canWalk } from '../src/game/pathfinding';
import { BUILD_COSTS, buildAt, cancelConstruction, updateGame, validateBuildAt } from '../src/game/simulation';
import { CONSTRUCTION_SECONDS } from '../src/game/structures';
import { buildingSize, type Building, type GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'monument-construction', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 14.5, y: 12.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 0,
      population: 4, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'monument-construction', rngState: 1,
    marauderPacks: [], raiderCamps: [],
  };
  state.factions.forEach(unlockBuildingResearch);
  updateFog(state); return state;
}
function order(state: GameState): Building {
  expect(buildAt(state, 'monument', 12, 10).ok).toBe(true);
  return state.buildings.find(building => building.kind === 'monument')!;
}

describe('monument construction', () => {
  it('requires exactly 200 gold and reserves a single 20-second site for a palace builder', () => {
    const state = fixture(); state.factions[0].gold = 199;
    expect(buildAt(state, 'monument', 12, 10).ok).toBe(false); expect(state.factions[0].gold).toBe(199);
    expect(state.buildings).toHaveLength(1);
    state.factions[0].gold = 200;
    const monument = order(state);
    expect(BUILD_COSTS.monument).toEqual({ food: 0, gold: 200, production: 0 });
    expect(state.factions[0].gold).toBe(0); expect(CONSTRUCTION_SECONDS.monument).toBe(20);
    expect(monument).toMatchObject({ faction: 0, x: 12, y: 10, hp: 250, maxHp: 250, armor: 0, capacity: 0,
      construction: { duration: 20, paidGold: 200, waitingForBuilder: true } });
    expect(buildingSize(monument)).toBe(1); expect(canWalk(state, 12.5, 10.5, 0)).toBe(true);
    expect(state.units.some(unit => unit.builder && unit.home === 1)).toBe(true);
  });

  it('sends a builder to complete the monument and blocks only its one-tile base', () => {
    const state = fixture(), monument = order(state);
    for (let step = 0; step < 300 && monument.construction; step++) updateGame(state, .1, idle);
    expect(monument.construction).toBeUndefined(); expect(state.time).toBeGreaterThanOrEqual(20);
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(false); expect(canWalk(state, 13.5, 10.5, 0)).toBe(true);
    expect(buildingSightRadius(monument)).toBe(7);
    expect(cancelConstruction(state, monument.id).ok).toBe(false);
  });

  it.each(['water', 'occupied', 'house lane'] as const)('rejects an invalid monument placement without charging: %s', reason => {
    const state = fixture();
    if (reason === 'water') state.world.tiles[10 * 32 + 12].terrain = 'river';
    else entityStore(state).buildings.add({ id: 20, kind: 'house', faction: 0,
      x: reason === 'house lane' ? 11 : 12, y: 10, hp: 100, maxHp: 100, capacity: 0 });
    expect(validateBuildAt(state, 'monument', 12, 10).ok).toBe(false);
    expect(buildAt(state, 'monument', 12, 10).ok).toBe(false); expect(state.factions[0].gold).toBe(500);
    expect(state.buildings.some(building => building.kind === 'monument')).toBe(false);
  });

  it('relocates a queued farm at no extra cost when a monument replaces its reserved cell', () => {
    const state = fixture(), farm: Building = { id: 20, kind: 'camp', faction: 0, x: 12, y: 10,
      hp: 100, maxHp: 100, capacity: 0, construction: { startedAt: 0, duration: 15, paidGold: 12.5, waitingForBuilder: true } };
    entityStore(state).buildings.add(farm);
    expect(validateBuildAt(state, 'monument', 12, 10).ok).toBe(true);
    expect(farm).toMatchObject({ x: 12, y: 10 });
    const monument = order(state);
    expect(monument).toMatchObject({ x: 12, y: 10 });
    expect(state.factions[0].gold).toBe(300);
    expect(state.buildings.filter(building => building.kind === 'camp')).toEqual([farm]);
    expect({ x: farm.x, y: farm.y }).not.toEqual({ x: 12, y: 10 });
    expect(farm.construction).toMatchObject({ duration: 15, paidGold: 12.5, waitingForBuilder: true });
    expect(state.fields).toHaveLength(0); // Work must finish before the relocated farm produces crops.
  });

  it('refunds a queued monument in full and releases an active builder on partial cancellation', () => {
    const queued = fixture(), queuedMonument = order(queued);
    expect(cancelConstruction(queued, queuedMonument.id)).toMatchObject({ ok: true, refund: 200 });
    expect(queued.factions[0].gold).toBe(500);
    const state = fixture(), monument = order(state);
    for (let step = 0; step < 100 && monument.construction?.waitingForBuilder; step++) updateGame(state, .1, idle);
    const builder = state.units.find(unit => unit.id === monument.construction?.builderId)!;
    expect(builder.buildPhase).toBe('working');
    state.time = monument.construction!.startedAt + 10;
    expect(cancelConstruction(state, monument.id)).toMatchObject({ ok: true, refund: 100 });
    expect(state.factions[0].gold).toBe(400); expect(builder.buildSite).toBeUndefined(); expect(builder.buildPhase).toBe('returning');
    expect(state.buildings.some(building => building.id === monument.id)).toBe(false);
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(true);
  });
});
