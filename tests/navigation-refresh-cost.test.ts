import { entityStore } from '../src/game/entity-store';
import { afterEach, expect, it, vi } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { moveUnit } from '../src/game/simulation';
import type { Unit } from '../src/game/types';
import * as pathfinding from '../src/game/pathfinding';
import { beginUnitFrame, endUnitFrame, nearbyUnits, refreshIndexedUnit } from '../src/game/spatial';

afterEach(() => vi.restoreAllMocks());
it('keeps a valid moving route across an unrelated economic revision, but replans a blocked route', () => {
  const state = scenario('Open melee');
  entityStore(state).buildings.replace([]); state.world.revision = 1;
  const unit: Unit = { ...state.units[1], id: 100, faction: 0, x: 5.5, y: 6.5, path: undefined, pathGoal: undefined, repathAt: 0, defensiveAnchor: undefined };
  entityStore(state).units.replace([unit]);
  const target = { x: 12.5, y: 6.5 }, find = vi.spyOn(pathfinding, 'findPath');
  moveUnit(state, unit, target, .05);
  expect(find).toHaveBeenCalled(); find.mockClear();
  state.time += 1; state.world.revision++;
  moveUnit(state, unit, target, .05);
  expect(find).not.toHaveBeenCalled();
  entityStore(state).buildings.add({ id: 200, kind: 'wall', faction: 0, x: 8, y: 6, hp: 100, maxHp: 100, capacity: 0 });
  state.time += 1; state.world.revision++;
  moveUnit(state, unit, target, .05);
  expect(find).toHaveBeenCalled();
  expect(unit.path?.some(p => Math.floor(p.x) === 8 && Math.floor(p.y) === 6)).toBe(false);
});
it('refreshes cached neighborhoods when a unit crosses buckets during the same step', () => {
  const state = scenario('Open melee');
  const a = { ...state.units[0], id: 100, x: 2.5, y: 2.5 }, b = { ...state.units[1], id: 101, x: 20.5, y: 20.5 };
  entityStore(state).units.replace([b, a]);
  beginUnitFrame(state);
  try {
    expect(nearbyUnits(state, a, 1).map(u => u.id)).toEqual([100]);
    b.x = 3.5; b.y = 2.5; refreshIndexedUnit(state, b);
    expect(nearbyUnits(state, a, 1).map(u => u.id)).toEqual([101, 100]);
    b.x = 20.5; b.y = 20.5; refreshIndexedUnit(state, b);
    expect(nearbyUnits(state, a, 1).map(u => u.id)).toEqual([100]);
  } finally { endUnitFrame(state); }
});
