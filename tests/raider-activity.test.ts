import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { canReleaseRaiderReserve, defendRaiderCamp, initializeRaiderSkirmishes, releaseRaiderReserve, updateRaiderActivity, updateRaiderReturn, RAIDER_CAMP_RESERVES } from '../src/game/raider-activity';
import { beginBattleRout } from '../src/game/battle-morale';
import { notifyRaiderAttack, updateRaiderAlert, RAIDER_ALARM_RADIUS, RAIDER_ALARM_SECONDS } from '../src/game/raider-alerts';
import { MAX_LIVE_RAIDERS, MAX_LIVE_RAIDERS_PER_CAMP } from '../src/game/raider-camps';
import { continueAfterVictory, updateGame } from '../src/game/simulation';
import { canWalk, travelTimeMap } from '../src/game/pathfinding';
import { fogRaidProfile, updateFogRaids } from '../src/game/fog-raids';
import { type GameState, type MarauderPack, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, x: number, y: number, faction = -2): Unit => ({ id, x, y, faction, kind: 'warrior', hp: 100, maxHp: 100,
  attack: 0, defense: 0, morale: 100, speed: 2.35, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, lastDamagedAt: -60, facing: 0, moving: false, attackTime: 0 });
function fixture(): GameState {
  return { world: { seed: 'activity', source: 'test', width: 64, height: 40, spawns: [], tiles: Array.from({ length: 2560 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 1, production: 0, gold: 0, variation: .5 })) },
    units: [{ ...person(1, 8.5, 20.5, 0), kind: 'leader', speed: 0 }],
    buildings: [{ id: 2, kind: 'palace', x: 7, y: 17, faction: 0, hp: 10000, maxHp: 10000, capacity: 0 },
      { id: 3, kind: 'house', x: 38, y: 18, faction: -2, hp: 200, maxHp: 200, capacity: 0, raiderCamp: 1 },
      { id: 4, kind: 'wall', x: 36, y: 18, faction: -2, hp: 200, maxHp: 200, capacity: 0, raiderCamp: 1 }],
    factions: [{ id: 0, name: 'Test', color: '#f00', affinity: 100, relation: 'self', food: 0, gold: 0, production: 0, population: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, seed: 'activity', rngState: 1, events: [], particles: [], fields: [], projectiles: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, marauderPacks: [], roamingMaraudersVersion: 1,
    raiderCamps: [{ id: 1, size: 'small', x: 36, y: 16, width: 7, height: 7, gate: { x: 36, y: 19 }, houses: [3], coreTowers: [4], name: 'Camp', waves: 0, nextRaidAt: 1e9 }],
    fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 } };
}
function returned(state: GameState, count = 1): { pack: MarauderPack; members: Unit[] } {
  const pack: MarauderPack = { id: 10, name: 'Returned', color: '#111', home: { x: 36.5, y: 19.5 }, waypoint: { x: 36.5, y: 19.5 },
    targetFaction: 0, nextWanderAt: 1e9, raid: true, returning: true, raiderCamp: 1 };
  state.marauderPacks!.push(pack);
  const members = Array.from({ length: count }, (_, i) => ({ ...person(100 + i, 37.5, 18.5), marauderPack: 10, hp: 43, kills: 31 }));
  entityStore(state).units.add(...members); return { pack, members };
}
const defenders = (state: GameState) => state.units.filter(unit => state.marauderPacks?.some(pack => pack.campDefense && pack.id === unit.marauderPack));

describe('camp activity and small raids', () => {
  it('broadcasts attacks to allies fourteen tiles away without revealing hidden enemy movement', () => {
    const state = fixture(), { pack, members } = returned(state, 3);
    Object.assign(pack, { returning: false, raid: true, targetBuilding: 2 });
    const [victim, ally, distant] = members;
    Object.assign(victim, { x: 26.5, y: 25.5, hp: 100 });
    Object.assign(ally, { x: victim.x + RAIDER_ALARM_RADIUS - 1, y: victim.y, hp: 100 });
    Object.assign(distant, { x: victim.x + RAIDER_ALARM_RADIUS + 1, y: victim.y, hp: 100 });
    const attacker = state.units[0]; attacker.x = 25.5; attacker.y = 25.5;
    expect(notifyRaiderAttack(state, victim, attacker)).toBe(2);
    const goals: { x: number; y: number }[] = [];
    const orders = { move: (point: { x: number; y: number }) => goals.push({ ...point }), attack: () => { throw Error('Enemy is not visible'); }, visible: () => false };
    expect(updateRaiderAlert(state, ally, .1, orders)).toBe(true);
    expect(goals).toEqual([{ x: 25.5, y: 25.5 }]);
    attacker.x = 10.5;
    updateRaiderAlert(state, ally, .1, orders);
    expect(goals.at(-1)).toEqual({ x: 25.5, y: 25.5 });
    expect(updateRaiderAlert(state, distant, .1, orders)).toBe(false);
    state.time = RAIDER_ALARM_SECONDS;
    expect(updateRaiderAlert(state, ally, .1, orders)).toBe(false);
  });

  it('wakes nearby tent occupants on an attack but leaves routed and wounded retreating leaders sheltered', () => {
    const state = fixture(), { members } = returned(state, 3);
    const [reserve, routed, commander] = members;
    for (const unit of members) {
      Object.assign(unit, { inside: true, raiderGarrison: 3, x: 38.5, y: 18.5 });
      entityStore(state).setUnitSleeping(unit, true);
    }
    beginBattleRout(state, routed);
    Object.assign(commander, { marauderLeader: true, marauderRetreating: true });
    const attacker = { x: 37.5, y: 18.5, faction: 0 };
    expect(notifyRaiderAttack(state, state.buildings[1], attacker)).toBe(1);
    expect(reserve.inside).toBe(false); expect(entityStore(state).units.query('active')).toContain(reserve);
    expect(routed.inside).toBe(true); expect(commander.inside).toBe(true);
    expect(state.units).toHaveLength(4); // The alarm reuses bodies, never spawns them.
    expect(notifyRaiderAttack(state, state.buildings[1], attacker)).toBe(0); // Event throttled.
  });

  it.each(['melee', 'arrow', 'ballistaBolt'] as const)('shares a real %s attack with a distant ally beyond ordinary sensing', source => {
    const state = fixture(), { pack, members } = returned(state, 2);
    const [victim, ally] = members;
    Object.assign(pack, { returning: false, raid: true, targetBuilding: 2, motivation: 'assault' });
    Object.assign(victim, { x: 24.5, y: 25.5, hp: 100, attack: 0 });
    Object.assign(ally, { x: 36.5, y: 25.5, hp: 100, attack: 0 });
    const attacker = { ...person(20, 23.5, 25.5, 0), attack: source === 'melee' ? 5 : 0,
      speed: 0, target: victim.id, forcedAttack: { target: victim.id } };
    entityStore(state).units.add(attacker);
    if (source !== 'melee') state.projectiles = [{ x: attacker.x, y: attacker.y, start: { x: attacker.x, y: attacker.y },
      end: { x: victim.x, y: victim.y }, attacker: attacker.id, target: victim.id, faction: 0, damage: 5,
      kind: source, elapsed: 0, duration: .01, startHeight: .5 }];
    for (let step = 0; step < 5; step++) updateGame(state, .1, idle);
    expect(victim.hp).toBeLessThan(100);
    const goals: { x: number; y: number }[] = [];
    expect(updateRaiderAlert(state, ally, .1, { move: goal => goals.push(goal), attack: () => {}, visible: () => false })).toBe(true);
    expect(goals.at(-1)).toEqual({ x: attacker.x, y: attacker.y });
  });

  it('does not redeploy routed camp reserves before their fifteen-second deadline', () => {
    const state = fixture(), { members } = returned(state), reserve = members[0];
    beginBattleRout(state, reserve);
    Object.assign(reserve, { inside: true, raiderGarrison: 3, x: 38.5, y: 18.5, morale: 100 });
    state.time = 14.99;
    expect(canReleaseRaiderReserve(state, reserve)).toBe(false);
    expect(releaseRaiderReserve(state, reserve)).toBe(false);
    expect(reserve).toMatchObject({ inside: true, routed: true, order: 'flee', routUntil: 15 });
    state.time = 15;
    expect(releaseRaiderReserve(state, reserve)).toBe(true);
    expect(reserve).toMatchObject({ inside: false, routed: false, order: 'raid' });
    expect(reserve.routUntil).toBeUndefined();
  });

  it('evacuates a destroyed camp shelter without prematurely rallying its routed occupant', () => {
    const state = fixture(), { members } = returned(state), reserve = members[0];
    beginBattleRout(state, reserve);
    Object.assign(reserve, { inside: true, raiderGarrison: 3, x: 38.5, y: 18.5, morale: 20 });
    state.buildings[1].hp = 0; state.time = 2;
    updateRaiderActivity(state);
    expect(reserve).toMatchObject({ inside: false, routed: true, order: 'flee', routUntil: 15, morale: 20 });
    expect(reserve.raiderGarrison).toBeUndefined();
  });

  it('does not turn a routed idle band into a new small attack or cancel its panic during return planning', () => {
    const state = fixture(), { pack, members } = returned(state), reserve = members[0];
    delete pack.raiderCamp; pack.raid = false; pack.returning = false;
    beginBattleRout(state, reserve);
    state.raiderSkirmishes = { nextByFaction: { 0: 1 }, wavesByFaction: { 0: 0 } };
    state.time = 2;
    updateRaiderActivity(state);
    expect(reserve).toMatchObject({ marauderPack: pack.id, routed: true, order: 'flee', routUntil: 15 });
    pack.campDefense = true; pack.defenseUntil = 2;
    state.time = 3;
    updateRaiderActivity(state);
    expect(reserve).toMatchObject({ routed: true, order: 'flee', routUntil: 15 });
  });

  it('lets overflow soldiers attack while their old commander remains safely garrisoned', () => {
    const state = fixture(), { pack, members } = returned(state, 2);
    const [commander, soldier] = members;
    Object.assign(commander, { marauderLeader: true, marauderRetreating: true, inside: true, raiderGarrison: 3, x: 38.5, y: 18.5 });
    Object.assign(pack, { leaderId: commander.id, startingTroops: 1, motivation: 'assault', raid: true, returning: false, targetBuilding: 2 });
    soldier.x = 32.5; soldier.y = 20.5;
    for (let step = 0; step < 80; step++) updateGame(state, .1, idle);
    expect(pack.returning).toBe(false);
    expect(soldier.x).toBeLessThan(25);
    expect(commander.inside).toBe(true);
    expect(commander.raiderGarrison).toBe(3);
    // The reserve retains its identity and experience for a later departure.
    expect(commander.kills).toBe(31);
  });

  it('does not make an active commander wait for a troop who is sleeping inside the camp', () => {
    const state = fixture(), { pack, members } = returned(state, 2);
    const [commander, reserve] = members;
    Object.assign(commander, { marauderLeader: true, x: 32.5, y: 20.5 });
    Object.assign(reserve, { inside: true, raiderGarrison: 3, x: 38.5, y: 18.5 });
    Object.assign(pack, { leaderId: commander.id, startingTroops: 1, motivation: 'assault', raid: true, returning: false, targetBuilding: 2 });
    for (let step = 0; step < 80; step++) updateGame(state, .1, idle);
    expect(commander.x).toBeLessThan(25);
    expect(pack.returning).toBe(false);
    expect(reserve.inside).toBe(true);
  });

  it('resumes both raid clocks after Keep playing without bypassing the victory menu', () => {
    const state = fixture();
    state.time = 60; state.raiderCamps![0].nextRaidAt = 60; state.fogRaids!.nextAt = 60;
    state.raiderSkirmishes = { nextByFaction: { 0: 60 }, wavesByFaction: { 0: 0 } };
    state.gameOver = true; state.victory = true; state.paused = true;
    updateFogRaids(state);
    expect(state.fogRaids!.waves).toBe(0); expect(state.raiderSkirmishes.wavesByFaction[0]).toBe(0);
    expect(continueAfterVictory(state)).toBe(true);
    updateFogRaids(state);
    expect(state.fogRaids!.waves).toBe(1); expect(state.raiderSkirmishes.wavesByFaction[0]).toBe(1);
    expect(state.marauderPacks!.some(pack => pack.microRaid)).toBe(true);
    expect(state.marauderPacks!.some(pack => pack.raid && !pack.microRaid)).toBe(true);
    state.time = 90; updateFogRaids(state);
    expect(state.fogRaids!.waves).toBe(2); expect(state.raiderSkirmishes.wavesByFaction[0]).toBe(2);
    expect(state.units.filter(unit => unit.hp > 0 && unit.faction === -2).length).toBeLessThanOrEqual(MAX_LIVE_RAIDERS_PER_CAMP);
  });

  it('retires a stalled siege approach even while its unfilled reinforcement timer keeps retrying', () => {
    const state = fixture(), { pack, members } = returned(state, 10);
    Object.assign(pack, { returning: false, motivation: 'siege', phase: 'approach', musterTarget: 30,
      siegeNextReinforceAt: 15, targetBuilding: 2, rally: { x: 23.5, y: 18.5 },
      lastProgressAt: 0, progressPosition: { x: 37.5, y: 18.5 } });
    // These live distant attackers fill the global budget, so the siege cannot
    // complete its muster by manufacturing extra troops while its route is shut.
    entityStore(state).units.add(...Array.from({ length: MAX_LIVE_RAIDERS - members.length }, (_, index) => person(1000 + index, 55.5, 32.5)));
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 30].terrain = 'river';
    state.time = 31;
    updateRaiderActivity(state);
    expect(pack.returning).toBe(true);
    expect(pack.siegeNextReinforceAt).toBeUndefined();
    expect(pack.home).toEqual({ x: 36.5, y: 19.5 });
    expect(state.units.filter(unit => unit.hp > 0 && unit.faction === -2)).toHaveLength(MAX_LIVE_RAIDERS);
  });

  it.each(['house', 'wall', 'road'] as const)('responds to each actual %s once per episode with 2–5 soldiers outside its footprint', kind => {
    const state = fixture(), building = state.buildings[1]; building.kind = kind;
    const attacker = { x: building.x - .5, y: building.y + .5, faction: 0 };
    const first = defendRaiderCamp(state, building, attacker);
    expect(first).toBeGreaterThanOrEqual(2); expect(first).toBeLessThanOrEqual(5);
    expect(defenders(state).every(unit => unit.kind === 'warrior' || unit.kind === 'archer')).toBe(true);
    for (const unit of defenders(state)) {
      expect(unit.marauderLeader).not.toBe(true); expect(canWalk(state, unit.x, unit.y, -2)).toBe(true);
      expect(Math.floor(unit.x) === building.x && Math.floor(unit.y) === building.y).toBe(false);
    }
    expect(defendRaiderCamp(state, building, attacker)).toBe(0);
    state.time = 29.99; expect(defendRaiderCamp(state, building, attacker)).toBe(0);
    state.time = 30; expect(defendRaiderCamp(state, building, attacker)).toBeGreaterThanOrEqual(2);
    expect(defendRaiderCamp(state, state.buildings[2], attacker)).toBeGreaterThanOrEqual(2);
  });

  it('reduces camp-defense archer assignments by one-third across small parties', () => {
    let formerArcherAssignments = 0, archers = 0;
    for (let seed = 1; seed <= 180; seed++) {
      const state = fixture(); state.rngState = seed;
      const building = state.buildings[1];
      const count = defendRaiderCamp(state, building, { x: building.x - .5, y: building.y + .5, faction: 0 });
      formerArcherAssignments += Math.floor((count + 1) / 3);
      archers += defenders(state).filter(unit => unit.kind === 'archer').length;
    }
    expect(archers / formerArcherAssignments).toBeGreaterThan(.58);
    expect(archers / formerArcherAssignments).toBeLessThan(.75);
  });

  it.each(['melee', 'arrow', 'tower'] as const)('triggers defenders on a lethal %s hit through the real combat pipeline', source => {
    const state = fixture(), target = state.buildings[1]; target.hp = 1;
    const attacker = { ...person(20, target.x + .5, target.y - .5, 0), attack: 500, target: target.id, forcedAttack: { target: target.id }, order: 'hold' as const, speed: 0 };
    entityStore(state).units.add(attacker);
    if (source !== 'melee') {
      if (source === 'tower') entityStore(state).buildings.add({ id: 21, kind: 'woodenTower', faction: 0, x: 40, y: 18, hp: 100, maxHp: 100, capacity: 0 });
      const from = { x: source === 'tower' ? 40.5 : attacker.x, y: 18.5 };
      state.projectiles = [{ ...from, start: from, end: { x: target.x + .5, y: target.y + .5 }, attacker: source === 'tower' ? 21 : attacker.id,
        target: target.id, faction: 0, damage: 500, kind: 'arrow', elapsed: 0, duration: .01, startHeight: .5 }];
      attacker.attack = 0;
    }
    updateGame(state, .1, idle);
    expect(target.hp).toBe(0);
    const response = state.units.filter(unit => unit.faction === -2);
    expect(response.length).toBeGreaterThanOrEqual(2); expect(response.length).toBeLessThanOrEqual(5);
    expect(state.raiderCamps![0].defenderReadyAt?.[target.id]).toBeGreaterThan(30);
  });

  it('walks survivors inside a real camp building and releases their active slots without losing experience or wounds', () => {
    const state = fixture(), { pack, members: [unit] } = returned(state);
    expect(updateRaiderReturn(state, unit, pack, () => { throw Error('Already at the door'); })).toBe(true);
    expect(unit.inside).toBe(true); expect(unit.raiderGarrison).toBe(3);
    expect(entityStore(state).units.query('active')).not.toContain(unit);
    expect(releaseRaiderReserve(state, unit)).toBe(true);
    expect(unit.inside).toBe(false); expect(unit.raiderGarrison).toBeUndefined();
    expect(entityStore(state).units.query('active')).toContain(unit);
    expect(unit.hp).toBe(43); expect(unit.kills).toBe(31); expect(canWalk(state, unit.x, unit.y, -2)).toBe(true);
  });

  it('bounds inactive reserves and returns overflow to attack instead of idling at the gate', () => {
    const state = fixture(), { pack, members } = returned(state, RAIDER_CAMP_RESERVES + 1);
    for (const unit of members) updateRaiderReturn(state, unit, pack, () => {});
    expect(state.units.filter(unit => unit.inside)).toHaveLength(RAIDER_CAMP_RESERVES);
    expect(pack.returning).toBe(false); expect(members.at(-1)!.inside).not.toBe(true);
  });

  it('wakes survivors when their shelter and core are destroyed and reassigns their orphaned band', () => {
    const state = fixture(), { pack, members: [unit] } = returned(state);
    updateRaiderReturn(state, unit, pack, () => {});
    state.buildings[1].hp = 0; state.buildings[2].hp = 0;
    updateRaiderActivity(state);
    expect(unit.inside).toBe(false); expect(entityStore(state).units.query('active')).toContain(unit);
    expect(pack.raiderCamp).toBeUndefined(); expect(pack.returning).toBe(false); expect(pack.targetFaction).toBe(0);
  });

  it('respects the global and camp caps even when every structure requests defenders', () => {
    for (const [count, attached] of [[MAX_LIVE_RAIDERS, false], [MAX_LIVE_RAIDERS_PER_CAMP, true]] as const) {
      const state = fixture();
      if (attached) returned(state, count);
      else entityStore(state).units.add(...Array.from({ length: count }, (_, i) => person(100 + i, 50.5, 30.5)));
      // Make camp members active attackers, not reusable returned reserves.
      for (const pack of state.marauderPacks!) { pack.returning = false; pack.raid = true; }
      expect(defendRaiderCamp(state, state.buildings[1], state.units[0])).toBe(0);
      expect(state.units.filter(unit => unit.faction === -2)).toHaveLength(count);
    }
  });

  it('never emits a one-person camp defense when only one body slot is available', () => {
    const state = fixture();
    entityStore(state).units.add(...Array.from({ length: MAX_LIVE_RAIDERS - 1 }, (_, i) => person(100 + i, 50.5, 30.5)));
    expect(defendRaiderCamp(state, state.buildings[1], state.units[0])).toBe(0);
    expect(state.units.filter(unit => unit.faction === -2)).toHaveLength(MAX_LIVE_RAIDERS - 1);
  });

  it('uses a farther reachable house instead of waiting forever outside an inaccessible nearer house', () => {
    const state = fixture(), { pack, members: [unit] } = returned(state);
    unit.x = 34.5; unit.y = 18.5;
    entityStore(state).buildings.add({ ...state.buildings[1], id: 5, x: 43 });
    state.raiderCamps![0].houses.push(5);
    for (const [x, y] of [[37, 18], [39, 18], [38, 17], [38, 19]]) state.world.tiles[y * state.world.width + x].terrain = 'lake';
    let goal: { x: number; y: number } | undefined;
    expect(updateRaiderReturn(state, unit, pack, point => { goal = point; })).toBe(true);
    expect(goal!.x).toBeGreaterThan(40); expect(unit.inside).not.toBe(true);
  });

  it('keeps sleepers reusable when a full garrison sends its active overflow back to attack', () => {
    const state = fixture(), { pack, members } = returned(state, RAIDER_CAMP_RESERVES + 1);
    for (const unit of members) updateRaiderReturn(state, unit, pack, () => {});
    expect(pack.returning).toBe(false);
    const count = defendRaiderCamp(state, state.buildings[1], state.units[0]);
    expect(count).toBeGreaterThanOrEqual(2);
    const reused = defenders(state).filter(unit => members.includes(unit)).length;
    expect(reused).toBeGreaterThanOrEqual(2); // The active overflow may occupy one of the four house doors.
    expect(state.units.filter(unit => unit.faction === -2)).toHaveLength(RAIDER_CAMP_RESERVES + 1 + count - reused);
    expect(state.units.filter(unit => unit.inside)).toHaveLength(RAIDER_CAMP_RESERVES - reused);
  });

  it('reserves distinct exits before spawning fresh recruits, and leaves blocked sleepers in their original pack', () => {
    const state = fixture(), { pack, members } = returned(state, 7);
    for (const unit of members) updateRaiderReturn(state, unit, pack, () => {});
    state.time = 300; state.raiderCamps![0].nextRaidAt = 300; state.fogRaids!.nextAt = 300;
    updateFogRaids(state);
    const active = state.units.filter(unit => unit.faction === -2 && !unit.inside);
    expect(new Set(active.map(unit => `${Math.floor(unit.x)},${Math.floor(unit.y)}`)).size).toBe(active.length);
    expect(members.filter(unit => unit.inside)).toHaveLength(3); // A one-tile house has four distinct doors.
    expect(members.filter(unit => unit.inside).every(unit => unit.marauderPack === pack.id)).toBe(true);
    expect(members.filter(unit => !unit.inside).every(unit => entityStore(state).units.query('active').includes(unit))).toBe(true);
  });

  it('seeds real reachable opening attacks and fairly schedules 1–5-person parties for full factions', () => {
    const state = fixture();
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' }, { ...state.factions[0], id: 2, relation: 'peace', villageId: 1 });
    entityStore(state).buildings.add({ ...state.buildings[0], id: 30, faction: 1, x: 53, y: 18 });
    entityStore(state).units.add({ ...person(31, 55.5, 20.5, 1), kind: 'leader' });
    const clock = structuredClone(state.fogRaids);
    initializeRaiderSkirmishes(state);
    expect(state.marauderPacks!.filter(pack => pack.microRaid).map(pack => pack.targetFaction).sort()).toEqual([0, 1]);
    for (const pack of state.marauderPacks!) {
      const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === pack.targetFaction)!;
      const travel = travelTimeMap(state, leader, -2, 2.35, 18);
      const members = state.units.filter(unit => unit.marauderPack === pack.id);
      expect(members).toHaveLength(3);
      for (const unit of members) expect(travel[Math.floor(unit.y) * state.world.width + Math.floor(unit.x)]).toBeLessThanOrEqual(18);
    }
    expect(state.raiderSkirmishes!.nextByFaction[2]).toBeUndefined();
    for (let wave = 0; wave < 5; wave++) {
      state.time = Math.max(...Object.values(state.raiderSkirmishes!.nextByFaction));
      updateRaiderActivity(state);
      for (const faction of [0, 1]) {
        const pack = state.marauderPacks!.filter(pack => pack.microRaid && pack.targetFaction === faction && pack.spawnedAt === state.time).at(-1)!;
        expect(pack).toBeDefined(); expect(state.units.filter(unit => unit.marauderPack === pack.id)).toHaveLength(wave + 1);
        expect(state.raiderSkirmishes!.nextByFaction[faction] - state.time).toBeGreaterThanOrEqual(18);
        expect(state.raiderSkirmishes!.nextByFaction[faction] - state.time).toBeLessThanOrEqual(24);
      }
    }
    expect(state.fogRaids).toEqual(clock); expect(fogRaidProfile(5, 60).total).toBe(4);
  });

  it('does not count garrisoned or small parties against ordinary-wave slots and reuses sleeping veterans', () => {
    const state = fixture(), { pack, members: [unit] } = returned(state);
    updateRaiderReturn(state, unit, pack, () => {});
    for (let i = 0; i < 10; i++) {
      const id = 20 + i;
      state.marauderPacks!.push({ ...pack, id, raid: true, returning: false, microRaid: true, spawnedAt: i });
      entityStore(state).units.add({ ...person(200 + i, 25.5, 30.5), marauderPack: id });
    }
    state.time = 60; state.raiderCamps![0].nextRaidAt = 60; state.fogRaids!.nextAt = 60;
    updateFogRaids(state);
    expect(state.fogRaids!.waves).toBe(1); expect(unit.inside).toBe(false); expect(unit.marauderPack).not.toBe(pack.id);
    expect(unit.hp / unit.maxHp!).toBeCloseTo(.43); expect(unit.kills).toBe(31);
  });
});
