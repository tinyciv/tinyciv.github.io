import { entityStore } from '../src/game/entity-store';
import { describe, expect, it, vi } from 'vitest';
import { updateGame, migrateGame } from '../src/game/simulation';
import { ensureMarauderLeaders, MARAUDER_LEADER_SPEED, marauderBandDepleted } from '../src/game/marauder-leaders';
import { drawVeterancy, recordKill, unitAttack, unitDamage, unitDefense, veterancy } from '../src/game/veterancy';
import { updateFogRaids } from '../src/game/fog-raids';
import { distance, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const soldier = (id: number, x: number, y: number, faction = 0): Unit => ({ id, kind: 'warrior', x, y, faction,
  hp: 100, maxHp: 100, morale: 100, attack: 17, defense: 4, speed: 2.35, range: 1.1, order: 'hold',
  cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
function fixture(): GameState {
  return { world: { width: 40, height: 30, seed: 'ranks', source: 'test', spawns: [],
    tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, gold: 0, production: 0, variation: .5 })) },
    units: [{ ...soldier(1, 5.5, 20.5), kind: 'leader', attack: 0, range: 4 }],
    buildings: [{ id: 2, kind: 'palace', faction: 0, x: 3, y: 18, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 0, gold: 0, production: 0,
      population: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'ranks', rngState: 17,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0 } };
}
function addBand(state: GameState, troops = 4) {
  const pack = { id: 1, name: 'Marauders', color: '#111', targetFaction: 0,
    home: { x: 30.5, y: 10.5 }, waypoint: { x: 10.5, y: 10.5 }, nextWanderAt: 1e9 };
  state.marauderPacks!.push(pack);
  for (let i = 0; i <= troops; i++) entityStore(state).units.add({ ...soldier(20 + i, 15.5 + i, 10.5, -2), marauderPack: 1, order: 'wander' });
  ensureMarauderLeaders(state);
  return { pack: state.marauderPacks![0], leader: state.units.find(unit => unit.marauderLeader)! };
}

describe('veterancy combat progression', () => {
  it('reduces hits by thirty percent after armor, including heavily armored minimum hits', () => {
    expect(unitDamage({ attack: 25 }, 0)).toBe(17.5);
    expect(unitDamage({ attack: 25 }, 5)).toBe(14);
    expect(unitDamage({ attack: 17 }, 100)).toBeCloseTo(2.8);
    expect(unitDamage({ attack: 17, kills: 100 }, 4)).toBe(14);
  });
  it('promotes at exactly 10, 100, 250 and 500 kills without mutating base stats', () => {
    const unit = soldier(3, 10, 10);
    const expected = new Map([[0, [11.9, 4]], [10, [14, 6]], [100, [16.8, 9]], [250, [20.3, 12]], [500, [27.37, 4]]]);
    for (let kills = 0; kills <= 501; kills++) {
      expect(veterancy(unit)).toBe(kills >= 500 ? 4 : kills >= 250 ? 3 : kills >= 100 ? 2 : kills >= 10 ? 1 : 0);
      if (expected.has(kills)) {
        const [attack, defense] = expected.get(kills)!;
        expect(unitAttack(unit)).toBeCloseTo(attack);
        expect(unitDefense(unit)).toBe(defense);
      }
      recordKill(unit);
    }
    expect(unit.attack).toBe(17); expect(unit.defense).toBe(4);
  });
  it('credits melee kills once and applies earned damage and defender armor', () => {
    const state = fixture(), attacker = { ...soldier(3, 10.5, 10.5), kills: 9 };
    const victim = { ...soldier(4, 11.5, 10.5, -2), hp: 1, speed: 0, attack: 0 };
    entityStore(state).units.add(attacker, victim); updateGame(state, .1, idle);
    expect(attacker.kills).toBe(10); expect(state.factions[0].gold).toBe(6);
    const veteran = { ...soldier(5, 11.5, 10.5, -2), kills: 100, speed: 0, attack: 0 };
    entityStore(state).units.add(veteran); attacker.cooldown = 0;
    for (let step = 0; step < 10 && veteran.hp === 100; step++) updateGame(state, .1, idle);
    expect(veteran.hp).toBeCloseTo(100 - (20 - 9) * .7); expect(attacker.kills).toBe(10);
  });
  it('credits javelin kills on impact and preserves rank through migration', () => {
    const state = fixture(), leader = state.units[0]; leader.attack = 25; leader.kills = 99;
    const victim = { ...soldier(4, 8.5, 20.5, -2), hp: 1, attack: 0, speed: 0 };
    entityStore(state).units.add(victim); updateGame(state, .1, idle);
    expect(leader.kills).toBe(99); expect(state.projectiles).toHaveLength(1);
    updateGame(state, .3, idle); expect(leader.kills).toBe(100);
    migrateGame(state); migrateGame(state);
    expect(leader.kills).toBe(100); expect(unitAttack(leader)).toBeCloseTo(22.4);
  });
  it('draws compact chevrons beside the helmet and gives Elite a single pixel bolt', () => {
    const c = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn() };
    for (const [kills, count] of [[9, 0], [10, 1], [100, 2], [250, 3]]) {
      c.stroke.mockClear(); c.moveTo.mockClear(); c.fillRect.mockClear();
      drawVeterancy(c as unknown as CanvasRenderingContext2D, { ...soldier(3, 0, 0), kills }, 100, 100, 32);
      expect(c.stroke).toHaveBeenCalledTimes(count * 2);
      expect(c.fillRect).not.toHaveBeenCalled();
      for (const [x, y] of c.moveTo.mock.calls) { expect(x).toBeGreaterThan(120); expect(y).toBeGreaterThan(103); expect(y).toBeLessThan(115); }
    }
    c.stroke.mockClear();
    drawVeterancy(c as unknown as CanvasRenderingContext2D, { ...soldier(3, 0, 0), kills: 500 }, 100, 100, 32);
    expect(c.stroke).not.toHaveBeenCalled();
    expect(c.fillRect).toHaveBeenCalled();
  });
});

describe('marauder leaders', () => {
  it('adds twenty percent health and speed only to commanders, without stacking or changing their attack bonus', () => {
    const state = fixture(), factionLeader = structuredClone(state.units[0]), { pack, leader } = addBand(state);
    expect(leader.hp).toBe(120); expect(leader.maxHp).toBe(120);
    expect(leader.speed).toBeCloseTo(3.525);
    expect(leader.attack).toBe(24); // Existing 1.4× promotion attack stays unchanged.
    expect(state.units[0]).toEqual(factionLeader);
    for (const unit of state.units.filter(unit => unit.marauderPack === pack.id && unit !== leader))
      expect(unit).toMatchObject({ hp: 100, maxHp: 100, speed: 2.35, attack: 17 });
    leader.hp = 42;
    ensureMarauderLeaders(state); ensureMarauderLeaders(state);
    expect(leader).toMatchObject({ hp: 42, maxHp: 120, attack: 24 });
    // Rediscovering an already promoted commander also must not grant the bonus again.
    delete pack.leaderId; ensureMarauderLeaders(state);
    expect(leader).toMatchObject({ hp: 42, maxHp: 120, attack: 24 });
  });
  it('preserves the wounded fraction when promoting a band member', () => {
    const state = fixture();
    state.marauderPacks!.push({ id: 1, name: 'Wounded band', color: '#111', targetFaction: 0,
      home: { x: 30.5, y: 10.5 }, waypoint: { x: 30.5, y: 10.5 }, nextWanderAt: 1e9 });
    entityStore(state).units.add({ ...soldier(20, 30.5, 10.5, -2), marauderPack: 1, hp: 26, maxHp: 65 });
    ensureMarauderLeaders(state);
    const leader = state.units.at(-1)!;
    expect(leader.maxHp).toBe(78); expect(leader.hp).toBeCloseTo(31.2);
    expect(leader.hp / leader.maxHp!).toBeCloseTo(.4);
  });
  it('keeps the same leader through load and never promotes a replacement after death', () => {
    const state = fixture(), { pack, leader } = addBand(state);
    expect(leader.speed).toBe(MARAUDER_LEADER_SPEED); expect(leader.range).toBe(1.1);
    const attack = leader.attack; ensureMarauderLeaders(state); expect(leader.attack).toBe(attack);
    leader.hp = 0; ensureMarauderLeaders(state);
    expect(state.units.filter(unit => unit.marauderLeader)).toHaveLength(1); expect(pack.leaderId).toBe(leader.id);
  });
  it('restores commander speed without healing a legacy wounded roaming leader', () => {
    const state = fixture(), { leader } = addBand(state);
    leader.attack = 14; leader.hp = 32.5; delete leader.maxHp; leader.kills = 14;
    migrateGame(state); migrateGame(state);
    expect(leader).toMatchObject({ hp: 32.5, maxHp: 65, kills: 14, speed: MARAUDER_LEADER_SPEED, range: 1.1 });
    entityStore(state).units.replace(state.units.filter(unit => unit !== leader));
    migrateGame(state);
    expect(state.units.some(unit => unit.marauderLeader)).toBe(false);
  });
  it('does not mistake a reused dead leader ID for a commander from its old band', () => {
    const state = fixture(), { pack, leader } = addBand(state);
    entityStore(state).units.replace(state.units.filter(unit => unit !== leader));
    const replacement = { ...soldier(leader.id, 25.5, 15.5, -2), marauderPack: 999, marauderLeader: true, speed: 1, range: 7 };
    entityStore(state).units.add(replacement); ensureMarauderLeaders(state);
    expect(replacement).toMatchObject({ speed: 1, range: 7, marauderPack: 999 });
    expect(pack.leaderId).toBe(leader.id);
    expect(state.units.some(unit => unit.marauderPack === pack.id && unit.marauderLeader)).toBe(false);
  });
  it('uses melee and awards exactly 200 gold when killed', () => {
    const state = fixture(), { leader } = addBand(state);
    leader.x = 10.5; leader.y = 10.5;
    const enemy = { ...soldier(100, 11.5, 10.5), attack: 0 }; entityStore(state).units.add(enemy);
    updateGame(state, .1, idle);
    expect(enemy.hp).toBeLessThan(100); expect(state.projectiles ?? []).toHaveLength(0);
    enemy.attack = 1000; enemy.cooldown = 0;
    updateGame(state, .1, idle);
    expect(leader.hp).toBe(0); expect(state.factions[0].gold).toBe(200); expect(enemy.kills).toBe(1);
  });
  it('immediately flees danger and returns home after its troop count falls', () => {
    const state = fixture(), { pack, leader } = addBand(state);
    leader.hp = 40; entityStore(state).units.add(soldier(100, 14.5, 10.5));
    const initial = distance(leader, state.units.at(-1)!);
    updateGame(state, .1, idle);
    expect(leader.marauderRetreating).toBe(true); expect(distance(leader, state.units.at(-1)!)).toBeGreaterThan(initial);
    entityStore(state).units.replace(state.units.filter(unit => unit.marauderPack === undefined || unit === leader));
    expect(marauderBandDepleted(state, pack)).toBe(true);
    const before = distance(leader, pack.home); updateGame(state, .4, idle);
    expect(pack.returning).toBe(true); expect(distance(leader, pack.home)).toBeLessThan(before);
  });
  it('flees a firing tower without enemy troops, even when camp lies beyond the tower', () => {
    const state = fixture(), { pack, leader } = addBand(state);
    leader.hp = 40; leader.x = 14.5; leader.y = 10.5;
    pack.home = { x: 8.5, y: 10.5 };
    const tower = { id: 100, kind: 'woodenTower' as const, faction: 0, x: 12, y: 10, hp: 600, maxHp: 600, capacity: 0 };
    entityStore(state).buildings.add(tower);
    const towerCenter = { x: 12.5, y: 10.5 }, before = distance(leader, towerCenter);
    updateGame(state, .1, idle);
    expect(state.projectiles?.some(projectile => projectile.attacker === tower.id)).toBe(true);
    expect(leader.marauderRetreating).toBe(true);
    expect(distance(leader, towerCenter)).toBeGreaterThan(before);
    expect(leader.target).toBeUndefined();
  });
  it('reuses a returned camp leader for the next wave, preserving kills and wounds', () => {
    const state = fixture(), { pack, leader } = addBand(state);
    entityStore(state).units.replace([state.units[0], leader]);
    Object.assign(pack, { raid: true, returning: true, raiderCamp: 1, spawnedAt: 0 });
    Object.assign(leader, { x: pack.home.x, y: pack.home.y, hp: 70, kills: 12, marauderRetreating: true });
    entityStore(state).buildings.add({ id: 50, kind: 'house', faction: -2, x: 32, y: 12, hp: 160, maxHp: 160, capacity: 0, raiderCamp: 1 });
    entityStore(state).buildings.add({ id: 51, kind: 'woodenTower', faction: -2, x: 33, y: 12, hp: 600, maxHp: 600, capacity: 0, raiderCamp: 1 });
    state.raiderCamps = [{ id: 1, size: 'small', name: 'Camp', x: 29, y: 10, width: 7, height: 7, gate: { x: 30, y: 10 }, houses: [50], coreTowers: [51], tentCapacity: 1, nextRaidAt: 60, waves: 1 }];
    state.time = 60; state.fogRaids!.nextAt = 60; updateFogRaids(state);
    expect(leader.marauderPack).not.toBe(pack.id); expect(leader.marauderRetreating).toBe(false);
    expect(leader.hp).toBe(70); expect(leader.maxHp).toBe(120); expect(leader.kills).toBe(12);
    expect(state.units.filter(unit => unit.marauderPack === leader.marauderPack)).toHaveLength(4);
    expect(state.marauderPacks!.find(candidate => candidate.id === leader.marauderPack)!.leaderId).toBe(leader.id);
  });
});
