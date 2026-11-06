import { describe, expect, it } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { entityStore } from '../src/game/entity-store';
import { movementProfile, setMovementProfiling } from '../src/game/movement-profile';
import { moveUnit } from '../src/game/simulation';
import { beginUnitFrame, endUnitFrame, lastCollidingUnitInCell, nearbyUnits, refreshIndexedUnit } from '../src/game/spatial';
import type { Point, Unit } from '../src/game/types';

function fixture() {
  const state = scenario('Open melee');
  entityStore(state).buildings.replace([]);
  const unit: Unit = { ...state.units[1], id: 100, faction: 0, x: 8.5, y: 8.5,
    path: undefined, pathGoal: undefined, repathAt: 0, defensiveAnchor: undefined };
  entityStore(state).units.replace([unit]);
  return { state, unit };
}

describe('reused movement bookkeeping', () => {
  it('preserves yield-chain occupant priority through overlapping units, movement and removal', () => {
    const { state, unit } = fixture(), store = entityStore(state);
    const first = { ...unit, id: 101, x: 10.5 }, last = { ...unit, id: 102, x: 10.5 };
    const civilian: Unit = { ...unit, id: 103, kind: 'worker', x: 10.5 };
    store.units.add(first, last, civilian);
    const cell = 8 * state.world.width + 10;
    expect(lastCollidingUnitInCell(state, cell, unit)).toBe(last);
    beginUnitFrame(state);
    try {
      expect(lastCollidingUnitInCell(state, cell, unit)).toBe(last);
      last.hp = 0;
      expect(lastCollidingUnitInCell(state, cell, unit)).toBe(first);
      last.hp = 100; last.inside = true;
      expect(lastCollidingUnitInCell(state, cell, unit)).toBe(first);
      last.inside = false; last.x = 12.5; refreshIndexedUnit(state, last);
      expect(lastCollidingUnitInCell(state, cell, unit)).toBe(first);
      store.units.retain(candidate => candidate !== first);
      expect(lastCollidingUnitInCell(state, cell, unit)).toBeUndefined();
      const newcomer = { ...unit, id: 104, x: 10.5 };
      // Reinforcements spawned during combat have not had a movement refresh.
      store.units.add(newcomer);
      const sensed = [...nearbyUnits(state, unit, 10)];
      expect(lastCollidingUnitInCell(state, cell, unit)).toBe(newcomer);
      expect(nearbyUnits(state, unit, 10)).toEqual(sensed);
      expect(nearbyUnits(state, unit, 10)).not.toContain(newcomer);
      refreshIndexedUnit(state, newcomer);
      expect(nearbyUnits(state, unit, 10)).toContain(newcomer);
      expect(lastCollidingUnitInCell(state, 8 * state.world.width + 8, unit)).toBe(unit);
      unit.x = 9.5;
      expect(lastCollidingUnitInCell(state, 8 * state.world.width + 9, unit)).toBe(unit);
    } finally { endUnitFrame(state); }
  });

  it('recomputes defensive boundaries after the anchor and occupied cell change', () => {
    const { state, unit } = fixture();
    unit.retinueStance = 'defensive'; unit.defensiveAnchor = { x: 8.5, y: 8.5 };
    const travel = (goal: Point) => {
      unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
      for (let i = 0; i < 20; i++) {
        state.time += .1; moveUnit(state, unit, goal, .1);
        expect(Math.hypot(unit.x - unit.defensiveAnchor!.x, unit.y - unit.defensiveAnchor!.y)).toBeLessThanOrEqual(3 + 1e-7);
      }
    };
    travel({ x: 10.5, y: 8.5 });
    expect(unit.x).toBeGreaterThan(9.5);
    unit.x = 16.5; unit.y = 16.5; unit.defensiveAnchor = { x: 16.5, y: 16.5 };
    travel({ x: 14.5, y: 16.5 });
    expect(unit.x).toBeLessThan(15.5);
  });

  it('collects opt-in costs without changing movement and resets when enabled again', () => {
    const plain = fixture(), measured = fixture(), goal = { x: 15.5, y: 8.5 };
    setMovementProfiling(measured.state, true);
    for (const { state, unit } of [plain, measured]) {
      beginUnitFrame(state);
      try {
        for (let i = 0; i < 10; i++) { state.time += .1; moveUnit(state, unit, goal, .1); refreshIndexedUnit(state, unit); }
      } finally { endUnitFrame(state); }
    }
    expect(measured.unit).toEqual(plain.unit);
    expect(movementProfile(plain.state)).toBeUndefined();
    const profile = movementProfile(measured.state)!;
    expect(profile.calls).toBe(10);
    expect(profile.pathSearches).toBeGreaterThan(0);
    expect(profile.movementMs).toBeGreaterThan(0);
    expect(profile.steeringMs).toBeGreaterThan(0);
    expect(profile.pathSearchMs).toBeLessThanOrEqual(profile.movementMs);
    setMovementProfiling(measured.state, false);
    expect(movementProfile(measured.state)).toBeUndefined();
    setMovementProfiling(measured.state, true);
    expect(movementProfile(measured.state)!.calls).toBe(0);
  });
});

it('caps automatic path searches even if repeated invalidations reset retry deadlines', async () => {
  const { withSimulationReads } = await import('../src/game/simulation-reads');
  const { state, unit } = fixture(), samples: number[] = [];
  setMovementProfiling(state, true);
  withSimulationReads(state, () => {
    for (let frame = 1; frame <= 120; frame++) {
      state.time = frame / 60;
      unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
      const before = movementProfile(state)!.pathSearches;
      moveUnit(state, unit, { x: 15.5, y: 8.5 }, 1 / 60);
      if (movementProfile(state)!.pathSearches > before) samples.push(state.time);
    }
  });
  expect(samples).toHaveLength(6);
  expect(movementProfile(state)!.pathSearches).toBe(6);
  for (let i = 1; i < samples.length; i++) expect(samples[i] - samples[i - 1]).toBeGreaterThanOrEqual(1 / 3 - 1e-9);
});
