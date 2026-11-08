import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { MARAUDER_FACTION, updateGame } from '../src/game/simulation';
import { distance, type Building, type GameState, type MarauderPack, type Unit } from '../src/game/types';
import { entityVisible } from '../src/game/fog';
import { initializeFogRaids } from '../src/game/fog-raids';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, morale: 100, attack: 0, defense: 4,
  speed: 0, range: kind === 'leader' ? 4 : 1.1, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, kind, faction: 0, x, y, hp: kind === 'palace' ? 650 : 160,
  maxHp: kind === 'palace' ? 650 : 160, capacity: 0, armor: 2,
});
function fixture(width = 48, height = 32): GameState {
  return {
    world: { width, height, seed: 'raid-combat', source: 'test', spawns: [],
      tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 2, production: 1, gold: 0, variation: .5 })) },
    units: [unit(10, 'leader', 2.5, 28.5)], buildings: [building(1, 'palace', 4, 4)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self',
      food: 0, gold: 0, production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], projectiles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false,
    victory: false, seed: 'raid-combat', rngState: 1, fields: [], marauderPacks: [],
    fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, enemyPressureVersion: 1,
  };
}
function scheduledCampFixture(): GameState {
  // Camp anchors must be at least 21 tiles from a settlement and 12 tiles
  // inside the map edge. The small tactical fixture has no such location.
  const state = fixture(80, 72), palace = state.buildings[0];
  palace.x = 39; palace.y = 35; palace.hp = palace.maxHp = 10000;
  state.units[0].x = 2.5; state.units[0].y = 68.5;
  // Test unopposed camp-to-settlement travel. Replacement escorts walking to
  // the distant stationary Leader would intercept the raid along this route.
  state.factions[0].nextRetinueAt = Infinity;
  initializeFogRaids(state);
  expect(state.raiderCamps!.length, 'the real camp planner must place a reachable war camp').toBeGreaterThan(0);
  expect(state.fogRaids!.nextAt).toBe(60);
  return state;
}
function addRaid(state: GameState, target: Building, x: number, y: number): { attacker: Unit; pack: MarauderPack } {
  const attacker = unit(100, 'warrior', x, y, MARAUDER_FACTION);
  Object.assign(attacker, { marauderPack: 999, attack: 24, speed: 2.35, order: 'raid' });
  const pack: MarauderPack = { id: 999, name: 'Scythians', color: '#e87535', targetFaction: 0,
    home: { x, y }, waypoint: { x: target.x + .5, y: target.y + .5 }, nextWanderAt: 0,
    raid: true, targetBuilding: target.id, spawnedAt: 0, retinueAtSpawn: 2 };
  entityStore(state).units.add(attacker); state.marauderPacks!.push(pack);
  return { attacker, pack };
}
function advance(state: GameState, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1) updateGame(state, Math.min(1, seconds - elapsed), idle);
}

describe('persistent fog raid combat', () => {
  it('starts with two early raiders after a minute and reaches buildings before the second minute ends', () => {
    const state = scheduledCampFixture(), palace = state.buildings[0];
    advance(state, 59);
    expect(state.marauderPacks).toEqual([]);
    let firstDamageAt = Infinity, openingSize = 0;
    for (let elapsed = 59; elapsed < 120; elapsed++) {
      updateGame(state, 1, idle);
      if (!openingSize && state.fogRaids!.waves) openingSize = state.units.filter(unit => unit.faction === -2).length;
      if (palace.hp < palace.maxHp) firstDamageAt = Math.min(firstDamageAt, state.time);
    }
    expect(firstDamageAt).toBeGreaterThan(60);
    expect(firstDamageAt).toBeLessThan(120);
    expect(state.fogRaids!.waves).toBeGreaterThanOrEqual(1);
    const opening = state.marauderPacks!.find(pack => pack.raid)!;
    expect(opening.raiderCamp).toBeDefined();
    expect(openingSize).toBe(2); // The four-unit baseline reduced by 40%, rounded to whole units.
  }, 15000);

  it('spawns a due wave beyond sight and carries its assault through to building damage', () => {
    const state = scheduledCampFixture(), palace = state.buildings[0];
    state.time = state.fogRaids!.nextAt;
    updateGame(state, .1, idle);
    const packs = state.marauderPacks!.filter(pack => pack.raid);
    const attackers = state.units.filter(attacker => attacker.marauderPack !== undefined);
    expect(state.fogRaids!.waves).toBe(1);
    expect(packs).toHaveLength(1);
    expect(packs[0].targetBuilding).toBe(palace.id);
    expect(attackers.length).toBeGreaterThan(0);
    expect(attackers.every(attacker => !entityVisible(state, attacker))).toBe(true);
    advance(state, 40);
    expect(palace.hp).toBeLessThan(palace.maxHp);
    expect(attackers.some(attacker => attacker.lastCombat > 0)).toBe(true);
    expect(state.gameOver).toBe(false);
  });

  it('assaults another settled faction and fights defenders from either realm', () => {
    const state = fixture(), target = { ...building(2, 'house', 20, 10), faction: 1 };
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace', name: 'Neighbor' });
    entityStore(state).buildings.add(target);
    const { attacker, pack } = addRaid(state, target, 19.5, 10.5); pack.targetFaction = 1;
    // An unseen party receives one staggered AI update per five steps.
    updateGame(state, .5, idle);
    expect(attacker.target).toBe(target.id); expect(target.hp).toBeLessThan(target.maxHp);
    const defender = unit(200, 'warrior', 18.5, 10.5, 1); entityStore(state).units.add(defender);
    for (let i = 0; i < 10 && attacker.target !== defender.id; i++) updateGame(state, .1, idle);
    expect(attacker.target).toBe(defender.id);
    defender.faction = 0;
    for (let i = 0; i < 10 && attacker.target !== defender.id; i++) updateGame(state, .1, idle);
    expect(attacker.target).toBe(defender.id);
  });

  it('continues a long building assault after the old 45-second wander deadline', () => {
    const state = fixture(), target = building(2, 'house', 10, 10);
    entityStore(state).buildings.add(target);
    const { attacker, pack } = addRaid(state, target, 45.5, 10.5);
    attacker.speed = .15; pack.nextWanderAt = 45;
    const startDistance = distance(attacker, target);
    advance(state, 46);
    const afterDeadline = distance(attacker, target);
    advance(state, 6);
    expect(pack.targetBuilding).toBe(target.id);
    expect(attacker.target).toBe(target.id);
    expect(afterDeadline).toBeLessThan(startDistance - 5);
    expect(distance(attacker, target)).toBeLessThan(afterDeadline - .5);
    expect(target.hp).toBe(target.maxHp);
    expect(state.gameOver).toBe(false);
  });

  it('destroys an outer house and continues to the next player building', () => {
    const state = fixture(), first = building(2, 'house', 20, 10), second = building(3, 'house', 27, 10);
    first.hp = 10; entityStore(state).buildings.add(first, second);
    const { attacker, pack } = addRaid(state, first, 19.5, 10.5);
    updateGame(state, .1, idle);
    expect(first.hp).toBe(0);
    expect(state.buildings.some(b => b.id === first.id)).toBe(false);
    // Destroying its only nearby sight source puts this party back in fog.
    for (let i = 0; i < 10 && attacker.target !== second.id; i++) updateGame(state, .1, idle);
    expect(pack.targetBuilding).toBe(second.id);
    expect(attacker.target).toBe(second.id);
    advance(state, 5);
    expect(second.hp).toBeLessThan(second.maxHp);
  });

  it.each(['destroyed', 'captured'] as const)('retargets a %s objective to a reachable building, ignoring routes, walls and isolated houses', condition => {
    const state = fixture(), old = building(2, 'house', 14, 9), isolated = building(3, 'house', 20, 10), reachable = building(4, 'house', 24, 10);
    state.buildings[0].y = 25;
    entityStore(state).buildings.add(old, isolated, reachable, building(5, 'road', 15, 10), building(6, 'bridge', 15, 11), building(7, 'wall', 16, 10), building(8, 'ruin', 16, 11));
    for (let y = 9; y <= 11; y++) for (let x = 19; x <= 21; x++) {
      if (x !== 20 || y !== 10) state.world.tiles[y * state.world.width + x].terrain = 'lake';
    }
    const { pack } = addRaid(state, old, 14.5, 10.5);
    if (condition === 'destroyed') old.hp = 0;
    else old.faction = 1;
    updateGame(state, .1, idle);
    expect(pack.targetBuilding).toBe(reachable.id);
  });

  it('prefers nearby military defenders over a closer worker or building, with no fixation on the leader', () => {
    const state = fixture(), house = building(2, 'house', 20, 9);
    entityStore(state).buildings.add(house);
    const { attacker } = addRaid(state, house, 20.5, 10.5);
    attacker.speed = 0; attacker.attack = 0;
    const leader = state.units[0], warrior = unit(11, 'warrior', 22.5, 10.5), worker = unit(12, 'worker', 21.5, 10.5);
    leader.x = 24.5; leader.y = 10.5; attacker.target = leader.id;
    entityStore(state).units.add(warrior, worker);
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(warrior.id);
    leader.x = 21.5; leader.y = 11.5;
    updateGame(state, .7, idle);
    expect(attacker.target).toBe(leader.id);
  });

  it('breaches a closed wall perimeter before damaging the palace behind it', () => {
    const state = fixture(), palace = state.buildings[0];
    const { attacker } = addRaid(state, palace, 11.5, 4.5);
    let id = 200;
    for (let y = 2; y <= 7; y++) for (let x = 2; x <= 7; x++) {
      if (x !== 2 && x !== 7 && y !== 2 && y !== 7) continue;
      entityStore(state).buildings.add({ ...building(id++, 'wall', x, y), hp: 40, maxHp: 450, defenseBaseMaxHp: 45, armor: 4 });
    }
    // Deliberately damaged 450HP fixtures isolate breach navigation from wall balance.
    const wallCount = state.buildings.filter(b => b.kind === 'wall').length;
    advance(state, 1);
    expect(palace.hp).toBe(palace.maxHp);
    advance(state, 23);
    expect(state.buildings.filter(b => b.kind === 'wall').length).toBeLessThan(wallCount);
    expect(palace.hp).toBeLessThan(palace.maxHp);
    expect(state.buildings.some(b => b.kind === 'wall' && Math.floor(attacker.x) === b.x && Math.floor(attacker.y) === b.y)).toBe(false);
  });
});
