import { afterEach, expect, it, vi } from 'vitest';
import * as spatial from '../src/game/spatial';
import { buildingBlockers, canWalk } from '../src/game/pathfinding';
import * as simulation from '../src/game/simulation';
import { scenario, step } from '../dev/navigation-lab/scenarios';

const snapshot = (state: ReturnType<typeof scenario>) => state.units.map(unit => ({
  id: unit.id, x: unit.x, y: unit.y, hp: unit.hp, morale: unit.morale,
  target: unit.target, order: unit.order, path: unit.path,
}));
afterEach(() => vi.restoreAllMocks());

it.each(['Open melee', 'Choke', 'Obstacle flank'] as const)('preserves full-scan combat results with indexed queries: %s', name => {
  const indexed = scenario(name), scanned = scenario(name);
  const query = spatial.nearbyUnits;
  const spy = vi.spyOn(spatial, 'nearbyUnits');
  for (let frame = 0; frame < 120; frame++) {
    spy.mockImplementation(query); step(indexed, name, simulation);
    spy.mockImplementation(state => state.units); step(scanned, name, simulation);
  }
  expect(snapshot(indexed)).toEqual(snapshot(scanned));
});

it('refreshes a traveler across bucket boundaries and releases the index after each step', () => {
  const state = scenario('Open melee'), unit = state.units[1];
  spatial.beginUnitFrame(state);
  unit.x = 27.5; unit.y = 20.5;
  spatial.refreshIndexedUnit(state, unit);
  expect(spatial.nearbyUnits(state, { x: 27.5, y: 20.5 }, 1)).toContain(unit);
  expect(spatial.nearbyUnits(state, { x: 8.5, y: 10.5 }, 1)).not.toContain(unit);
  expect(spatial.indexedUnit(state, unit.id)).toBe(unit);
  spatial.endUnitFrame(state);
  // Exported simulation helpers and save edits run without a frame index.
  unit.x = 4.5; unit.y = 4.5;
  expect(spatial.nearbyUnits(state, unit, 1)).toBe(state.units);
});

it('keeps cached topology private when combat removes its target from a blocker set', () => {
  const state = scenario('Open melee');
  const palace = state.buildings[0], index = palace.y * state.world.width + palace.x;
  const attackBlockers = buildingBlockers(state, 0);
  expect(attackBlockers.delete(index)).toBe(true);
  expect(canWalk(state, palace.x, palace.y, 0)).toBe(false);
  expect(buildingBlockers(state, 0).has(index)).toBe(true);
  palace.hp = 0;
  expect(canWalk(state, palace.x, palace.y, 0)).toBe(true);
});
