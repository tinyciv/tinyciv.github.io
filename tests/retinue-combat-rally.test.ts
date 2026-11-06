import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { retinueFormation } from '../src/game/formation';
import { canMove } from '../src/game/pathfinding';
import { updateGame } from '../src/game/simulation';
import { updateFog } from '../src/game/fog';
import { distance, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const soldier = (id: number, faction: number, x: number, y: number): Unit => ({ id, faction, kind: 'warrior', x, y,
  hp: 100, maxHp: 100, morale: 100, attack: 20, defense: 5, speed: 3.96, range: 1.2,
  order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, retinueStance: 'aggressive' });
function fixture(count = 12): GameState {
  return {
    world: { width: 64, height: 40, seed: 'retinue-rally', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 64 * 40 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 0, gold: 0, variation: .3 })) },
    units: [{ ...soldier(1, 0, 30.5, 20.5), kind: 'leader', speed: 3.6, attack: 0, range: 0 },
      ...Array.from({ length: count }, (_, i) => soldier(10 + i, 0, 29.5 - i, 20.5))],
    buildings: [{ id: 2, kind: 'palace', faction: 0, x: 4, y: 4, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#38f', relation: 'self', affinity: 100, food: 500, gold: 0, production: 0, population: 0,
      culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false, events: [], particles: [], fields: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, seed: 'retinue-rally', rngState: 1,
    marauderPacks: [], raiderCamps: [], fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 }, retinueStance: 'aggressive', movementMode: 'travel',
  };
}
const escorts = (state: GameState) => state.units.filter(unit => unit.kind === 'warrior' && unit.faction === 0);
function advance(state: GameState, seconds: number): void {
  for (let i = 0; i < seconds * 10; i++) {
    const before = new Map(state.units.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
    updateGame(state, .1, idle);
    for (const unit of state.units) {
      expect(canMove(state, before.get(unit.id)!, unit, unit.faction)).toBe(true);
      expect(distance(before.get(unit.id)!, unit)).toBeLessThanOrEqual(unit.speed * .1 + .12);
    }
  }
}

describe('retinue rally around a slow or stopped Leader', () => {
  it('turns a stopped column into a compact crowd despite blocked ideal slots and a stale destination', () => {
    const state = fixture(), leader = state.units[0];
    // The old wide-rank test fails on this wall of water, leaving the whole
    // formation in a queue even though there is ample ground on the east bank.
    for (let y = 0; y < 40; y++) for (let x = 24; x <= 28; x++) if (y !== 20) state.world.tiles[y * 64 + x].terrain = 'river';
    state.world.revision = 1;
    leader.speed = 0; leader.destination = { x: 45.5, y: 20.5 };
    advance(state, 16);
    expect(retinueFormation(state, leader).mode).toBe('mob');
    expect(retinueFormation(state, leader).traveling).toBe(false);
    expect(escorts(state).every(unit => distance(unit, leader) < 4.2), JSON.stringify(escorts(state).map(unit => [unit.id, unit.x, unit.y]))).toBe(true);
    expect(new Set(escorts(state).map(unit => Math.floor(unit.y))).size).toBeGreaterThanOrEqual(4);
  });

  it('lets rear escorts and arriving recruits join the Leader’s nearby battle after a choke', () => {
    const state = fixture(), leader = state.units[0]; leader.speed = 0;
    for (let y = 0; y < 40; y++) for (let x = 24; x <= 28; x++) if (y !== 20) state.world.tiles[y * 64 + x].terrain = 'river';
    state.world.revision = 1;
    const troops = escorts(state);
    for (const recruit of troops.slice(6)) recruit.joiningRetinue = true;
    for (let i = 0; i < 6; i++) entityStore(state).units.add({ ...soldier(100 + i, -2, 33.5 + i % 2 * 2, 18.5 + Math.floor(i / 2) * 2),
      hp: 10000, maxHp: 10000, speed: 0, attack: 0, cooldown: 10000, order: 'hold' });
    updateFog(state);
    advance(state, 18);
    const fought = troops.filter(unit => unit.lastCombat > 0);
    expect(fought.length, JSON.stringify(troops.map(unit => [unit.id, unit.x, unit.y, unit.lastCombat, unit.joiningRetinue]))).toBeGreaterThanOrEqual(10);
    expect(troops.slice(6).filter(unit => unit.lastCombat > 0).length).toBeGreaterThanOrEqual(4);
    expect(troops.every(unit => !unit.joiningRetinue)).toBe(true);
  });

  it('ignores small combat shuffling but keeps slow ford travel in travel mode', () => {
    const state = fixture(2), leader = state.units[0];
    for (let i = 0; i < 30; i++) {
      state.time += .1; leader.x = 30.5 + Math.sin(i * 2) * .08;
      expect(retinueFormation(state, leader).traveling).toBe(false);
    }
    for (let i = 0; i < 15; i++) {
      state.time += .1; leader.x += .162;
      retinueFormation(state, leader);
    }
    expect(retinueFormation(state, leader).traveling).toBe(true);
    for (let i = 0; i < 12; i++) { state.time += .1; retinueFormation(state, leader); }
    expect(retinueFormation(state, leader).traveling).toBe(false);
    expect(retinueFormation(state, leader).mode).toBe('mob');
  });

  it('leaves defensive posts and front-line contact cells out of other escorts’ rally assignments', () => {
    const state = fixture(5), leader = state.units[0], defender = state.units[1], fighter = state.units[2];
    Object.assign(defender, { x: 27.5, y: 16.5, retinueStance: 'defensive', defensiveAnchor: { x: 27.5, y: 16.5 } });
    const target = { id: 200, kind: 'palace' as const, faction: -2, x: 32, y: 20, hp: 650, maxHp: 650, capacity: 0 };
    entityStore(state).buildings.add(target);
    Object.assign(fighter, { x: 33.5, y: 19.5, target: target.id, lastCombat: state.time });
    const formation = retinueFormation(state, leader);
    expect(formation.goals.has(defender.id)).toBe(false);
    expect(formation.goals.has(fighter.id)).toBe(false);
    const occupied = new Set([defender, fighter].map(unit => `${Math.floor(unit.x)},${Math.floor(unit.y)}`));
    expect([...formation.goals.values()].every(goal => !occupied.has(`${Math.floor(goal.x)},${Math.floor(goal.y)}`))).toBe(true);
    const post = { x: defender.x, y: defender.y };
    advance(state, 1);
    expect(distance(defender, post)).toBeLessThan(.01);
  });
});
