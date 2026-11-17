import { describe, expect, it } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { entityStore } from '../src/game/entity-store';
import { MOVEMENT_PATH_REQUESTS_PER_UPDATE, movementPathDeferred, requestMovementPath, withMovementPathBudget } from '../src/game/movement-path-schedule';
import { moveUnit, updateGame } from '../src/game/simulation';
import type { GameState, Unit } from '../src/game/types';

function fixture(count = 24) {
  const state = scenario('Open melee'), base = state.units[1];
  const units: Unit[] = Array.from({ length: count }, (_, index) => ({ ...base,
    id: 100 + index, kind: 'warrior', faction: 0, x: 3.5 + index % 6 * 3,
    y: 6.5 + Math.floor(index / 6) * 3, marauderPack: undefined,
    order: 'hold', path: undefined, pathGoal: undefined, repathAt: 0 }));
  entityStore(state).units.replace(units);
  entityStore(state).buildings.replace([]);
  state.marauderPacks = [];
  return { state, units };
}
function exhaust(state: GameState) {
  for (let index = 0; index < MOVEMENT_PATH_REQUESTS_PER_UPDATE; index++)
    expect(requestMovementPath(state, { id: -index - 1, hp: 100 } as Unit)).toBe(true);
}

describe('movement route scheduling', () => {
  it('keeps object identity when a replacement actor reuses a queued external ID', () => {
    const { state, units: [old] } = fixture(1);
    withMovementPathBudget(state, () => { exhaust(state); expect(requestMovementPath(state, old)).toBe(false); });
    old.hp = 0;
    const replacement = { ...old, hp: 100 };
    state.time += .1;
    withMovementPathBudget(state, () => {
      expect(requestMovementPath(state, replacement)).toBe(true);
      for (let index = 1; index < MOVEMENT_PATH_REQUESTS_PER_UPDATE; index++)
        expect(requestMovementPath(state, { ...replacement })).toBe(true);
      expect(requestMovementPath(state, { ...replacement })).toBe(false);
    });
  });

  it('restores scope admission after exceptions and resets deferred state on time rewind', () => {
    const { state, units: [unit] } = fixture(1);
    state.time = 10;
    expect(() => withMovementPathBudget(state, () => {
      exhaust(state); expect(requestMovementPath(state, unit)).toBe(false);
      throw new Error('cancelled simulation step');
    })).toThrow('cancelled simulation step');
    expect(requestMovementPath(state, unit)).toBe(true);
    state.time = 0;
    withMovementPathBudget(state, () => {
      expect(movementPathDeferred(state, unit)).toBe(false);
      expect(requestMovementPath(state, unit)).toBe(true);
      expect(requestMovementPath(state, unit, true)).toBe(true);
    });
  });

  it('bounds requests and gives every waiting unit a turn despite repeated early arrivals', () => {
    const { state, units } = fixture(41), seen = new Set<number>();
    const process = () => withMovementPathBudget(state, () => {
      const accepted = units.filter(unit => requestMovementPath(state, unit));
      expect(accepted.length).toBeLessThanOrEqual(MOVEMENT_PATH_REQUESTS_PER_UPDATE);
      accepted.forEach(unit => seen.add(unit.id));
      state.time += .1;
      return accepted.map(unit => unit.id);
    });
    const order = Array.from({ length: 6 }, process);
    expect(seen.size).toBe(units.length);
    const repeat = fixture(41), replay: number[][] = [];
    for (let frame = 0; frame < 6; frame++) withMovementPathBudget(repeat.state, () => {
      replay.push(repeat.units.filter(unit => requestMovementPath(repeat.state, unit)).map(unit => unit.id));
      repeat.state.time += .1;
    });
    expect(replay).toEqual(order);
  });

  it('expires cancelled and dead requests without starving later arrivals', () => {
    const { state, units } = fixture(20);
    withMovementPathBudget(state, () => units.forEach(unit => requestMovementPath(state, unit)));
    units[8].hp = 0;
    for (let frame = 0; frame < 3; frame++) withMovementPathBudget(state, () => {
      // Units 9–15 no longer need a route; they must not reserve slots forever.
      for (const unit of units.slice(16)) requestMovementPath(state, unit);
      state.time += .1;
    });
    withMovementPathBudget(state, () => {
      expect(units.slice(16).every(unit => requestMovementPath(state, unit))).toBe(true);
    });
  });

  it('does not starve five rotating hidden cohorts behind continuous foreground requests', () => {
    const { state, units } = fixture(70), seen = new Set<number>();
    const foreground = units.slice(0, 40), hidden = units.slice(40);
    hidden.forEach(unit => { unit.faction = -2; });
    for (let frame = 1; frame <= 40; frame++) withMovementPathBudget(state, () => {
      let accepted = 0;
      // Foreground units always run first, deliberately making this adversarial.
      for (const unit of [...foreground, ...hidden.filter(unit => unit.id % 5 === frame % 5)]) {
        if (requestMovementPath(state, unit)) { accepted++; seen.add(unit.id); }
      }
      expect(accepted).toBeLessThanOrEqual(MOVEMENT_PATH_REQUESTS_PER_UPDATE);
      state.time += 1 / 60;
    });
    expect(foreground.every(unit => seen.has(unit.id))).toBe(true);
    expect(hidden.every(unit => seen.has(unit.id))).toBe(true);
  });

  it('keeps a deferred worker job pending without reporting an unreachable or stuck trip', () => {
    const { state, units: [unit] } = fixture(1);
    Object.assign(unit, { kind: 'worker', builder: true, order: 'work', buildSite: 77,
      buildPhase: 'outbound', destination: { x: 22.5, y: unit.y }, stuckFor: .25 });
    const destination = unit.destination!;
    withMovementPathBudget(state, () => {
      exhaust(state);
      moveUnit(state, unit, destination, .1);
      expect(movementPathDeferred(state, unit)).toBe(true);
      expect(unit).toMatchObject({ buildSite: 77, buildPhase: 'outbound', order: 'work', stuckFor: .25, repathAt: 0 });
      expect(unit.destination).toBe(destination);
      expect(unit.pathGoal).toBeUndefined();
    });
    state.time += .1;
    withMovementPathBudget(state, () => moveUnit(state, unit, destination, .1));
    expect(unit.moving).toBe(true);
    expect(unit.path?.length).toBeGreaterThan(0);
    expect(movementPathDeferred(state, unit)).toBe(false);
    expect(unit.buildSite).toBe(77);
  });

  it('starts a mass movement order in bounded batches while preserving every destination', () => {
    const { state, units } = fixture();
    const initial = units.map(unit => unit.x);
    for (const unit of units) unit.attackReturn = { x: unit.x + 6, y: unit.y };
    for (let frame = 1; frame <= 3; frame++) {
      state.time += .1;
      withMovementPathBudget(state, () => {
        for (const unit of units) moveUnit(state, unit, unit.attackReturn!, .1);
      });
      expect(units.filter((unit, index) => unit.x > initial[index]).length)
        .toBe(frame * MOVEMENT_PATH_REQUESTS_PER_UPDATE);
      expect(units.every((unit, index) => unit.attackReturn?.x === initial[index] + 6)).toBe(true);
      expect(units.filter(unit => movementPathDeferred(state, unit)).every(unit => !unit.stuckFor)).toBe(true);
    }
  });

  it('continues an existing usable route while its requested refresh waits', () => {
    const { state, units: [unit] } = fixture(1);
    moveUnit(state, unit, { x: 18.5, y: unit.y }, .1);
    const route = unit.path, originalGoal = unit.pathGoal, from = unit.x;
    state.time = 1; unit.repathAt = 0;
    withMovementPathBudget(state, () => {
      exhaust(state);
      moveUnit(state, unit, { x: 24.5, y: unit.y }, .1);
    });
    expect(unit.path).toBe(route);
    expect(unit.pathGoal).toBe(originalGoal);
    expect(unit.x).toBeGreaterThan(from);
    expect(movementPathDeferred(state, unit)).toBe(true);
  });

  it('moves a human leader immediately even after the regular request budget is spent', () => {
    const { state, units: [unit] } = fixture(1);
    unit.kind = 'leader';
    withMovementPathBudget(state, () => {
      exhaust(state);
      moveUnit(state, unit, { x: 22.5, y: unit.y }, .1);
    });
    expect(unit.moving).toBe(true);
    expect(movementPathDeferred(state, unit)).toBe(false);
  });

  it('lets ordinary combatants engage after bounded initial route requests', () => {
    const state = scenario('Open melee'), units = state.units.filter(unit => unit.kind !== 'leader');
    const positions = new Map(units.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
    for (let frame = 0; frame < 80; frame++) updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(state.gameOver).toBe(false);
    expect(units.filter(unit => unit.lastCombat > 0).length).toBeGreaterThan(10);
    expect(units.filter(unit => Math.hypot(unit.x - positions.get(unit.id)!.x, unit.y - positions.get(unit.id)!.y) > 1).length).toBeGreaterThan(10);
  });
});
