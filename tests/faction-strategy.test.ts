import { entityStore } from '../src/game/entity-store';
import { describe, expect, it, vi } from 'vitest';
import { getFactionStrategy, updateFactionStrategies, type FactionStrategyQueries } from '../src/game/faction-strategy';
import { insideOwnBorders } from '../src/game/borders';
import { buildingSightRadius, unitSightRadius } from '../src/game/fog';
import { sightDistance } from '../src/game/sight';
import { buildingSize, distance, type Building, type Faction, type GameState, type Unit } from '../src/game/types';

const faction = (id: number): Faction => ({ id, name: `Realm ${id}`, color: '#3988ff', relation: id ? 'war' : 'self', affinity: 50,
  population: 20, gold: 500, food: 500, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, defeated: false });
const unit = (id: number, kind: Unit['kind'], faction: number, x: number, y: number): Unit => ({ id, kind, faction, x, y,
  hp: 100, maxHp: 100, attack: 20, defense: 5, morale: 100, speed: 2.2, range: kind === 'leader' ? 4 : 1.1,
  order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
const building = (id: number, kind: Building['kind'], faction: number, x: number, y: number): Building =>
  ({ id, kind, faction, x, y, hp: 650, maxHp: 650, capacity: 0 });

function fixture(): GameState {
  return { world: { width: 64, height: 48, seed: 'faction-strategy', source: 'test', revision: 0, spawns: [],
    tiles: Array.from({ length: 64 * 48 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [unit(1, 'leader', 0, 4.5, 6.5), unit(10, 'leader', 1, 24.5, 21.5),
      unit(11, 'warrior', 1, 23.5, 21.5), unit(12, 'warrior', 1, 25.5, 20.5),
      unit(13, 'warrior', 1, 25.5, 21.5), unit(14, 'warrior', 1, 25.5, 22.5)],
    buildings: [building(100, 'palace', 0, 3, 3), building(101, 'palace', 1, 20, 20), building(102, 'camp', 1, 30, 20)],
    factions: [faction(0), faction(1)], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed: 'faction-strategy', rngState: 1, marauderPacks: [], raiderCamps: [] };
}

function queries(state: GameState): FactionStrategyQueries {
  return { hostile: (a, b) => a !== b && (a === -2 || b === -2 || a === 0 || b === 0),
    visible: (observer, target) => {
      const from = 'capacity' in observer ? { x: observer.x + buildingSize(observer) / 2, y: observer.y + buildingSize(observer) / 2 } : observer;
      const radius = ('capacity' in observer ? buildingSightRadius(observer) : unitSightRadius(observer)) - .65;
      return sightDistance(state.world, from, target.x, target.y, radius) <= radius;
    } };
}

function band(state: GameState): Unit[] {
  const members = [unit(50, 'warrior', -2, 35.5, 21.5), unit(51, 'warrior', -2, 36.5, 21.5)];
  for (const member of members) { member.hp = 50; member.attack = 10; member.defense = 0; member.marauderPack = 1; }
  members[1].marauderLeader = true;
  entityStore(state).units.add(...members);
  return members;
}

function plan(state: GameState) { updateFactionStrategies(state, queries(state)); return getFactionStrategy(state, 1)!; }

describe('rival faction bounty strategy', () => {
  it('starts a Leader-led attack on a hostile city without detaching raiders', () => {
    const state = fixture(); state.factions[1].nextRaid = 0;
    const mission = plan(state);
    expect(mission.mode).toBe('attack');
    expect(mission.leaderId).toBe(10);
    expect(mission.goal).toEqual({ x: 4, y: 4 });
    expect(mission.targetId).toBeUndefined();
    expect(mission.escortIds).toHaveLength(3);
    expect(state.units.every(unit => unit.order === 'follow' && unit.marauderPack === undefined)).toBe(true);
    expect(state.factions[1].nextRaid).toBe(40);
  });

  it('regroups its campaigning army and abandons the attack when the Leader needs to recover', () => {
    const state = fixture(); state.factions[1].nextRaid = 0;
    expect(plan(state).mode).toBe('attack');
    const leader = state.units[1]; leader.x = 10.5; leader.y = 10.5;
    state.time = 1.1;
    expect(plan(state).mode).toBe('regroup');
    leader.hp = 40; state.time = 1.2;
    expect(plan(state).mode).toBe('recover');
    expect(state.factions[1].nextRaid).toBeGreaterThan(state.time);
  });

  it('does not launch a detached offensive when no Leader is present', () => {
    const state = fixture(); state.factions[1].nextRaid = 0;
    entityStore(state).units.retain(unit => unit.id !== 10);
    updateFactionStrategies(state, queries(state));
    expect(getFactionStrategy(state, 1)).toBeUndefined();
    expect(state.units.every(unit => unit.order === 'follow')).toBe(true);
  });

  it('releases strategic control when the leader receives an explicit hold order', () => {
    const state = fixture(); band(state);
    expect(plan(state).mode).toBe('hunt');
    state.units.find(unit => unit.id === 10)!.order = 'hold';
    updateFactionStrategies(state, queries(state));
    expect(getFactionStrategy(state, 1)).toBeUndefined();
  });

  it('hunts an observed favorable raider group with escorts and a separate home garrison', () => {
    const state = fixture(), enemies = band(state), before = state.factions[1].gold;
    const mission = plan(state);
    expect(mission.mode).toBe('hunt');
    // The ordinary raider is observed; its leader is just outside the farm's
    // sight and must not receive priority through hidden information.
    expect(mission.targetId).toBe(enemies[0].id);
    expect(mission.escortIds).toHaveLength(3);
    expect(mission.garrisonIds).toEqual([11]);
    expect(mission.escortIds.every(id => !mission.garrisonIds.includes(id))).toBe(true);
    expect(state.factions[1].gold).toBe(before);
    expect(state.units.every(unit => unit.order === 'follow')).toBe(true);
  });

  it('prefers a visible raider leader bounty over an equally accessible ordinary soldier', () => {
    const state = fixture(), enemies = band(state);
    enemies[1].x = 35.75;
    expect(plan(state).targetId).toBe(enemies[1].id);
  });

  it('scouts with its army instead of targeting unseen raiders anywhere on the map', () => {
    const state = fixture(); band(state);
    updateFactionStrategies(state, { ...queries(state), visible: () => false });
    const mission = getFactionStrategy(state, 1)!;
    expect(mission.mode).toBe('patrol'); expect(mission.targetId).toBeUndefined();
    expect(distance(mission.goal, { x: 21, y: 21 })).toBeGreaterThan(8);
    expect(mission.escortIds.length).toBeGreaterThanOrEqual(2);
  });

  it('does not plan a hunt across unpathable water even when a scout sees the target', () => {
    const state = fixture(); band(state);
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 33].terrain = 'river';
    state.world.revision!++;
    const mission = plan(state);
    expect(mission.mode).toBe('patrol'); expect(mission.targetId).toBeUndefined();
  });

  it('rejects a weak-looking prize surrounded by a stronger enemy group', () => {
    const state = fixture(); band(state);
    for (let i = 0; i < 12; i++) entityStore(state).units.add(unit(70 + i, 'warrior', -2, 34.5 + i % 3, 19.5 + Math.floor(i / 3)));
    const mission = plan(state);
    expect(mission.mode).not.toBe('hunt'); expect(mission.targetId).toBeUndefined();
    expect(distance(mission.goal, { x: 35.5, y: 21.5 })).toBeGreaterThan(5);
  });

  it('avoids turning a profitable bounty into a siege under an observed tower', () => {
    const state = fixture(); band(state);
    entityStore(state).buildings.add(building(110, 'woodenTower', -2, 34, 20));
    expect(plan(state).mode).not.toBe('hunt');
  });

  it('does not keep pursuing last-seen coordinates after visible reinforcements make a hunt unsafe', () => {
    const state = fixture(); band(state); expect(plan(state).mode).toBe('hunt');
    for (let i = 0; i < 12; i++) entityStore(state).units.add(unit(70 + i, 'warrior', -2, 34.5 + i % 3, 19.5 + Math.floor(i / 3)));
    state.time = 1.1;
    expect(plan(state).mode).not.toBe('hunt');
  });

  it('abandons a bounty to intercept an enemy near the home palace', () => {
    const state = fixture(); band(state); expect(plan(state).mode).toBe('hunt');
    const invader = unit(80, 'warrior', -2, 23.5, 19.5); invader.attack = 4;
    entityStore(state).units.add(invader); state.time = 1.1;
    const mission = plan(state);
    expect(mission.mode).toBe('defend'); expect(mission.targetId).toBe(invader.id);
  });

  it('responds to a wounded leader immediately and returns to owned ground before resuming', () => {
    const state = fixture(); band(state); plan(state);
    const leader = state.units[1]; leader.hp = 40; state.time = .1;
    let mission = plan(state);
    expect(mission.mode).toBe('recover');
    expect(insideOwnBorders(state, 1, mission.goal.x, mission.goal.y)).toBe(true);
    expect(mission.targetId).toBeUndefined();
    entityStore(state).units.replace(state.units.filter(unit => unit.faction >= 0));
    leader.hp = 89; leader.x = 22.5; leader.y = 22.5; state.time = 2;
    expect(plan(state).mode).toBe('recover');
    leader.hp = 95; state.time = 3.1;
    expect(plan(state).mode).toBe('patrol');
  });

  it('waits for trailing soldiers before setting out on a hunt', () => {
    const state = fixture(); band(state);
    for (const unit of state.units.filter(unit => unit.id >= 12 && unit.faction === 1)) { unit.x = 14.5; unit.y = 18.5; }
    const mission = plan(state);
    expect(mission.mode).toBe('regroup');
    expect(mission.goal).toEqual({ x: state.units[1].x, y: state.units[1].y });
  });

  it('does not count raiding, fleeing, or distant new recruits as ready hunting escorts', () => {
    const state = fixture(); band(state);
    state.units.find(unit => unit.id === 12)!.order = 'raid';
    state.units.find(unit => unit.id === 13)!.order = 'flee';
    Object.assign(state.units.find(unit => unit.id === 14)!, { joiningRetinue: true, x: 15.5 });
    const mission = plan(state);
    expect(mission.mode).toBe('patrol'); expect(mission.escortIds).toEqual([]);
    expect(mission.garrisonIds).not.toContain(12); expect(mission.garrisonIds).not.toContain(13);
  });

  it('leaves holding soldiers at their posts instead of waiting for them as escorts', () => {
    const state = fixture(); band(state);
    state.units.find(unit => unit.id === 12)!.order = 'hold';
    state.units.find(unit => unit.id === 13)!.order = 'hold';
    const mission = plan(state);
    expect(mission.mode).toBe('patrol');
    expect(mission.escortIds).not.toContain(12); expect(mission.escortIds).not.toContain(13);
  });

  it('remembers only the last seen position of a hidden target, then gives up the search', () => {
    const state = fixture(), enemies = band(state), mission = plan(state), lastSeen = { ...mission.goal };
    for (const enemy of enemies) { enemy.x = 59.5; enemy.y = 45.5; }
    state.time = 1.1; updateFactionStrategies(state, { ...queries(state), visible: () => false });
    const search = getFactionStrategy(state, 1)!;
    expect(search.mode).toBe('hunt'); expect(search.targetId).toBeUndefined(); expect(search.goal).toEqual(lastSeen);
    state.time = 7; updateFactionStrategies(state, { ...queries(state), visible: () => false });
    expect(getFactionStrategy(state, 1)!.mode).toBe('patrol');
  });

  it('ends a prolonged hunt and keeps returning home during its cooldown', () => {
    const state = fixture(); band(state); plan(state);
    const leader = state.units[1]; leader.x = 33.5;
    state.time = 40; let mission = plan(state);
    expect(mission.mode).toBe('recover'); expect(distance(mission.goal, { x: 21, y: 21 })).toBeLessThan(5);
    state.time = 41.1; mission = plan(state);
    expect(mission.mode).toBe('recover'); expect(distance(mission.goal, { x: 21, y: 21 })).toBeLessThan(5);
  });

  it('throttles sensing and never takes over the player, defeated, or confederated factions', () => {
    const state = fixture(); band(state);
    const base = queries(state), visible = vi.fn(base.visible);
    updateFactionStrategies(state, { ...base, visible });
    const calls = visible.mock.calls.length;
    expect(calls).toBeGreaterThan(0); expect(getFactionStrategy(state, 0)).toBeUndefined();
    state.time = .5; updateFactionStrategies(state, { ...base, visible });
    expect(visible).toHaveBeenCalledTimes(calls);
    state.factions[1].relation = 'confederated'; updateFactionStrategies(state, { ...base, visible });
    expect(getFactionStrategy(state, 1)).toBeUndefined();
    state.factions[1].relation = 'war'; state.factions[1].defeated = true;
    updateFactionStrategies(state, { ...base, visible }); expect(getFactionStrategy(state, 1)).toBeUndefined();
  });
});

it('checks a retained home and planning deadline before preparing city rosters', () => {
  const state = fixture(), leader = state.units[1];
  leader.home = 101;
  band(state); plan(state);
  const buildings = vi.spyOn(entityStore(state).buildings, 'query');
  const scanUnits = vi.spyOn(state.units, 'filter'), scanBuildings = vi.spyOn(state.buildings, 'filter');
  try {
    state.time = .5; plan(state);
    expect(buildings).not.toHaveBeenCalled();
    expect(scanUnits).not.toHaveBeenCalled(); expect(scanBuildings).not.toHaveBeenCalled();
    leader.hp = 40;
    expect(plan(state).mode).toBe('recover');
    expect(buildings).toHaveBeenCalled();
    buildings.mockClear();
    state.buildings.find(building => building.id === 101)!.hp = 0;
    updateFactionStrategies(state, queries(state));
    expect(getFactionStrategy(state, 1)).toBeUndefined();
    expect(buildings).toHaveBeenCalled();
  } finally { buildings.mockRestore(); scanUnits.mockRestore(); scanBuildings.mockRestore(); }
});

it('still changes the nearest fallback city immediately when a homeless leader moves', () => {
  const state = fixture(), leader = state.units[1];
  entityStore(state).buildings.add(building(103, 'palace', 1, 48, 36));
  expect(plan(state).palaceId).toBe(101);
  leader.x = 49.5; leader.y = 37.5; state.time = .1;
  expect(plan(state).palaceId).toBe(103);
});
