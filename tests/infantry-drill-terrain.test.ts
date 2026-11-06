import { describe, expect, it, vi } from 'vitest';
import { advanceInfantryFormations, infantryFormationGoal, infantryPointClear, infantryRectangleOffsets,
  toggleInfantryFormation, INFANTRY_CATCHUP_MULTIPLIER, INFANTRY_FORMATION_SPEED } from '../src/game/infantry-drill';
import { beginNavigationFrame, endNavigationFrame } from '../src/game/pathfinding';
import * as navigation from '../src/game/pathfinding';
import { entityStore } from '../src/game/entity-store';
import { moveUnit } from '../src/game/simulation';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from '../src/game/spatial';
import { distance, type GameState, type InputState, type Point, type Unit } from '../src/game/types';

const idle: InputState = { up: false, down: false, left: false, right: false };
const DT = .05;
function soldier(id: number, point: Point, kind: Unit['kind']): Unit {
  return { id, ...point, kind, faction: 0, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 5,
    speed: kind === 'leader' ? 4.4 : kind === 'horseman' ? 5.5 : 3.3, range: 1.1,
    order: kind === 'leader' ? 'hold' : 'follow', retinueStance: 'aggressive', cooldown: 0, lastCombat: -100,
    moving: false, facing: 0, attackTime: 0 };
}
function fixture(count = 12) {
  const width = 64, height = 40, leader = soldier(1, { x: 10.5, y: 20.5 }, 'leader');
  const members = infantryRectangleOffsets(count).map((offset, index) => soldier(index + 2,
    { x: leader.x + offset.x, y: leader.y + offset.y }, (['warrior', 'archer', 'spearman', 'horseman'] as const)[index % 4]));
  const state = {
    world: { width, height, revision: 0, seed: 'local-drill-terrain', source: 'test', spawns: [], tiles: Array.from({ length: width * height }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .1, moisture: .5, food: 0, production: 0, gold: 0, variation: .5 })) },
    units: [leader, ...members], buildings: [],
    factions: [{ id: 0, name: 'Roma', color: '#f44', affinity: 100, relation: 'self', population: 0, food: 10000, gold: 10000,
      production: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false,
      research: { focus: 'infantryDrill', levels: { infantryDrill: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, gameOver: false, victory: false, events: [], particles: [], selected: leader.id,
    selectedType: 'unit', buildMode: null, diplomacy: null, seed: 'local-drill-terrain', rngState: 1, fields: [], raiderCamps: [],
    marauderPacks: [], villages: [], fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, retinueStance: 'aggressive', movementMode: 'travel',
  } as unknown as GameState;
  const block = (x: number, y: number, kind: 'house' | 'wall' = 'wall') => entityStore(state).buildings.add({ id: 1000 + state.buildings.length,
    kind, faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
  return { state, leader, members, block };
}
function ideal(leader: Unit, member: Unit): Point {
  const form = leader.infantryFormation!, slot = form.slots.find(candidate => candidate.id === member.id)!;
  return { x: leader.x + Math.cos(form.heading) * slot.x - Math.sin(form.heading) * slot.y,
    y: leader.y + Math.sin(form.heading) * slot.x + Math.cos(form.heading) * slot.y };
}
function step(state: GameState, input: InputState = idle): void {
  const before = state.units.map(unit => ({ ...unit }));
  state.time += DT; beginUnitFrame(state); beginNavigationFrame(state);
  try {
    advanceInfantryFormations(state, DT, () => input, (unit, goal, speed, elapsed) => {
      moveUnit(state, unit, goal, elapsed * speed / unit.speed, true, false, true); refreshIndexedUnit(state, unit);
    });
    state.units.forEach((unit, index) => {
      expect(distance(unit, before[index])).toBeLessThanOrEqual(3.3 * INFANTRY_FORMATION_SPEED * INFANTRY_CATCHUP_MULTIPLIER * DT + 1e-7);
      expect(infantryPointClear(state, unit, 0)).toBe(true);
    });
  } finally { endUnitFrame(state); endNavigationFrame(state); }
}
function run(state: GameState, seconds: number): void { for (let index = 0; index < Math.round(seconds / DT); index++) step(state); }
function expectReformedAndStill(state: GameState, leader: Unit, members: Unit[]): void {
  for (const member of members) expect(distance(member, ideal(leader, member))).toBeLessThan(.04);
  for (let a = 0; a < state.units.length; a++) for (let b = a + 1; b < state.units.length; b++)
    expect(distance(state.units[a], state.units[b])).toBeGreaterThan(.65);
  const settled = state.units.map(unit => ({ ...unit })); run(state, 4);
  state.units.forEach((unit, index) => expect(distance(unit, settled[index])).toBeLessThan(.001));
}

describe('individual Infantry Drill terrain adjustments', () => {
  it.each(['isolated house', 'wall alongside the march'] as const)('preserves clear ranks beside an %s', scenario => {
    const { state, leader, members, block } = fixture();
    if (scenario === 'isolated house') block(18, 18, 'house');
    else for (let x = 15; x <= 32; x++) block(x, 18);
    expect(toggleInfantryFormation(state).ok).toBe(true);
    leader.destination = { x: 43.5, y: 20.5 };
    let adjustedOuterRank = false, inspected = 0;
    for (let index = 0; index < 1200; index++) {
      step(state);
      if (leader.x < 15 || leader.x > (scenario === 'isolated house' ? 21 : 32)) continue;
      for (const member of members) {
        const slot = leader.infantryFormation!.slots.find(candidate => candidate.id === member.id)!, target = infantryFormationGoal(state, member)!;
        if (slot.y >= 0) {
          // The far half of the army has no obstruction: both its assigned
          // destination and actual march should retain the original rectangle.
          expect(distance(target, ideal(leader, member))).toBeLessThan(1e-7);
          expect(distance(member, ideal(leader, member))).toBeLessThan(.12);
          inspected++;
        } else adjustedOuterRank ||= distance(target, ideal(leader, member)) > .1;
      }
    }
    expect(inspected).toBeGreaterThan(100); expect(adjustedOuterRank).toBe(true);
    expect(distance(leader, { x: 43.5, y: 20.5 })).toBeLessThan(.03);
    expectReformedAndStill(state, leader, members);
  });

  it.each([12, 24])('takes %i mixed soldiers through a one-cell passage and restores separate resting positions', count => {
    const { state, leader, members, block } = fixture(count);
    for (let y = 0; y < state.world.height; y++) if (y !== 20) block(25, y);
    expect(toggleInfantryFormation(state).ok).toBe(true);
    leader.destination = { x: 48.5, y: 20.5 };
    run(state, 100);
    expect(distance(leader, { x: 48.5, y: 20.5 })).toBeLessThan(.03);
    expect(members.every(member => member.x > 26)).toBe(true);
    expectReformedAndStill(state, leader, members);
  });

  it.each(['isolated house', 'near wall', 'unreachable alternatives'] as const)(
    'bounds stationary path searches beside %s independently of the frame count', scenario => {
      const { state, leader, members, block } = fixture(24);
      if (scenario === 'near wall') {
        // Keep this a grazing flank at any nominal formation width. Its body
        // needs a small local shift, but its slot is still on this bank.
        const shift = 19.06 - Math.min(...members.map(member => member.y));
        for (const unit of [leader, ...members]) unit.y += shift;
      }
      if (scenario === 'isolated house') block(10, 18, 'house');
      else for (let x = 0; x < state.world.width; x++) block(x, scenario === 'near wall' ? 18 : 19);
      // The last case has nearer candidate slots across a completely sealed
      // wall. Real A* must reject those alternatives rather than repeatedly
      // probing them every frame while the soldier rests on this bank.
      for (const member of members) if (!infantryPointClear(state, member, 0)) member.y = 20.25;
      expect(toggleInfantryFormation(state).ok).toBe(true);
      run(state, 4);
      const settled = state.units.map(unit => ({ ...unit })), find = vi.spyOn(navigation, 'findPath');
      try {
        const seconds = 3;
        run(state, seconds);
        const byUnit = new Map<number, number>();
        for (const call of find.mock.calls) {
          const unit = call[1] as Unit;
          byUnit.set(unit.id, (byUnit.get(unit.id) ?? 0) + 1);
        }
        // The direct target and fallback alternatives share two searches per
        // 0.3-second planning window, regardless of the number of render frames.
        const budget = (Math.ceil(seconds / .3) + 1) * 2;
        for (const count of byUnit.values()) expect(count).toBeLessThanOrEqual(budget);
        if (scenario !== 'unreachable alternatives') expect(find).not.toHaveBeenCalled();
        state.units.forEach((unit, index) => expect(distance(unit, settled[index])).toBeLessThan(.001));
        console.info(`Stationary drill path searches (${scenario}): ${find.mock.calls.length} over ${seconds / DT} frames; maximum per soldier ${Math.max(0, ...byUnit.values())}`);
      } finally { find.mockRestore(); }
    });
});
