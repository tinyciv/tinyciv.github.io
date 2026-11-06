import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { migrateGame, updateGame } from '../src/game/simulation';
import { unitDamage } from '../src/game/veterancy';
import type { GameState, Unit } from '../src/game/types';
import { initializeUnitDamageTimes, regenerateUnits } from '../src/game/unit-health';
import { withSimulationReads } from '../src/game/simulation-reads';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 0,
  speed: 0, range: kind === 'leader' ? 4 : 1.1, order: 'hold', cooldown: 0,
  lastCombat: -60, lastDamagedAt: 0, moving: false, facing: 0, attackTime: 0,
});
function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'regeneration', source: 'test', spawns: [],
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 3, production: 0, gold: 1, variation: .5 })) },
    units: [person(10, 'leader', 3.5, 3.5)],
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 6, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'regeneration', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: 1000, waves: 0, pressureVersion: 2 },
  };
}

function home(state: GameState, x: number, y: number, faction = 0): void {
  if (faction === 1 && !state.factions.some(realm => realm.id === 1))
    state.factions.push({ ...state.factions[0], id: 1, name: 'Enemy', relation: 'war' });
  entityStore(state).buildings.add({ id: 1000 + state.buildings.length, kind: 'house', faction, x, y, hp: 100, maxHp: 100, capacity: 0 });
}

describe('damage-free unit regeneration', () => {
  it('waits fifteen seconds and heals only the eligible portion of a step crossing the deadline', () => {
    const state = fixture(), leader = state.units[0]; leader.hp = 60;
    updateGame(state, 14.9, idle); expect(leader.hp).toBe(60);
    updateGame(state, .1, idle); expect(leader.hp).toBeCloseTo(60, 8);
    updateGame(state, .05, idle); expect(leader.hp).toBeCloseTo(60.12, 8);
    const crossing = fixture(); crossing.time = 14.95; crossing.units[0].hp = 60;
    updateGame(crossing, .1, idle);
    expect(crossing.units[0].hp).toBeCloseTo(60.12, 8);
  });

  it('regenerates Leaders, distant workers, and enemies inside their own borders', () => {
    const state = fixture(), leader = state.units[0]; leader.hp = 50;
    const worker = { ...person(20, 'worker', 22.5, 19.5), hp: 25, maxHp: 50 };
    const enemy = { ...person(21, 'warrior', 25.5, 5.5, 1), hp: 40, maxHp: 80 };
    entityStore(state).units.add(worker, enemy); home(state, 22, 20); home(state, 25, 6, 1);
    updateGame(state, 16, idle);
    expect(leader.hp).toBeCloseTo(52.4, 8); expect(worker.hp).toBeCloseTo(27.4, 8);
    expect(enemy.hp).toBeCloseTo(42.4, 8);
  });

  it.each([true, false])('restarts the delay on melee damage without healing earlier in the same step (victim first: %s)', victimFirst => {
    const state = fixture(), victim = { ...person(20, 'warrior', 16.5, 12.5), hp: 70 };
    const attacker = { ...person(21, 'warrior', 17.5, 12.5, -2), attack: 20 };
    state.time = 20; home(state, 15, 13);
    entityStore(state).units.add(...(victimFirst ? [victim, attacker] : [attacker, victim]));
    updateGame(state, .1, idle);
    expect(victim.hp).toBe(70 - unitDamage(attacker, 0)); expect(victim.lastDamagedAt).toBeCloseTo(20.1);
    entityStore(state).units.replace(state.units.filter(unit => unit !== attacker));
    updateGame(state, 15, idle); expect(victim.hp).toBeCloseTo(70 - unitDamage(attacker, 0), 8);
    updateGame(state, .5, idle); expect(victim.hp).toBeCloseTo(71.2 - unitDamage(attacker, 0), 8);
  });

  it('keeps healing through a javelin launch, but records impact and postpones the next healing interval', () => {
    const state = fixture(), leader = state.units[0];
    leader.x = 14.5; leader.y = 12.5; leader.attack = 25;
    const target = { ...person(20, 'warrior', 18.5, 12.5, 1), hp: 70 };
    entityStore(state).units.add(target); state.time = 20; home(state, 19, 13, 1);
    updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(1); expect(target.hp).toBeCloseTo(70.24, 8);
    expect(target.lastDamagedAt).toBe(0); expect(target.lastCombat).toBeCloseTo(20.1);
    const damage = unitDamage(leader, 0); leader.attack = 0;
    updateGame(state, .2, idle); expect(target.hp).toBeCloseTo(70.72, 8);
    updateGame(state, .2, idle);
    expect(target.lastDamagedAt).toBeCloseTo(20.5); expect(target.hp).toBeCloseTo(70.96 - damage, 8);
    const wounded = target.hp;
    leader.x = 3.5; leader.y = 3.5; // Keep later recruits away while testing recovery.
    updateGame(state, 15, idle); expect(target.hp).toBeCloseTo(wounded, 8);
    updateGame(state, .1, idle); expect(target.hp).toBeCloseTo(wounded + .24, 8);
  });

  it('allows an unhurt attacker to heal while it keeps inflicting damage', () => {
    const state = fixture(), attacker = { ...person(20, 'warrior', 16.5, 12.5), hp: 70, attack: 20 };
    const target = person(21, 'warrior', 17.5, 12.5, -2);
    entityStore(state).units.add(attacker, target); state.time = 20; home(state, 15, 13);
    updateGame(state, 1.1, idle);
    expect(target.hp).toBe(100 - 2 * unitDamage(attacker, 0)); expect(attacker.lastCombat).toBeGreaterThan(21);
    expect(attacker.lastDamagedAt).toBe(0); expect(attacker.hp).toBeCloseTo(72.64, 8);
  });

  it('clamps to each unit maximum, does not revive corpses, and never regenerates buildings', () => {
    const state = fixture(), worker = { ...person(20, 'worker', 22.5, 19.5), hp: 49.9, maxHp: 50 };
    const enemy = { ...person(21, 'warrior', 25.5, 5.5, 1), hp: 64.9, maxHp: 65 };
    const dead = { ...person(22, 'warrior', 26.5, 8.5, 1), hp: 0 };
    entityStore(state).units.add(worker, enemy, dead); state.time = 20; home(state, 22, 20); home(state, 25, 6, 1);
    state.buildings[0].hp = 500;
    updateGame(state, 1, idle);
    expect(worker.hp).toBe(50); expect(enemy.hp).toBe(65);
    expect(dead.hp).toBe(0); expect(state.units).not.toContain(dead);
    expect(state.buildings[0].hp).toBe(500);
  });

  it('ordinary soldiers do not heal in wilderness or another faction’s territory, then resume at home', () => {
    const state = fixture(), leader = person(50, 'warrior', 3.5, 3.5);
    entityStore(state).units.add(leader); state.time = 30; leader.hp = 60;
    leader.x = 22.5; leader.y = 19.5;
    updateGame(state, 1, idle); expect(leader.hp).toBe(60);
    home(state, 23, 20, 1);
    updateGame(state, 1, idle); expect(leader.hp).toBe(60);
    leader.x = 3.5; leader.y = 3.5;
    updateGame(state, 1, idle); expect(leader.hp).toBeCloseTo(62.4, 8);
  });


  it('heals an out-of-combat marauder leader without borders, but keeps the player Leader territory-bound', () => {
    const state = fixture(), leader = { ...person(50, 'warrior', 26.5, 20.5, -2), marauderLeader: true, hp: 60 };
    entityStore(state).units.add(leader);
    leader.lastCombat = 20; leader.lastDamagedAt = 10; state.time = 34.9;
    Object.assign(state.units[0], { x: 26.5, y: 2.5, hp: 60 });
    updateGame(state, .1, idle); expect(leader.hp).toBeCloseTo(60);
    updateGame(state, .5, idle); expect(leader.hp).toBeCloseTo(61.2); expect(state.units[0].hp).toBe(60);
  });

  it('does not call an attacking marauder leader out of combat merely because no one hit him', () => {
    const state = fixture(), leader = { ...person(50, 'warrior', 16.5, 12.5, -2), marauderLeader: true, hp: 60, attack: 20 };
    entityStore(state).units.add(leader, person(51, 'warrior', 17.5, 12.5, 0)); state.time = 30;
    updateGame(state, .1, idle);
    expect(leader.lastCombat).toBeCloseTo(30.1); expect(leader.hp).toBe(60);
  });

  it('gives raiders no healing territory even beside a building they own', () => {
    const state = fixture(), raider = { ...person(21, 'warrior', 25.5, 5.5, -2), hp: 40, maxHp: 80 };
    entityStore(state).units.add(raider); state.time = 30; home(state, 25, 6, -2);
    updateGame(state, 1, idle);
    expect(raider.hp).toBe(40);
  });

  it('keeps saved damage time and initializes old saves conservatively without renewing their delay on each reload', () => {
    const state = fixture(), leader = state.units[0]; state.time = 20; leader.hp = 60;
    leader.lastDamagedAt = 12; leader.lastCombat = 19;
    const restored = migrateGame(JSON.parse(JSON.stringify(state)) as GameState), healed = restored.units.find(unit => unit.id === leader.id)!;
    expect(healed.lastDamagedAt).toBe(12);
    updateGame(restored, 7, idle); expect(healed.hp).toBeCloseTo(60, 8);
    updateGame(restored, .1, idle); expect(healed.hp).toBeCloseTo(60.24, 8);
    const legacy = fixture(); legacy.time = 20; legacy.units[0].hp = 60;
    delete legacy.units[0].lastDamagedAt; legacy.units[0].lastCombat = 18;
    migrateGame(legacy); expect(legacy.units[0].lastDamagedAt).toBe(18);
    legacy.time = 25; legacy.units[0].lastCombat = 24;
    migrateGame(legacy); expect(legacy.units[0].lastDamagedAt).toBe(18);
  });
});

it('does no recurring health work for an initialized healthy roster', () => {
  const state = fixture(), store = entityStore(state);
  for (let id = 100; id < 1100; id++) store.units.add(person(id, 'worker', 3.5, 3.5));
  let reads = 0;
  for (const unit of state.units) Object.defineProperty(unit, 'hp', {
    configurable: true, enumerable: true, get: () => { reads++; return 100; },
  });
  withSimulationReads(state, () => {
    initializeUnitDamageTimes(state); regenerateUnits(state, 1 / 30);
    reads = 0;
    for (let i = 0; i < 120; i++) { state.time += 1 / 30; initializeUnitDamageTimes(state); regenerateUnits(state, 1 / 30); }
    expect(reads).toBe(0);
  });
});
