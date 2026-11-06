import { describe, expect, it } from 'vitest';
import { territory } from '../src/game/borders';
import { entityStore, resetEntities } from '../src/game/entity-store';
import { palaceEnclosures } from '../src/game/enclosures';
import { canWalk, invalidateNavigation } from '../src/game/pathfinding';
import { withSimulationReads } from '../src/game/simulation-reads';
import { markWorldChanged } from '../src/game/world-revisions';
import { type Building, type GameState } from '../src/game/types';

function fixture(): GameState {
  return { world: { width: 40, height: 30, seed: 'shared-views', source: 'test', revision: 0, spawns: [],
    tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 1, production: 1, gold: 0, variation: .5 })) },
    units: [], buildings: [], fields: [], factions: [{ id: 0, name: 'Player', color: '#3988ff', affinity: 100,
      relation: 'self', culture: 0, food: 100, gold: 100, production: 0, population: 0,
      yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'shared-views', rngState: 1 };
}
const house = (id: number, x: number): Building => ({ id, kind: 'house', faction: 0,
  x, y: 15, hp: 100, maxHp: 100, capacity: 4 });

describe('maintained simulation world views', () => {
  it('performs no building validation for unchanged queries across simulation steps', () => {
    const state = fixture(), building = house(1, 12);
    entityStore(state).buildings.add(building);
    let reads = 0;
    Object.defineProperty(building, 'x', { enumerable: true, get: () => { reads++; return 12; } });
    withSimulationReads(state, () => {
      territory(state); canWalk(state, 2, 2, 0); palaceEnclosures(state, true);
      const before = reads;
      for (let i = 0; i < 100; i++) {
        state.time += 1 / 30;
        territory(state); canWalk(state, 2, 2, 0); palaceEnclosures(state, true);
      }
      expect(reads).toBe(before);
      markWorldChanged(state.world, 'appearance');
      territory(state); canWalk(state, 2, 2, 0); palaceEnclosures(state, true);
      expect(reads).toBe(before);
    });
  });

  it('sees deaths, completion, membership and culture thresholds immediately', () => {
    const state = fixture(), building = house(1, 12), store = entityStore(state);
    store.buildings.add(building);
    withSimulationReads(state, () => {
      const before = territory(state);
      expect(canWalk(state, 12, 15, 0)).toBe(false);
      building.hp = 0; invalidateNavigation(state);
      expect(territory(state).revision).toBeGreaterThan(before.revision);
      expect(canWalk(state, 12, 15, 0)).toBe(true);
      const replacement = house(2, 25); replacement.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
      store.buildings.add(replacement);
      expect(canWalk(state, 25, 15, 0)).toBe(true);
      delete replacement.construction; store.buildings.updateRoles(replacement); invalidateNavigation(state);
      expect(canWalk(state, 25, 15, 0)).toBe(false);
      const completed = territory(state);
      state.factions[0].culture = 100000;
      expect(territory(state).revision).toBeGreaterThan(completed.revision);
      store.buildings.retain(b => b !== replacement);
      expect(canWalk(state, 25, 15, 0)).toBe(true);
    });
  });

  it('keeps standalone editor queries live and clears nested read scopes after errors', () => {
    const state = fixture(), building = house(1, 12); entityStore(state).buildings.add(building);
    withSimulationReads(state, () => withSimulationReads(state, () => territory(state)));
    building.hp = 0;
    expect(canWalk(state, 12, 15, 0)).toBe(true);
    expect(territory(state).sourceRadii.has(building.id)).toBe(false);
    expect(() => withSimulationReads(state, () => { throw new Error('stop'); })).toThrow('stop');
    building.hp = 100;
    expect(canWalk(state, 12, 15, 0)).toBe(false);
    expect(territory(state).sourceRadii.has(building.id)).toBe(true);
  });

  it('rebuilds shared structural views at an explicit same-state import boundary', () => {
    const state = fixture(); entityStore(state).buildings.add(house(1, 12));
    withSimulationReads(state, () => {
      expect(canWalk(state, 12, 15, 0)).toBe(false);
      territory(state); palaceEnclosures(state, true);
    });
    Object.assign(state, { buildings: [house(1, 25)] }); resetEntities(state);
    withSimulationReads(state, () => {
      expect(canWalk(state, 12, 15, 0)).toBe(true);
      expect(canWalk(state, 25, 15, 0)).toBe(false);
      expect(territory(state).owners[15 * state.world.width + 25]).toBe(0);
      palaceEnclosures(state, true);
    });
  });
});
