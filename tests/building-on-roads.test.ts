import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { buildAt, cancelConstruction, updateGame, validateBuildAt } from '../src/game/simulation';
import { removeCoveredRoads } from '../src/game/covered-roads';
import { CAMP_FIELD_OFFSETS, isPendingCampField } from '../src/game/farms';
import { canWalk, movementMultiplier } from '../src/game/pathfinding';
import { queueConstruction } from '../src/game/structures';
import { ensureBuilders } from '../src/game/builders';
import { updateFog } from '../src/game/fog';
import type { Building, GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };

function fixture(): GameState {
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'build-over-road', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 14.5, y: 12.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 0,
      population: 4, culture: 10000, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'build-over-road', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: 10000, waves: 0, pressureVersion: 1 },
  };
  state.factions.forEach(unlockBuildingResearch);
  updateFog(state); return state;
}

function roadAt(state: GameState, x: number, y: number, faction = 0): Building {
  const road: Building = { id: Math.max(...state.buildings.map(b => b.id), ...state.units.map(u => u.id)) + 1,
    kind: 'road', faction, x, y, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.add(road); return road;
}

function advanceUntil(state: GameState, condition: () => boolean, seconds = 28): void {
  for (let step = 0; step < seconds * 10 && !condition(); step++) updateGame(state, .1, idle);
  expect(condition()).toBe(true);
}

describe('building over roads', () => {
  it.each(['house', 'woodenTower'] as const)('keeps a road usable under a queued %s until its peasant starts work', kind => {
    const state = fixture(), road = roadAt(state, 12, 8);
    state.traffic = { [8 * 32 + 12]: [0] };
    expect(buildAt(state, kind, 12, 8).ok).toBe(true);
    const site = state.buildings.at(-1)!;
    expect(site.construction?.waitingForBuilder).toBe(true);
    expect(state.buildings).toContain(road);
    expect(canWalk(state, 12.5, 8.5, 0)).toBe(true);
    expect(movementMultiplier(state, 12.5, 8.5)).toBe(1.5);
    advanceUntil(state, () => site.construction?.waitingForBuilder === false);
    expect(state.buildings).not.toContain(road);
    expect(state.traffic[String(8 * 32 + 12)]).toBeUndefined();
    expect(movementMultiplier(state, 12.5, 8.5)).toBe(1);
    expect(canWalk(state, 12.5, 8.5, 0)).toBe(false);
    advanceUntil(state, () => !site.construction);
    expect(canWalk(state, 12.5, 8.5, 0)).toBe(false);
  });

  it('rejects road overlap and plants one crop cell beside the existing road', () => {
    const state = fixture();
    const roads = [12, 13, 14].map(x => roadAt(state, x, 8));
    expect(buildAt(state, 'camp', 13, 8).ok).toBe(false);
    expect(buildAt(state, 'camp', 13, 9).ok).toBe(true);
    const farm = state.buildings.at(-1)!;
    const beforePreview = JSON.stringify(state);
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
      expect(isPendingCampField(state, 13 + dx, 9 + dy)).toBe(true);
      expect(validateBuildAt(state, 'woodenTower', 13 + dx, 9 + dy).ok).toBe(true);
    }
    expect(JSON.stringify(state)).toBe(beforePreview); // Relocation waits for a committed order.
    expect(state.buildings).toEqual(expect.arrayContaining(roads));
    advanceUntil(state, () => farm.construction?.waitingForBuilder === false);
    expect(state.buildings).toEqual(expect.arrayContaining(roads));
    advanceUntil(state, () => !farm.construction);
    expect(state.fields!.filter(field => field.camp === farm.id)).toHaveLength(1);
    expect(movementMultiplier(state, roads[0].x + .5, roads[0].y + .5)).toBe(1.5);
    for (const road of roads.slice(1)) expect(movementMultiplier(state, road.x + .5, road.y + .5)).toBe(1.5);
  });

  it('cancels covered road orders safely and refunds only their unfinished work', () => {
    const state = fixture(), active = roadAt(state, 13, 8), queued = roadAt(state, 14, 8), outside = roadAt(state, 15, 8);
    queueConstruction(active, 0, 2); queueConstruction(queued, 0, 2);
    Object.assign(active.construction!, { waitingForBuilder: false, cleared: true });
    state.time = 1; ensureBuilders(state);
    const worker = state.units.find(unit => unit.builder)!;
    Object.assign(worker, { buildSite: active.id, target: queued.id, buildPhase: 'working', inside: false, destination: { x: 13.5, y: 8.5 } });
    state.selected = active.id; state.selectedType = 'building';
    expect(buildAt(state, 'palace', 13, 8).ok).toBe(true);
    const palace = state.buildings.at(-1)!, before = state.factions[0].gold;
    removeCoveredRoads(state, palace);
    expect(state.factions[0].gold - before).toBe(3);
    expect(state.buildings).not.toContain(active); expect(state.buildings).not.toContain(queued);
    expect(state.buildings).toContain(outside);
    expect(worker).toMatchObject({ buildPhase: 'returning', buildSite: undefined, target: undefined, destination: undefined });
    expect(state.selectedType).toBe('unit');
    expect(state.selected).toBe(2);
  });

  it('preserves the original road when a replacement building is canceled before work starts', () => {
    const state = fixture(), road = roadAt(state, 12, 8), before = state.factions[0].gold;
    expect(buildAt(state, 'house', 12, 8).ok).toBe(true);
    const house = state.buildings.at(-1)!;
    expect(cancelConstruction(state, house.id).ok).toBe(true);
    expect(state.buildings).toContain(road);
    expect(state.factions[0].gold).toBe(before);
    expect(movementMultiplier(state, 12.5, 8.5)).toBe(1.5);
  });

  it.each([0, -1])('accepts completed and queued roads belonging to faction %i', faction => {
    for (const queued of [false, true]) {
      const state = fixture(), road = roadAt(state, 12, 8, faction);
      if (queued) queueConstruction(road, state.time, 2);
      for (const kind of ['house', 'woodenTower'] as const)
        expect(validateBuildAt(state, kind, 12, 8).ok).toBe(true);
      expect(validateBuildAt(state, 'camp', 12, 8).ok).toBe(false);
    }
  });

  it.each([-2, 1])('rejects roads belonging to another faction (%i)', faction => {
    const state = fixture(); roadAt(state, 12, 8, faction);
    for (const kind of ['house', 'woodenTower', 'camp'] as const)
      expect(validateBuildAt(state, kind, 12, 8).ok).toBe(false);
    // A one-cell farm beside the road does not occupy or replace it.
    expect(validateBuildAt(state, 'camp', 11, 8).ok).toBe(true);
  });

  it.each([['wall', 'road'], ['road', 'wall']] as const)('preserves both layers when constructing a gate in %s/%s order', (first, second) => {
    const state = fixture(); roadAt(state, 11, 9);
    expect(buildAt(state, first, 12, 9).ok).toBe(true);
    expect(buildAt(state, second, 12, 9).ok).toBe(true);
    const layers = state.buildings.filter(b => b.x === 12 && b.y === 9);
    advanceUntil(state, () => layers.every(layer => !layer.construction));
    expect(state.buildings).toEqual(expect.arrayContaining(layers));
    expect(canWalk(state, 12.5, 9.5, 0)).toBe(true);
    expect(canWalk(state, 12.5, 9.5, -2)).toBe(false);
    expect(movementMultiplier(state, 12.5, 9.5)).toBe(1.5);
    expect(validateBuildAt(state, 'house', 12, 9).ok).toBe(false);
  });
});
