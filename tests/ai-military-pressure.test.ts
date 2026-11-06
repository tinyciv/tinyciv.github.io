import { describe, expect, it } from 'vitest';
import { createGame, moveUnit, updateGame } from '../src/game/simulation';
import { entityStore } from '../src/game/entity-store';
import { enemyStrength, setEnemyStrength, updateEnemyStrength } from '../src/game/enemy-strength';
import { grantIncome } from '../src/game/resource-income';
import { unitAttack, unitDamage } from '../src/game/veterancy';
import { setSoldierRole } from '../src/game/archery';
import { updateWallStats } from '../src/game/wall-stats';
import { marauderBaseStats, RAIDER_ATTACK_MULTIPLIER } from '../src/game/raider-pressure';
import { fogRaidProfile } from '../src/game/fog-raids';
import { refreshRaiderCampPressure, updateRaiderCampPressure } from '../src/game/raider-camp-pressure';
import { defendRaiderCamp } from '../src/game/raider-activity';
import { updateFactionStrategies, getFactionStrategy } from '../src/game/faction-strategy';
import { advanceInfantryFormations, infantryFormationGoal, infantryRectangleOffsets } from '../src/game/infantry-drill';
import { updateMarauderFormations, marauderFortificationMultiplier } from '../src/game/marauder-formations';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from '../src/game/spatial';
import { beginNavigationFrame, endNavigationFrame } from '../src/game/pathfinding';
import { distance, type Building, type GameState, type Unit, type World } from '../src/game/types';
import { recordLeaderDeath } from '../src/game/leader-respawn';

const idle = { up: false, down: false, left: false, right: false };
function soldier(id: number, faction: number, x = 10.5, y = 15.5): Unit {
  return { id, kind: 'warrior', faction, x, y, hp: 100, maxHp: 100, attack: 17, defense: 4, morale: 100,
    speed: 2.35, range: 1.1, order: 'follow', cooldown: 0, lastCombat: -100, lastDamagedAt: -100, facing: 0, moving: false, attackTime: 0 };
}
function fixture(): GameState {
  return { world: { seed: 'pressure', source: 'test', width: 64, height: 36, revision: 0, spawns: [], tiles: Array.from({ length: 64 * 36 }, () =>
    ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    units: [], buildings: [], factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#f00', affinity: 0, relation: id ? 'war' : 'self',
      population: 0, food: 0, gold: 0, production: 0, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, seed: 'pressure', rngState: 1, events: [], particles: [], fields: [], projectiles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, marauderPacks: [], roamingMaraudersVersion: 1,
  } as GameState;
}
const building = (id: number, faction: number, kind: Building['kind'], x: number, y: number): Building =>
  ({ id, faction, kind, x, y, hp: 200, maxHp: 200, capacity: 0 });
function campFixture() {
  const state = fixture();
  entityStore(state).buildings.replace([building(10, -2, 'house', 30, 12), building(11, -2, 'woodenTower', 31, 14)]);
  state.buildings.forEach(building => building.raiderCamp = 1);
  state.raiderCamps = [{ id: 1, size: 'small', name: 'Camp', x: 28, y: 10, width: 7, height: 7, gate: { x: 28, y: 13 },
    houses: [10], coreTowers: [11], nextRaidAt: 30, waves: 0, defenderReadyAt: { 10: 30 } }];
  return { state, camp: state.raiderCamps[0] };
}

describe('enemy strength', () => {
  it('scales actual damage after armor, health and earned gold; excludes villages and human opponents', () => {
    const state = fixture();
    state.multiplayer = { humanFactionIds: [0, 1], inputs: {}, controls: {}, winner: null };
    state.factions.push({ ...state.factions[1], id: 2 }, { ...state.factions[1], id: 3, villageId: 1 });
    entityStore(state).units.replace([0, 1, 2, 3, -2, -3].map((faction, index) => soldier(index + 1, faction)));
    entityStore(state).buildings.replace([building(20, 2, 'library', 20, 20), building(21, 3, 'house', 22, 20)]);
    state.units[2].hp = 40;
    const ordinary = unitDamage(state.units[2], 15);
    setEnemyStrength(state, 2);
    expect(state.units.map(unit => unit.maxHp)).toEqual([100, 100, 200, 100, 200, 100]);
    expect(state.units[2].hp).toBe(80);
    expect(unitDamage(state.units[2], 15)).toBe(ordinary * 2);
    expect(state.buildings.map(building => building.maxHp)).toEqual([400, 200]);
    for (const faction of state.factions) grantIncome(faction, { gold: 10 }, state, 'taxes');
    expect(state.factions.map(faction => faction.gold)).toEqual([10, 10, 15, 10]); // AI library diverts its normal 25% from the doubled receipt.
    expect(state.factions[2].incomeTotals?.gold).toBe(20);
    expect(enemyStrength(fixture())).toBe(1);
  });

  it('does not compound on updates, retraining or wall-stat refresh; ownership restores normal health', () => {
    const state = fixture(), unit = soldier(1, 1), wall = building(10, 1, 'wall', 20, 20);
    entityStore(state).units.replace([unit]); entityStore(state).buildings.replace([wall]);
    updateWallStats(state, true); const wallHealth = wall.maxHp;
    setEnemyStrength(state, 2); updateEnemyStrength(state, true); updateWallStats(state, true);
    expect(wall.maxHp).toBe(wallHealth * 2);
    setSoldierRole(unit, 'archer'); expect(unit.maxHp).toBeCloseTo(400 / 3);
    setEnemyStrength(state, 1.5); setSoldierRole(unit, 'warrior'); expect(unit.maxHp).toBe(150);
    expect(unitDamage(unit, 10)).toBeCloseTo(unitDamage(soldier(30, 0), 10) * 1.5);
    unit.faction = 0; wall.faction = 0; updateEnemyStrength(state, true); updateWallStats(state, true);
    expect(unit.maxHp).toBe(100); expect(wall.maxHp).toBe(wallHealth);
    const fresh = soldier(2, 1); entityStore(state).units.add(fresh); updateEnemyStrength(state);
    expect(fresh.maxHp).toBe(150);
  });

  it('scales new-game units and fortifications and a real tower projectile', () => {
    const world = fixture().world; world.spawns = [{ x: 8, y: 17 }, { x: 48, y: 17 }];
    const game = createGame(world, undefined, { banditIntensity: 0, enemyStrength: 1.5 });
    expect(game.units.find(unit => unit.kind === 'leader' && unit.faction === 1)?.maxHp).toBe(150);
    expect(game.units.find(unit => unit.kind === 'leader' && unit.faction === 0)?.maxHp).toBe(100);
    const state = fixture(), target = { ...soldier(1, 0, 12.5, 15.5), kind: 'leader' as const, order: 'hold' as const, attack: 0, speed: 0 };
    entityStore(state).units.replace([target]); entityStore(state).buildings.replace([building(20, 1, 'woodenTower', 15, 15)]);
    setEnemyStrength(state, 2); updateGame(state, .05, idle);
    expect(state.projectiles?.[0].damage).toBeCloseTo((12.5 - 4) * .7 * 2);
  });

  it('stores unscaled respawn health so a newly created Leader cannot double the multiplier', () => {
    const state = fixture(), leader = { ...soldier(1, 1), kind: 'leader' as const };
    entityStore(state).units.replace([leader]); entityStore(state).buildings.replace([building(10, 1, 'palace', 20, 20)]);
    setEnemyStrength(state, 2); leader.hp = 0; recordLeaderDeath(state, leader, 0);
    expect(state.factions[1].leaderRespawn?.maxHp).toBe(100);
    const replacement = { ...soldier(2, 1), kind: 'leader' as const, maxHp: state.factions[1].leaderRespawn!.maxHp };
    entityStore(state).units.add(replacement); updateEnemyStrength(state);
    expect(replacement.maxHp).toBe(200);
  });
});

describe('marauder recruitment pressure', () => {
  it('halves each baseline gap, including the final marauder attack factor', () => {
    for (const [hp, attack, defense] of [[40, 6, 0], [65, 10, 2], [100, 21, 2]]) {
      const stats = marauderBaseStats(hp, attack, defense);
      expect(100 - stats.hp).toBeCloseTo((100 - hp) / 2);
      expect(4 - stats.defense).toBeCloseTo((4 - defense) / 2);
      expect(17 - stats.attack * RAIDER_ATTACK_MULTIPLIER).toBeCloseTo((17 - attack * RAIDER_ATTACK_MULTIPLIER) / 2);
    }
    expect(fogRaidProfile(0, 0)).toMatchObject({ hp: 70, attack: 13, defense: 2 });
  });

  it('doubles timer progress for ten seconds, renews under proximity, then expires without compounding', () => {
    const { state, camp } = campFixture();
    state.marauderPacks = [{ id: 1, name: 'siege', color: '#000', targetFaction: 0, home: camp.gate, waypoint: camp.gate, nextWanderAt: 0,
      raiderCamp: 1, siegeNextReinforceAt: 30 }];
    refreshRaiderCampPressure(state, camp);
    state.time = 5; updateRaiderCampPressure(state);
    expect(camp.nextRaidAt).toBe(25); expect(camp.defenderReadyAt![10]).toBe(25);
    expect(state.marauderPacks[0].siegeNextReinforceAt).toBe(25);
    updateRaiderCampPressure(state); expect(camp.nextRaidAt).toBe(25);
    state.time = 12; updateRaiderCampPressure(state); expect(camp.nextRaidAt).toBe(20);
    state.time = 13; updateRaiderCampPressure(state); expect(camp.nextRaidAt).toBe(20);
    entityStore(state).units.replace([soldier(1, 0, 26, 14)]);
    updateRaiderCampPressure(state); expect(camp.pressureUntil).toBe(23);
    state.time = 18; updateRaiderCampPressure(state); expect(camp.pressureUntil).toBe(28);
    expect(camp.nextRaidAt).toBe(18);
  });

  it('damage refreshes the surge even during a defender cooldown; neutral village visitors do not', () => {
    const { state, camp } = campFixture();
    expect(defendRaiderCamp(state, state.buildings[0], { faction: 0, x: 29, y: 12 })).toBe(0);
    expect(camp.pressureUntil).toBe(10);
    state.time = 5; defendRaiderCamp(state, state.buildings[0], { faction: 0, x: 29, y: 12 });
    expect(camp.pressureUntil).toBe(15);
    state.factions.push({ ...state.factions[1], id: 2, villageId: 1 });
    entityStore(state).units.replace([soldier(2, 2, 28.5, 14.5)]);
    state.time = 6; updateRaiderCampPressure(state); expect(camp.pressureUntil).toBe(15);
  });

  it('wakes the shared wave scheduler when a damage event advances a camp clock', () => {
    const { state, camp } = campFixture();
    state.fogRaids = { nextAt: 30, waves: 0 };
    refreshRaiderCampPressure(state, camp);
    state.time = 5; refreshRaiderCampPressure(state, camp);
    expect(camp.nextRaidAt).toBe(25); expect(state.fogRaids.nextAt).toBe(25);
    updateRaiderCampPressure(state); // Same timestamp must neither lose nor double the earned acceleration.
    expect(camp.nextRaidAt).toBe(25); expect(state.fogRaids.nextAt).toBe(25);
  });
});

function invasion() {
  const state = fixture(), palace = building(100, 1, 'palace', 48, 16), enemy = building(101, 0, 'palace', 6, 16);
  entityStore(state).buildings.replace([palace, enemy]);
  const leader = { ...soldier(1, 1, 45.5, 17.5), kind: 'leader' as const, home: palace.id };
  entityStore(state).units.replace([leader, ...Array.from({ length: 8 }, (_, i) => soldier(i + 2, 1, 44.5 + i % 3, 17.5 + Math.floor(i / 3))),
    ...Array.from({ length: 10 }, (_, i) => ({ ...soldier(i + 20, 1, 51.5, 16.5 + i % 4), kind: 'worker' as const, hp: 50, maxHp: 50, home: palace.id, attack: 0 }))]);
  state.factions[1].population = 120; state.factions[1].gold = 5000; state.factions[1].nextRaid = 0;
  state.factions[0].population = 30;
  state.factions[1].research = { focus: 'massLevy', levels: { massLevy: 1 }, progress: {} };
  return { state, palace, enemy, leader };
}
const queries = { hostile: (a: number, b: number) => a !== b, visible: () => true };
describe('offensive faction levy', () => {
  it('drafts paid real workers for a favorable population differential and assembles them with the Leader', () => {
    const { state } = invasion();
    updateFactionStrategies(state, queries);
    const levies = state.units.filter(unit => unit.levy);
    expect(levies).toHaveLength(6); expect(state.factions[1].gold).toBe(4910);
    const mission = getFactionStrategy(state, 1)!;
    expect(['attack', 'regroup']).toContain(mission.mode);
    for (const levy of levies) expect(mission.escortIds).toContain(levy.id);
    state.time = 1; updateFactionStrategies(state, queries);
    expect(state.units.filter(unit => unit.levy)).toHaveLength(6);
    expect(state.factions[1].gold).toBe(4910);
  });

  it('rejects an overwhelming defended city and does not levy without technology or expedition wages', () => {
    const { state, enemy } = invasion();
    entityStore(state).buildings.add(...Array.from({ length: 30 }, (_, i) => building(200 + i, 0, 'woodenTower', enemy.x + i % 6, enemy.y + Math.floor(i / 6))));
    updateFactionStrategies(state, queries);
    expect(state.units.some(unit => unit.levy)).toBe(false);
    expect(getFactionStrategy(state, 1)?.mode).not.toBe('attack');
    for (const variant of ['poor', 'unresearched']) {
      const next = invasion().state;
      if (variant === 'poor') next.factions[1].gold = 100; else next.factions[1].research!.levels.massLevy = 0;
      updateFactionStrategies(next, queries);
      expect(next.units.some(unit => unit.levy)).toBe(false);
    }
  });

  it('uses the prospective levy to turn a marginal siege into a favorable campaign', () => {
    const { state, enemy } = invasion();
    entityStore(state).buildings.add(...Array.from({ length: 5 }, (_, i) => building(200 + i, 0, 'woodenTower', enemy.x + 4, enemy.y - 2 + i)));
    updateFactionStrategies(state, queries);
    expect(state.units.filter(unit => unit.levy).length).toBeGreaterThan(0);
    expect(['attack', 'regroup']).toContain(getFactionStrategy(state, 1)?.mode);
    const weak = invasion();
    weak.state.factions[1].research!.levels.massLevy = 0;
    entityStore(weak.state).buildings.add(...Array.from({ length: 5 }, (_, i) => building(200 + i, 0, 'woodenTower', weak.enemy.x + 4, weak.enemy.y - 2 + i)));
    updateFactionStrategies(weak.state, queries);
    expect(getFactionStrategy(weak.state, 1)?.mode).not.toBe('attack');
  });
});

function formationState() {
  const state = fixture(), leader = { ...soldier(1, -2, 10.5, 17.5), marauderPack: 1, marauderLeader: true };
  entityStore(state).units.replace([leader, ...infantryRectangleOffsets(11).map((offset, index) => ({ ...soldier(index + 2, -2, leader.x + offset.x, leader.y + offset.y), marauderPack: 1 }))]);
  const target = building(100, 0, 'palace', 45, 17); entityStore(state).buildings.replace([target]);
  state.marauderPacks = [{ id: 1, name: 'assault', color: '#000', targetFaction: 0, targetBuilding: 100, home: { x: 5, y: 17 }, waypoint: { x: 46, y: 18 },
    nextWanderAt: 1e9, raid: true, motivation: 'assault', leaderId: 1, startingTroops: 11 }];
  return { state, leader };
}
function march(state: GameState, seconds: number) {
  for (let i = 0; i < seconds * 20; i++) {
    state.time += .05; beginUnitFrame(state); beginNavigationFrame(state);
    try {
      updateMarauderFormations(state, () => true);
      advanceInfantryFormations(state, .05, () => idle, (unit, goal, speed, dt) => {
        moveUnit(state, unit, goal, dt * speed / unit.speed, true, false, true); refreshIndexedUnit(state, unit);
      });
    } finally { endNavigationFrame(state); endUnitFrame(state); }
  }
}
describe('large marauder formations', () => {
  it('marches a compact pack while leaving small unrelated raiders outside it', () => {
    const { state, leader } = formationState();
    const unrelated = { ...soldier(50, -2, 12, 25), marauderPack: 2 };
    entityStore(state).units.add(unrelated);
    march(state, 8);
    expect(leader.infantryFormation?.active).toBe(true); expect(leader.x).toBeGreaterThan(22);
    expect(leader.infantryFormation?.slots).toHaveLength(11);
    expect(unrelated.infantryDrillLeader).toBeUndefined();
    for (const member of state.units.filter(unit => unit.marauderPack === 1 && !unit.marauderLeader)) {
      expect(distance(member, infantryFormationGoal(state, member)!)).toBeLessThan(.3);
      expect(marauderFortificationMultiplier(state, member, building(200, 0, 'wall', 25, 17))).toBe(2);
      expect(marauderFortificationMultiplier(state, member, building(201, 0, 'house', 25, 17))).toBe(1);
    }
  });

  it('reaches a closed wall face in formation and releases on camp return', () => {
    const { state, leader } = formationState();
    entityStore(state).buildings.add(...Array.from({ length: state.world.height }, (_, y) => building(200 + y, 0, 'wall', 23, y)));
    march(state, 14);
    expect(leader.x).toBeGreaterThan(21); expect(leader.x).toBeLessThan(23);
    expect(leader.infantryFormation?.active).toBe(true);
    state.marauderPacks![0].returning = true; state.time += 1; updateMarauderFormations(state, () => true);
    expect(leader.infantryFormation?.active).toBe(false);
    expect(state.units.some(unit => unit.infantryDrillLeader !== undefined)).toBe(false);
  });
});
