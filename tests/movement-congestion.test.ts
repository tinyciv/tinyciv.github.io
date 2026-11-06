import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { unitObstructs } from '../src/game/collisions';
import { claimAttackSpot, movementCongestion } from '../src/game/engagement';
import { beginUnitFrame, endUnitFrame } from '../src/game/spatial';
import type { GameState, Point, Unit } from '../src/game/types';

const cell = (state: GameState, point: Point) => Math.floor(point.y) * state.world.width + Math.floor(point.x);

// Preserve the former two-pass/set algorithm as a numeric/order oracle. Claims
// are observed through the public reservation API instead of internal state.
function reference(state: GameState, unit: Unit, claims: Map<number, { point: Point; until: number }>) {
  const result = new Map<number, number>(), obstructing = new Set<number>();
  const add = (point: Point, amount: number) => {
    const index = cell(state, point); result.set(index, (result.get(index) ?? 0) + amount);
  };
  for (const other of state.units) {
    if (!unitObstructs(unit, other)) continue;
    obstructing.add(other.id);
    if (other.faction !== unit.faction) continue;
    add(other, other.moving ? 2 : 5);
    for (const point of other.path?.slice(0, 3) ?? []) add(point, .8);
  }
  for (const [id, claim] of claims) if (claim.until >= state.time && obstructing.has(id)) add(claim.point, 3);
  return result;
}

describe('fused obstruction and movement-cost scan', () => {
  it('clears reused search costs when units die or belong to a different observer', () => {
    const state = scenario('Open melee'), base = state.units[1];
    const a = { ...base, id: 100, faction: 0, x: 8.5, y: 8.5 };
    const b = { ...base, id: 101, faction: 0, x: 9.5, y: 8.5, path: [{ x: 10.5, y: 8.5 }] };
    const enemy = { ...base, id: 102, faction: 1, x: 14.5, y: 8.5 };
    entityStore(state).units.replace([a, b, enemy]);
    const scratch = new Map<number, number>([[-1, 99]]);
    expect(movementCongestion(state, a, undefined, scratch)).toBe(scratch);
    expect([...scratch]).toEqual([...movementCongestion(state, a)]);
    expect(scratch.size).toBeGreaterThan(0);
    movementCongestion(state, enemy, undefined, scratch);
    expect([...scratch]).toEqual([...movementCongestion(state, enemy)]);
    expect(scratch.size).toBe(0);
    b.hp = 0;
    movementCongestion(state, a, undefined, scratch);
    expect(scratch.size).toBe(0);
  });

  it('preserves exact cost additions, map order, reservations and live collision exclusions', () => {
    const state = scenario('Open melee'), base = state.units[1];
    const shared = { x: 16.5, y: 8.5 }, fourth = { x: 29.5, y: 22.5 };
    entityStore(state).units.replace(Array.from({ length: 7 }, (_, i): Unit => ({ ...base, id: 100 + i, faction: i === 3 ? -2 : 0,
      x: 7.5 + i, y: 12.5, hp: 100, kind: i === 4 ? 'worker' : i === 5 ? 'deer' : 'warrior',
      moving: i % 2 === 1, path: i === 1 ? [shared, shared, shared, fourth] : i === 2 ? [shared] : undefined })));
    const observer = state.units[0], claims = new Map<number, { point: Point; until: number }>();
    beginUnitFrame(state);
    try {
      for (let i = 1; i < state.units.length; i++) {
        const point = claimAttackSpot(state, state.units[i], { ...base, id: 900 + i, x: 21.5, y: 2.5 + i * 2.5 }, () => true);
        expect(point).toBeDefined();
        claims.set(state.units[i].id, { point: point!, until: state.time + 1.25 });
      }
      const check = () => {
        const visits: { unit: Unit; cell: number }[] = [];
        const actual = movementCongestion(state, observer, (unit, cell) => visits.push({ unit, cell }));
        expect([...actual]).toEqual([...reference(state, observer, claims)]);
        expect(visits.map(visit => visit.unit)).toEqual(state.units.filter(other => unitObstructs(observer, other)));
        expect(visits.every(visit => visit.cell === cell(state, visit.unit))).toBe(true);
        expect([...movementCongestion(state, observer)]).toEqual([...actual]);
        expect(actual.has(cell(state, fourth))).toBe(false);
      };
      check();
      state.units[1].hp = 0; state.units[3].inside = true;
      check();
      state.time = 1.25; check();
      state.time = 1.251; check();
    } finally { endUnitFrame(state); }
  });
});
