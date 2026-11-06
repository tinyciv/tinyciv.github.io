import { indexedUnit } from '../src/game/spatial';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { constructionEdges } from '../src/game/builders';
import { canWalk } from '../src/game/pathfinding';
import { canRespawnLeader, getLeader, respawnLeader, updateGame } from '../src/game/simulation';
import { veterancy } from '../src/game/veterancy';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, x, y, faction, hp: 650, maxHp: 650, capacity: 0,
});
const unit = (id: number, kind: Unit['kind'], x: number, y: number): Unit => ({
  id, kind, faction: 0, x, y, hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5,
  speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
function fixture(): GameState {
  const dead = { ...unit(40, 'leader', 22.5, 18.5), hp: 0, kills: 350, morale: 0, cooldown: 5,
    target: 99, order: 'flee' as const, destination: { x: 25.5, y: 18.5 }, attackTime: 2,
    casualtyShock: { until: 130, routed: true }, routed: true };
  const warrior = { ...unit(12, 'warrior', 8.5, 8.5), retinueStance: 'defensive' as const, kills: 110 };
  return {
    world: { width: 32, height: 24, seed: 'respawn', source: 'fixture', spawns: [],
      tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .5, food: 2, production: 0, gold: 0, variation: .2 })) },
    buildings: [{ ...building(1, 'palace', 4, 4), populationGrowth: .5 }], units: [dead, warrior],
    factions: [{ id: 0, name: 'Home', color: '#3988ff', relation: 'self', affinity: 100,
      food: 375, gold: 82, production: 0, population: 8, culture: 100,
      yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: true }],
    time: 120, tick: 4, speed: 1, paused: true, gameOver: true, victory: false, events: [], particles: [],
    projectiles: [], fields: [], selected: dead.id, selectedType: 'unit', buildMode: 'wall', diplomacy: 1,
    retinueStance: 'defensive', movementMode: 'formation', seed: 'respawn', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
}

describe('defeat Leader respawn', () => {
  it('creates a fresh untrained Leader near the palace and resumes the existing realm', () => {
    const state = fixture(), dead = state.units[0], warrior = state.units[1], beforeWarrior = structuredClone(warrior);
    const beforeTreasury = { ...state.factions[0] }, beforeBuildings = [...state.buildings];
    expect(canRespawnLeader(state)).toBe(true);

    const result = respawnLeader(state), leader = result.leader!;

    expect(result.ok).toBe(true);
    expect(leader).not.toBe(dead);
    expect(leader.id).toBeGreaterThan(dead.id);
    expect(Math.hypot(leader.x - 5, leader.y - 5)).toBeLessThanOrEqual(4);
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
    expect(leader).toMatchObject({ kind: 'leader', faction: 0, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, kills: 0, cooldown: 0, attackTime: 0, moving: false,
      order: 'follow', home: 1, bornAt: 120 });
    expect(veterancy(leader)).toBe(0);
    for (const field of ['target', 'destination', 'path', 'forcedAttack', 'casualtyShock', 'routed', 'routOrder', 'recallIssuedAt'] as const)
      expect(leader[field]).toBeUndefined();
    expect(state.units).not.toContain(dead);
    expect(warrior).toEqual(beforeWarrior);
    expect(state.factions[0]).toEqual({ ...beforeTreasury, defeated: false });
    expect(state.buildings).toEqual(beforeBuildings);
    expect(state).toMatchObject({ gameOver: false, victory: false, paused: false, selected: leader.id,
      selectedType: 'unit', buildMode: null, diplomacy: null, retinueStance: 'defensive', movementMode: 'formation' });
    updateGame(state, .1, idle);
    expect(state.time).toBeCloseTo(120.1);
    expect(state.gameOver).toBe(false);
    expect(getLeader(state)).toBe(leader);
    expect(respawnLeader(state).ok).toBe(false);
    expect(state.units.filter(candidate => candidate.kind === 'leader' && candidate.faction === 0)).toHaveLength(1);
  });

  it.each(['playing', 'victory', 'alive Leader', 'no palace', 'destroyed palace', 'unfinished palace', 'enemy palace'] as const)
  ('rejects %s without changing the realm', reason => {
    const state = fixture();
    if (reason === 'playing') state.gameOver = false;
    if (reason === 'victory') state.victory = true;
    if (reason === 'alive Leader') state.units[0].hp = 100;
    if (reason === 'no palace') entityStore(state).buildings.replace([]);
    if (reason === 'destroyed palace') state.buildings[0].hp = 0;
    if (reason === 'unfinished palace') state.buildings[0].construction = { startedAt: 0, duration: 45, waitingForBuilder: true };
    if (reason === 'enemy palace') state.buildings[0].faction = 1;
    const snapshot = structuredClone(state);
    expect(canRespawnLeader(state)).toBe(false);
    expect(respawnLeader(state).ok).toBe(false);
    expect(state).toEqual(snapshot);
  });

  it('uses another surviving palace when the first has no traversable entrance', () => {
    const state = fixture(), first = state.buildings[0];
    for (const point of constructionEdges(state, first)) state.world.tiles[Math.floor(point.y) * 32 + Math.floor(point.x)].terrain = 'river';
    expect(canRespawnLeader(state)).toBe(false);
    expect(respawnLeader(state).message).toContain('blocked');
    const other = building(2, 'palace', 15, 8); entityStore(state).buildings.add(other);
    const result = respawnLeader(state);
    expect(result.ok).toBe(true);
    expect(result.leader!.home).toBe(other.id);
    expect(Math.hypot(result.leader!.x - 16, result.leader!.y - 9)).toBeLessThanOrEqual(4);
  });

  it('respawns just outside crowded palace exits without overlapping their guards', () => {
    const state = fixture(), exits = constructionEdges(state, state.buildings[0]);
    entityStore(state).units.add(...exits.map((point, index) => unit(100 + index, 'warrior', point.x, point.y)));
    expect(canRespawnLeader(state)).toBe(true);
    const leader = respawnLeader(state).leader!;
    expect(exits).not.toContainEqual({ x: leader.x, y: leader.y });
    expect(Math.hypot(leader.x - 5, leader.y - 5)).toBeLessThanOrEqual(4);
    expect(state.units.every(other => other === leader || other.hp <= 0 || other.inside || Math.hypot(other.x - leader.x, other.y - leader.y) >= 1)).toBe(true);
  });

  it('chooses different safe tiles using the game RNG, without randomizing availability checks', () => {
    const positions = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const state = fixture(); state.rngState = seed;
      expect(canRespawnLeader(state)).toBe(true);
      expect(canRespawnLeader(state)).toBe(true);
      expect(state.rngState).toBe(seed);
      const leader = respawnLeader(state).leader!;
      expect(Math.hypot(leader.x - 5, leader.y - 5)).toBeLessThanOrEqual(4);
      positions.add(`${leader.x},${leader.y}`);
    }
    expect(positions.size).toBeGreaterThan(10);
  });

  it('never chooses a tile immediately beside an enemy, including diagonal neighbors', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = fixture(); state.rngState = seed;
      const enemies = [{ ...unit(100, 'warrior', 2.5, 3.5), faction: -2 },
        { ...unit(101, 'warrior', 7.5, 6.5), faction: -2 }];
      entityStore(state).units.add(...enemies);
      const leader = respawnLeader(state).leader!;
      expect(leader).toBeDefined();
      for (const enemy of enemies)
        expect(Math.max(Math.abs(Math.floor(leader.x) - Math.floor(enemy.x)), Math.abs(Math.floor(leader.y) - Math.floor(enemy.y)))).toBeGreaterThan(1);
    }
  });

  it('requires a safe neighborhood and falls back to another palace under siege', () => {
    const state = fixture();
    for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) {
      if (!canWalk(state, x + .5, y + .5, 0)) continue;
      entityStore(state).units.add({ ...unit(100 + y * 10 + x, 'warrior', x + .5, y + .5), faction: -2 });
    }
    expect(canRespawnLeader(state)).toBe(false);
    expect(respawnLeader(state).message).toContain('adjacent enemies');
    const second = building(2, 'palace', 15, 8); entityStore(state).buildings.add(second);
    expect(canRespawnLeader(state)).toBe(true);
    expect(respawnLeader(state).leader!.home).toBe(second.id);
  });

  it('cannot respawn through a sealed perimeter or outside a fully crowded palace neighborhood', () => {
    for (const sealed of [false, true]) {
      const state = fixture();
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
        const point = { x: x + .5, y: y + .5 };
        const gap = Math.hypot(Math.max(4 - point.x, 0, point.x - 6), Math.max(4 - point.y, 0, point.y - 6));
        if (gap > 3 || !canWalk(state, point.x, point.y, 0)) continue;
        if (sealed && (x === 2 || x === 7 || y === 2 || y === 7)) entityStore(state).buildings.add(building(200 + y * 10 + x, 'wall', x, y));
        else if (!sealed || x > 2 && x < 7 && y > 2 && y < 7) entityStore(state).units.add(unit(100 + y * 10 + x, 'warrior', point.x, point.y));
      }
      const before = structuredClone(state);
      expect(canRespawnLeader(state)).toBe(false);
      expect(respawnLeader(state).ok).toBe(false);
      expect(state).toEqual(before);
    }
  });

  it('never reuses a removed Leader ID still referenced by projectiles or orders', () => {
    const state = fixture();
    entityStore(state).units.replace(state.units.filter(candidate => candidate.kind !== 'leader'));
    state.units[0].target = 800;
    state.units[0].forcedAttack = { target: 700, previousTarget: 950 };
    state.selected = 960;
    state.projectiles = [{ x: 3.5, y: 4.5, start: { x: 3.5, y: 4.5 }, end: { x: 3.5, y: 4.5 },
      attacker: 1000, target: 900, faction: -2, damage: 500, elapsed: 0, duration: .1 }];
    const result = respawnLeader(state), leader = result.leader!;
    expect(result.ok).toBe(true); expect(leader.id).toBeGreaterThan(1000);
    expect(indexedUnit(state, leader.id)).toBe(leader);
    expect(indexedUnit(state, 13)).toBeUndefined();
    updateGame(state, .1, idle);
    expect(leader.hp).toBe(100);
    expect(state.projectiles).toEqual([]);
    entityStore(state).units.retain(unit => unit !== leader);
    expect(indexedUnit(state, leader.id)).toBeUndefined();
    expect(entityStore(state).units.query('leader')).not.toContain(leader);
  });
});
