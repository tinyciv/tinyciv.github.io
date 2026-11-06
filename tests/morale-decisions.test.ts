import { describe, expect, it } from 'vitest';
import { invalidateDecisions } from '../src/game/decision-schedule';
import { entityStore } from '../src/game/entity-store';
import { hasMoraleThreat, senseMorale, type MoralePerception } from '../src/game/morale-perception';
import { updateGame } from '../src/game/simulation';
import type { GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function unit(id: number, faction = 0): Unit {
  return { id, faction, x: 18.5, y: 12.5, kind: 'warrior', hp: 100, morale: 30,
    attack: 0, defense: 0, speed: 0, range: 1.1, order: 'hold', cooldown: 0,
    lastCombat: -100, moving: false, facing: 0, attackTime: 0 };
}
function fixture(): GameState {
  return { world: { width: 40, height: 32, seed: 'morale-clock', source: 'test', spawns: [],
    tiles: Array.from({ length: 40 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
  units: [{ ...unit(1), kind: 'leader', x: 2.5, y: 20.5, morale: 100, range: 4 }, unit(20)],
  buildings: [{ id: 2, kind: 'palace', x: 2, y: 22, faction: 0, hp: 650, maxHp: 650, capacity: 0 }],
  factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 0, gold: 0,
    production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e6, defeated: false }],
  time: 10, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
  buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'morale-clock', rngState: 1, fields: [],
  marauderPacks: [], fogRaids: { nextAt: 1e6, waves: 0, pressureVersion: 1 } };
}
const calm: MoralePerception = { enemies: 0, allies: 1, routingAllies: 0, fightingUntil: -Infinity, firstEnemyFaction: -1, shelter: false };
const pressure = { losses: 0, enemyLosses: 0 };

describe('morale decision cadence', () => {
  it('samples quiet and threatened units at most three times per game second', () => {
    for (const combat of [false, true]) {
      const state = fixture(), soldier = state.units[1], leader = state.units[0];
      let samples = 0;
      const sample = () => { samples++; return { ...calm, enemies: combat ? 1 : 0 }; };
      for (let frame = 0; frame < 240; frame++) {
        state.time = 10 + frame / 60;
        senseMorale(state, soldier, leader, pressure, sample);
        if (frame === 59) samples = 0;
      }
      expect(samples).toBe(9);
      expect(hasMoraleThreat(state, soldier)).toBe(combat);
    }
  });

  it('coalesces damage, commands, target death, leader loss, war and nearby casualties until the next sample', () => {
    const state = fixture(), soldier = state.units[1], leader = state.units[0], enemy = unit(30, -2);
    entityStore(state).units.add(enemy);
    let samples = 0;
    const sample = () => { samples++; return calm; };
    const observe = (nextPressure = pressure, commander: Unit | undefined = leader) =>
      senseMorale(state, soldier, commander, nextPressure, sample);
    observe(); expect(samples).toBe(1);
    observe(); expect(samples).toBe(1);
    soldier.hp--; observe(); expect(samples).toBe(1);
    soldier.lastDamagedAt = state.time; observe(); expect(samples).toBe(1);
    soldier.order = 'follow'; observe(); expect(samples).toBe(1);
    soldier.target = enemy.id; observe(); expect(samples).toBe(1);
    enemy.hp = 0; observe(); expect(samples).toBe(1);
    leader.hp = 0;
    senseMorale(state, soldier, undefined, pressure, sample); expect(samples).toBe(1);
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war' });
    invalidateDecisions(state);
    senseMorale(state, soldier, undefined, pressure, sample); expect(samples).toBe(1);
    senseMorale(state, soldier, undefined, { losses: 1, enemyLosses: 0 }, sample); expect(samples).toBe(1);
    state.time += .7; observe(); expect(samples).toBe(2);
  });

  it('does not wake for healing, ordinary movement, or a distant battle', () => {
    const state = fixture(), soldier = state.units[1];
    let samples = 0;
    const sample = () => { samples++; return calm; };
    soldier.hp = 50;
    senseMorale(state, soldier, undefined, pressure, sample);
    soldier.hp++; soldier.x += .05;
    state.casualties = [{ unit: 99, faction: 0, x: 39, y: 31, time: state.time }];
    senseMorale(state, soldier, undefined, pressure, sample);
    expect(samples).toBe(1);
  });

  it('coalesces road additions, fleeing and new shelter until the next sample', () => {
    const state = fixture(), soldier = state.units[1];
    let samples = 0;
    const sample = () => { samples++; return calm; };
    const observe = () => senseMorale(state, soldier, undefined, pressure, sample);
    observe();
    entityStore(state).buildings.add({ id: 30, kind: 'road', faction: 0, x: 18, y: 12, hp: 100, maxHp: 100, capacity: 0 });
    observe();
    expect(samples).toBe(1);
    soldier.order = 'flee'; observe();
    expect(samples).toBe(1);
    entityStore(state).buildings.add({ id: 31, kind: 'house', faction: 0, x: 19, y: 12, hp: 160, maxHp: 160, capacity: 4 });
    observe();
    expect(samples).toBe(1);
    state.time += .7; observe(); expect(samples).toBe(2);
  });

  it('keeps runtime observations separate across loaded states and reused IDs', () => {
    const state = fixture(), soldier = state.units[1];
    senseMorale(state, soldier, undefined, pressure, () => ({ ...calm, enemies: 1 }));
    expect(hasMoraleThreat(state, soldier)).toBe(true);
    const restored = structuredClone(state);
    expect(hasMoraleThreat(restored, restored.units[1])).toBe(false);
    expect(hasMoraleThreat(state, { ...soldier })).toBe(false);
  });
});

describe('continuous morale integration', () => {
  it('recovers on every fast step, pauses, and follows game speed', () => {
    const state = fixture(), soldier = state.units[1];
    for (let frame = 1; frame <= 6; frame++) {
      updateGame(state, 1 / 60, idle);
      expect(soldier.morale).toBeCloseTo(30 + frame / 10);
    }
    state.paused = true;
    updateGame(state, 1, idle);
    expect(state.time).toBeCloseTo(10.1);
    expect(soldier.morale).toBeCloseTo(30.6);
    state.paused = false; state.speed = 3;
    updateGame(state, .1, idle);
    expect(state.time).toBeCloseTo(10.4);
    expect(soldier.morale).toBeCloseTo(32.4);
  });

  it('integrates low-health panic continuously after the next neighborhood sample detects danger', () => {
    const state = fixture(), soldier = state.units[1];
    updateGame(state, .01, idle); // Prime a quiet sample.
    soldier.hp = 10; soldier.morale = .01;
    entityStore(state).units.add({ ...unit(30, -2), x: 21.5 });
    updateGame(state, .7, idle);
    expect(soldier.morale).toBe(0);
    expect(soldier.order).toBe('flee');
  });
});
