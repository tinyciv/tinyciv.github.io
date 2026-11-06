import { entityStore } from '../src/game/entity-store';
import { describe, expect, it, vi } from 'vitest';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from '../src/game/spatial';
import { EARLY_HUNT_CALIBRATION, HERD_MAX_SIZE, HERD_GRAZE_MIN_SECONDS, HERD_STROLL_SPEED, HERD_RUN_SPEED, HUNT_FOOD_REWARD, HUNT_GROWTH_SECONDS,
  huntingGrowthMultiplier, huntingGrowthMultiplierForFaction, initializeWildlife, isHuntable,
  nearestHuntTarget, rewardHunt, spawnWildlifeHerd, updateHerdAnimal, updateWildlife,
  wildlifeHabitatSuitability, wildlifeHerdTarget, WILDLIFE_FACTION, WILDLIFE_RESPAWN_MIN } from '../src/game/hunting';
import { pointInSight, updateFog } from '../src/game/fog';
import { beginNavigationFrame, canMove, canWalk, endNavigationFrame } from '../src/game/pathfinding';
import { distance, type Building, type GameState, type Point, type Unit } from '../src/game/types';
import { moveUnit, updateGame } from '../src/game/simulation';

const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: kind === 'leader' ? 25 : 17,
  defense: 0, speed: 3.6, range: kind === 'leader' ? 4 : 1.1, order: 'follow',
  cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
function fixture(width = 80, height = 50): GameState {
  return {
    world: { width, height, seed: 'wildlife-herds', source: 'test', spawns: [],
      tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none',
        elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', x: 8, y: 10, faction: 0, hp: 650, maxHp: 650, capacity: 0 }],
    units: [unit(10, 'leader', 11.5, 12.5)],
    factions: [{ id: 0, name: 'Home', color: '#3988ff', relation: 'self', affinity: 100,
      food: 50, gold: 100, production: 0, population: 5, yields: { food: 4.6, production: 0, gold: 3 }, nextRaid: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false,
    victory: false, seed: 'wildlife-herds', rngState: 1, marauderPacks: [], raiderCamps: [],
    roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 },
  };
}
function animal(id = 20, x = 30.5, y = 20.5): Unit {
  return { ...unit(id, 'boar', x, y, WILDLIFE_FACTION), herdId: 1, hp: 14, maxHp: 14, attack: 0, range: 0, order: 'wander' };
}
function activeHerd(state: GameState): Unit[] {
  const animals = [animal(), animal(21, 31.5, 20.5), animal(22, 30.5, 21.5)];
  entityStore(state).units.add(...animals);
  state.wildlife = { herds: [{ id: 1, waypoint: { x: 31, y: 21 }, nextWanderAt: 0 }],
    nextRespawnAt: 1e9, sequence: 0, targetHerds: 1 };
  return animals;
}

describe('hidden wildlife herds', () => {
  it('supports more wildlife in moist woodland than bare desert and never spawns into uninhabitable ground', () => {
    const woodland = fixture(), desert = fixture();
    for (const tile of woodland.world.tiles) { tile.overlay = 'forest'; tile.moisture = .8; tile.fertility = .75; }
    for (const tile of desert.world.tiles) { tile.terrain = 'desert'; tile.biome = 'desert'; tile.moisture = .1; }
    expect(wildlifeHabitatSuitability(woodland.world, 30, 30)).toBeGreaterThan(.8);
    expect(wildlifeHabitatSuitability(desert.world, 30, 30)).toBe(0);
    expect(wildlifeHerdTarget(woodland)).toBeGreaterThan(wildlifeHerdTarget(desert));
    initializeWildlife(desert);
    expect(desert.wildlife!.targetHerds).toBe(0);
    expect(desert.wildlife!.herds).toHaveLength(0);
  });

  it('keeps herds in viable habitat when a large dry region borders wooded wetlands', () => {
    const state = fixture();
    for (let y = 0; y < state.world.height; y++) for (let x = 0; x < state.world.width; x++) {
      const tile = state.world.tiles[y * state.world.width + x];
      tile.terrain = x < 45 ? 'desert' : 'grassland';
      tile.biome = x < 45 ? 'desert' : 'wetland';
      tile.overlay = x < 45 ? 'none' : 'forest';
      tile.moisture = x < 45 ? .1 : .85;
    }
    initializeWildlife(state);
    const animals = state.units.filter(isHuntable);
    expect(animals.length).toBeGreaterThan(0);
    expect(animals.every(animal => animal.x >= 45)).toBe(true);
    const tile = state.world.tiles[30 * state.world.width + 60]; tile.biome = 'alpine';
    expect(wildlifeHabitatSuitability(state.world, 60, 30)).toBe(0);
  });

  it('scatters one to eight animals per group, only on unseen walkable ground', () => {
    const state = fixture(); initializeWildlife(state);
    const fog = updateFog(state), herds = state.wildlife!.herds;
    expect(herds).toHaveLength(wildlifeHerdTarget(state));
    const occupied = new Set<number>();
    for (const herd of herds) {
      const members = state.units.filter(member => member.herdId === herd.id);
      expect(members.length).toBeGreaterThanOrEqual(1); expect(members.length).toBeLessThanOrEqual(HERD_MAX_SIZE);
      for (const member of members) {
        expect(isHuntable(member)).toBe(true);
        expect(pointInSight(fog, member.x, member.y)).toBe(false);
        expect(distance(member, state.units[0])).toBeGreaterThanOrEqual(8);
        expect(canWalk(state, member.x, member.y, WILDLIFE_FACTION)).toBe(true);
        expect(distance(member, herd.waypoint)).toBeLessThanOrEqual(2.5);
        const cell = Math.floor(member.y) * state.world.width + Math.floor(member.x);
        expect(occupied.has(cell)).toBe(false); occupied.add(cell);
      }
    }
  });

  it('is deterministic and does not consume combat or economy RNG', () => {
    const a = fixture(), b = fixture(); initializeWildlife(a); initializeWildlife(b);
    expect(a.units).toEqual(b.units); expect(a.wildlife).toEqual(b.wildlife);
    expect(a.rngState).toBe(1);
    const before = structuredClone(a.wildlife); initializeWildlife(a);
    expect(a.wildlife).toEqual(before);
  });

  it('never spawns an entire herd when any candidate would be visible', () => {
    const state = fixture(20, 20);
    entityStore(state).units.replace([]);
    entityStore(state).buildings.replace([]);
    for (const y of [4, 12]) for (const x of [4, 12]) entityStore(state).buildings.add({
      id: state.buildings.length + 1, kind: 'palace', faction: 0, x, y, hp: 650, maxHp: 650, capacity: 0,
    });
    initializeWildlife(state);
    expect(state.wildlife!.herds).toHaveLength(0);
    expect(state.units).toHaveLength(0);
  });

  it('replenishes at most one herd per three to five minutes, never an entire depleted population', () => {
    const state = fixture(); initializeWildlife(state);
    const next = state.wildlife!.nextRespawnAt;
    expect(next).toBeGreaterThanOrEqual(WILDLIFE_RESPAWN_MIN); expect(next).toBeLessThanOrEqual(300);
    entityStore(state).units.replace(state.units.filter(member => !isHuntable(member)));
    state.time = next - .01; updateWildlife(state);
    expect(state.wildlife!.herds).toHaveLength(0);
    state.time = next; updateWildlife(state);
    expect(state.wildlife!.herds).toHaveLength(1);
    const deadline = state.wildlife!.nextRespawnAt;
    expect(deadline - state.time).toBeGreaterThanOrEqual(180);
    state.time += .1; updateWildlife(state);
    expect(state.wildlife!.herds).toHaveLength(1);
    expect(state.wildlife!.nextRespawnAt).toBe(deadline);
  });

  it('does not initialize wildlife implicitly in synthetic states or repopulate observed ground', () => {
    const state = fixture(); updateWildlife(state);
    expect(state.wildlife).toBeUndefined(); expect(spawnWildlifeHerd(state)).toBeUndefined();
  });
});

describe('herd movement and local hunting', () => {
  it('observes wildlife spawning, role changes, death and removal after an empty search', () => {
    const state = fixture(), hunter = state.units[0], store = entityStore(state);
    expect(nearestHuntTarget(state, hunter, () => true)).toBeUndefined();
    const quarry = animal(20, hunter.x + 2, hunter.y);
    store.units.add(quarry);
    expect(nearestHuntTarget(state, hunter, () => true)).toBe(quarry);
    store.setUnitRole(quarry, { kind: 'warrior' });
    expect(nearestHuntTarget(state, hunter, () => true)).toBeUndefined();
    store.setUnitRole(quarry, { kind: 'marshBird' });
    expect(nearestHuntTarget(state, hunter, () => true)).toBe(quarry);
    quarry.hp = 0;
    expect(nearestHuntTarget(state, hunter, () => true)).toBeUndefined();
    quarry.hp = 14;
    store.units.retain(candidate => candidate !== quarry);
    expect(nearestHuntTarget(state, hunter, () => true)).toBeUndefined();
    store.units.add(quarry);
    expect(nearestHuntTarget(state, hunter, () => true)).toBe(quarry);
  });

  it('takes short forage walks and flees together from any human', () => {
    const state = fixture(), animals = activeHerd(state);
    updateWildlife(state);
    const herd = state.wildlife!.herds[0], wander = { ...herd.waypoint };
    expect(distance(wander, animals[0])).toBeGreaterThan(1);
    entityStore(state).units.add(unit(30, 'worker', 27, 20.5, 1));
    state.time = .6; updateWildlife(state);
    expect(herd.fleeUntil).toBeGreaterThan(state.time);
    expect(herd.waypoint.x).toBeGreaterThan(31);
    const goals: Point[] = [];
    for (const member of animals) updateHerdAnimal(state, member, .1, (_state, _unit, goal) => goals.push(goal));
    expect(goals).toHaveLength(3);
    expect(animals.every(member => member.speed === 3.15 && member.order === 'wander')).toBe(true);
    expect(goals.every(goal => distance(goal, herd.waypoint) <= 1.5 + 1e-8)).toBe(true);
    expect(new Set(goals.map(goal => `${goal.x},${goal.y}`)).size).toBe(3);
  });

  it('chooses reachable ground while avoiding water and uses the supplied normal movement', () => {
    const state = fixture(), animals = activeHerd(state);
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 34].terrain = 'river';
    entityStore(state).units.add(unit(30, 'warrior', 27, 20.5, 1));
    updateWildlife(state);
    const herd = state.wildlife!.herds[0];
    expect(herd.waypoint.x).toBeLessThan(34);
    for (const member of animals) updateHerdAnimal(state, member, .1, (s, moving, goal, dt) => {
      expect(canMove(s, moving, goal, moving.faction)).toBe(true);
      const length = distance(moving, goal), step = Math.min(length, moving.speed * dt);
      moving.x += (goal.x - moving.x) / length * step; moving.y += (goal.y - moving.y) / length * step;
    });
    expect(animals.every(member => member.x < 34)).toBe(true);
  });

  it('respects visibility, recall, hold range, and the escort leash', () => {
    const state = fixture(), hunter = state.units[0];
    const target = animal(20, hunter.x + 3, hunter.y); entityStore(state).units.add(target);
    expect(nearestHuntTarget(state, hunter, () => true)).toBe(target);
    expect(nearestHuntTarget(state, hunter, () => false)).toBeUndefined();
    hunter.recallIssuedAt = 1; expect(nearestHuntTarget(state, hunter, () => true)).toBeUndefined();
    delete hunter.recallIssuedAt;
    const soldier = unit(21, 'warrior', target.x - 1.5, target.y); entityStore(state).units.add(soldier);
    soldier.order = 'hold'; expect(nearestHuntTarget(state, soldier, () => true)).toBeUndefined();
    soldier.order = 'follow'; expect(nearestHuntTarget(state, soldier, () => true)).toBe(target);
    hunter.x = 2; expect(nearestHuntTarget(state, soldier, () => true)).toBeUndefined();
    expect(nearestHuntTarget(state, unit(23, 'worker', target.x, target.y), () => true)).toBeUndefined();
  });

  it('uses direct normal movement on clear ground but requests a path around obstacles', () => {
    const state = fixture(), animals = activeHerd(state), member = animals[0];
    state.wildlife!.herds[0].waypoint = { x: 36.5, y: 20.5 };
    state.wildlife!.herds[0].wanderUntil = 5;
    const choices: boolean[] = [];
    updateHerdAnimal(state, member, .1, (_state, _unit, _goal, _dt, direct) => choices.push(!!direct));
    for (let y = 16; y <= 24; y++) entityStore(state).buildings.add({ id: 100 + y, kind: 'wall', faction: 0,
      x: 33, y, hp: 225, maxHp: 225, capacity: 0 });
    updateHerdAnimal(state, member, .1, (_state, _unit, _goal, _dt, direct) => choices.push(!!direct));
    expect(choices).toEqual([true, false]);
  });

  it('grazes in place after spawning instead of immediately converging on a shared waypoint', () => {
    const state = fixture(); initializeWildlife(state);
    for (const herd of state.wildlife!.herds) expect(herd.nextWanderAt).toBeGreaterThanOrEqual(HERD_GRAZE_MIN_SECONDS);
    const move = vi.fn();
    for (const member of state.units.filter(isHuntable)) {
      Object.assign(member, { moving: true, path: [{ x: 1, y: 1 }], pathGoal: { x: 1, y: 1 } });
      updateHerdAnimal(state, member, .1, move);
      expect(member.moving).toBe(false); expect(member.path).toBeUndefined(); expect(member.pathGoal).toBeUndefined();
    }
    expect(move).not.toHaveBeenCalled();
  });

  it.each([1, 8])('keeps a %i-animal herd still at least80%% of undisturbed time, with only short slow forage walks', count => {
    const state = fixture(), animals = Array.from({ length: count }, (_, i) => animal(20 + i, 30.5 + i % 3, 20.5 + Math.floor(i / 3)));
    entityStore(state).units.replace(animals);
    state.wildlife = { herds: [{ id: 1, waypoint: { x: 31, y: 21 }, nextWanderAt: 25 }], nextRespawnAt: 1e9, sequence: 0, targetHerds: 1 };
    let stationary = 0, walking = 0, longestWalk = 0, currentWalk = 0;
    for (let step = 0; step < 1200; step++) {
      state.time += .1; updateWildlife(state); beginUnitFrame(state); beginNavigationFrame(state);
      let anyMoving = false;
      try {
        for (const member of animals) {
          const before = { x: member.x, y: member.y };
          updateHerdAnimal(state, member, .1, moveUnit); refreshIndexedUnit(state, member);
          expect(member.speed).toBe(HERD_STROLL_SPEED);
          if (member.moving) { walking++; anyMoving = true; } else {
            stationary++; expect(distance(member, before)).toBeLessThan(1e-8);
          }
          expect(distance(member, state.wildlife.herds[0].waypoint)).toBeLessThan(5);
        }
      } finally { endUnitFrame(state); endNavigationFrame(state); }
      currentWalk = anyMoving ? currentWalk + .1 : 0; longestWalk = Math.max(longestWalk, currentWalk);
    }
    expect(stationary / (stationary + walking)).toBeGreaterThanOrEqual(.8);
    expect(walking).toBeGreaterThan(0); expect(longestWalk).toBeLessThan(5.6);
  });

  it('interrupts grazing when a human approaches, then settles in place after the danger passes', () => {
    const state = fixture(), animals = activeHerd(state), herd = state.wildlife!.herds[0];
    herd.nextWanderAt = 100;
    const move = vi.fn();
    updateWildlife(state); updateHerdAnimal(state, animals[0], .1, move);
    expect(move).not.toHaveBeenCalled();
    const person = unit(30, 'worker', 27, 20.5, 1); entityStore(state).units.add(person);
    state.time = .6; updateWildlife(state);
    for (const member of animals) updateHerdAnimal(state, member, .1, move);
    expect(move).toHaveBeenCalledTimes(3);
    expect(animals.every(member => member.speed === HERD_RUN_SPEED)).toBe(true);
    person.x = 70; person.y = 40;
    state.time = 5; updateWildlife(state); move.mockClear();
    const restingAt = animals.map(member => ({ x: member.x, y: member.y }));
    for (const member of animals) updateHerdAnimal(state, member, .1, move);
    expect(move).not.toHaveBeenCalled(); expect(herd.fleeUntil).toBeUndefined();
    expect(herd.nextWanderAt).toBeGreaterThanOrEqual(state.time + HERD_GRAZE_MIN_SECONDS);
    state.time = 10; updateWildlife(state);
    for (const [i, member] of animals.entries()) {
      updateHerdAnimal(state, member, .1, move); expect(member).toMatchObject(restingAt[i]);
      expect(member.speed).toBe(HERD_STROLL_SPEED); expect(member.moving).toBe(false);
    }
    expect(move).not.toHaveBeenCalled();
  });
});

describe('hunting food and timed growth', () => {
  it('calibrates a five-food reward to the early village instead of claiming food stock controls its birth rate', () => {
    const model = EARLY_HUNT_CALIBRATION;
    expect(model.growthPerTick).toBeCloseTo(1.4815384615384614);
    expect(model.growthPerTick * .1 * model.foodPerBirth).toBeCloseTo(.5926153846);
    expect(HUNT_FOOD_REWARD).toBe(5);
    expect(HUNT_FOOD_REWARD).toBe(model.population);
    expect(HUNT_FOOD_REWARD % 5).toBe(0);
  });

  it('awards food once, attributes the bonus to the nearest city, and never grants gold or veterancy', () => {
    const state = fixture(), hunter = state.units[0], target = animal(); target.hp = 0;
    const second: Building = { ...state.buildings[0], id: 2, x: 29, y: 19 };
    entityStore(state).buildings.add(second); state.time = 12;
    expect(rewardHunt(state, hunter, target)).toBe(true);
    expect(state.factions[0].food).toBe(55); expect(state.factions[0].gold).toBe(100);
    expect(hunter.kills).toBeUndefined(); expect(state.buildings[0].huntingBonuses).toBeUndefined();
    expect(second.huntingBonuses).toEqual([{ startedAt: 12, expiresAt: 42 }]);
    expect(state.particles[0]).toMatchObject({ text: '+5 food', kind: 'hunt' });
    expect(rewardHunt(state, hunter, target)).toBe(true); expect(state.factions[0].food).toBe(55);
    expect(rewardHunt(state, hunter, { ...target, hp: 14 })).toBe(false);
  });

  it('stacks additive ten-percent bonuses for exactly thirty seconds each', () => {
    const state = fixture(), hunter = state.units[0];
    for (let i = 0; i < 3; i++) rewardHunt(state, hunter, { ...animal(20 + i), hp: 0 });
    expect(huntingGrowthMultiplierForFaction(state, 0)).toBeCloseTo(1.3);
    expect(huntingGrowthMultiplier(state, state.buildings[0])).toBeCloseTo(1.3);
    expect(huntingGrowthMultiplierForFaction(state, 1)).toBe(1);
    state.time = HUNT_GROWTH_SECONDS - .01;
    expect(huntingGrowthMultiplierForFaction(state, 0)).toBeCloseTo(1.3);
    state.time = HUNT_GROWTH_SECONDS;
    expect(huntingGrowthMultiplierForFaction(state, 0)).toBe(1);
  });

  it('preserves partial ticks so killing just before an economy tick does not waste the effect', () => {
    const state = fixture(); state.time = 29;
    rewardHunt(state, state.units[0], { ...animal(), hp: 0 });
    const first = huntingGrowthMultiplierForFaction(state, 0, 0, 30);
    const second = huntingGrowthMultiplierForFaction(state, 0, 30, 60);
    expect(first).toBeCloseTo(1 + .1 / 30);
    expect(second).toBeCloseTo(1 + .1 * 29 / 30);
    expect((first - 1) * 30 + (second - 1) * 30).toBeCloseTo(3);
    expect(huntingGrowthMultiplierForFaction(state, 0, 60, 90)).toBe(1);
  });

  it('combines hunts across friendly cities while leaving other factions unchanged', () => {
    const state = fixture();
    entityStore(state).buildings.add({ ...state.buildings[0], id: 2, x: 60, y: 35 });
    rewardHunt(state, state.units[0], { ...animal(20, 10, 10), hp: 0 });
    rewardHunt(state, state.units[0], { ...animal(21, 61, 36), hp: 0 });
    expect(state.buildings.every(building => building.huntingBonuses?.length === 1)).toBe(true);
    expect(huntingGrowthMultiplierForFaction(state, 0)).toBeCloseTo(1.2);
    expect(huntingGrowthMultiplier(state, state.buildings[0])).toBeCloseTo(1.1);
  });
});

describe('hunting in the live simulation', () => {
  const idle = { up: false, down: false, left: false, right: false };

  it('automatically kills nearby game with the Leader’s javelin and awards food instead of gold or a military kill', () => {
    const state = fixture(), leader = state.units[0], quarry = animal(20, leader.x + 3, leader.y);
    entityStore(state).units.add(quarry);
    updateGame(state, .1, idle);
    expect(state.projectiles?.some(projectile => projectile.attacker === leader.id && projectile.target === quarry.id)).toBe(true);
    updateGame(state, .5, idle);
    expect(quarry.hp).toBe(0);
    expect(state.units).not.toContain(quarry);
    expect(state.factions[0].food).toBe(55); expect(state.factions[0].gold).toBe(100);
    expect(leader.kills ?? 0).toBe(0);
    expect(state.buildings[0].huntingBonuses).toHaveLength(1);
    expect(state.particles.some(particle => particle.kind === 'hunt' && particle.text === '+5 food')).toBe(true);
  });

  it('keeps human enemies ahead of an animal in attack range', () => {
    const state = fixture(), leader = state.units[0], quarry = animal(20, leader.x + 2, leader.y);
    const enemy = unit(21, 'warrior', leader.x + 3, leader.y, -2);
    entityStore(state).units.add(quarry, enemy);
    updateGame(state, .1, idle);
    expect(state.projectiles?.find(projectile => projectile.attacker === leader.id)?.target).toBe(enemy.id);
    expect(quarry.hp).toBe(14);
    expect(state.factions[0].food).toBe(50);
  });

  it('adds ten percent to newly earned growth for one cycle without multiplying banked progress', () => {
    const prepare = (): GameState => {
      const state = fixture(); state.buildings[0].populationGrowth = 10;
      state.buildings[0].governorPermissions = { farms: false, housing: false };
      // Eight mature irrigated orchard cells now produce 12.8 food per tick;
      // five residents consume five, leaving 7.8 for the growth calculation.
      let id = 1000;
      for (const [x, y] of [[18, 8], [18, 12]]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const point = { x: x + dx, y: y + dy };
        entityStore(state).buildings.add({
          id: id++, kind: 'camp', faction: 0, ...point, hp: 140, maxHp: 140, capacity: 0, orchard: { startedAt: -120, readyAt: 0 },
        }, { id: id++, kind: 'irrigation', faction: 0, ...point, hp: 100, maxHp: 100, capacity: 0 });
      }
      return state;
    };
    const ordinary = prepare(), hunted = prepare();
    rewardHunt(hunted, hunted.units[0], { ...animal(), hp: 0 });
    ordinary.time = hunted.time = 29.9;
    updateGame(ordinary, .1, idle); updateGame(hunted, .1, idle);
    const base = ordinary.buildings[0].populationGrowth! - 10;
    expect(base).toBeCloseTo(3 * (.14 + (12.8 - 5) / 13));
    expect(hunted.buildings[0].populationGrowth! - 10).toBeCloseTo(base * 1.1);
    const before = hunted.buildings[0].populationGrowth!;
    hunted.time = 59.9; updateGame(hunted, .1, idle);
    expect(hunted.buildings[0].populationGrowth! - before).toBeCloseTo(base);
  });
});


it('rejects distant humans cheaply while retaining original-order ties between equally close threats', () => {
  const state = fixture(); activeHerd(state);
  for (let i = 0; i < 300; i++) entityStore(state).units.add(unit(1000 + i, 'worker', 65 + i % 4, 40 + i % 3));
  entityStore(state).units.add(unit(31, 'worker', 34.5, 20.5), unit(30, 'worker', 27.5, 20.5));
  const roots = vi.spyOn(Math, 'hypot');
  try {
    updateWildlife(state);
    expect(state.wildlife!.herds[0].lastThreat).toEqual({ x: 34.5, y: 20.5 });
    expect(roots.mock.calls.length).toBeLessThan(150);
  } finally { roots.mockRestore(); }
});

it('selects the same nearest visible quarry and id tie with a spatial frame, including live deaths', () => {
  const state = fixture(), leader = state.units[0], hunter = unit(40, 'warrior', leader.x + 1, leader.y);
  const farther = animal(15, hunter.x + 2, hunter.y), highId = animal(30, hunter.x - 1, hunter.y), lowId = animal(20, hunter.x + 1, hunter.y);
  entityStore(state).units.add(hunter, farther, highId, lowId);
  expect(nearestHuntTarget(state, hunter, () => true)).toBe(lowId);
  beginUnitFrame(state);
  try {
    expect(nearestHuntTarget(state, hunter, () => true)).toBe(lowId);
    lowId.hp = 0;
    expect(nearestHuntTarget(state, hunter, () => true)).toBe(highId);
    expect(nearestHuntTarget(state, hunter, target => target !== highId)).toBe(farther);
  } finally { endUnitFrame(state); }
});
