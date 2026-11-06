import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { citySummaries } from '../src/game/cities';
import { canWalk } from '../src/game/pathfinding';
import { insideOwnBorders } from '../src/game/borders';
import { attackSpots } from '../src/game/engagement';
import { buildAt, cancelConstruction, commandAttackAt, updateGame } from '../src/game/simulation';
import { buildingSize, type Building, type GameState, type Unit } from '../src/game/types';
import { unlockBuildingResearch } from './helpers/research';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 2,
  speed: 0, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, kind, faction: 0, x, y, hp: 350, maxHp: 350, capacity: 0,
});
function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'guard-post-integration', source: 'test', spawns: [],
      tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ ...building(1, 'palace', 6, 10), populationGrowth: -10000, governorPermissions: { farms: false, housing: false } },
      building(2, 'guardPost', 10, 10)],
    units: [person(10, 'leader', 3.5, 18.5)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 10, yields: { food: 0, production: 0, gold: 0 },
      nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'guard-post-integration', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 },
  };
}
const garrison = (state: GameState) => state.units.filter(unit => unit.kind === 'militia');

describe('guard posts in the game simulation', () => {
  it('advances from the post when allies occupy every melee slot around a reachable enemy', () => {
    const state = fixture(), enemy = person(20, 'warrior', 15.5, 10.5, -2);
    enemy.hp = enemy.maxHp = 1000;
    entityStore(state).units.add(enemy);
    let id = 21;
    for (let y = 9; y <= 11; y++) for (let x = 14; x <= 16; x++) if (x !== 15 || y !== 10)
      entityStore(state).units.add({ ...person(id++, 'warrior', x + .5, y + .5), retinueStance: 'hold' });
    entityStore(state).buildings.add(building(40, 'house', 16, 8));
    updateGame(state, .1, idle);
    const guards = garrison(state);
    expect(attackSpots(state, guards[0], enemy, () => true)).toEqual([]);
    for (let step = 0; step < 50; step++) updateGame(state, .1, idle);
    expect(guards.some(unit => unit.x > 12.5)).toBe(true);
    expect(state.units.filter(unit => unit.id >= 21 && unit.id < id).every(unit => unit.order === 'hold')).toBe(true);
  });

  it('deploys with autonomous orders rather than the retinue Hold command', () => {
    const state = fixture(), enemy = person(20, 'warrior', 12.5, 10.5, -2);
    enemy.hp = enemy.maxHp = 1000; entityStore(state).units.add(enemy);
    updateGame(state, 2, idle);
    expect(garrison(state).every(unit => !unit.inside)).toBe(true);
    expect(garrison(state).every(unit => unit.order !== 'hold' && unit.retinueStance === undefined)).toBe(true);
    expect(enemy.hp).toBeLessThan(1000);
  });

  it('returns instead of freezing outside forever when the remaining intruder becomes unreachable', () => {
    const state = fixture(), enemy = person(20, 'warrior', 12.5, 10.5, -2);
    enemy.hp = enemy.maxHp = 1000; entityStore(state).units.add(enemy);
    updateGame(state, 2, idle);
    expect(garrison(state).some(unit => !unit.inside)).toBe(true);
    Object.assign(enemy, { x: 10.5, y: 14.5 });
    for (let y = 13; y <= 15; y++) for (let x = 9; x <= 11; x++)
      if (x !== 10 || y !== 14) state.world.tiles[y * state.world.width + x].terrain = 'river';
    state.world.revision = (state.world.revision ?? 0) + 1;
    expect(insideOwnBorders(state, 0, enemy.x, enemy.y)).toBe(true);
    for (let step = 0; step < 180; step++) updateGame(state, .1, idle);
    expect(garrison(state).every(unit => unit.inside)).toBe(true);
    expect(enemy.hp).toBeGreaterThan(0);
  });

  it('pursues an engaged enemy beyond the border, then returns after it leaves the pursuit range', () => {
    const state = fixture(), enemy = person(20, 'warrior', 12.5, 10.5, -2);
    enemy.hp = enemy.maxHp = 10000; entityStore(state).units.add(enemy);
    updateGame(state, 2, idle);
    const guards = garrison(state), farthest = Math.max(...guards.map(unit => unit.x));
    enemy.x = 20.5;
    expect(insideOwnBorders(state, 0, enemy.x, enemy.y)).toBe(false);
    for (let step = 0; step < 60; step++) updateGame(state, .1, idle);
    expect(guards.some(unit => unit.x > farthest + 4 && unit.target === enemy.id)).toBe(true);
    enemy.x = 31.5;
    for (let step = 0; step < 220; step++) updateGame(state, .1, idle);
    expect(guards.every(unit => unit.inside && unit.target === undefined)).toBe(true);
  });

  it('orders a 1×1 post for 200 gold and keeps it inactive until its builder finishes', () => {
    const state = fixture(); entityStore(state).buildings.replace(state.buildings.slice(0, -1));
    unlockBuildingResearch(state.factions[0]);
    state.units[0].x = 10.5; state.units[0].y = 14.5;
    state.factions[0].population = 4; state.factions[0].gold = 199;
    expect(buildAt(state, 'guardPost', 10, 10)).toMatchObject({ ok: false, message: 'Need 200 gold.' });
    state.factions[0].gold = 200;
    expect(buildAt(state, 'guardPost', 10, 10).ok).toBe(true);
    const post = state.buildings.find(candidate => candidate.kind === 'guardPost')!;
    expect(buildingSize(post)).toBe(1);
    expect(state.factions[0].gold).toBe(0);
    expect(post.construction).toMatchObject({ paidGold: 200, waitingForBuilder: true });
    entityStore(state).units.add(person(20, 'warrior', 12.5, 10.5, -2));
    updateGame(state, .1, idle);
    expect(garrison(state)).toHaveLength(0);
    expect(post.guardPost).toBeUndefined();
    expect(cancelConstruction(state, post.id)).toMatchObject({ ok: true, refund: 200 });
    expect(state.factions[0].gold).toBe(200);
  });

  it('dispatches, lands real melee hits, and returns the surviving militia to the post', () => {
    const state = fixture(), enemy = person(20, 'warrior', 12.5, 10.5, -2);
    entityStore(state).units.add(enemy);
    updateGame(state, 2, idle);
    expect(garrison(state)).toHaveLength(3);
    expect(garrison(state).some(unit => !unit.inside)).toBe(true);
    expect(enemy.hp).toBeLessThan(100);
    const guards = [...garrison(state)];
    for (let step = 0; step < 200 && (enemy.hp > 0 || guards.some(unit => !unit.inside)); step++)
      updateGame(state, .1, idle);
    expect(enemy.hp).toBe(0);
    expect(state.units).not.toContain(enemy);
    expect(guards.every(unit => unit.inside && !unit.moving)).toBe(true);
    expect(garrison(state)).toEqual(guards);
    expect(state.factions[0].population).toBe(10);
    expect(canWalk(state, 10.5, 10.5, 0)).toBe(false);
  });

  it('calls guards home once an enemy leaves pursuit range and leaves retinue attack commands separate', () => {
    const state = fixture(), enemy = person(20, 'warrior', 12.5, 10.5, -2);
    enemy.hp = enemy.maxHp = 1000;
    entityStore(state).units.add(enemy); updateGame(state, 2, idle);
    expect(commandAttackAt(state, enemy.x, enemy.y)).toBe(true);
    expect(garrison(state).every(unit => unit.forcedAttack === undefined)).toBe(true);
    enemy.x = 31.5;
    for (let step = 0; step < 120 && garrison(state).some(unit => !unit.inside); step++) updateGame(state, .1, idle);
    expect(garrison(state).every(unit => unit.inside)).toBe(true);
    expect(garrison(state).every(unit => unit.target === undefined)).toBe(true);
  });

  it('defends against a reachable enemy when a closer enemy is isolated across water', () => {
    const state = fixture(), isolated = person(20, 'warrior', 12.5, 10.5, -2), reachable = person(21, 'warrior', 10.5, 14.5, -2);
    for (let y = 9; y <= 11; y++) for (let x = 11; x <= 13; x++)
      if (x !== 12 || y !== 10) state.world.tiles[y * state.world.width + x].terrain = 'river';
    entityStore(state).units.add(isolated, reachable);
    updateGame(state, 5, idle);
    expect(isolated.hp).toBe(100);
    expect(reachable.hp).toBeLessThan(100);
  });

  it('charges exactly 15 gold each 30 seconds with no extra warrior upkeep for the three guards', () => {
    const state = fixture(); updateGame(state, .1, idle);
    expect(garrison(state)).toHaveLength(3);
    expect(garrison(state).every(unit => unit.inside)).toBe(true);
    expect(citySummaries(state)[0].gold).toBe(-8);
    expect(state.factions[0].yields.gold).toBe(-8);
    updateGame(state, 29.8, idle);
    expect(state.factions[0].gold).toBe(500);
    updateGame(state, .2, idle);
    expect(state.factions[0].gold).toBe(492);
    expect(state.factions[0].yields.gold).toBe(-8);
    updateGame(state, 30, idle);
    expect(state.factions[0].gold).toBe(484);
    expect(garrison(state)).toHaveLength(3);
  });

  it('removes the displayed upkeep at the next maintenance sample when the post loses its city territory', () => {
    const state = fixture(); updateGame(state, .1, idle);
    expect(state.factions[0].yields.gold).toBe(-8);
    state.buildings[0].x = 25;
    state.world.revision = (state.world.revision ?? 0) + 1;
    updateGame(state, .4, idle);
    expect(garrison(state)).toHaveLength(0);
    expect(citySummaries(state)[0].gold).toBe(7);
    expect(state.factions[0].yields.gold).toBe(7);
    expect(state.factions[0].gold).toBe(500);
  });

  it('removes the garrison after its post is destroyed without reducing civilian population', () => {
    const state = fixture(); updateGame(state, .1, idle);
    expect(garrison(state)).toHaveLength(3);
    state.buildings[1].hp = 0; updateGame(state, .4, idle);
    expect(garrison(state)).toHaveLength(0);
    expect(state.factions[0].population).toBe(10);
    expect(state.factions[0].gold).toBe(500);
  });
});
