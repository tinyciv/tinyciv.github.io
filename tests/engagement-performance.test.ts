import { withSimulationReads } from '../src/game/simulation-reads';
import { entityStore } from '../src/game/entity-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import * as collisions from '../src/game/collisions';
import { attackSpots, claimAttackSpot } from '../src/game/engagement';
import * as navigation from '../src/game/pathfinding';
import { distance, type Building } from '../src/game/types';
import { beginUnitFrame, endUnitFrame } from '../src/game/spatial';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const state = scenario('Open melee');
  const attacker = { ...state.units[1], id: 100, faction: 0, x: 8.5, y: 12.5 };
  const target = { ...attacker, id: 101, faction: -2, x: 13.5 };
  entityStore(state).units.replace([attacker, target]);
  return { state, attacker, target };
}

describe('attack-position query cost', () => {
  it('does not scan distant occupancy when no contact positions are available', () => {
    const { state, attacker, target } = fixture();
    for (let i = 0; i < 100; i++) entityStore(state).units.add({ ...attacker, id: 200 + i, x: 25.5, y: 20.5 });
    beginUnitFrame(state);
    const obstruction = vi.spyOn(collisions, 'unitObstructs');
    try {
      expect(claimAttackSpot(state, attacker, target, () => false)).toBeUndefined();
      // The spatial query may inspect neighbors, but not the hundred remote units.
      expect(obstruction.mock.calls.length).toBeLessThan(10);
    } finally { endUnitFrame(state); }
  });

  it('reuses a private obstacle view across failed candidate paths', () => {
    const { state, attacker, target } = fixture();
    const copy = vi.spyOn(navigation, 'buildingBlockers');
    const direct = vi.spyOn(navigation, 'canMove').mockReturnValue(false);
    const reaches = vi.fn(() => false);
    const path = vi.spyOn(navigation, 'createReachabilityQuery').mockReturnValue(reaches);
    expect(claimAttackSpot(state, attacker, target, () => true)).toBeUndefined();
    expect(direct.mock.calls.length).toBeGreaterThan(1);
    // Enumeration and every probe read shared snapshots without copying Sets.
    expect(copy).not.toHaveBeenCalled();
    const blockers = direct.mock.calls[0][4]!;
    expect(direct.mock.calls.every(call => call[4] === blockers)).toBe(true);
    expect(path).toHaveBeenCalledTimes(1);
    expect(reaches).toHaveBeenCalledTimes(direct.mock.calls.length);
    const occupied = path.mock.calls[0][3]!;
    expect(occupied).not.toBe(blockers);
    const targetCell = Math.floor(target.y) * state.world.width + Math.floor(target.x);
    expect(blockers.has(targetCell)).toBe(true);
    expect(navigation.buildingBlockers(state, attacker.faction).has(targetCell)).toBe(false);
  });

  it('claims a current contact position without preparing route obstacles', () => {
    const { state, attacker, target } = fixture();
    attacker.x = target.x - 1;
    const copy = vi.spyOn(navigation, 'buildingBlockers');
    const direct = vi.spyOn(navigation, 'canMove');
    const path = vi.spyOn(navigation, 'createReachabilityQuery');
    expect(claimAttackSpot(state, attacker, target, () => true)).toEqual({ x: attacker.x, y: attacker.y });
    expect(copy).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
    expect(path).not.toHaveBeenCalled();
  });

  it('queries occupied contact cells without scanning the army for each claim', () => {
    const { state, attacker, target } = fixture();
    for (let i = 0; i < 200; i++) entityStore(state).units.add({ ...attacker, id: 200 + i, x: 25.5, y: 20.5 });
    beginUnitFrame(state);
    const obstruction = vi.spyOn(collisions, 'unitObstructs');
    vi.spyOn(navigation, 'canMove').mockReturnValue(false);
    vi.spyOn(navigation, 'createReachabilityQuery').mockReturnValue(() => false);
    try {
      expect(claimAttackSpot(state, attacker, target, () => true)).toBeUndefined();
      expect(obstruction.mock.calls.length).toBeLessThan(20);
    } finally { endUnitFrame(state); }
  });
});

it('keeps a valid traveling contact slot briefly and immediately rejects an occupied slot', () => {
  const { state, attacker, target } = fixture();
  vi.spyOn(navigation, 'canMove').mockReturnValue(false);
  const search = vi.spyOn(navigation, 'createReachabilityQuery').mockReturnValue(() => true);
  const point = claimAttackSpot(state, attacker, target, () => true)!;
  expect(point).toBeDefined();
  attacker.pathGoal = { ...point }; attacker.path = [{ ...point }];
  const calls = search.mock.calls.length;
  state.time += .01;
  expect(claimAttackSpot(state, attacker, target, () => true)).toEqual(point);
  expect(search).toHaveBeenCalledTimes(calls);
  entityStore(state).units.add({ ...attacker, id: 999, x: point.x, y: point.y });
  const next = claimAttackSpot(state, attacker, target, () => true);
  expect(next).not.toEqual(point);
});


it('rejects an occupied runtime slot immediately but waits for the capped clock to search again', () => {
  const { state, attacker, target } = fixture();
  vi.spyOn(navigation, 'canMove').mockReturnValue(false);
  const search = vi.spyOn(navigation, 'createReachabilityQuery').mockReturnValue(() => true);
  const claim = () => withSimulationReads(state, () => claimAttackSpot(state, attacker, target, () => true));
  const point = claim()!;
  const calls = search.mock.calls.length;
  state.time += .01;
  expect(claim()).toEqual(point);
  entityStore(state).units.add({ ...attacker, id: 999, x: point.x, y: point.y });
  expect(claim()).toBeUndefined();
  expect(search).toHaveBeenCalledTimes(calls);
  state.time += .7;
  const replacement = claim();
  expect(replacement).toBeDefined(); expect(replacement).not.toEqual(point);
  expect(search.mock.calls.length).toBeGreaterThan(calls);
});

it('scores each contact cell once while preserving the original stable comparator', () => {
  const { state, attacker } = fixture();
  const target: Building = { ...state.buildings[0], id: 500, kind: 'house', x: 13, y: 12, faction: -2, hp: 100 };
  entityStore(state).buildings.replace([target]); entityStore(state).units.replace([attacker]); attacker.range = 1.5;
  const narrowAt = (point: { x: number; y: number }) => Math.floor(point.y) % 2 === 0;
  const narrow = vi.spyOn(navigation, 'isNarrowPassage').mockImplementation((_state, point) => narrowAt(point));
  const spots = attackSpots(state, attacker, target, () => true);
  expect(spots.length).toBeGreaterThan(2);
  expect(narrow).toHaveBeenCalledTimes(spots.length);
  const rowOrder = [...spots].sort((a, b) => a.y - b.y || a.x - b.x);
  const expected = rowOrder.sort((a, b) => distance(attacker, a) + 0 + (narrowAt(a) ? 3 : 0)
    - distance(attacker, b) - 0 - (narrowAt(b) ? 3 : 0));
  expect(spots).toEqual(expected);
});

it('keeps shared blocker snapshots read-only and replaces them after topology changes', () => {
  const { state, attacker } = fixture(), building = state.buildings[0];
  const index = building.y * state.world.width + building.x;
  const first = navigation.buildingBlockerView(state, attacker.faction);
  expect(first).toBe(navigation.buildingBlockerView(state, attacker.faction));
  expect(Object.keys(first)).toEqual(['has']);
  expect(first.has(index)).toBe(true);
  const mutable = navigation.buildingBlockers(state, attacker.faction);
  mutable.delete(index);
  expect(first.has(index)).toBe(true);
  building.hp = 0;
  const second = navigation.buildingBlockerView(state, attacker.faction);
  expect(second).not.toBe(first);
  expect(second.has(index)).toBe(false);
  expect(first.has(index)).toBe(true);
});
