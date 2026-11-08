import { entityStore } from '../src/game/entity-store';
import { describe, expect, it, vi } from 'vitest';
import { raiderArcherFraction, initializeFogRaids, updateFogRaids } from '../src/game/fog-raids';
import { MAX_LIVE_RAIDERS, MAX_LIVE_RAIDERS_PER_CAMP } from '../src/game/raider-camps';
import { raiderMotivationForWave, raiderMotivationSize, selectTheftPalace, siegeRallyPoint, updateRaiderGroupMotivation, updateRaiderMotivation, type RaiderMotivationOrders } from '../src/game/raider-motivations';
import { ensureMarauderLeaders } from '../src/game/marauder-leaders';
import { setSoldierRole } from '../src/game/archery';
import { canWalk } from '../src/game/pathfinding';
import { updateGame } from '../src/game/simulation';
import { distance, type Building, type GameState, type MarauderPack, type Unit } from '../src/game/types';
const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, x: number, y: number, faction = -2, kind: Unit['kind'] = 'warrior'): Unit => ({
  id, x, y, faction, kind, hp: 100, maxHp: 100, attack: 17, defense: 4, speed: 2.35, range: 1.1,
  morale: 100, cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, order: 'hold',
});
const structure = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, x, y, faction, hp: 650, maxHp: 650, capacity: 0, governorPermissions: { farms: false, housing: false },
});
function fixture(): GameState {
  return { world: { width: 64, height: 48, seed: 'motivation', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 64 * 48 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .5 })) },
    units: [{ ...person(1, 2.5, 44.5, 0, 'leader'), attack: 0, speed: 0 }], buildings: [structure(2, 'palace', 24, 24)],
    factions: [{ id: 0, name: 'Rome', color: '#f00', affinity: 100, relation: 'self', food: 0, gold: 500, production: 0,
      population: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], projectiles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'motivation', rngState: 731, marauderPacks: [],
    raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } };
}
function band(state: GameState, motivation: MarauderPack['motivation'], count = 3, x = 12.5, y = 24.5) {
  const pack: MarauderPack = { id: 50, name: 'Raiders', color: '#111', targetFaction: 0, targetBuilding: 2, raid: true,
    motivation, phase: 'approach', home: { x: 4.5, y: 4.5 }, waypoint: { x: 25, y: 25 }, nextWanderAt: 0, startingTroops: count - 1,
    leaderId: 100, raiderCamp: 60 };
  const members = Array.from({ length: count }, (_, i) => ({ ...person(100 + i, x, y + i * .8), marauderPack: 50, order: 'raid' as const }));
  state.marauderPacks!.push(pack); entityStore(state).units.add(...members);
  return { pack, members };
}
function orders() { return { move: vi.fn(), attack: vi.fn(), visible: vi.fn(() => true) } satisfies RaiderMotivationOrders; }
function enclose(state: GameState, x0 = 22, y0 = 22, x1 = 27, y1 = 27): void {
  let id = 500;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x === x0 || x === x1 || y === y0 || y === y1)
    entityStore(state).buildings.add(structure(id++, 'wall', x, y));
  state.world.revision = (state.world.revision ?? 0) + 1;
}

describe('raider group motivations', () => {
  it('retains ordinary assaults and keeps specialists in their intended size ranges', () => {
    expect(Array.from({ length: 8 }, (_, i) => raiderMotivationForWave(i))).toEqual(['assault', 'assault', 'harass', 'assault', 'theft', 'assault', 'harass', 'siege']);
    expect(raiderMotivationSize('harass', 4, 0).total).toBe(2);
    expect(raiderMotivationSize('harass', 60, 100).total).toBe(10);
    expect(raiderMotivationSize('theft', 60, 0).total).toBe(1);
    expect(raiderMotivationSize('theft', 60, 100).total).toBe(10);
    expect(raiderMotivationSize('siege', 60, 20)).toEqual({ initial: 10, total: 20 });
    expect(raiderMotivationSize('siege', 60, 10000).total).toBe(30);
    const state = fixture(), { pack, members } = band(state, 'assault');
    expect(updateRaiderGroupMotivation(state, pack, members)).toBe(false);
    expect(updateRaiderMotivation(state, members[0], .1, orders())).toBe(false);
  });
  it('harasses peasants but immediately abandons the raid on sighting a soldier', () => {
    const state = fixture(), { pack, members } = band(state, 'harass'), actions = orders();
    const worker = person(200, 14.5, 24.5, 0, 'worker'); entityStore(state).units.add(worker);
    updateRaiderGroupMotivation(state, pack, members);
    updateRaiderMotivation(state, members[0], .1, actions);
    expect(actions.attack).toHaveBeenLastCalledWith(members[0], worker, .1);
    const soldier = person(201, 15.5, 24.5, 0); entityStore(state).units.add(soldier);
    updateRaiderMotivation(state, members[0], .1, actions);
    expect(pack.returning).toBe(true); expect(pack.phase).toBe('escape');
    expect(actions.move).toHaveBeenLastCalledWith(members[0], pack.home, .1);
    expect(actions.attack).toHaveBeenCalledTimes(1);
  });
  it('harasses undefended houses but never selects buildings covered by a tower', () => {
    const state = fixture(), { members } = band(state, 'harass'), actions = orders();
    const house = structure(200, 'house', 14, 24); entityStore(state).buildings.add(house);
    updateRaiderMotivation(state, members[0], .1, actions);
    expect(actions.attack).toHaveBeenLastCalledWith(members[0], house, .1);
    entityStore(state).buildings.add(structure(201, 'woodenTower', 16, 24)); state.time = 1;
    actions.attack.mockClear(); updateRaiderMotivation(state, members[0], .1, actions);
    expect(actions.attack).not.toHaveBeenCalled();
  });
  it('chooses the nearest reachable palace entrance and never paths through a closed wall ring', () => {
    const state = fixture(), from = { x: 18.5, y: 24.5 };
    expect(selectTheftPalace(state, from)?.palace.id).toBe(2);
    enclose(state);
    expect(selectTheftPalace(state, from)).toBeUndefined();
    const distant = structure(3, 'palace', 42, 24); entityStore(state).buildings.add(distant);
    const selected = selectTheftPalace(state, from)!;
    expect(selected.palace).toBe(distant);
    expect(canWalk(state, selected.entrance.x, selected.entrance.y, -2)).toBe(true);
  });
  it('abandons theft when a newly finished wall cuts off a still-walkable palace entrance', () => {
    const state = fixture(), { pack, members } = band(state, 'theft');
    updateRaiderGroupMotivation(state, pack, members);
    const entrance = pack.raidGoal!; expect(entrance).toBeDefined();
    enclose(state); expect(canWalk(state, entrance.x, entrance.y, -2)).toBe(true);
    state.time = 3; updateRaiderGroupMotivation(state, pack, members);
    expect(pack.returning).toBe(true);
  });
  it('never selects a Keep for theft, but can still choose an ordinary settlement of the same faction', () => {
    const state = fixture(), from = { x: 18.5, y: 24.5 };
    state.buildings[0].palaceLevel = 2;
    expect(selectTheftPalace(state, from)).toBeUndefined();
    const ordinary = structure(3, 'palace', 42, 24); entityStore(state).buildings.add(ordinary);
    expect(selectTheftPalace(state, from)?.palace).toBe(ordinary);
  });
  it('prevents an already-arrived thief stealing when its target becomes a Keep', () => {
    const state = fixture(), { pack, members } = band(state, 'theft', 3, 23.5, 24.5), actions = orders();
    updateRaiderGroupMotivation(state, pack, members);
    expect(pack.raidGoal).toBeDefined();
    state.buildings[0].palaceLevel = 2;
    const gold = state.factions[0].gold;
    updateRaiderMotivation(state, members[0], .1, actions);
    expect(state.factions[0].gold).toBe(gold);
    expect(members[0].stolenGold ?? 0).toBe(0);
    expect(pack.returning).toBe(true);
    expect(actions.move).toHaveBeenLastCalledWith(members[0], pack.home, .1);
  });
  it.each([[100, 100], [300, 200], [1000, 500]])('steals from %i gold once, capped to the actual treasury (%i)', (stock, stolen) => {
    const state = fixture(), { pack, members } = band(state, 'theft', 3, 23.5, 24.5), actions = orders();
    state.factions[0].gold = stock;
    updateRaiderGroupMotivation(state, pack, members);
    for (const member of members) updateRaiderMotivation(state, member, .1, actions);
    expect(state.factions[0].gold).toBe(stock - stolen);
    expect(members.reduce((sum, unit) => sum + (unit.stolenGold ?? 0), 0)).toBe(stolen);
    expect(pack.lootCarrier).toBe(members[0].id); expect(pack.returning).toBe(true);
    expect(actions.attack).not.toHaveBeenCalled();
  });
  it('lets thieves fight only a physical blocker or with at least a 3:1 nearby numerical advantage', () => {
    const state = fixture(), { pack, members } = band(state, 'theft', 2), actions = orders();
    pack.raidGoal = { x: 23.5, y: 24.5 };
    const defender = person(200, 12.5, 26.5, 0); entityStore(state).units.add(defender);
    updateRaiderMotivation(state, members[0], .1, actions);
    expect(actions.attack).not.toHaveBeenCalled();
    const third = { ...person(103, 13.5, 24.5), marauderPack: pack.id }; entityStore(state).units.add(third);
    updateRaiderMotivation(state, members[0], .1, actions);
    expect(actions.attack).toHaveBeenLastCalledWith(members[0], defender, .1);
    entityStore(state).units.replace(state.units.filter(unit => unit !== third)); defender.x = 13.5; defender.y = 24.5;
    actions.attack.mockClear(); updateRaiderMotivation(state, members[0], .1, actions);
    expect(actions.attack).toHaveBeenLastCalledWith(members[0], defender, .1);
  });
  it('includes nearby civilians when assessing the thieves’ three-to-one advantage', () => {
    const state = fixture(), { pack, members } = band(state, 'theft', 3), actions = orders();
    pack.raidGoal = { x: 23.5, y: 24.5 };
    const defender = person(200, 12.5, 26.5, 0), peasant = person(201, 12.5, 22.5, 0, 'worker');
    entityStore(state).units.add(defender, peasant);
    updateRaiderMotivation(state, members[0], .1, actions);
    // Three thieves against two humans is not 3:1, and neither blocks the route.
    expect(actions.attack).not.toHaveBeenCalled();
    entityStore(state).units.replace(state.units.filter(unit => unit !== defender));
    updateRaiderMotivation(state, members[0], .1, actions);
    expect(actions.attack).toHaveBeenLastCalledWith(members[0], peasant, .1);
  });
  it('never breaches a wall to attack a defender even with numerical superiority', () => {
    const state = fixture(), { pack, members } = band(state, 'theft', 3), actions = orders();
    pack.raidGoal = { x: 23.5, y: 24.5 };
    const wall = structure(300, 'wall', 13, 24), defender = person(200, 14.5, 24.5, 0);
    entityStore(state).buildings.add(wall); entityStore(state).units.add(defender);
    updateRaiderMotivation(state, members[0], .1, actions);
    expect(actions.attack).not.toHaveBeenCalled(); expect(actions.move).toHaveBeenCalled();
    updateGame(state, .1, idle);
    expect(wall.hp).toBe(wall.maxHp); expect(defender.hp).toBe(100);
  });
  it('keeps carried gold recoverable until the carrier reaches a surviving camp house', () => {
    const state = fixture(), { pack, members } = band(state, 'theft'), actions = orders();
    const house = structure(300, 'house', 4, 4, -2); entityStore(state).buildings.add(house);
    state.raiderCamps = [{ id: 60, size: 'small', name: 'Camp', x: 2, y: 2, width: 6, height: 6, houses: [300], coreTowers: [300], gate: { x: 4, y: 2 }, nextRaidAt: Infinity, waves: 1 }];
    pack.returning = true; members[0].stolenGold = 200;
    updateRaiderMotivation(state, members[0], .1, actions); expect(members[0].stolenGold).toBe(200);
    members[0].x = 3.5; members[0].y = 4.5;
    updateRaiderMotivation(state, members[0], .1, actions); expect(members[0].stolenGold).toBe(0);
    expect(state.factions[0].gold).toBe(500);
  });
  it('uses the live combat pipeline to return carried stolen gold to the killer', () => {
    const state = fixture(), { pack, members } = band(state, 'theft', 1, 23.5, 24.5);
    entityStore(state).buildings.add({ ...structure(300, 'house', 4, 4, -2), raiderCamp: 60 });
    state.raiderCamps = [{ id: 60, size: 'small', name: 'Camp', x: 2, y: 2, width: 6, height: 6, houses: [300], coreTowers: [300], gate: { x: 4, y: 2 }, nextRaidAt: Infinity, waves: 1 }];
    members[0].speed = 0; members[0].attack = 0;
    updateGame(state, .1, idle);
    expect(pack.raidObjectiveDone).toBe(true); expect(members[0].stolenGold).toBe(250);
    expect(state.factions[0].gold).toBe(250);
    const defender = { ...person(200, 22.5, 24.5, 0), attack: 1000, speed: 0 };
    members[0].hp = 1; entityStore(state).units.add(defender);
    updateGame(state, .1, idle);
    expect(members[0].hp).toBe(0); expect(members[0].stolenGold).toBe(0);
    expect(state.factions[0].gold).toBe(506); expect(defender.kills).toBe(1);
  });
  it('assembles beyond tower and archer range, holds, then releases a coordinated assault', () => {
    const state = fixture(), { pack, members } = band(state, 'siege', 10);
    const tower = structure(300, 'woodenTower', 22, 24), archer = person(301, 20.5, 22.5, 0, 'archer'); archer.range = 4;
    entityStore(state).buildings.add(tower); entityStore(state).units.add(archer);
    const rally = siegeRallyPoint(state, members[0], state.buildings[0])!;
    expect(distance(rally, { x: 22.5, y: 24.5 })).toBeGreaterThan(8);
    expect(distance(rally, archer)).toBeGreaterThan(6);
    pack.rally = rally; pack.musterTarget = 10;
    for (const member of members) { member.x = rally.x; member.y = rally.y; }
    updateRaiderGroupMotivation(state, pack, members);
    expect(pack.phase).toBe('muster'); expect(pack.musterUntil).toBe(30);
    state.time = 29; updateRaiderGroupMotivation(state, pack, members); expect(pack.phase).toBe('muster');
    state.time = 30; updateRaiderGroupMotivation(state, pack, members); expect(pack.phase).toBe('attack');
    expect(updateRaiderMotivation(state, members[0], .1, orders())).toBe(false);
  });
  it('promotes an archer commander back into a warrior without losing wounds or double-applying bonuses', () => {
    const state = fixture(), { pack, members } = band(state, 'siege'); delete pack.leaderId;
    members[0].hp = 50; setSoldierRole(members[0], 'archer');
    ensureMarauderLeaders(state); ensureMarauderLeaders(state);
    expect(members[0]).toMatchObject({ kind: 'warrior', maxHp: 120, hp: 60, range: 1.1, marauderLeader: true });
  });
});

describe('specialist wave scheduling and saturation', () => {
  function campFixture(retinue = 20): GameState {
    const state = fixture(); delete state.raiderCamps; delete state.fogRaids;
    for (let i = 0; i < retinue; i++) entityStore(state).units.add(person(1000 + i, 30.5, 30.5, 0));
    initializeFogRaids(state); state.raiderCamps!.slice(1).forEach(camp => { camp.nextRaidAt = Infinity; });
    return state;
  }
  function saturatedCamp(state: GameState): Unit[] {
    const camp = state.raiderCamps![0], home = { x: camp.gate.x + .5, y: camp.gate.y + .5 }, veterans: Unit[] = [];
    for (let group = 0; group < 3; group++) {
      const id = 500 + group, first = 20000 + group * 30;
      state.marauderPacks!.push({ id, name: 'Veterans', color: '#111', raiderCamp: camp.id, targetFaction: 0,
        home, waypoint: home, nextWanderAt: Infinity, leaderId: first, startingTroops: 29, raid: true, returning: group === 0 });
      for (let index = 0; index < 30; index++) {
        const unit: Unit = { ...person(first + index, home.x, home.y), marauderPack: id, marauderLeader: index === 0,
          hp: index === 0 ? 48 : 40, maxHp: index === 0 ? 120 : 100, kills: 7 };
        entityStore(state).units.add(unit); if (!group) veterans.push(unit);
      }
    }
    return veterans;
  }
  it('reuses leftover veterans after repeated small raids instead of stranding them at a saturated camp', () => {
    const state = campFixture(), veterans = saturatedCamp(state), camp = state.raiderCamps![0];
    const original = veterans.map(unit => [unit.id, unit.hp, unit.maxHp, unit.kills]);
    state.time = 1800;
    for (const wave of [2, 3, 6, 3, 2, 3]) {
      for (const pack of state.marauderPacks!) if (veterans.some(unit => unit.marauderPack === pack.id)) pack.returning = true;
      for (const unit of state.units) if (unit.faction === -2 && !veterans.includes(unit)) unit.lastCombat = state.time;
      camp.waves = wave; camp.nextRaidAt = state.time; state.fogRaids!.nextAt = state.time;
      updateFogRaids(state);
      const active = state.marauderPacks!.find(pack => pack.raid && !pack.returning && pack.spawnedAt === state.time)!;
      expect(veterans.filter(unit => unit.marauderPack === active.id)).toHaveLength(wave === 3 ? 30 : 10);
      expect(state.units.filter(unit => unit.faction === -2)).toHaveLength(MAX_LIVE_RAIDERS_PER_CAMP);
      expect(veterans.map(unit => [unit.id, unit.hp, unit.maxHp, unit.kills])).toEqual(original);
      for (const pack of state.marauderPacks!) {
        const members = state.units.filter(unit => unit.marauderPack === pack.id);
        expect(members.length).toBeLessThanOrEqual(30);
        expect(members.filter(unit => unit.marauderLeader).length).toBeLessThanOrEqual(1);
      }
      state.time += 60;
    }
    expect(new Set(veterans.map(unit => unit.marauderPack)).size).toBe(1);
  });
  it('reinforces a siege with returned reserves even when the camp cannot create more raiders', () => {
    const state = campFixture(40), veterans = saturatedCamp(state), camp = state.raiderCamps![0];
    const original = veterans.map(unit => [unit.id, unit.hp, unit.maxHp, unit.kills, unit.x, unit.y]);
    camp.waves = 7; state.time = 1800; updateFogRaids(state);
    const siege = state.marauderPacks!.find(pack => pack.motivation === 'siege')!;
    expect(veterans.filter(unit => unit.marauderPack === siege.id)).toHaveLength(10);
    // This isolated scheduler test holds the army at its assembly point;
    // an unmoving approach now correctly returns home after thirty seconds.
    siege.phase = 'muster'; siege.musterStartedAt = state.time; siege.musterUntil = state.time + 30;
    camp.nextRaidAt = Infinity; state.fogRaids!.nextAt = Infinity;
    for (let count = 15; count <= 30; count += 5) {
      state.time += 15; updateFogRaids(state);
      expect(veterans.filter(unit => unit.marauderPack === siege.id)).toHaveLength(count);
      expect(state.units.filter(unit => unit.faction === -2)).toHaveLength(MAX_LIVE_RAIDERS_PER_CAMP);
    }
    expect(siege.siegeNextReinforceAt).toBeUndefined();
    expect(veterans.map(unit => [unit.id, unit.hp, unit.maxHp, unit.kills, unit.x, unit.y])).toEqual(original);
    expect(veterans.filter(unit => unit.marauderLeader)).toHaveLength(1);
  });
  it('reduces the archer share by one-third to 80:20, including commanders, without altering commander role', () => {
    expect([0, 120, 420, 720, 7200].map(raiderArcherFraction)).toEqual([0, 0, .1, .2, .2]);
    const state = campFixture(); state.time = 1800; updateFogRaids(state);
    const raiders = state.units.filter(unit => unit.faction === -2);
    expect(raiders).toHaveLength(60); expect(raiders.filter(unit => unit.kind === 'archer')).toHaveLength(12);
    expect(raiders.filter(unit => unit.marauderLeader).every(unit => unit.kind === 'warrior')).toBe(true);
  });
  it('adds siege reinforcements every 15s without delaying them until the next ordinary wave', () => {
    const state = campFixture(), camp = state.raiderCamps![0]; camp.waves = 7;
    state.time = 600; updateFogRaids(state);
    const pack = state.marauderPacks!.find(pack => pack.raiderCamp === camp.id)!;
    const count = () => state.units.filter(unit => unit.hp > 0 && unit.marauderPack === pack.id).length;
    expect(pack.motivation).toBe('siege'); expect(count()).toBe(8); expect(pack.musterTarget).toBe(16);
    for (const member of state.units.filter(unit => unit.marauderPack === pack.id)) { member.x = 15.5; member.y = 20.5; }
    state.time = 614.9; updateFogRaids(state); expect(count()).toBe(8);
    state.time = 615; updateFogRaids(state); expect(count()).toBe(12);
    for (const member of state.units.filter(unit => unit.marauderPack === pack.id)) { member.x = 15.5; member.y = 20.5; }
    state.time = 630; updateFogRaids(state); expect(count()).toBe(16);
    expect(state.fogRaids!.waves).toBe(1); expect(pack.siegeNextReinforceAt).toBeUndefined();
    expect(pack.startingTroops).toBe(15);
  });
  it('shares the global/camp caps with siege reinforcements and stops them after camp destruction', () => {
    const state = campFixture(100), camp = state.raiderCamps![0]; camp.waves = 7;
    state.time = 600; updateFogRaids(state);
    const pack = state.marauderPacks![0]; expect(pack.musterTarget).toBe(24);
    const count = () => state.units.filter(unit => unit.hp > 0 && unit.faction === -2).length;
    let id = 10000;
    while (count() < MAX_LIVE_RAIDERS) entityStore(state).units.add({ ...person(id++, 15.5, 20.5), marauderPack: pack.id + 100 });
    state.time = 615; updateFogRaids(state); expect(count()).toBe(MAX_LIVE_RAIDERS);
    expect(state.units.filter(unit => unit.marauderPack === pack.id)).toHaveLength(8);
    for (const house of state.buildings) if (camp.coreTowers!.includes(house.id)) house.hp = 0;
    state.units.filter(unit => unit.marauderPack === pack.id + 100).slice(0, 20).forEach(unit => { unit.hp = 0; });
    state.time = 630; updateFogRaids(state);
    expect(pack.siegeNextReinforceAt).toBeUndefined(); expect(count()).toBe(MAX_LIVE_RAIDERS - 20);
    expect(state.units.filter(unit => unit.hp > 0 && unit.marauderPack === pack.id).length).toBeLessThanOrEqual(MAX_LIVE_RAIDERS_PER_CAMP);
  });
  it('limits siege reinforcement by the remaining camp budget, independently of the world budget', () => {
    const state = campFixture(100), camp = state.raiderCamps![0]; camp.waves = 7;
    state.time = 600; updateFogRaids(state);
    const pack = state.marauderPacks![0], old = { ...pack, id: 999, motivation: 'assault' as const, returning: false, siegeNextReinforceAt: undefined };
    state.marauderPacks!.push(old);
    for (let i = 0; i < MAX_LIVE_RAIDERS_PER_CAMP - 12; i++) entityStore(state).units.add({ ...person(10000 + i, 15.5, 20.5), marauderPack: old.id });
    for (const member of state.units.filter(unit => unit.marauderPack === pack.id)) { member.x = 15.5; member.y = 20.5; }
    state.time = 615; updateFogRaids(state);
    expect(state.units.filter(unit => unit.hp > 0 && unit.faction === -2)).toHaveLength(MAX_LIVE_RAIDERS_PER_CAMP);
    expect(state.units.filter(unit => unit.marauderPack === pack.id)).toHaveLength(12);
    pack.phase = 'attack'; state.time = 630; updateFogRaids(state);
    expect(pack.siegeNextReinforceAt).toBeUndefined();
    expect(state.units.filter(unit => unit.marauderPack === pack.id)).toHaveLength(12);
  });
  it('spawns bounded harass/theft parties and falls back to assault against sealed cities', () => {
    for (const waves of [2, 4]) {
      const state = campFixture(), camp = state.raiderCamps![0]; camp.waves = waves;
      state.time = 600; updateFogRaids(state);
      expect(state.marauderPacks![0].motivation).toBe(waves === 2 ? 'harass' : 'theft');
      expect(state.units.filter(unit => unit.faction === -2).length).toBeLessThanOrEqual(10);
    }
    const state = campFixture(), camp = state.raiderCamps![0]; camp.waves = 4; enclose(state);
    state.time = 600; updateFogRaids(state);
    expect(state.marauderPacks![0].motivation).toBe('assault');
  });
});
