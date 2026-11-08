import { describe, expect, it, vi } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { initialLeaderProgression, leaderProgressionView, learnLeaderSkill } from '../src/game/leader-progression';
import { fleeingAbilityMultiplier, livingEngineer, synchronizeEngineers, updateLeaderBrace } from '../src/game/leader-abilities';
import { recordLeaderDeath, leaderRespawnRemainingSeconds } from '../src/game/leader-respawn';
import { buildAt, buildCostAt, getLeader, moveUnit, updateGame, updateLeaderRespawns } from '../src/game/simulation';
import { recordCivilianCasualty } from '../src/game/civilian-population';
import { unitsCollide } from '../src/game/collisions';
import { regenerateUnits } from '../src/game/unit-health';
import { unitDefense } from '../src/game/veterancy';
import type { GameState, Unit } from '../src/game/types';
const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], x = 6.5, y = 4.5, faction = 0): Unit => ({ id, kind, faction, x, y,
  hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 100,
  lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 });
function fixture(): GameState {
  return { world: { width: 32, height: 24, seed: 'abilities', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 0, gold: 1, variation: .5 })) },
    units: [{ ...person(10, 'leader'), leaderProgression: initialLeaderProgression() }],
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 6, hp: 650, maxHp: 650, capacity: 4 },
      { id: 2, kind: 'road', faction: 0, x: 5, y: 5, hp: 100, maxHp: 100, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#ff3333', affinity: 100, relation: 'self', food: 500, gold: 500, production: 0,
      population: 0, defeated: false, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'abilities', rngState: 1, fields: [], marauderPacks: [], raiderCamps: [],
    roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 } };
}
function teach(state: GameState, skill: 'engineer' | 'brace' | 'discretion'): Unit {
  const leader = getLeader(state)!; leader.leaderProgression!.skills[skill] = 1; return leader;
}
function shot(state: GameState, attacker: Unit, target: Unit): void {
  (state.projectiles ??= []).push({ x: attacker.x, y: attacker.y, start: { x: attacker.x, y: attacker.y }, end: { x: target.x, y: target.y },
    attacker: attacker.id, target: target.id, faction: attacker.faction, damage: 1000, elapsed: 0, duration: .01 });
}

describe('technology Leader abilities', () => {
  it.each([['engineer', 'metalTools'], ['brace', 'militaryTactics'], ['discretion', 'scoutLodge']] as const)
  ('locks %s behind its technology and spends only one point', (skill, tech) => {
    const state = fixture(), leader = getLeader(state)!; leader.leaderProgression!.skillPoints = 2;
    expect(learnLeaderSkill(state, skill).ok).toBe(false);
    expect(leaderProgressionView(state)!.skills.find(row => row.id === skill)).toMatchObject({ unlocked: false, maxRank: 1 });
    state.factions[0].research = { focus: tech, levels: { [tech]: 1 }, progress: {} };
    expect(learnLeaderSkill(state, skill).ok).toBe(true);
    expect(learnLeaderSkill(state, skill).ok).toBe(false);
    expect(leader.leaderProgression!.skillPoints).toBe(1);
  });
  it('creates a companion without population or food and completes half-price roads without civilian labor', () => {
    const state = fixture(); teach(state, 'engineer');
    updateGame(state, .1, idle);
    const engineer = livingEngineer(state, 0)!;
    expect(engineer).toMatchObject({ kind: 'worker', hp: 100, maxHp: 100, attack: 0 });
    expect(engineer.builder).toBeUndefined(); expect(engineer.collector).toBeUndefined();
    expect(state.factions[0]).toMatchObject({ population: 0, food: 500 });
    expect(buildCostAt(state, 'road', 6, 5).gold).toBe(5);
    expect(buildCostAt(state, 'bridge', 6, 5).gold).toBe(5);
    const gold = state.factions[0].gold, result = buildAt(state, 'road', 6, 5);
    expect(result.ok, result.message).toBe(true);
    const road = state.buildings.find(building => building.kind === 'road' && building.x === 6 && building.y === 5)!;
    expect(road.construction).toMatchObject({ waitingForBuilder: false, engineerId: engineer.id });
    expect(state.factions[0].gold).toBe(gold - 5);
    updateGame(state, 2.2, idle);
    expect(road.construction).toBeUndefined();
    expect(state.units.filter(unit => unit.builder)).toHaveLength(0);
  });
  it('keeps engineers out of population losses and respawns only after sixty game seconds', () => {
    const state = fixture(); teach(state, 'engineer'); updateGame(state, .1, idle);
    const first = livingEngineer(state, 0)!; first.hp = 0;
    expect(recordCivilianCasualty(state, first)).toBe(false);
    updateGame(state, .1, idle); const deadline = state.factions[0].engineerRespawnAt!;
    expect(deadline).toBeCloseTo(60.2); expect(livingEngineer(state, 0)).toBeUndefined();
    const spawn = vi.fn((faction: number, point: { x: number; y: number }, home: number) => {
      const unit = { ...person(300, 'worker', point.x, point.y, faction), home }; entityStore(state).units.add(unit); return unit;
    });
    state.time = deadline - .01; synchronizeEngineers(state, spawn); expect(spawn).not.toHaveBeenCalled();
    state.time = deadline; synchronizeEngineers(state, spawn); expect(spawn).toHaveBeenCalledOnce();
    expect(livingEngineer(state, 0)?.home).toBe(1);
    expect(state.factions[0].population).toBe(0);
  });
  it('allows the engineer through its Leader but reserves space against soldiers', () => {
    const leader = person(10, 'leader'), engineer = { ...person(11, 'worker'), engineer: { leader: 10 } }, soldier = person(12, 'warrior');
    expect(unitsCollide(engineer, leader)).toBe(false); expect(unitsCollide(leader, engineer)).toBe(false);
    expect(unitsCollide(engineer, soldier)).toBe(true);
  });
  it('builds Brace after ten stationary seconds, caps at six and clears upon movement', () => {
    const state = fixture(), leader = teach(state, 'brace');
    updateLeaderBrace(leader, 10); expect(unitDefense(leader)).toBe(5);
    updateLeaderBrace(leader, 1); expect(unitDefense(leader)).toBe(7);
    updateLeaderBrace(leader, 9); expect(unitDefense(leader)).toBe(11);
    leader.x += .1; updateLeaderBrace(leader, .1); expect(unitDefense(leader)).toBe(5);
    leader.order = 'flee'; updateLeaderBrace(leader, 30); expect(unitDefense(leader)).toBe(5);
  });
  it('makes Discretion 50% faster and heals outside territory only after the last impact', () => {
    const state = fixture(), leader = teach(state, 'discretion');
    leader.x = 25.5; leader.y = 18.5; leader.order = 'flee'; leader.hp = 40; leader.lastDamagedAt = 1;
    state.time = 1; regenerateUnits(state, .1); expect(leader.hp).toBe(40);
    state.time = 1.1; regenerateUnits(state, .1); expect(leader.hp).toBeCloseTo(40.24);
    expect(fleeingAbilityMultiplier(leader)).toBe(1.5);
    const x = leader.x; moveUnit(state, leader, { x: x + 3, y: leader.y }, .1, true);
    expect(leader.x - x).toBeCloseTo(leader.speed * .95 * 1.5 * .1);
    leader.order = 'hold'; expect(fleeingAbilityMultiplier(leader)).toBe(1);
  });
});

describe('real-time Leader recovery', () => {
  it.each([0, 37.5, 199])('limits the death penalty to the available %s gold', gold => {
    const state = fixture(), leader = getLeader(state)!;
    state.factions[0].gold = gold; leader.hp = 0;
    recordLeaderDeath(state, leader, 1000);
    expect(state.factions[0].gold).toBe(0);
    expect(state.factions[0].goldLedger?.flatMap(entry => Object.values(entry.outlays)).reduce((sum, value) => sum + (value ?? 0), 0) ?? 0).toBe(gold);
    updateLeaderRespawns(state, 11000);
    expect(getLeader(state)?.hp).toBeGreaterThan(0);
    expect(state.factions[0].gold).toBe(0);
  });
  it.each([1, 4])('preserves learned skills, loses one level/200 gold and respawns after ten real seconds at %sx', speed => {
    const state = fixture(), leader = teach(state, 'brace');
    Object.assign(leader.leaderProgression!, { level: 4, xp: 75, skillPoints: 2 });
    Object.assign(leader, { maxHp: 130, attack: 28, hp: 0 }); state.speed = speed;
    recordLeaderDeath(state, leader, 1000);
    expect(state.factions[0].gold).toBe(300); expect(state.factions[0].defeated).toBe(false);
    expect(leaderRespawnRemainingSeconds(state, 0, 2000)).toBe(9);
    state.paused = true; updateLeaderRespawns(state, 10_999); expect(getLeader(state)).toBeUndefined();
    updateLeaderRespawns(state, 11_000);
    expect(getLeader(state)).toMatchObject({ hp: 120, maxHp: 120, attack: 27, kills: 0,
      leaderProgression: { level: 3, xp: 75, skillPoints: 1, skills: { brace: 1 } } });
    expect(state.factions[0].leaderRespawn).toBeUndefined(); expect(state.gameOver).toBe(false);
    updateLeaderRespawns(state, 20_000); expect(state.units.filter(unit => unit.kind === 'leader')).toHaveLength(1);
  });
  it.each([true, false])('uses wall time through updateGame when paused=%s at 4x speed', paused => {
    const state = fixture(), leader = getLeader(state)!; state.speed = 4; state.paused = paused; leader.hp = 0;
    let now = 1000; const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      recordLeaderDeath(state, leader);
      now = 10999; updateGame(state, .1, idle); expect(getLeader(state)).toBeUndefined();
      now = 11000; updateGame(state, .1, idle); expect(getLeader(state)).toBeDefined();
      expect(state.factions[0].leaderRespawn).toBeUndefined();
    } finally { clock.mockRestore(); }
  });
  it('records an actual combat death and grants fixed XP plus 200 gold without bypassing level thresholds to the victor', () => {
    const state = fixture(), leader = getLeader(state)!;
    const enemy = { ...person(20, 'leader', 15.5, 15.5, 1), leaderProgression: initialLeaderProgression() };
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war' });
    entityStore(state).units.add(enemy); entityStore(state).buildings.add({ id: 3, kind: 'palace', faction: 1, x: 22, y: 18, hp: 650, maxHp: 650, capacity: 4 });
    leader.leaderProgression!.xp = 95; shot(state, leader, enemy); updateGame(state, .1, idle);
    expect(leader.leaderProgression).toMatchObject({ level: 1, xp: 6495, skillPoints: 0 });
    expect(state.factions[0].gold).toBe(700); expect(state.factions[1].gold).toBe(300);
    expect(state.factions[1].leaderRespawn).toBeDefined(); expect(state.factions[1].defeated).toBe(false); expect(state.gameOver).toBe(false);
  });
  it('rewards marauder commander kills with 50 gold without assigning faction respawns to marauders', () => {
    const state = fixture(), leader = getLeader(state)!;
    const marauder = { ...person(20, 'warrior', 15.5, 15.5, -2), marauderLeader: true };
    entityStore(state).units.add(marauder); shot(state, leader, marauder); updateGame(state, .1, idle);
    expect(leader.leaderProgression).toMatchObject({ level: 1, xp: 6400, skillPoints: 0 }); expect(state.factions[0].gold).toBe(550);
  });
  it('cannot postpone death penalties by repeated death handling, and has no respawn without a city', () => {
    const state = fixture(), leader = getLeader(state)!; leader.hp = 0;
    recordLeaderDeath(state, leader, 1000); recordLeaderDeath(state, leader, 2000);
    expect(state.factions[0].gold).toBe(300); expect(state.factions[0].leaderRespawn?.readyAtWallTime).toBe(11000);
    state.buildings[0].hp = 0; updateLeaderRespawns(state, 11000);
    expect(state.factions[0].leaderRespawn).toBeUndefined(); expect(state.factions[0].defeated).toBe(true);
  });
});
