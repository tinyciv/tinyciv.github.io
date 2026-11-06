import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { beginUnitFrame, endUnitFrame } from '../src/game/spatial';
import { beginBattleRout, casualtyPressure, MARAUDER_MIN_ROUT_SECONDS, recordBattleDeath } from '../src/game/battle-morale';
import { atWar, updateGame } from '../src/game/simulation';
import { firingTowerThreats, recordTowerShot } from '../src/game/tower-threats';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, faction = 0, x = 18.5, y = 12.5): Unit => ({
  id, faction, x, y, kind: 'warrior', hp: 100, morale: 100, attack: 0, defense: 0, speed: 0,
  range: 1.1, order: 'hold', cooldown: 0, lastCombat: 0, moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, x, y, faction, hp: 650, maxHp: 650, capacity: 0,
});
function fixture(): GameState {
  return { world: { width: 40, height: 32, seed: 'battle-morale', source: 'test', spawns: [],
    tiles: Array.from({ length: 40 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [{ ...unit(1, 0, 2.5, 20.5), kind: 'leader', range: 4 }], buildings: [building(2, 'palace', 2, 22)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 500, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'battle-morale', rngState: 1, fields: [],
    marauderPacks: [], fogRaids: { nextAt: 1000, waves: 0, pressureVersion: 1 } };
}
function losses(state: GameState, count: number, faction = 0, x = 18.5, y = 12.5): void {
  for (let i = 0; i < count; i++) recordBattleDeath(state, { ...unit(1000 + (state.casualties?.length ?? 0), faction, x, y), hp: 0 });
}
const pressure = (state: GameState, observer: Unit) => casualtyPressure(state, observer, (a, b) => atWar(state, a, b));

describe('local battle morale', () => {
  it('requires at least six losses and scales with the local cohort before its losses', () => {
    const state = fixture(), observer = unit(20); entityStore(state).units.add(observer);
    losses(state, 5);
    expect(pressure(state, observer)).toMatchObject({ losses: 5, threshold: 6, collapsing: false });
    losses(state, 1);
    expect(pressure(state, observer)).toMatchObject({ losses: 6, threshold: 6, collapsing: true });
    entityStore(state).units.add(...Array.from({ length: 19 }, (_, i) => unit(30 + i)));
    expect(pressure(state, observer)).toMatchObject({ losses: 6, threshold: 13, collapsing: false });
    losses(state, 14);
    expect(pressure(state, observer)).toMatchObject({ losses: 20, threshold: 20, collapsing: true });
  });

  it('stays local, counts a real death once, and expires losses after twenty seconds', () => {
    const state = fixture(), observer = unit(20); entityStore(state).units.add(observer);
    losses(state, 6, 0, 30.5, 12.5);
    expect(pressure(state, observer).collapsing).toBe(false);
    const casualty = { ...unit(999), hp: 0 };
    recordBattleDeath(state, casualty); recordBattleDeath(state, casualty);
    casualty.x = 35;
    expect(pressure(state, observer).losses).toBe(1);
    expect(state.casualties).toHaveLength(7);
    state.time = 20.01;
    expect(pressure(state, observer).losses).toBe(0);
    expect(state.casualties).toHaveLength(0);
  });

  it('allows enemy losses up to a 5:1 ratio, counting only nearby hostile deaths in the same window', () => {
    const state = fixture(), observer = unit(20); entityStore(state).units.add(observer); losses(state, 6);
    losses(state, 1, 1); // Peaceful casualties do not improve the exchange.
    losses(state, 1, -2, 35.5, 12.5); // Other battles do not improve it either.
    expect(pressure(state, observer)).toMatchObject({ enemyLosses: 0, collapsing: true });
    losses(state, 1, -2);
    expect(pressure(state, observer)).toMatchObject({ enemyLosses: 1, collapsing: true });
    losses(state, 1, -2);
    expect(pressure(state, observer)).toMatchObject({ enemyLosses: 2, collapsing: false });
    losses(state, 4);
    expect(pressure(state, observer)).toMatchObject({ losses: 10, enemyLosses: 2, collapsing: true });
    state.time = 20.01;
    expect(pressure(state, observer)).toMatchObject({ losses: 0, enemyLosses: 0, collapsing: false });
  });

  it('halts a running shock after the next casualty sample sees an exchange below 5:1', () => {
    const state = fixture(), soldier = unit(20); entityStore(state).units.add(soldier); losses(state, 6);
    updateGame(state, 1, idle);
    expect(soldier.morale).toBeCloseTo(50);
    losses(state, 2, -2);
    updateGame(state, .7, idle); // Allow the staggered casualty sample to observe the kills.
    const settledMorale = soldier.morale;
    updateGame(state, .2, idle);
    expect(soldier.morale).toBeGreaterThan(settledMorale);
    expect(soldier.order).toBe('hold');
  });

  it('counts distinct casualties with a reused ID while deduplicating repeated hits on the same unit', () => {
    const state = fixture(), observer = unit(20); entityStore(state).units.add(observer);
    const first = { ...unit(999), hp: 0 }, replacement = unit(999);
    recordBattleDeath(state, first); recordBattleDeath(state, first);
    recordBattleDeath(state, replacement); // A living replacement is not a loss.
    expect(pressure(state, observer).losses).toBe(1);
    state.time = 1;
    replacement.hp = 0;
    recordBattleDeath(state, replacement); recordBattleDeath(state, replacement);
    expect(pressure(state, observer).losses).toBe(2);
    expect(state.casualties!.map(death => death.unit)).toEqual([999, 999]);
  });

  it('records projectile deaths at their impact site and routes marauders after an unanswered massacre', () => {
    const state = fixture(), leader = state.units[0], survivor = { ...unit(20, -2, 16.5, 12.5), marauderPack: 1 };
    Object.assign(leader, { x: 12.5, y: 15.5, attack: 200 });
    entityStore(state).units.add(survivor);
    state.marauderPacks = [{ id: 1, name: 'Test band', color: '#f00', targetFaction: 0,
      home: { x: 25.5, y: 12.5 }, waypoint: { x: 16.5, y: 12.5 }, nextWanderAt: 1000 }];
    for (let i = 0; i < 6; i++) {
      const victim = { ...unit(100 + i, -2, 12.5, 12.5), kind: 'worker' as const, hp: 1 };
      entityStore(state).units.add(victim); leader.target = victim.id; leader.cooldown = 0;
      updateGame(state, .4, idle);
      expect(victim.hp).toBe(0);
    }
    expect(state.casualties).toHaveLength(6);
    expect(state.casualties!.every(death => death.x === 12.5 && death.y === 12.5)).toBe(true);
    updateGame(state, 2 + 1 / 3, idle);
    expect(survivor.morale).toBe(0);
    expect(survivor.order).toBe('flee');
    expect(survivor.routed).toBe(true);
    expect(survivor.target).toBeUndefined();
  });

  it('recovers the holding stance after a rout rather than silently switching to follow', () => {
    const state = fixture(), soldier = { ...unit(20), morale: .01, hp: 10 }, enemy = unit(21, -2, 21.5, 12.5);
    entityStore(state).units.add(soldier, enemy); updateGame(state, .1, idle);
    expect(soldier.order).toBe('flee'); expect(soldier.routOrder).toBe('hold');
    entityStore(state).units.replace(state.units.filter(candidate => candidate !== enemy)); soldier.hp = 100;
    updateGame(state, 9, idle);
    expect(soldier.order).toBe('hold'); expect(soldier.routed).toBe(false);
  });

  it('rallies the first enemy faction in unit order when spatial buckets visit another faction first', () => {
    const state = fixture(), soldier = { ...unit(20), morale: .01, hp: 10 };
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war' });
    const firstEnemy = { ...unit(21, 1, 21.5, 12.5), morale: 50 };
    const leftEnemy = { ...unit(22, -2, 17.5, 12.5), morale: 50 };
    // The left bucket is visited first, but the right enemy was first in the
    // original array and must receive the opposing soldier's routing rally.
    entityStore(state).units.add(soldier, firstEnemy, leftEnemy);
    updateGame(state, .1, idle);
    expect(soldier.order).toBe('flee');
    expect(firstEnemy.morale - leftEnemy.morale).toBeCloseTo(12, 10);
  });

  it('ends a casualty rout within four seconds and does not reuse that episode’s losses after reload', () => {
    const state = fixture(), soldier = unit(20); entityStore(state).units.add(soldier);
    losses(state, 6);
    updateGame(state, 2.1, idle);
    expect(soldier).toMatchObject({ morale: 0, order: 'flee', casualtyShock: { routed: true } });
    const until = soldier.casualtyShock!.until;
    // Continued casualties within the same shock cannot extend its timer.
    losses(state, 6);
    const saved = structuredClone(state), restored = saved.units.find(u => u.id === soldier.id)!;
    updateGame(saved, 2.1, idle);
    expect(saved.time).toBeLessThan(5);
    expect(restored.casualtyShock!.until).toBe(until);
    expect(restored.order).toBe('hold'); expect(restored.routed).toBe(false);
    expect(restored.morale).toBeGreaterThanOrEqual(50);
    updateGame(saved, 5, idle);
    expect(restored.order).toBe('hold');
    expect(pressure(saved, restored).collapsing).toBe(false);
    // A genuinely new threshold of losses can trigger another short shock.
    losses(saved, 6);
    updateGame(saved, 2.1, idle);
    expect(restored.order).toBe('flee');
    expect(restored.casualtyShock!.until).toBeGreaterThan(until);
  });

  it('does not shorten an ordinary combat rout or rally a defeated faction', () => {
    for (const defeated of [false, true]) {
      const state = fixture(), soldier = { ...unit(20), order: 'flee' as const, morale: 0, routed: true,
        routOrder: 'hold' as const, casualtyShock: { until: 4, routed: defeated } };
      entityStore(state).units.add(soldier, { ...unit(21, -2, 19.5, 12.5), order: 'hold' as const });
      state.factions[0].defeated = defeated;
      // Keep the realm active so the defeated-faction branch is exercised.
      state.time = 4;
      updateGame(state, .1, idle);
      expect(soldier.order).toBe('flee');
      expect(soldier.morale).toBeLessThan(49);
    }
  });
});

describe('hostile rout contagion and marauder rally delay', () => {
  function line(morale = 60, extraStanding = 0) {
    const state = fixture();
    state.raiderCamps = []; state.raiderSkirmishes = { nextByFaction: {}, wavesByFaction: {} };
    const broken = { ...unit(20, -2, 19.5, 12.5), morale: 0, lastCombat: -60 };
    const wavering = { ...unit(21, -2, 20.5, 12.5), morale, lastCombat: -60 };
    const steady = { ...unit(22, -2, 21.5, 12.5), morale: 60, lastCombat: -60 };
    const enemy = { ...unit(23, 0, 20.5, 16.5), lastCombat: -60 };
    entityStore(state).units.add(broken, wavering, steady, enemy,
      ...Array.from({ length: extraStanding }, (_, i) => ({ ...unit(30 + i, -2, 18.5 + i % 4, 11.5), lastCombat: -60 })));
    beginBattleRout(state, broken);
    return { state, broken, wavering, steady, enemy };
  }

  it('spreads through a weakened hostile line in successive routs without a new casualty', () => {
    const { state, broken, wavering, steady } = line(12);
    updateGame(state, 1.6, idle);
    expect(wavering.order).toBe('flee');
    expect(steady.order).not.toBe('flee');
    expect(steady.morale).toBeLessThan(50);
    updateGame(state, 3.2, idle);
    expect(steady.order).toBe('flee');
    expect(steady.routUntil).toBeGreaterThan(wavering.routUntil!);
    expect(wavering.routUntil).toBeGreaterThan(broken.routUntil!);
    expect(state.casualties ?? []).toHaveLength(0);
  });

  it('does not guarantee a chain rout in a healthy formation with only one fugitive', () => {
    const { state, wavering, steady } = line(100, 5);
    steady.morale = 100;
    updateGame(state, 5, idle);
    expect(wavering.order).not.toBe('flee'); expect(steady.order).not.toBe('flee');
    expect(wavering.morale).toBeGreaterThan(85);
  });

  it('does not spread panic away from fighting, beyond five tiles, or into the friendly retinue', () => {
    for (const scenario of ['peaceful', 'distant', 'friendly'] as const) {
      const { state, broken, wavering, steady, enemy } = line(30);
      if (scenario === 'peaceful') entityStore(state).units.retain(candidate => candidate !== enemy);
      if (scenario === 'distant') broken.x = 12.5;
      if (scenario === 'friendly') { broken.faction = wavering.faction = steady.faction = 0; enemy.faction = -2; }
      updateGame(state, 1, idle);
      expect(wavering.morale, scenario).toBeGreaterThan(30);
      expect(wavering.order, scenario).not.toBe('flee');
    }
  });

  it('damps contagion near a commander who is still standing', () => {
    const morale: number[] = [];
    for (const routed of [false, true]) {
      const { state, wavering, broken } = line(70);
      const commander = { ...unit(40, -2, 20.5, 10.5), kind: 'leader' as const, lastCombat: -60 };
      entityStore(state).units.add(commander);
      if (routed) { commander.morale = 0; beginBattleRout(state, commander); }
      updateGame(state, 1, idle);
      expect(broken.order).toBe('flee');
      morale.push(wavering.morale);
    }
    expect(morale[0] - morale[1]).toBeGreaterThan(10);
  });

  it('holds an ordinary marauder rout for fifteen seconds even after full morale recovery', () => {
    const { state, broken, wavering, steady, enemy } = line();
    entityStore(state).units.retain(candidate => candidate !== wavering && candidate !== steady && candidate !== enemy);
    const deadline = broken.routUntil!;
    expect(deadline).toBe(MARAUDER_MIN_ROUT_SECONDS);
    broken.morale = 100;
    beginBattleRout(state, broken); // Repeat notifications cannot restart the clock.
    updateGame(state, 14.9, idle);
    expect(broken.order).toBe('flee'); expect(broken.routUntil).toBe(deadline);
    // Hidden morale is sampled on a five-step phase, never before the deadline.
    updateGame(state, deadline - state.time + .5, idle);
    expect(broken.order).toBe('hold'); expect(broken.routed).toBe(false);
    expect(broken.routUntil).toBeUndefined();
  });

  it('does not let a four-second casualty shock bypass the marauder rally deadline', () => {
    const state = fixture(), soldier = { ...unit(20, -2), lastCombat: -60 };
    state.raiderCamps = []; state.raiderSkirmishes = { nextByFaction: {}, wavesByFaction: {} };
    entityStore(state).units.add(soldier); losses(state, 6, -2);
    updateGame(state, 2.1, idle);
    expect(soldier.order).toBe('flee');
    const deadline = soldier.routUntil!;
    expect(deadline).toBeGreaterThan(16.9);
    updateGame(state, 3, idle);
    expect(soldier.morale).toBeGreaterThan(48);
    expect(soldier.order).toBe('flee'); expect(soldier.routUntil).toBe(deadline);
    updateGame(state, deadline - state.time - .01, idle);
    expect(soldier.order).toBe('flee');
    // Permit only the hidden five-step scheduling latency after expiry.
    updateGame(state, .5, idle);
    expect(soldier.order).toBe('hold');
  });

  it('starts the same deadline for immediate commander-loss panic', () => {
    const state = fixture(), soldier = { ...unit(20, -2), morale: 30 };
    entityStore(state).units.add(soldier);
    state.time = 7;
    recordBattleDeath(state, { ...unit(21, -2), marauderLeader: true, hp: 0 });
    expect(soldier).toMatchObject({ order: 'flee', routed: true, routUntil: 22 });
  });
});

describe('Leader retreat to the palace', () => {
  it('immediately abandons orders, ignores a nearer house, and keeps routing until reaching the palace', () => {
    const state = fixture(), leader = state.units[0], palace = state.buildings[0];
    Object.assign(leader, { x: 22.5, y: 7.5, speed: 3.6, order: 'hold', destination: { x: 30.5, y: 7.5 },
      path: [{ x: 23.5, y: 7.5 }], pathGoal: { x: 30.5, y: 7.5 }, repathAt: 100 });
    entityStore(state).buildings.add(building(40, 'house', 22, 9));
    losses(state, 6, 0, 22.5, 7.5);
    updateGame(state, 2.1, idle);
    expect(leader.order).toBe('flee');
    expect(leader.destination).toBeDefined();
    expect(leader.destination!.x).toBeLessThan(palace.x + 3);
    expect(leader.destination!.y).toBeGreaterThan(palace.y - 1);
    const x = leader.x;
    updateGame(state, 2.2, idle);
    expect(state.time).toBeGreaterThan(leader.casualtyShock!.until);
    expect(leader.order).toBe('flee');
    expect(leader.x).toBeLessThan(x);
    for (let i = 0; i < 120 && leader.order === 'flee'; i++) updateGame(state, .1, idle);
    expect(leader.order).toBe('hold'); expect(leader.routed).toBe(false);
    expect(leader.morale).toBeGreaterThanOrEqual(50);
    expect(Math.hypot(Math.max(palace.x - leader.x, 0, leader.x - palace.x - 2),
      Math.max(palace.y - leader.y, 0, leader.y - palace.y - 2))).toBeLessThanOrEqual(.75);
    expect(leader.destination).toBeUndefined();
  });

  it('does not recover in the field just because normal morale has risen above the old threshold', () => {
    const state = fixture(), leader = state.units[0];
    Object.assign(leader, { x: 22.5, y: 7.5, speed: 3.6, morale: 90, order: 'flee', routOrder: 'follow', routed: true });
    updateGame(state, .1, idle);
    expect(leader.order).toBe('flee'); expect(leader.moving).toBe(true);
    expect(leader.x).toBeLessThan(22.5);
  });
});

describe('retaliation against firing buildings', () => {
  it('prioritizes a nearby tower firing on the unit over a closer military decoy', () => {
    const state = fixture(), tower = building(30, 'woodenTower', 12, 12);
    const raider = { ...unit(20, -2, 15.5, 12.5), order: 'wander' as const, marauderPack: 1, attack: 20 };
    entityStore(state).buildings.add(tower); entityStore(state).units.add(raider, unit(21, 0, 15.5, 14.5));
    updateGame(state, .1, idle);
    expect(raider.target).toBe(tower.id);
  });

  it('shares shot awareness only with local allies and forgets silent or destroyed towers', () => {
    const state = fixture(), tower = building(30, 'woodenTower', 12, 12);
    const victim = unit(20, -2, 15.5, 12.5), ally = unit(21, -2, 17.5, 12.5), distant = unit(22, -2, 23.5, 12.5);
    entityStore(state).units.add(victim, ally, distant); recordTowerShot(state, tower, victim);
    expect(firingTowerThreats(state, ally)).toEqual([tower]);
    expect(firingTowerThreats(state, distant)).toEqual([]);
    state.time = 6.01; expect(firingTowerThreats(state, ally)).toEqual([]);
    recordTowerShot(state, tower, victim); tower.hp = 0;
    expect(firingTowerThreats(state, ally)).toEqual([]);
  });

  it('does not fixate on a firing tower separated by impassable water', () => {
    const state = fixture(), tower = building(30, 'woodenTower', 12, 12);
    const raider = { ...unit(20, -2, 15.5, 12.5), order: 'wander' as const, marauderPack: 1, attack: 20 };
    entityStore(state).buildings.add(tower); entityStore(state).units.add(raider, unit(21, 0, 15.5, 14.5));
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 14].terrain = 'river';
    updateGame(state, .1, idle);
    expect(raider.target).toBe(21);
  });
});

describe('ranged wall overflight', () => {
  it.each(['wall', 'palisade'] as const)('lets the Leader hit over a %s while retaining the obstruction for melee', kind => {
    const state = fixture(), leader = state.units[0], victim = unit(20, -2, 16.5, 12.5);
    Object.assign(leader, { x: 12.5, y: 12.5, attack: 25 });
    entityStore(state).units.add(victim); entityStore(state).buildings.add(building(30, kind, 14, 12));
    updateGame(state, .5, idle);
    expect(victim.hp).toBe(82.5);
    // Give melee the same reach to isolate physical obstruction from range.
    leader.attack = 0;
    victim.attack = 25; victim.range = 4; victim.order = 'wander'; victim.cooldown = 0;
    updateGame(state, .5, idle);
    expect(victim.hp).toBe(82.5);
    expect(leader.hp).toBe(100);
  });
});


it('retains the exact empty exchange result and observes new deaths and expiry immediately', () => {
  const state = fixture(), observer = unit(20);
  const empty = { losses: 0, threshold: 6, recentEnemyKill: false, enemyLosses: 0, unfavorableExchange: true, collapsing: false };
  expect(pressure(state, observer)).toEqual(empty);
  losses(state, 1); losses(state, 1, -2);
  expect(pressure(state, observer)).toEqual({ losses: 1, threshold: 6, recentEnemyKill: true,
    enemyLosses: 1, unfavorableExchange: false, collapsing: false });
  state.time = 20.01;
  expect(pressure(state, observer)).toEqual(empty);
});

it('keeps casualty rows distinct across negative and distant coordinates', () => {
  const state = fixture(), observer = unit(20, 0, -.5, .5);
  losses(state, 6, 0, -.5, .5);
  losses(state, 20, -2, 79.5, -7.5);
  expect(pressure(state, observer)).toMatchObject({ losses: 6, enemyLosses: 0, collapsing: true });
  observer.x = 79.5; observer.y = -7.5;
  expect(pressure(state, observer)).toMatchObject({ losses: 0, enemyLosses: 20, collapsing: false });
});

it('counts the living cohort identically with an index and sees death and hiding during the frame', () => {
  const state = fixture(), observer = unit(20); entityStore(state).units.add(observer);
  entityStore(state).units.add(...Array.from({ length: 18 }, (_, i) => unit(30 + i, 0, observer.x + i % 3, observer.y)));
  losses(state, 6);
  const before = pressure(state, observer);
  beginUnitFrame(state);
  try {
    expect(pressure(state, observer)).toEqual(before);
    state.units[2].hp = 0; state.units[3].inside = true;
    expect(pressure(state, observer).threshold).toBe(12);
  } finally { endUnitFrame(state); }
  expect(pressure(state, observer).threshold).toBe(12);
});
