import { expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { withSimulationReads } from '../src/game/simulation-reads';
import { canWalk, invalidateNavigation, movementMultiplier, wallBreachingNavigation, workNavigationState, withNavigationFrame } from '../src/game/pathfinding';
import type { Building, GameState, World } from '../src/game/types';

function fixture(): GameState {
  const world: World = { width: 16, height: 16, revision: 1, seed: 'row-journal', source: 'fixture', spawns: [],
    tiles: Array.from({ length: 256 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) };
  return { world, units: [], buildings: [], factions: [], time: 1, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: world.seed, rngState: 1 };
}
const row = (id: number, kind: Building['kind'], x = 4, y = 4, faction = 0): Building => ({ id, kind, x, y, faction, hp: 100, maxHp: 100, capacity: 0 });

it('invalidates a strategic child after its access policy changes in the same parent frame', () => {
  const state = fixture(); entityStore(state).buildings.add(row(1, 'wall', 4, 4, 1));
  withSimulationReads(state, () => withNavigationFrame(state, () => {
    let hostile = true;
    const view = () => wallBreachingNavigation(state, { kind: 'faction', faction: 0, hostile: () => hostile });
    const first = view(); expect(canWalk(first, 4.5, 4.5, 0)).toBe(true);
    hostile = false;
    expect(view()).toBe(first); expect(canWalk(first, 4.5, 4.5, 0)).toBe(false);
  }));
});

it('publishes additions, ownership and removals into already-shared worker views', () => {
  const state = fixture(), store = entityStore(state), house = row(1, 'house'); store.buildings.add(house);
  withSimulationReads(state, () => withNavigationFrame(state, () => {
    const view = workNavigationState(state, true);
    expect(canWalk(state, 4.5, 4.5, 0)).toBe(false); expect(canWalk(view, 4.5, 4.5, 0)).toBe(true);
    const wall = row(2, 'wall', 7, 7), road = row(3, 'road', 7, 7); store.buildings.add(wall, road); invalidateNavigation(state);
    expect(canWalk(workNavigationState(state, true), 7.5, 7.5, 0)).toBe(true);
    wall.faction = 1; invalidateNavigation(state);
    expect(canWalk(workNavigationState(state, true), 7.5, 7.5, 0)).toBe(false);
    store.buildings.retain(b => b !== wall); invalidateNavigation(state);
    expect(canWalk(workNavigationState(state, true), 7.5, 7.5, 0)).toBe(true);
  }));
});

it('keeps nested construction presence and paved-road speed live', () => {
  const state = fixture(), tower = row(1, 'woodenTower'), road = row(2, 'road', 7, 7);
  tower.construction = { startedAt: 0, duration: 10, waitingForBuilder: true }; entityStore(state).buildings.add(tower, road);
  withSimulationReads(state, () => {
    expect(canWalk(state, 4.5, 4.5, 0)).toBe(true);
    tower.construction!.waitingForBuilder = false; invalidateNavigation(state);
    expect(canWalk(state, 4.5, 4.5, 0)).toBe(false);
    tower.construction!.pausedAt = 1; invalidateNavigation(state);
    expect(canWalk(state, 4.5, 4.5, 0)).toBe(true);
    delete tower.construction!.pausedAt; invalidateNavigation(state);
    expect(canWalk(state, 4.5, 4.5, 0)).toBe(false);
    const dirt = movementMultiplier(state, 7.5, 7.5); road.roadPaved = true; invalidateNavigation(state);
    expect(movementMultiplier(state, 7.5, 7.5)).toBeGreaterThan(dirt);
  });
});

it('reconciles unregistered standalone editor edits after leaving the trusted scope', () => {
  const state = fixture(), building = row(1, 'house'); entityStore(state).buildings.add(building);
  withSimulationReads(state, () => expect(canWalk(state, 4.5, 4.5, 0)).toBe(false));
  building.x = 5; expect(canWalk(state, 4.5, 4.5, 0)).toBe(true); expect(canWalk(state, 5.5, 4.5, 0)).toBe(false);
  Object.defineProperty(state, 'buildings', { configurable: true, enumerable: true, writable: true, value: [row(10, 'wall', 8, 8)] }); expect(canWalk(state, 5.5, 4.5, 0)).toBe(true); expect(canWalk(state, 8.5, 8.5, 0)).toBe(false);
});

it('reconsiders partner wall membership when only its gate road changes', () => {
  for (const initiallyOpen of [false, true]) {
    const state = fixture(), store = entityStore(state), wall = row(1, 'wall', 4, 4, 1), road = row(2, 'road', 4, 4, 1);
    store.buildings.add(wall); if (initiallyOpen) store.buildings.add(road);
    withSimulationReads(state, () => withNavigationFrame(state, () => {
      const view = () => workNavigationState(state, false, 0, 1, false);
      expect(canWalk(view(), 4.5, 4.5, 0)).toBe(initiallyOpen);
      if (initiallyOpen) store.buildings.retain(b => b !== road); else store.buildings.add(road);
      invalidateNavigation(state);
      expect(canWalk(view(), 4.5, 4.5, 0)).toBe(!initiallyOpen);
    }));
  }
});
