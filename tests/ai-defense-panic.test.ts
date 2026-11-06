import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { panicCivilian, updateCivilianPanic } from '../src/game/civilian-panic';
import { updateFactionDefenses, type DefenseKind } from '../src/game/faction-defense';
import { getFactionStrategy } from '../src/game/faction-strategy';
import { selectRaidTarget } from '../src/game/raid-targeting';
import { canWalk, hasStaticPath, invalidateNavigation } from '../src/game/pathfinding';
import { constructionEdges } from '../src/game/builders';
import { invalidateDecisions } from '../src/game/decision-schedule';
import { civilianThreat } from '../src/game/morale-perception';
import { atWar, buildAt, moveUnit, updateGame, validateBuildAt } from '../src/game/simulation';
import { distance, type Building, type Faction, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const faction = (id: number): Faction => ({ id, name: `Realm ${id}`, color: '#fff', affinity: 50, relation: id === 0 ? 'self' : 'peace',
  food: 500, gold: 500, production: 0, population: 5, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false });
const unit = (id: number, kind: Unit['kind'], faction: number, x: number, y: number): Unit => ({ id, kind, faction, x, y,
  hp: 100, maxHp: 100, attack: kind === 'worker' ? 0 : 15, defense: 0, morale: 100, speed: 2.2, range: kind === 'leader' ? 4 : 1.1,
  order: kind === 'worker' ? 'work' : 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
const building = (id: number, kind: Building['kind'], faction: number, x: number, y: number): Building => ({ id, kind, faction, x, y,
  hp: 650, maxHp: 650, armor: 2, capacity: kind === 'house' ? 4 : 0 });
function fixture(): GameState {
  return { world: { width: 48, height: 32, seed: 'ai-behavior', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    units: [unit(1, 'leader', 0, 4.5, 8.5), unit(2, 'leader', 1, 29.5, 20.5)],
    buildings: [building(100, 'palace', 0, 4, 4), building(101, 'palace', 1, 28, 16)],
    factions: [faction(0), faction(1)], time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false,
    events: [], particles: [], projectiles: [], fields: [], marauderPacks: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, seed: 'ai-behavior', rngState: 1 };
}

describe('civilian fear', () => {
  const hostility = (a: number, b: number) => a !== b;
  const visible = () => true;
  function sealedCity(kind: 'worker' | 'merchant', wallKind: 'wall' | 'palisade' = 'wall') {
    const state = fixture(), civilian = unit(10, kind, 0, 15.5, 12.5), enemy = unit(11, 'warrior', -2, 17.5, 12.5);
    civilian.attack = 0; enemy.range = 7;
    entityStore(state).units.add(civilian, enemy);
    let id = 500;
    for (let y = 9; y <= 15; y++) for (let x = 10; x <= 16; x++)
      if (y === 9 || y === 15 || x === 10 || x === 16) entityStore(state).buildings.add(building(id++, wallKind, 0, x, y));
    return { state, civilian, enemy, gate: state.buildings.find(b => b.x === 16 && b.y === 12)! };
  }

  it.each(['worker', 'merchant'] as const)('keeps a %s working just beyond two tiles, but panics at the boundary', kind => {
    const state = fixture(), civilian = unit(10, kind, 0, 10.5, 12.5), enemy = unit(11, 'warrior', -2, 12.51, 12.5);
    civilian.attack = 0; entityStore(state).units.add(civilian, enemy);
    const previousOrder = civilian.order;
    expect(updateCivilianPanic(state, civilian, .05, () => {}, hostility, visible)).toBe(false);
    expect(civilian.order).toBe(previousOrder); expect(civilian.morale).toBe(100);
    enemy.x = 12.5; state.time = .7; // Let the ordinary quiet perception cadence sample the moved enemy.
    expect(updateCivilianPanic(state, civilian, .05, () => {}, hostility, visible)).toBe(true);
    expect(civilian.order).toBe('flee'); expect(civilian.morale).toBe(0);
    expect(civilian.civilianPanic!.until).toBeCloseTo(state.time + 3);
  });

  it('keeps a frightened civilian routed during ongoing danger, then uses a two-second quiet period plus ordinary morale recovery', () => {
    const state = fixture(), civilian = unit(10, 'worker', 0, 10.5, 12.5), enemy = unit(11, 'warrior', -2, 12.5, 12.5);
    // With no reachable shelter, recovery can be observed independently of travel time.
    entityStore(state).buildings.replace([]); entityStore(state).units.add(civilian, enemy);
    const stepTo = (seconds: number) => {
      for (let tick = Math.round(state.time * 20) + 1; tick <= Math.round(seconds * 20); tick++) {
        state.time = tick / 20;
        updateCivilianPanic(state, civilian, .05, () => {}, hostility, visible);
      }
    };
    expect(updateCivilianPanic(state, civilian, .05, () => {}, hostility, visible)).toBe(true);
    expect(civilian.civilianPanic!.until).toBe(3);
    stepTo(5);
    expect(civilian.order).toBe('flee'); expect(civilian.morale).toBe(0);
    expect(civilian.civilianPanic!.until).toBe(7);
    enemy.hp = 0; stepTo(6.95);
    expect(civilian.order).toBe('flee'); expect(civilian.morale).toBe(0);
    expect(civilian.civilianPanic!.until).toBe(7);
    stepTo(8);
    expect(civilian.order).toBe('flee'); expect(civilian.morale).toBeCloseTo(15.75);
    stepTo(10.25);
    expect(civilian.order).toBe('flee'); expect(civilian.morale).toBeLessThan(50);
    stepTo(10.35);
    expect(civilian.order).toBe('work'); expect(civilian.civilianPanic).toBeUndefined();
    expect(civilian.morale).toBeGreaterThanOrEqual(50);
  });

  it.each(['worker', 'merchant'] as const)('keeps a %s calm behind solid walls and friendly gates, then senses a breach on the next scheduled sample', kind => {
    const { state, civilian, gate } = sealedCity(kind, 'palisade');
    expect(updateCivilianPanic(state, civilian, .1, moveUnit, hostility, visible)).toBe(false);
    entityStore(state).buildings.add(building(900, 'road', 0, gate.x, gate.y));
    expect(updateCivilianPanic(state, civilian, .1, moveUnit, hostility, visible)).toBe(false);
    gate.hp = 0; invalidateNavigation(state); invalidateDecisions(state); state.time += .7;
    expect(updateCivilianPanic(state, civilian, .1, moveUnit, hostility, visible)).toBe(true);
    expect(civilian.order).toBe('flee'); expect(civilian.morale).toBe(0);
  });

  it('uses enemy ownership for gates rather than the civilian’s walkable route', () => {
    const { state, civilian, gate } = sealedCity('worker');
    entityStore(state).buildings.add(building(900, 'road', 0, gate.x, gate.y));
    expect(civilianThreat(state, civilian, hostility, visible)).toBeUndefined();
    gate.faction = -2; invalidateNavigation(state); invalidateDecisions(state); state.time += .7;
    expect(civilianThreat(state, civilian, hostility, visible)?.id).toBe(11);
  });

  it.each(['lake', 'ledge'] as const)('does not fear a nearby ranged marauder across impassable %s terrain', barrier => {
    const { state, civilian } = sealedCity('worker');
    for (const wall of state.buildings.filter(b => b.kind === 'wall')) {
      wall.hp = 0;
      const tile = state.world.tiles[wall.y * state.world.width + wall.x];
      if (barrier === 'lake') tile.terrain = 'lake';
    }
    if (barrier === 'ledge') for (let y = 9; y <= 15; y++) for (let x = 10; x <= 16; x++)
      state.world.tiles[y * state.world.width + x].ridge = 1;
    state.world.revision!++;
    expect(updateCivilianPanic(state, civilian, .1, moveUnit, hostility, visible)).toBe(false);
    if (barrier === 'lake') entityStore(state).buildings.add(building(900, 'bridge', 0, 16, 12));
    else {
      state.world.tiles[12 * state.world.width + 16].stair = 'east'; state.world.revision!++;
      expect(civilianThreat(state, civilian, hostility, visible)).toBeUndefined();
      state.world.tiles[12 * state.world.width + 16].stair = 'west'; state.world.revision!++;
    }
    invalidateNavigation(state); invalidateDecisions(state); state.time += .7;
    expect(updateCivilianPanic(state, civilian, .1, moveUnit, hostility, visible)).toBe(true);
  });

  it('still panics after a real hit across a wall, but inaccessible enemies do not prolong that panic', () => {
    const { state, civilian, enemy } = sealedCity('merchant');
    panicCivilian(state, civilian, enemy);
    expect(civilian.order).toBe('flee'); expect(civilian.morale).toBe(0);
    expect(civilian.civilianPanic!.until).toBe(3);
    for (let tick = 1; tick <= 125; tick++) {
      state.time = tick / 20;
      expect(updateCivilianPanic(state, civilian, .05, () => {}, hostility, visible)).toBe(true);
      expect(civilian.civilianPanic!.until).toBe(3);
    }
    state.time = 6.3;
    expect(updateCivilianPanic(state, civilian, .05, () => {}, hostility, visible)).toBe(false);
    expect(civilian.civilianPanic).toBeUndefined(); expect(civilian.order).toBe('follow');
  });

  it('stagger-caches protected civilian sensing instead of path or sight checks every frame', () => {
    const { state, civilian } = sealedCity('worker'); let sightings = 0;
    for (let frame = 0; frame < 240; frame++) {
      state.time = frame / 60;
      civilianThreat(state, civilian, hostility, () => { sightings++; return true; });
    }
    expect(sightings).toBeGreaterThanOrEqual(12); expect(sightings).toBeLessThanOrEqual(13);
  });

  it('immediately releases every job reservation, pauses work and keeps carried food', () => {
    const state = fixture(), worker = unit(10, 'worker', 0, 10.5, 6.5);
    Object.assign(worker, { builder: true, collector: true, cargo: 12, cargoField: 40, field: 40, buildSite: 110, repairSite: 111,
      buildPhase: 'working', collectPhase: 'outbound', clearTree: { x: 8, y: 8 }, clearProgress: 2 });
    entityStore(state).units.add(worker);
    state.fields = [{ id: 40, x: 10, y: 6, camp: 120, faction: 0, planted: true, food: 3, nextHarvest: 30, claimedBy: worker.id }];
    const site = building(110, 'wall', 0, 11, 6); site.construction = { duration: 10, startedAt: 0, builderId: worker.id };
    const repair = building(111, 'house', 0, 8, 6); repair.repairerId = worker.id;
    entityStore(state).buildings.add(site, repair); state.treeClearings = [{ x: 8, y: 8, faction: 0, workerId: worker.id }];
    panicCivilian(state, worker, { x: 11.5, y: 6.5 });
    expect(worker.order).toBe('flee'); expect(worker.morale).toBe(0); expect(worker.cargo).toBe(12);
    expect(state.fields[0].claimedBy).toBeUndefined(); expect(site.construction.builderId).toBeUndefined();
    expect(site.construction.waitingForBuilder).toBe(true); expect(repair.repairerId).toBeUndefined();
    expect(state.treeClearings[0].workerId).toBeUndefined(); expect(worker.buildSite).toBeUndefined(); expect(worker.field).toBeUndefined();
    expect(worker.collectPhase).toBe('returning'); expect(worker.buildPhase).toBe('returning');
  });

  it('runs away from a nearby attacker and resumes only after danger and the quiet interval pass', () => {
    const state = fixture(), worker = unit(10, 'worker', 0, 12.5, 6.5), enemy = unit(11, 'warrior', -2, 13.5, 6.5);
    worker.cargo = 9; entityStore(state).units.add(worker, enemy); panicCivilian(state, worker, enemy);
    const start = distance(worker, enemy);
    for (let i = 0; i < 10; i++) {
      state.time += .1;
      expect(updateCivilianPanic(state, worker, .1, moveUnit, (a, b) => atWar(state, a, b), () => true)).toBe(true);
    }
    expect(distance(worker, enemy)).toBeGreaterThan(start + 1); expect(worker.morale).toBe(0); expect(worker.cargo).toBe(9);
    enemy.hp = 0; state.time = worker.civilianPanic!.until + 1;
    expect(updateCivilianPanic(state, worker, 1, moveUnit, (a, b) => atWar(state, a, b), () => true)).toBe(true);
    for (let step = 0; step < 120; step++) {
      state.time += .1; updateCivilianPanic(state, worker, .1, moveUnit, (a, b) => atWar(state, a, b), () => true);
    }
    expect(worker.order).toBe('work'); expect(worker.civilianPanic).toBeUndefined(); expect(worker.cargo).toBe(9);
  });

  it.each(['melee', 'projectile'] as const)('triggers panic on an actual %s hit in the game loop', mode => {
    const state = fixture(), worker = unit(10, 'worker', 0, 12.5, 8.5);
    worker.speed = 0; // Keep contact while proximity fear now starts before the hit.
    entityStore(state).units.add(worker); state.factions[1].relation = 'war';
    if (mode === 'melee') {
      const enemy = unit(11, 'warrior', 1, 13.5, 8.5); enemy.order = 'hold'; state.factions[1].relation = 'war'; entityStore(state).units.add(enemy);
    } else state.projectiles = [{ attacker: 2, faction: 1, target: worker.id, start: { x: 16.5, y: 8.5 },
      end: { x: worker.x, y: worker.y }, x: worker.x, y: worker.y, damage: 7, elapsed: 0, duration: .1 }];
    updateGame(state, .1, idle);
    expect(worker.hp).toBeLessThan(100); expect(worker.order).toBe('flee'); expect(worker.civilianPanic).toBeDefined();
    expect(worker.civilianPanic!.until).toBeCloseTo(state.time + 3);
  });

  it('returns a frightened courier’s carried harvest to the palace after recovery', () => {
    const state = fixture(), worker = unit(10, 'worker', 0, 12.5, 6.5);
    entityStore(state).buildings.add(building(120, 'camp', 0, 11, 6));
    Object.assign(worker, { collector: true, collectorCamp: 120, home: 100, cargo: 9, collectPhase: 'returning', inside: false });
    entityStore(state).units.add(worker); panicCivilian(state, worker, { x: 13.5, y: 6.5 });
    const food = state.factions[0].food;
    updateGame(state, 15, idle);
    expect(worker.civilianPanic).toBeUndefined(); expect(worker.order).toBe('work');
    expect(worker.cargo).toBe(0); expect(state.factions[0].food).toBe(food + 9);
  });
});

describe('settlement defense and shared raider pressure', () => {
  it('selects NPC objectives and redirects additional parties toward an unpressured realm', () => {
    const state = fixture(), from = { x: 22.5, y: 13.5 };
    expect(selectRaidTarget(state, from)?.faction).toBe(1);
    state.marauderPacks = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, name: 'Raid', color: '#000', targetFaction: 1, raid: true,
      targetBuilding: 101, home: from, waypoint: from, nextWanderAt: 0 }));
    expect(selectRaidTarget(state, from)?.faction).toBe(0);
    state.factions[0].defeated = true; expect(selectRaidTarget(state, from)?.faction).toBe(1);
  });

  it('queues a paid tower and its palisade gate for NPC builders, respecting authoritative placement validation', () => {
    const state = fixture(); state.time = 15;
    state.factions[1].population = 20;
    state.factions[1].research = { focus: 'wall', levels: { wall: 1, woodenTower: 1 }, progress: {} };
    const before = state.factions[1].gold;
    updateFactionDefenses(state, { validate: (faction, kind, x, y) => validateBuildAt(state, kind, x, y, faction),
      build: (faction, kind, x, y) => buildAt(state, kind, x, y, faction) });
    const defenses = state.buildings.filter(building => building.faction === 1 && ['palisade', 'woodenTower'].includes(building.kind));
    expect(defenses.some(building => building.kind === 'woodenTower')).toBe(true);
    expect(defenses.some(building => building.kind === 'palisade')).toBe(true);
    expect(defenses.every(building => building.construction?.waitingForBuilder)).toBe(true);
    expect(state.factions[1].gold).toBeLessThan(before); expect(state.units.some(worker => worker.faction === 1 && worker.builder)).toBe(true);
    const count = state.buildings.length; updateFactionDefenses(state, { validate: () => ({ ok: true }), build: () => { throw Error('Planner must be throttled'); } });
    expect(state.buildings).toHaveLength(count);
  });

  it('patrols home and intercepts raiders without pursuing them beyond the settlement', () => {
    const state = fixture(), leader = state.units[1]; leader.x = 32.5;
    const start = { ...leader };
    updateGame(state, 1, idle); expect(distance(start, leader)).toBeGreaterThan(.5);
    const enemy = unit(20, 'warrior', -2, leader.x + 3, leader.y); enemy.attack = 0; enemy.speed = 0;
    entityStore(state).units.add(enemy); updateGame(state, .7, idle); expect(leader.target).toBe(enemy.id);
    enemy.x = 45.5; enemy.y = 29.5; updateGame(state, 1, idle);
    expect(leader.target).toBeUndefined(); expect(distance(leader, { x: 29, y: 17 })).toBeLessThan(9);
  });

  it('completes separate tower enclosures without walling over the city approach road', () => {
    const state = fixture(); state.factions[1].gold = 10000;
    state.factions[1].population = 100;
    state.factions[1].research = { focus: 'wall', levels: { wall: 1, woodenTower: 1 }, progress: {} };
    for (let y = 12; y <= 15; y++) entityStore(state).buildings.add(building(200 + y, 'road', 1, 28, y));
    const orders = { validate: (faction: number, kind: DefenseKind, x: number, y: number) => validateBuildAt(state, kind, x, y, faction),
      build: (faction: number, kind: DefenseKind, x: number, y: number) => buildAt(state, kind, x, y, faction) };
    // Completion is already exercised by construction tests; here each planning round receives its completed previous orders.
    for (let round = 0; round < 22; round++) {
      state.time = 15 + round * 8;
      for (const structure of state.buildings) delete structure.construction;
      updateFactionDefenses(state, orders);
    }
    for (const structure of state.buildings) delete structure.construction;
    state.world.revision = (state.world.revision ?? 0) + 1;
    const towers = state.buildings.filter(structure => structure.kind === 'woodenTower' && structure.faction === 1);
    expect(towers).toHaveLength(4);
    const walls = state.buildings.filter(structure => structure.kind === 'palisade' && structure.faction === 1);
    expect(walls).toHaveLength(32);
    for (const tower of towers) {
      expect(walls.filter(wall => Math.max(Math.abs(wall.x - tower.x), Math.abs(wall.y - tower.y)) === 1)).toHaveLength(8);
      const contacts = constructionEdges(state, tower);
      expect(contacts).toHaveLength(1);
      expect(constructionEdges(state, state.buildings[1]).some(exit => hasStaticPath(state, exit, contacts[0], 1))).toBe(true);
      expect(canWalk(state, contacts[0].x, contacts[0].y, -2)).toBe(false);
    }
    expect(state.buildings.some(structure => structure.kind === 'wall' && structure.faction === 1)).toBe(false);
    expect(canWalk(state, 28.5, 12.5, 1)).toBe(true); expect(canWalk(state, 28.5, 12.5, -2)).toBe(true);
    expect(canWalk(state, 29.5, 21.5, 1)).toBe(true);
  });
});


describe('Leader-controlled faction sorties', () => {
  it.each([100, 600, 1800])('keeps the army under its Leader at %i seconds instead of detaching raid waves', time => {
    const state = fixture(); state.time = time;
    state.factions[1].relation = 'war'; state.factions[1].nextRaid = 0;
    entityStore(state).units.add(...Array.from({ length: 60 }, (_, i) => unit(200 + i, 'warrior', 1, 28.5 + i % 10, 21.5 + Math.floor(i / 10))));
    updateGame(state, .01, idle);
    const army = state.units.filter(unit => unit.faction === 1 && unit.kind === 'warrior');
    expect(army.filter(unit => unit.order === 'raid')).toHaveLength(0);
    const mission = getFactionStrategy(state, 1)!;
    expect(['attack', 'regroup']).toContain(mission.mode);
    expect(mission.leaderId).toBe(2);
    expect(mission.escortIds.length).toBeGreaterThan(0);
    expect(mission.garrisonIds.length).toBeGreaterThan(0);
    expect(state.factions[1].nextRaid - state.time).toBeGreaterThanOrEqual(35);
    expect(state.factions[1].nextRaid - state.time).toBeLessThan(60);
  });
});


it('validates raid planning topology once across a large objective list and refreshes the next search', () => {
  const state = fixture(), palace = state.buildings[0], from = { x: 5.5, y: 8.5 };
  for (let i = 0; i < 40; i++) entityStore(state).buildings.add(building(800 + i, 'house', 1, 20 + i % 20, 24 + Math.floor(i / 20)));
  let hp = palace.hp, reads = 0;
  Object.defineProperty(palace, 'hp', { get: () => { reads++; return hp; }, enumerable: true });
  expect(selectRaidTarget(state, from)?.id).toBe(palace.id);
  // Each objective has several edge probes; none should rescan every live
  // structure when their shared planning topology is unchanged.
  expect(reads).toBeLessThan(50);
  hp = 0; reads = 0;
  expect(selectRaidTarget(state, from)?.id).not.toBe(palace.id);
  expect(reads).toBeLessThan(50);
});
