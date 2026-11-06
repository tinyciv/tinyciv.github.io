import { entityStore } from '../src/game/entity-store';
import { afterEach, describe, expect, it } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { unitObstructs } from '../src/game/collisions';
import { beginUnitFrame, cellOccupant, endUnitFrame, forEachNearbyUnit, indexedLeader, nearbyBuildings, nearbyUnits, refreshIndexedUnit, unitOccupancy } from '../src/game/spatial';
import type { GameState, Unit } from '../src/game/types';

const active: GameState[] = [];
afterEach(() => { for (const state of active) endUnitFrame(state); active.length = 0; });
function begin(state: GameState) { beginUnitFrame(state); active.push(state); }
function fixture() {
  const state = scenario('Open melee'), base = state.units[1];
  entityStore(state).units.replace([
    { ...base, id: 100, faction: 0, x: 8.5, y: 12.5 },
    { ...base, id: 101, faction: 0, x: 10.5, y: 12.5 },
    { ...base, id: 102, faction: 0, x: 9.5, y: 12.5 },
  ]);
  return state;
}
const key = (state: GameState, unit: { x: number; y: number }) => Math.floor(unit.y) * state.world.width + Math.floor(unit.x);

describe('live cell occupancy index', () => {
  it('refreshes moves within and across broad-phase buckets and observes death/hiding immediately', () => {
    const state = fixture(), [requester, first, second] = state.units;
    begin(state);
    const occupied = unitOccupancy(state, requester), destination = key(state, first), previous = key(state, second);
    second.x = first.x; refreshIndexedUnit(state, second);
    expect(occupied.has(previous)).toBe(false);
    expect(occupied.has(destination)).toBe(true);
    // Moving within the bucket does not change original insertion priority.
    expect(cellOccupant(state, first, requester)).toBe(first);
    first.x = 14.5; refreshIndexedUnit(state, first);
    first.x = second.x; refreshIndexedUnit(state, first);
    // Leaving/reentering appends to the original bucket's ordered Set.
    expect(cellOccupant(state, second, requester)).toBe(second);
    second.hp = 0;
    expect(cellOccupant(state, second, requester)).toBe(first);
    first.inside = true;
    expect(occupied.has(destination)).toBe(false);
    expect(cellOccupant(state, second, requester)).toBeUndefined();
  });

  it('matches full-scan collision classes without retaining dead or hidden blockers', () => {
    const state = fixture(), kinds: Unit['kind'][] = ['leader', 'warrior', 'worker', 'deer', 'buffalo', 'elephant', 'ostrich'];
    entityStore(state).units.replace(kinds.map((kind, i) => ({ ...state.units[0], kind, id: 100 + i, x: 8.5 + i, y: 12.5 })));
    begin(state);
    const check = () => {
      for (const requester of state.units) {
        const occupied = unitOccupancy(state, requester);
        for (const other of state.units) expect(occupied.has(key(state, other))).toBe(state.units.some(candidate => key(state, candidate) === key(state, other) && unitObstructs(requester, candidate)));
      }
    };
    check();
    state.units[0].hp = 0; state.units[1].inside = true;
    state.units[2].x = state.units[3].x; refreshIndexedUnit(state, state.units[2]);
    check();
  });

  it('indexes newly added units and falls back to fresh snapshots outside a frame', () => {
    const state = fixture(), requester = state.units[0];
    begin(state);
    const newcomer = { ...state.units[1], id: 500, x: 22.5 };
    entityStore(state).units.add(newcomer); refreshIndexedUnit(state, newcomer);
    expect(unitOccupancy(state, requester).has(key(state, newcomer))).toBe(true);
    endUnitFrame(state);
    newcomer.x = 2.5;
    expect(unitOccupancy(state, requester).has(key(state, newcomer))).toBe(true);
    expect(cellOccupant(state, newcomer, requester)).toBe(newcomer);
  });

  it('retains occupancy views across frames while observing changed collision roles and moves', () => {
    const state = fixture(), [requester, blocker] = state.units;
    begin(state);
    const occupied = unitOccupancy(state, requester), before = key(state, blocker);
    endUnitFrame(state);
    blocker.x += 8;
    beginUnitFrame(state);
    expect(unitOccupancy(state, requester)).toBe(occupied);
    expect(occupied.has(before)).toBe(false);
    expect(occupied.has(key(state, blocker))).toBe(true);
    blocker.inside = true;
    expect(occupied.has(key(state, blocker))).toBe(false);
    blocker.inside = false;
    entityStore(state).setUnitRole(requester, { kind: 'worker', collector: true });
    entityStore(state).setUnitRole(blocker, { kind: 'worker', collector: true });
    expect(occupied.has(key(state, blocker))).toBe(false);
  });
});

it('refreshes building candidates after direct size/position edits and collection replacement', () => {
  const state = fixture();
  const building = { id: 500, kind: 'house' as const, faction: 0, x: 11, y: 8, hp: 100, maxHp: 100, capacity: 4 };
  entityStore(state).buildings.replace([building]);
  begin(state);
  const point = { x: 13.5, y: 8.5 };
  expect(nearbyBuildings(state, point, 0)).toEqual([]);
  // Deliberately bypass revision helpers: public fixture/editor mutations must
  // still be visible at the next spatial frame boundary.
  state.buildings[0].kind = 'palace';
  beginUnitFrame(state);
  expect(nearbyBuildings(state, point, 0)).toEqual([building]);
  building.x = 21;
  beginUnitFrame(state);
  expect(nearbyBuildings(state, point, 0)).toEqual([]);
  const replacement = { ...building, id: 501, x: 12, kind: 'house' as const };
  entityStore(state).buildings.replace([replacement]);
  beginUnitFrame(state);
  expect(nearbyBuildings(state, point, 0)).toEqual([replacement]);
  replacement.hp = 0; replacement.faction = 1;
  expect(nearbyBuildings(state, point, 0)[0]).toBe(replacement);
  entityStore(state).buildings.retain(() => false);
  beginUnitFrame(state);
  expect(nearbyBuildings(state, point, 0)).toEqual([]);
});

it('selects the first living faction leader and sees refreshed membership changes', () => {
  const state = fixture(), [first, second] = state.units;
  entityStore(state).setUnitRole(first, { kind: 'leader' }); entityStore(state).setUnitRole(second, { kind: 'leader' });
  begin(state);
  expect(indexedLeader(state, 0)).toBe(first);
  first.hp = 0;
  expect(indexedLeader(state, 0)).toBe(second);
  second.faction = 1; refreshIndexedUnit(state, second);
  expect(indexedLeader(state, 0)).toBeUndefined();
  expect(indexedLeader(state, 1)).toBe(second);
  entityStore(state).setUnitRole(second, { kind: 'warrior' }); refreshIndexedUnit(state, second);
  expect(indexedLeader(state, 1)).toBeUndefined();
  endUnitFrame(state);
  first.hp = 100;
  expect(indexedLeader(state, 0)).toBe(first);
});

describe('unordered broad-phase visits', () => {
  it('reports the same neighbors and original array indices after bucket movement', () => {
    const state = fixture(), base = state.units[0];
    entityStore(state).units.replace(Array.from({ length: 40 }, (_, i) => ({ ...base, id: 200 + i, x: 4.5 + i % 10, y: 4.5 + Math.floor(i / 10) * 4 })));
    begin(state);
    // Reinsert an early unit into a later bucket: visit order must not be used
    // as original unit-array order for choosing a routing faction or tie winner.
    state.units[0].x = 13.5; state.units[0].y = 16.5; refreshIndexedUnit(state, state.units[0]);
    for (const point of [{ x: 8.5, y: 8.5 }, { x: 0, y: 0 }, { x: 13.5, y: 16.5 }]) {
      for (const radius of [0, 1, 5, Infinity]) {
        const visits: { unit: Unit; order: number }[] = [];
        forEachNearbyUnit(state, point, radius, (unit, order) => visits.push({ unit, order }));
        expect(visits.map(item => item.unit).sort((a, b) => state.units.indexOf(a) - state.units.indexOf(b))).toEqual(nearbyUnits(state, point, radius));
        expect(visits.every(item => state.units[item.order] === item.unit)).toBe(true);
        expect(new Set(visits.map(item => item.unit)).size).toBe(visits.length);
      }
    }
  });

  it('retains the public full-scan fallback outside a unit frame', () => {
    const state = fixture(), visits: { unit: Unit; order: number }[] = [];
    forEachNearbyUnit(state, { x: 100, y: 100 }, 0, (unit, order) => visits.push({ unit, order }));
    expect(visits.map(item => item.unit)).toEqual(state.units);
    expect(visits.map(item => item.order)).toEqual([0, 1, 2]);
  });
});

it('keeps original order across bitset words, swap removals, and newly appended recruits', () => {
  const state = fixture(), base = state.units[0];
  entityStore(state).units.replace(Array.from({ length: 96 }, (_, i) => ({ ...base, id: 1000 + i,
    x: 4.5 + i % 12 * 2, y: 4.5 + Math.floor(i / 12) * 2,
    inside: i % 7 === 0, hp: i % 11 === 0 ? 0 : base.hp })));
  begin(state);
  const check = () => {
    for (const point of [{ x: .5, y: .5 }, { x: 12.5, y: 12.5 }, { x: 25.5, y: 18.5 }]) {
      for (const radius of [0, 1, 5, 12, 30]) {
        const x0 = Math.max(0, Math.floor((point.x - radius) / 4));
        const x1 = Math.min(Math.ceil(state.world.width / 4) - 1, Math.floor((point.x + radius) / 4));
        const y0 = Math.max(0, Math.floor((point.y - radius) / 4)), y1 = Math.floor((point.y + radius) / 4);
        const expected = state.units.filter(unit => {
          const x = Math.floor(unit.x / 4), y = Math.floor(unit.y / 4);
          return x >= x0 && x <= x1 && y >= y0 && y <= y1;
        });
        expect(nearbyUnits(state, point, radius)).toEqual(expected);
        // A repeated query uses exactly the same membership and order.
        expect(nearbyUnits(state, point, radius)).toEqual(expected);
      }
    }
  };
  check();
  for (let i = 0; i < 65; i += 2) {
    state.units[i].x = 10.5; state.units[i].y = 12.5;
    refreshIndexedUnit(state, state.units[i]);
  }
  check();
  for (let i = 0; i < 40; i++) {
    const recruit = { ...base, id: 2000 + i, x: 10.5, y: 12.5 };
    entityStore(state).units.add(recruit); refreshIndexedUnit(state, recruit);
  }
  check();
});
