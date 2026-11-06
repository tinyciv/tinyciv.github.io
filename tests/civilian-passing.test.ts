import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { moveUnit, updateFriendlyYield } from '../src/game/simulation';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit, unitOccupancy } from '../src/game/spatial';
import { beginNavigationFrame, canMove, endNavigationFrame, invalidateNavigation } from '../src/game/pathfinding';
import { unitCollisionRadius, unitsCollide } from '../src/game/collisions';
import { unitPositionBlocked } from '../src/game/civilian-movement';
import type { Building, GameState, Unit } from '../src/game/types';

function traveler(id: number, kind: Unit['kind'], x: number): Unit {
  return { id, kind, faction: 0, x, y: 3.5, hp: 50, morale: 100, attack: 0, defense: 0, speed: 2.2, range: 1,
    order: 'work', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
function corridor(): GameState {
  return { world: { width: 22, height: 7, seed: 'civilian-passing', source: 'test', revision: 1, spawns: [],
    tiles: Array.from({ length: 154 }, (_, index) => ({ terrain: Math.floor(index / 22) === 3 ? 'grassland' : 'lake',
      overlay: 'none', elevation: .3, moisture: .5, variation: .5, food: 1, production: 1, gold: 0 })) },
    units: [], buildings: [], factions: [{ id: 0, relation: 'self' }], time: 0,
  } as unknown as GameState;
}
const building = (id: number, kind: Building['kind'], faction: number): Building => ({ id, kind, faction,
  x: 10, y: 3, hp: 100, maxHp: 100, capacity: 0 });
const nonMilitary: Unit['kind'][] = ['worker', 'merchant', 'boar', 'deer', 'buffalo', 'elephant', 'ostrich'];

describe('non-military passing', () => {
  it.each([false, true])('allows exact overlap for every non-military pair and faction (indexed: %s)', indexed => {
    const state = corridor();
    for (const kind of nonMilitary) for (const otherKind of nonMilitary) for (const faction of [0, 1, -2]) {
      const a = traveler(1, kind, 3.5), b = { ...traveler(2, otherKind, 3.5), faction };
      entityStore(state).units.replace([a, b]);
      if (indexed) beginUnitFrame(state);
      try {
        expect(unitOccupancy(state, a).has(3 * 22 + 3)).toBe(false);
        expect(unitPositionBlocked(state, a, b)).toBe(false);
        expect(unitPositionBlocked(state, b, a)).toBe(false);
      } finally { if (indexed) endUnitFrame(state); }
    }
  });

  it('retains military blocking and human civilian passage through soldiers', () => {
    const state = corridor(), a = traveler(1, 'warrior', 3.25), b = traveler(2, 'archer', 3.75);
    entityStore(state).units.replace([a, b]);
    expect(unitPositionBlocked(state, a, b)).toBe(true);
    expect(unitOccupancy(state, a).has(3 * 22 + 3)).toBe(true);
    for (const kind of ['worker', 'merchant'] as const) {
      entityStore(state).setUnitRole(a, { kind });
      expect(unitPositionBlocked(state, a, b)).toBe(false);
      expect(unitPositionBlocked(state, b, a)).toBe(false);
    }
    expect(unitsCollide({ kind: 'boar' }, b)).toBe(true);
    expect(unitCollisionRadius(traveler(3, 'worker', 8))).toBe(.14);
    expect(unitCollisionRadius(b)).toBe(.5);
  });

  it.each(['worker', 'merchant', 'deer'] as const)('crosses a %s on the lane centerline without yielding, slowing, or leaving land', kind => {
    const state = corridor(), a = traveler(1, 'worker', 2.5), b = { ...traveler(2, kind, 18.5), faction: 1 };
    a.speed = b.speed = 2.5;
    entityStore(state).units.replace([a, b]);
    const goals = [{ x: 18.5, y: 3.5 }, { x: 2.5, y: 3.5 }];
    let overlapped = false;
    for (let step = 0; step < 80; step++) {
      state.time += .1; beginNavigationFrame(state); beginUnitFrame(state);
      try {
        for (let i = 0; i < 2; i++) {
          const unit = state.units[i], from = { x: unit.x, y: unit.y };
          moveUnit(state, unit, goals[i], .1); refreshIndexedUnit(state, unit);
          expect(canMove(state, from, unit, unit.faction)).toBe(true);
          expect(unit.y).toBe(3.5);
          expect(Math.abs(unit.x - from.x)).toBeLessThanOrEqual(.25001);
          expect(unit.stuckFor ?? 0).toBe(0);
          expect(updateFriendlyYield(state, unit, .1)).toBe(false);
        }
        overlapped ||= Math.abs(a.x - b.x) < .28;
      } finally { endUnitFrame(state); endNavigationFrame(state); }
    }
    expect(overlapped).toBe(true);
    expect(Math.abs(a.x - goals[0].x)).toBeLessThan(.12);
    expect(Math.abs(b.x - goals[1].x)).toBeLessThan(.12);
  });

  it('passes a stationary civilian in a gate without making it move', () => {
    const state = corridor(), a = traveler(1, 'worker', 8.5), b = traveler(2, 'merchant', 10.5);
    entityStore(state).units.replace([a, b]);
    entityStore(state).buildings.replace([building(10, 'wall', 0), building(11, 'road', 0)]);
    let overlapped = false;
    for (let step = 0; step < 25; step++) {
      state.time += .1;
      moveUnit(state, a, { x: 13.5, y: 3.5 }, .1);
      overlapped ||= Math.abs(a.x - b.x) < .2;
      expect(a.y).toBe(3.5);
      expect(updateFriendlyYield(state, b, .1)).toBe(false);
      expect(b.x).toBe(10.5);
    }
    expect(overlapped).toBe(true);
    expect(a.x).toBeGreaterThan(13.3);
    // A civilian beyond a solid wall or water cannot make those tiles pathable.
    entityStore(state).buildings.replace(state.buildings.slice(0, -1)); invalidateNavigation(state);
    Object.assign(a, { x: 8.5, y: 3.5, path: undefined, pathGoal: undefined, repathAt: 0 });
    for (let step = 0; step < 25; step++) { state.time += .1; moveUnit(state, a, { x: 13.5, y: 3.5 }, .1); }
    expect(a.x).toBeLessThan(10);
    expect(canMove(state, a, { x: a.x, y: 2.5 }, 0)).toBe(false);
  });
});
