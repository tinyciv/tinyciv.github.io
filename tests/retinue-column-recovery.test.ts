import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { retinueFormation } from '../src/game/formation';
import { canMove, hasStaticPath, isNarrowPassage } from '../src/game/pathfinding';
import { recallRetinue, updateGame } from '../src/game/simulation';
import { distance, type GameState, type Unit } from '../src/game/types';
import { scoutRealm } from './helpers/scouts';

const idle = { up: false, down: false, left: false, right: false };
const cell = (state: GameState, unit: { x: number; y: number }) => Math.floor(unit.y) * state.world.width + Math.floor(unit.x);

/** The save begins beyond a right-angle bend, so there are no breadcrumbs
 * back through the horizontal approach. Water leaves only one tile to walk. */
function bentCrossing(count = 8) {
  const state = scoutRealm(), leader = state.units[0], template = state.units[1];
  for (let y = 0; y < state.world.height; y++) for (let x = 0; x < state.world.width; x++) {
    const open = x < 10 && y >= 10 && y <= 20 || y === 15 && x <= 20
      || x === 20 && y >= 15 || y >= 25 && x >= 20;
    state.world.tiles[y * state.world.width + x].terrain = open ? 'grassland' : 'river';
  }
  Object.assign(leader, { x: 20.5, y: 17.5, facing: Math.PI / 2, attack: 0 });
  const soldiers: Unit[] = Array.from({ length: count }, (_, index) => ({ ...template,
    id: 10 + index, x: 5.5 + index % 4, y: 13.5 + Math.floor(index / 4), attack: 0,
    retinueStance: 'aggressive', hp: 1000, maxHp: 1000 }));
  entityStore(state).units.replace([leader, ...soldiers]);
  entityStore(state).buildings.replace([{ id: 1000, kind: 'palace', faction: 0, x: 1, y: 18,
    hp: 650, maxHp: 650, capacity: 4, governorPermissions: { farms: false, housing: false } }]);
  return { state, leader, soldiers };
}

describe('retinue recovery without a complete leader trail', () => {
  it('assigns reachable forward goals to the whole column after a loaded bend', () => {
    const { state, leader, soldiers } = bentCrossing();
    retinueFormation(state, leader);
    for (let sample = 0; sample < 6; sample++) {
      state.time += .1; leader.y += .3; leader.moving = true;
      retinueFormation(state, leader);
    }
    const formation = retinueFormation(state, leader);
    expect(formation.mode).toBe('column');
    expect(formation.goals.size).toBe(soldiers.length);
    const goals = soldiers.map(soldier => formation.goals.get(soldier.id)!);
    expect(new Set(goals.map(goal => cell(state, goal))).size).toBe(soldiers.length);
    for (let index = 0; index < soldiers.length; index++) {
      expect(distance(soldiers[index], goals[index])).toBeGreaterThan(5);
      expect(hasStaticPath(state, soldiers[index], goals[index], soldiers[index].faction)).toBe(true);
    }
  });

  it('brings every recalled soldier through the bend without overlaps or terrain jumps', () => {
    const { state, leader, soldiers } = bentCrossing();
    recallRetinue(state);
    leader.destination = { x: 30.5, y: 28.5 };
    for (let step = 0; step < 600; step++) {
      const before = new Map(state.units.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
      updateGame(state, .05, idle);
      const occupied = soldiers.map(soldier => cell(state, soldier));
      expect(new Set(occupied).size).toBe(occupied.length);
      for (const unit of [leader, ...soldiers]) expect(canMove(state, before.get(unit.id)!, unit, unit.faction)).toBe(true);
    }
    expect(distance(leader, { x: 30.5, y: 28.5 })).toBeLessThan(.2);
    expect(soldiers.every(soldier => soldier.x >= 20 && soldier.y >= 25 && distance(soldier, leader) < 5)).toBe(true);
    expect(soldiers.every(soldier => soldier.recallIssuedAt === undefined)).toBe(true);
  });

  it('keeps stopped rally posts out of a narrow gate when the courtyard has enough room', () => {
    const { state, leader, soldiers } = bentCrossing(4);
    Object.assign(leader, { x: 20.5, y: 25.5 });
    const formation = retinueFormation(state, leader);
    for (const soldier of soldiers) {
      const goal = formation.goals.get(soldier.id)!;
      expect(isNarrowPassage(state, goal, soldier.faction)).toBe(false);
      expect(hasStaticPath(state, soldier, goal, soldier.faction)).toBe(true);
    }
  });
});
