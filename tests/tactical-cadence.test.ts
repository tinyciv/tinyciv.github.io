import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { updateWoodenTowers } from '../src/game/tower-combat';
import { updateRaiderMotivation } from '../src/game/raider-motivations';
import { updateBallistae } from '../src/game/ballista';
import { evadeMelee } from '../src/game/archery';
import { withSimulationReads } from '../src/game/simulation-reads';
import { advanceInfantryFormations, infantryRectangleOffsets, toggleInfantryFormation } from '../src/game/infantry-drill';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], faction: number, x: number, y: number): Unit => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: 10, defense: 4,
  speed: kind === 'leader' ? 4.4 : 3.3, range: kind === 'archer' ? 4 : 1.1,
  order: 'follow', cooldown: 0, lastCombat: -100, moving: false, facing: 0, attackTime: 0,
});
function fixture(): GameState {
  return {
    world: { width: 48, height: 32, revision: 0, seed: 'cadence', source: 'test', spawns: [],
      tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, variation: .5, food: 0, production: 0, gold: 0 })) },
    units: [person(1, 'leader', 0, 12.5, 12.5), person(2, 'warrior', 1, 14.5, 12.5)], buildings: [],
    factions: [{ id: 0, name: 'Player', relation: 'self', population: 0, food: 1000, gold: 1000, production: 0, color: '#f44', affinity: 100,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false,
      research: { focus: 'infantryDrill', levels: { infantryDrill: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, selected: null, selectedType: null, buildMode: null, diplomacy: null,
    gameOver: false, victory: false, seed: 'cadence', rngState: 1, events: [], particles: [], fields: [],
  } as GameState;
}
function assertCapped(samples: number[]): void {
  expect(samples.length).toBeGreaterThanOrEqual(10);
  expect(samples.length).toBeLessThanOrEqual(12);
  for (let i = 1; i < samples.length; i++) expect(samples[i] - samples[i - 1]).toBeGreaterThanOrEqual(1 / 3 - 1e-9);
}

describe('tactical scan ceiling', () => {
  it.each(['woodenTower', 'ballista'] as const)('caps unsuccessful %s acquisition instead of retrying every frame', kind => {
    const state = fixture(), samples: number[] = [];
    entityStore(state).buildings.add({ id: 10, kind, faction: 0, x: 12, y: 12, hp: 100, maxHp: 100, capacity: 0 });
    const hooks = { hostile: (a: number, b: number) => a !== b,
      clearShot: (_weapon: Building) => { samples.push(state.time); return false; }, shoot: () => { throw new Error('blocked shot fired'); } };
    for (let frame = 0; frame < 240; frame++) {
      state.time = frame / 60;
      withSimulationReads(state, () => kind === 'ballista' ? updateBallistae(state, 1 / 60, hooks) : updateWoodenTowers(state, 1 / 60, hooks));
    }
    assertCapped(samples);
  });

  it('retains an archer escape goal and moves every frame between capped threat scans', () => {
    const state = fixture(), archer = state.units[0], samples: number[] = [];
    archer.kind = 'archer'; archer.range = 4; state.units[1].x = 13.5;
    let moves = 0;
    for (let frame = 0; frame < 240; frame++) {
      state.time = frame / 60;
      withSimulationReads(state, () => evadeMelee(state, archer, 1 / 60, () => { moves++; }, (a, b) => a !== b,
        () => { samples.push(state.time); return true; }));
    }
    assertCapped(samples); expect(moves).toBe(240);
  });

  it('retains a raider attack between capped specialist perception scans', () => {
    const state = fixture(), raider = person(10, 'warrior', -2, 12.5, 12.5), victim = person(20, 'worker', 0, 14.5, 12.5);
    raider.marauderPack = 1;
    entityStore(state).units.replace([raider, victim]);
    state.marauderPacks = [{ id: 1, motivation: 'harass', name: 'Test', color: '#f44', targetFaction: 0,
      home: { x: 2.5, y: 2.5 }, waypoint: { x: 20.5, y: 12.5 }, nextWanderAt: 100 }];
    const samples: number[] = []; let attacks = 0;
    for (let frame = 0; frame < 240; frame++) {
      state.time = frame / 60;
      withSimulationReads(state, () => updateRaiderMotivation(state, raider, 1 / 60, {
        move: () => {}, attack: (_unit, target) => { expect(target).toBe(victim); attacks++; },
        visible: () => { samples.push(state.time); return true; },
      }));
    }
    assertCapped(samples); expect(attacks).toBe(240);
  });

  it('keeps real infantry movement speed while layout planning is throttled', () => {
    const state = fixture(), leader = state.units[0];
    entityStore(state).units.replace([leader, ...infantryRectangleOffsets(8).map((offset, i) => person(i + 10, 'warrior', 0, leader.x + offset.x, leader.y + offset.y))]);
    expect(toggleInfantryFormation(state).ok).toBe(true);
    const step = (moving: boolean) => {
      state.time += .05;
      withSimulationReads(state, () => advanceInfantryFormations(state, .05, () => ({ ...idle, up: moving }),
        (unit, next) => { unit.x = next.x; unit.y = next.y; }));
    };
    for (let i = 0; i < 40; i++) step(false);
    const start = leader.x;
    for (let i = 0; i < 20; i++) step(true);
    expect(leader.x - start).toBeCloseTo(3.465, 6);
  });
});
