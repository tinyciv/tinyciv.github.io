import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { commandAttackAt, updateGame } from '../src/game/simulation';
import { updateFog } from '../src/game/fog';
import { canWalk, hasStaticPath } from '../src/game/pathfinding';
import { type Building, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, faction: number, x: number, y: number): Unit => ({ id, kind: 'warrior', faction, x, y,
  hp: 1000, maxHp: 1000, morale: 100, attack: 30, defense: 0, speed: 2.35, range: 1.1,
  order: 'follow', retinueStance: 'aggressive', cooldown: 0, lastCombat: -100, moving: false, facing: 0, attackTime: 0 });
const building = (id: number, kind: Building['kind'], faction: number, x: number, y: number): Building => ({ id, kind, faction, x, y,
  hp: kind === 'wall' ? 40 : 10000, maxHp: kind === 'wall' ? 40 : 10000,
  // Small authored walls keep these navigation scenarios brief after the stone multiplier.
  defenseBaseMaxHp: kind === 'wall' ? 4 : undefined, capacity: 0, armor: 0 });
function fixture(raid = false) {
  const owner = raid ? 0 : 1, attacker = unit(10, raid ? -2 : 0, 9.5, 10.5), house = building(100, 'house', owner, 14, 10);
  const leader = { ...unit(1, 0, 3.5, 20.5), kind: 'leader' as const, speed: 0, attack: 0, order: 'hold' as const };
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'siege-priority', source: 'test', revision: 1, spawns: [],
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    units: [leader, attacker], buildings: [building(2, 'palace', 0, 2, 2), building(3, 'palace', 1, 28, 2), house],
    factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#fff', affinity: 0, relation: id ? 'war' : 'self',
      food: 0, gold: 0, production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false })),
    time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false, selected: null, selectedType: null,
    buildMode: null, diplomacy: null, events: [], particles: [], projectiles: [], fields: [], marauderPacks: [], raiderCamps: [],
    roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 }, seed: 'siege-priority', rngState: 1,
  };
  if (raid) {
    Object.assign(attacker, { marauderPack: 900, order: 'raid' });
    state.marauderPacks!.push({ id: 900, name: 'Raid', color: '#000', raid: true, targetFaction: owner, targetBuilding: house.id,
      home: { x: attacker.x, y: attacker.y }, waypoint: { x: house.x + .5, y: house.y + .5 }, nextWanderAt: Infinity });
  }
  return { state, attacker, house };
}
function ring(state: GameState, owner: number, opening?: 'gap' | 'gate'): Building[] {
  const walls: Building[] = [];
  for (let y = 7; y <= 13; y++) for (let x = 11; x <= 17; x++) {
    if (x !== 11 && x !== 17 && y !== 7 && y !== 13 || opening === 'gap' && x === 14 && y === 13) continue;
    walls.push(building(200 + y * 32 + x, 'wall', owner, x, y));
  }
  entityStore(state).buildings.add(...walls);
  if (opening === 'gate') entityStore(state).buildings.add(building(800, 'road', owner, 14, 13));
  return walls;
}
function advanceUntil(state: GameState, predicate: () => boolean, seconds = 30): void {
  for (let time = 0; time < seconds && !predicate(); time += .1) updateGame(state, .1, idle);
  expect(predicate()).toBe(true);
}

describe('city assault priorities', () => {
  it.each([false, true])('routes %s raiders through an existing breach to the house, leaving every wall intact', raid => {
    const { state, attacker, house } = fixture(raid), walls = ring(state, house.faction, 'gap');
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(house.id);
    advanceUntil(state, () => house.hp < house.maxHp);
    expect(attacker.x).toBeGreaterThan(11); expect(attacker.y).toBeLessThan(13);
    expect(walls.every(wall => wall.hp === wall.maxHp)).toBe(true);
  });

  it('uses an owned gate to reach a hostile watchtower inside friendly fortifications', () => {
    const { state, attacker, house: tower } = fixture(), walls = ring(state, 0, 'gate');
    tower.kind = 'woodenTower'; tower.attackCooldown = Infinity;
    // A surviving friendly building keeps these fortifications owned despite
    // the hostile tower inside. Defensive towers cannot be annexed by borders.
    entityStore(state).buildings.add(building(801, 'well', 0, 14, 8));
    expect(canWalk(state, 14.5, 13.5, 0)).toBe(true);
    advanceUntil(state, () => tower.hp < tower.maxHp);
    expect(attacker.x).toBeGreaterThan(11);
    expect(walls.every(wall => wall.faction === 0)).toBe(true);
    expect(walls.every(wall => wall.hp === wall.maxHp)).toBe(true);
  });

  it.each([false, true])('makes one breach in a sealed city then enters, without clearing adjacent walls (raider=%s)', raid => {
    const { state, attacker, house } = fixture(raid), walls = ring(state, house.faction, 'gate');
    expect(canWalk(state, 14.5, 13.5, attacker.faction)).toBe(false);
    advanceUntil(state, () => house.hp < house.maxHp);
    expect(walls.filter(wall => wall.hp <= 0)).toHaveLength(1);
    expect(walls.filter(wall => wall.hp < wall.maxHp)).toHaveLength(1);
    expect(attacker.x).toBeGreaterThan(11);
    for (let i = 0; i < 40; i++) updateGame(state, .1, idle);
    expect(walls.filter(wall => wall.hp < wall.maxHp)).toHaveLength(1);
  });

  it('waits behind a friendly traffic jam instead of destroying a wall beside the open route', () => {
    const { state, attacker, house } = fixture(), walls = ring(state, house.faction, 'gap');
    const blocker = { ...unit(11, 0, 14.5, 13.5), speed: 0, attack: 0, retinueStance: 'hold' as const, order: 'hold' as const };
    entityStore(state).units.add(blocker);
    for (let i = 0; i < 100; i++) updateGame(state, .1, idle);
    expect(house.hp).toBe(house.maxHp); expect(walls.every(wall => wall.hp === wall.maxHp)).toBe(true);
    entityStore(state).units.replace(state.units.filter(other => other !== blocker));
    advanceUntil(state, () => house.hp < house.maxHp);
    expect(walls.every(wall => wall.hp === wall.maxHp)).toBe(true);
  });

  it('prefers an accessible building over a nearer inaccessible building and perimeter wall', () => {
    const { state, attacker, house } = fixture();
    const accessible = building(101, 'well', 1, 9, 7);
    entityStore(state).buildings.add(accessible, building(102, 'wall', 1, 10, 10));
    for (let y = 0; y < 24; y++) state.world.tiles[y * 32 + 12].terrain = 'lake';
    state.world.revision!++;
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(accessible.id); expect(house.hp).toBe(house.maxHp);
  });

  it('prioritizes a reachable enemy unit over nearby wall and building targets', () => {
    const { state, attacker } = fixture();
    const enemy = { ...unit(12, 1, 12.5, 11.5), speed: 0, attack: 0, order: 'hold' as const };
    entityStore(state).units.add(enemy); entityStore(state).buildings.add(building(102, 'wall', 1, 10, 10));
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(enemy.id);
  });

  it('honors an explicit wall attack even when a house can be reached through a breach', () => {
    const { state, attacker, house } = fixture(), walls = ring(state, house.faction, 'gap');
    const selected = walls.find(wall => wall.x === 11 && wall.y === 10)!;
    selected.hp = selected.maxHp = 10000; selected.defenseBaseMaxHp = 1000;
    updateFog(state);
    expect(commandAttackAt(state, selected.x + .5, selected.y + .5)).toBe(true);
    expect(attacker.forcedAttack?.target).toBe(selected.id);
    advanceUntil(state, () => selected.hp < selected.maxHp);
    expect(house.hp).toBe(house.maxHp); expect(attacker.target).toBe(selected.id);
  });

  it.each(['hold', 'defensive'] as const)('keeps a %s warrior at its post beside a quiet enemy house', stance => {
    const { state, attacker, house } = fixture(), walls = ring(state, house.faction);
    house.x = 12; house.y = 8;
    walls.find(wall => wall.x === 11 && wall.y === 8)!.hp = 0;
    Object.assign(attacker, { x: 11.5, y: 8.5, order: stance === 'hold' ? 'hold' : 'follow', retinueStance: stance });
    if (stance === 'defensive') attacker.defensiveAnchor = { x: attacker.x, y: attacker.y };
    updateGame(state, .1, idle);
    if (stance === 'hold') expect(house.hp).toBeLessThan(house.maxHp);
    else expect(house.hp).toBe(house.maxHp); // Defensive stance retaliates; the house has not attacked anyone.
    expect(attacker.x).toBeCloseTo(11.5); expect(attacker.y).toBeCloseTo(8.5);
  });

  it('funnels a dense raiding group through the breach instead of clearing the perimeter', () => {
    const { state, attacker, house } = fixture(true), walls = ring(state, house.faction, 'gate');
    state.buildings.find(target => target.id === 2)!.x = 2; state.buildings.find(target => target.id === 2)!.y = 20;
    for (let i = 1; i < 16; i++) entityStore(state).units.add({ ...unit(20 + i, -2, 6.5 + i % 3, 6.5 + Math.floor(i / 3)),
      marauderPack: attacker.marauderPack, order: 'raid' });
    for (const [x, y] of [[12, 8], [15, 8], [15, 12]]) entityStore(state).buildings.add(building(900 + x + y * 32, 'house', 0, x, y));
    const starts = new Map(state.units.filter(member => member.marauderPack).map(member => [member.id, { x: member.x, y: member.y }]));
    for (let i = 0; i < 200; i++) updateGame(state, .1, idle);
    const raiders = state.units.filter(member => starts.has(member.id));
    expect(state.buildings.filter(target => target.kind === 'house').some(target => target.hp < target.maxHp)).toBe(true);
    expect(raiders.filter(member => member.x > 11 && member.x < 17 && member.y > 7 && member.y < 13).length).toBeGreaterThanOrEqual(6);
    expect(walls.filter(wall => wall.hp <= 0).length).toBeLessThanOrEqual(3);
    expect(walls.filter(wall => wall.hp === wall.maxHp).length).toBeGreaterThanOrEqual(walls.length - 4);
  });

  it('rechecks static connectivity immediately when a hostile gate is breached', () => {
    const { state, attacker, house } = fixture(), walls = ring(state, house.faction, 'gate');
    const inside = { x: 12.5, y: 10.5 };
    expect(hasStaticPath(state, attacker, inside, attacker.faction)).toBe(false);
    walls.find(wall => wall.x === 14 && wall.y === 13)!.hp = 0;
    expect(hasStaticPath(state, attacker, inside, attacker.faction)).toBe(true);
  });
});
