import { describe, expect, it } from 'vitest';
import { clearArea, demolishBuildingsInArea } from '../src/game/area-tools';
import { borderRadius, insideOwnBorders, territory, UNCLAIMED } from '../src/game/borders';
import { buildingArmor } from '../src/game/defense-equipment';
import { entityStore } from '../src/game/entity-store';
import { FORT_BASE_HP, FORT_BUILD_SECONDS, FORT_GOLD, FORT_UPKEEP, SKIRMISHER_SPEED, fortBrigadeCapacity, preserveDestroyedFort,
  rebuildFort, rebuildFortStatus, updateForts, updateFortSkirmisher, upgradeFortBrigade, upgradeFortBrigadeStatus } from '../src/game/forts';
import { buildAt, updateGame, validateBuildAt } from '../src/game/simulation';
import { applyGameCommand } from '../src/multiplayer/commands';
import { withPlayerFaction } from '../src/game/player-context';
import { updateWoodenTowers, WOODEN_TOWER_ATTACK } from '../src/game/tower-combat';
import { buildingHeight, buildingWidth, type Building, type GameState, type Unit } from '../src/game/types';
import { updateWallStats } from '../src/game/wall-stats';
import { updateWallOwnership } from '../src/game/wall-ownership';

const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({ id, kind, x, y, faction,
  hp: FORT_BASE_HP, maxHp: FORT_BASE_HP, capacity: 0, armor: 2 });
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({ id, kind, faction, x, y,
  hp: 100, maxHp: 100, morale: 100, attack: 14, defense: 4, speed: 3, range: 1.1, order: 'hold', cooldown: 0,
  lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
function fixture(): GameState {
  return { world: { width: 48, height: 40, seed: 'forts', source: 'test', spawns: [],
    tiles: Array.from({ length: 48 * 40 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6,
      food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [unit(10, 'leader', 19.5, 20.5)], buildings: [building(1, 'palace', 4, 4), building(2, 'fort', 20, 20)],
    factions: [0, 1].map(id => ({ id, name: `Test ${id}`, color: '#3988ff', affinity: 0, relation: id ? 'war' : 'self', food: 500,
      gold: 2000, production: 500, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'forts', rngState: 1, fields: [],
    marauderPacks: [], fogRaids: { nextAt: 1000, waves: 0, pressureVersion: 1 } };
}
const idle = { up: false, down: false, left: false, right: false };

describe('Forts', () => {
  it('validates, pays for and physically constructs a Fort only on owned land and a researched supply depot', () => {
    const state = fixture(); entityStore(state).buildings.retain(site => site.kind === 'palace');
    state.factions = [state.factions[0]];
    const faction = state.factions[0], palace = state.buildings[0], leader = state.units[0];
    Object.assign(palace, { x: 12, y: 8 });
    Object.assign(leader, { x: 14.5, y: 10.5 });
    Object.assign(palace, { capacity: 10, unhousedResidents: 6, governorPermissions: { farms: false, housing: false } });
    faction.population = 6;
    expect(validateBuildAt(state, 'fort', 15, 8)).toMatchObject({ ok: false, message: 'Research Masonry at a library first.' });
    expect(validateBuildAt(state, 'supplyDepot', 9, 6)).toMatchObject({ ok: false, message: 'Research Supply train at a library first.' });
    faction.research = { focus: 'wall', levels: { wall: 1, supplyTrain: 1 }, progress: {} };
    expect(insideOwnBorders(state, 0, 15.5, 8.5)).toBe(true);
    expect(validateBuildAt(state, 'fort', 23, 8)).toMatchObject({ ok: false, message: 'Build entirely within your faction’s borders.' });
    expect(buildAt(state, 'fort', 15, 8).ok).toBe(true);
    expect(buildAt(state, 'supplyDepot', 9, 6).ok).toBe(true);
    expect(faction.gold).toBe(2000 - 300 - 120);
    const fort = state.buildings.find(site => site.kind === 'fort')!, depot = state.buildings.find(site => site.kind === 'supplyDepot')!;
    expect(FORT_BUILD_SECONDS).toBe(240);
    expect(fort).toMatchObject({ maxHp: 2250, construction: { duration: FORT_BUILD_SECONDS, waitingForBuilder: true } });
    expect(depot).toMatchObject({ construction: { duration: 45, waitingForBuilder: true } });
    for (let i = 0; i < 1400 && (fort.construction || depot.construction); i++) updateGame(state, .25, idle);
    expect(fort.construction).toBeUndefined(); expect(depot.construction).toBeUndefined();
    expect(insideOwnBorders(state, 0, 19.5, 8.5)).toBe(true);
    leader.x = 14.5; leader.y = 8.5;
    fort.hp = 0; preserveDestroyedFort(state, fort);
    for (let y = 8; y <= 9; y++) for (let x = 15; x <= 16; x++)
      expect(validateBuildAt(state, 'fort', x, y).message).toContain('foundation is permanent');
    expect(validateBuildAt(state, 'fort', 17, 8).ok).toBe(true);
    expect(rebuildFort(state, fort).ok).toBe(true);
    expect(fort.construction?.duration).toBe(FORT_BUILD_SECONDS);
    for (let i = 0; i < 1400 && fort.construction; i++) updateGame(state, .25, idle);
    expect(fort.construction).toBeUndefined(); expect(fort.hp).toBe(fort.maxHp);
  }, 20000);

  it('checks all four Fort tiles and rejects hostile territory, water, blockers and forbidden reconstruction', () => {
    const state = fixture(); entityStore(state).buildings.retain(site => site.kind === 'palace');
    Object.assign(state.buildings[0], { x: 12, y: 8 });
    const faction = state.factions[0]; faction.research = { focus: 'wall', levels: { wall: 1 }, progress: {} };
    state.units[0].x = 14.5; state.units[0].y = 10.5;
    expect(validateBuildAt(state, 'fort', 15, 8).ok).toBe(true);
    state.world.tiles[9 * 48 + 16].terrain = 'lake';
    expect(validateBuildAt(state, 'fort', 15, 8).ok).toBe(false);
    state.world.tiles[9 * 48 + 16].terrain = 'grassland';
    const obstruction = building(20, 'house', 16, 9); entityStore(state).buildings.add(obstruction);
    expect(validateBuildAt(state, 'fort', 15, 8).ok).toBe(false);
    entityStore(state).buildings.retain(site => site !== obstruction);
    const enemy = building(21, 'palace', 17, 8, 1); entityStore(state).buildings.add(enemy);
    expect(validateBuildAt(state, 'fort', 15, 8).ok).toBe(false);
    entityStore(state).buildings.retain(site => site !== enemy);
    const fort = building(22, 'fort', 15, 8); entityStore(state).buildings.add(fort); fort.hp = 0; preserveDestroyedFort(state, fort);
    state.forbiddenZones = { cells: [9 * 48 + 16], revision: 1 };
    expect(rebuildFortStatus(state, fort)).toMatchObject({ available: false, reason: 'Remove the forbidden zone before rebuilding here.' });
    delete state.forbiddenZones; faction.gold = 149;
    expect(rebuildFortStatus(state, fort)).toMatchObject({ available: false, reason: 'Need 150 gold.' });
  });

  it.each([0, 1])('authenticates multiplayer Fort repairs and upgrades for actor %s', actor => {
    const state = fixture(), fort = state.buildings[1]; fort.faction = actor;
    state.multiplayer = { humanFactionIds: [0, 1], inputs: {}, controls: {}, winner: null };
    state.units[0].faction = actor;
    entityStore(state).units.add(unit(11, 'leader', 19.5, 21.5, 1 - actor));
    expect(applyGameCommand(state, 1 - actor, { type: 'fort-brigade', buildingId: fort.id, faction: actor }).ok).toBe(false);
    expect(applyGameCommand(state, actor, { type: 'fort-brigade', buildingId: fort.id }).ok).toBe(true);
    fort.hp = 0; preserveDestroyedFort(state, fort);
    const otherGold = state.factions[1 - actor].gold;
    expect(applyGameCommand(state, 1 - actor, { type: 'fort-rebuild', buildingId: fort.id, faction: actor }).ok).toBe(false);
    withPlayerFaction(state, 1 - actor, () => clearArea(state, { x: 20, y: 20 }, { x: 21, y: 21 }));
    expect(state.buildings).toContain(fort); expect(fort.faction).toBe(actor); expect(state.factions[1 - actor].gold).toBe(otherGold);
    expect(applyGameCommand(state, actor, { type: 'fort-rebuild', buildingId: fort.id }).ok).toBe(true);
    expect(fort.construction?.paidGold).toBe(150);
  });

  it('uses a 2x2 footprint and exactly the health and armor of masonry walls', () => {
    const state = fixture(), fort = state.buildings[1], wall = building(3, 'wall', 30, 30);
    entityStore(state).buildings.add(wall); updateWallStats(state);
    expect([buildingWidth(fort), buildingHeight(fort)]).toEqual([2, 2]);
    expect(fort.maxHp).toBe(2250); expect(fort.maxHp).toBe(wall.maxHp);
    expect(buildingArmor(fort, state.factions[0])).toBe(buildingArmor(wall, state.factions[0]));
    state.factions[0].armorLevel = 3; updateWallStats(state, true);
    expect(buildingArmor(fort, state.factions[0])).toBe(buildingArmor(wall, state.factions[0]));
  });

  it('fires at two distinct military targets with the same damage and cadence as a watch tower', () => {
    const state = fixture(), fort = state.buildings[1], shots: { target: number; damage: number }[] = [];
    entityStore(state).units.add(unit(20, 'warrior', 23, 21, 1), unit(21, 'warrior', 24, 21, 1), unit(22, 'worker', 22.5, 21, 1));
    const orders = { hostile: (a: number, b: number) => a !== b, clearShot: () => true,
      shoot: (_fort: Building, _from: { x: number; y: number }, target: Unit, damage: number) => { shots.push({ target: target.id, damage }); } };
    updateWoodenTowers(state, .1, orders);
    expect(shots).toEqual([{ target: 20, damage: WOODEN_TOWER_ATTACK }, { target: 21, damage: WOODEN_TOWER_ATTACK }]);
    updateWoodenTowers(state, .74, orders); expect(shots).toHaveLength(2);
    updateWoodenTowers(state, .01, orders); expect(shots).toHaveLength(4);
    fort.fort = { brigadeLevel: 0, nextUpkeepAt: 30, nextRecruitAt: 0, funded: false };
    updateWoodenTowers(state, 2, orders); expect(shots).toHaveLength(4);
  });

  it('launches two real arrows from the center and retains destroyed foundations in the simulation', () => {
    const state = fixture(), fort = state.buildings[1];
    entityStore(state).units.add(unit(20, 'warrior', 25, 21, 1), unit(21, 'warrior', 25, 22, 1));
    updateGame(state, .1, idle);
    expect(state.projectiles?.filter(shot => shot.attacker === fort.id)).toHaveLength(2);
    expect(state.projectiles?.filter(shot => shot.attacker === fort.id).every(shot => shot.kind === 'arrow'
      && shot.towerArrow && shot.start.x === 21 && shot.start.y === 21)).toBe(true);
    fort.hp = 0; updateGame(state, .4, idle);
    expect(state.buildings).toContain(fort); expect(fort.fort?.destroyed).toBe(true);
  });

  it('survives hostile projectile destruction as a ruined Fort without entering the full-price rebuilding queue', () => {
    const state = fixture(), fort = state.buildings[1];
    updateWallStats(state); updateForts(state); fort.hp = 1;
    state.projectiles = [{ x: 24, y: 21, start: { x: 24, y: 21 }, end: { x: 21, y: 21 }, attacker: 100,
      target: fort.id, faction: 1, damage: 100, elapsed: 0, duration: .1 }];
    updateGame(state, .1, idle);
    expect(fort.hp).toBe(0); expect(fort.fort?.destroyed).toBe(true);
    expect(state.buildings).toContain(fort); expect(state.defenseRebuilds ?? []).toHaveLength(0);
    expect(rebuildFortStatus(state, fort).cost).toBe(150);
  });

  it('projects fixed borders independently of culture and nearby monuments', () => {
    const state = fixture(), fort = state.buildings[1], initial = territory(state);
    expect(borderRadius('fort')).toBe(6.5);
    expect(insideOwnBorders(state, 0, 26.5, 21)).toBe(true);
    expect(insideOwnBorders(state, 0, 28.5, 21)).toBe(false);
    entityStore(state).buildings.add(building(3, 'monument', 15, 20));
    const extended = territory(state);
    expect(extended.revision).toBeGreaterThan(initial.revision);
    expect(extended.sourceRadii.get(fort.id)).toBe(6.5);
    expect(insideOwnBorders(state, 0, 28.5, 21)).toBe(false);
    state.factions[0].culture = 100000;
    expect(borderRadius('fort', 100000)).toBe(6.5);
    expect(territory(state).sourceRadii.get(fort.id)).toBe(6.5);
    state.buildings[2].faction = 1;
    expect(territory(state).sourceRadii.get(fort.id)).toBe(6.5);
    fort.hp = 0;
    expect(territory(state).sourceRadii.has(fort.id)).toBe(false);
  });

  it('extends into unclaimed ground without displacing a neighboring faction frontier', () => {
    const state = fixture();
    entityStore(state).buildings.retain(() => false);
    entityStore(state).buildings.add(building(1, 'palace', 14, 20), building(2, 'palace', 27, 20, 1));
    const before = territory(state), originalEnemy = [...before.owners].flatMap((owner, cell) => owner === 1 ? [cell] : []);
    const fort = building(100, 'fort', 19, 20);
    for (let y = 20; y < 22; y++) for (let x = 19; x < 21; x++) expect(insideOwnBorders(state, 0, x, y, before)).toBe(true);
    entityStore(state).buildings.add(fort);
    const after = territory(state);
    expect(originalEnemy.length).toBeGreaterThan(0);
    expect(originalEnemy.every(cell => after.owners[cell] === 1)).toBe(true);
    expect([...after.owners].some((owner, cell) => owner === 0 && before.owners[cell] === UNCLAIMED)).toBe(true);
    // A fort's lower relative-distance score must not make the frontier depend
    // on whether it happened to be visited before or after the enemy city.
    entityStore(state).buildings.replace([...state.buildings].reverse());
    expect(territory(state).owners).toEqual(after.owners);
    // Adding a nearby civic source does not amplify the fort's own claims.
    entityStore(state).buildings.add(building(101, 'monument', 18, 20));
    const enlarged = territory(state);
    expect(originalEnemy.every(cell => enlarged.owners[cell] === 1)).toBe(true);
    entityStore(state).buildings.retain(site => site.faction !== 1);
    const liberated = territory(state);
    expect(originalEnemy.some(cell => liberated.owners[cell] === 0)).toBe(true);
  });

  it('limits a newly built fort in an established fort-only frontier to its protected buffer', () => {
    const state = fixture();
    entityStore(state).buildings.retain(() => false);
    const older = building(10, 'fort', 20, 20, 1), newer = building(20, 'fort', 25, 20);
    entityStore(state).buildings.add(older);
    const before = territory(state);
    entityStore(state).buildings.add(newer);
    const after = territory(state);
    expect([...before.owners].every((owner, cell) => {
      const x = cell % state.world.width, y = Math.floor(cell / state.world.width);
      const buffer = x >= newer.x - 1 && x <= newer.x + 2 && y >= newer.y - 1 && y <= newer.y + 2;
      return owner !== 1 || after.owners[cell] === (buffer ? 0 : 1);
    })).toBe(true);
    expect([...after.owners].some(owner => owner === 0)).toBe(true);
    entityStore(state).buildings.replace([...state.buildings].reverse());
    expect(territory(state).owners).toEqual(after.owners);
    state.factions[1].culture = 100000;
    expect(territory(state).owners).toEqual(after.owners);
    expect(territory(state).sourceRadii.get(older.id)).toBe(6.5);
    expect(territory(structuredClone(state)).owners).toEqual(after.owners);
  });

  it('preserves neutral village reservations outside the fort’s minimum buffer', () => {
    const state = fixture();
    Object.assign(state.factions[1], { villageId: 1, relation: 'peace' });
    state.villages = [{ id: 1, faction: 1, campId: 100, name: 'Neighbors', identity: 'growers', relation: 'neutral',
      x: 25, y: 20, nextGrowthAt: 90, nextThinkAt: 0, nextRecruitAt: 90 }];
    entityStore(state).buildings.add({ ...building(100, 'villageTent', 25, 20, 1), villageId: 1 });
    const reserved = territory(state);
    expect(insideOwnBorders(state, 1, 24.5, 20.5, reserved)).toBe(true);
    state.buildings[1].hp = 0;
    const withoutFort = territory(state);
    expect([...withoutFort.owners].every((owner, cell) => {
      const x = cell % state.world.width, y = Math.floor(cell / state.world.width);
      const buffer = x >= 19 && x <= 22 && y >= 19 && y <= 22;
      return owner !== 1 || reserved.owners[cell] === (buffer ? 0 : 1);
    })).toBe(true);
  });

  it('charges 20 gold every thirty seconds and suspends service without accumulating arrears', () => {
    const state = fixture(), fort = state.buildings[1], faction = state.factions[0];
    updateForts(state); expect(faction.gold).toBe(2000);
    state.time = 30; updateForts(state); expect(faction.gold).toBe(2000 - FORT_UPKEEP);
    updateForts(state); expect(faction.gold).toBe(1980);
    faction.gold = 19; state.time = 60; updateForts(state); expect(fort.fort?.funded).toBe(false); expect(faction.gold).toBe(19);
    state.time = 180; faction.gold = 100; updateForts(state);
    expect(faction.gold).toBe(80); expect(fort.fort?.funded).toBe(true); expect(fort.fort?.nextUpkeepAt).toBe(210);
  });

  it('buys 3, 6 and 10 skirmishers without consuming population or retinue slots', () => {
    const state = fixture(), fort = state.buildings[1];
    for (const capacity of [3, 6, 10]) {
      expect(upgradeFortBrigadeStatus(state, fort).nextCapacity).toBe(capacity);
      expect(upgradeFortBrigade(state, fort).ok).toBe(true);
      // Previous recruits have left the exits before the next expansion arrives.
      for (const soldier of state.units.filter(candidate => candidate.fort === fort.id)) soldier.y += 4;
      updateForts(state);
      expect(fortBrigadeCapacity(fort)).toBe(capacity);
      expect(state.units.filter(soldier => soldier.kind === 'skirmisher' && soldier.hp > 0)).toHaveLength(capacity);
    }
    expect(state.factions[0].population).toBe(0);
    expect(upgradeFortBrigadeStatus(state, fort).available).toBe(false);
    expect(state.units.filter(soldier => soldier.kind === 'skirmisher').every(soldier => soldier.speed === SKIRMISHER_SPEED && soldier.range === 5)).toBe(true);
  });

  it('preserves the original owner, brigade and foundation across half-price reconstruction', () => {
    const state = fixture(), fort = state.buildings[1];
    updateWallStats(state); upgradeFortBrigade(state, fort); updateForts(state);
    fort.hp = 0; preserveDestroyedFort(state, fort);
    expect(fort.kind).toBe('fort'); expect(fort.faction).toBe(0); expect(fortBrigadeCapacity(fort)).toBe(3);
    expect(state.units.filter(soldier => soldier.fort === fort.id).every(soldier => soldier.hp === 0)).toBe(true);
    expect(rebuildFortStatus(state, fort).cost).toBe(FORT_GOLD / 2);
    const gold = state.factions[0].gold;
    expect(rebuildFort(state, fort).ok).toBe(true);
    expect(state.factions[0].gold).toBe(gold - 150);
    expect(fort.construction?.paidGold).toBe(150);
    expect(fort.construction?.waitingForBuilder).toBe(true);
    // Builder travel and construction time are not billed as operational upkeep.
    state.time = 200; delete fort.construction; updateForts(state);
    expect(state.factions[0].gold).toBe(gold - 150); expect(fort.fort?.nextUpkeepAt).toBe(230);
    fort.hp = 0; preserveDestroyedFort(state, fort);
    expect(rebuildFortStatus(state, fort).cost).toBe(150);
  });

  it('prevents another faction from clearing a Fort even after its border surrounds the site', () => {
    const state = fixture(), fort = state.buildings[1];
    fort.faction = 1; state.factions[1].defeated = true;
    entityStore(state).buildings.add(building(3, 'palace', 20, 22));
    expect(insideOwnBorders(state, 0, 20, 20)).toBe(true);
    updateWallOwnership(state); expect(fort.faction).toBe(1);
    clearArea(state, { x: 20, y: 20 }, { x: 21, y: 21 });
    expect(state.buildings).toContain(fort);
    fort.hp = 0; preserveDestroyedFort(state, fort);
    demolishBuildingsInArea(state, { x: 20, y: 20 }, { x: 21, y: 21 });
    expect(state.buildings).toContain(fort);
    fort.faction = 0;
    expect(demolishBuildingsInArea(state, { x: 20, y: 20 }, { x: 21, y: 21 }).count).toBe(1);
  });

  it('patrols far from home, throws javelins in range and immediately retreats from approaching enemies', () => {
    const state = fixture(), fort = state.buildings[1];
    upgradeFortBrigade(state, fort); updateForts(state);
    const soldier = state.units.find(candidate => candidate.kind === 'skirmisher')!;
    soldier.x = 25; soldier.y = 21;
    const moves: { x: number; y: number }[] = [], attacks: number[] = [];
    const orders = { hostile: (a: number, b: number) => a !== b, visible: () => true,
      move: (_state: GameState, _unit: Unit, goal: { x: number; y: number }) => { moves.push({ ...goal }); },
      attack: (_unit: Unit, target: Unit) => { attacks.push(target.id); } };
    updateFortSkirmisher(state, soldier, .1, orders);
    expect(moves).toHaveLength(1); expect(Math.hypot(moves[0].x - 21, moves[0].y - 21)).toBeGreaterThan(4);
    const enemy = unit(100, 'warrior', 29, 21, 1); entityStore(state).units.add(enemy);
    updateFortSkirmisher(state, soldier, .1, orders); expect(attacks).toEqual([100]);
    enemy.x = 27; updateFortSkirmisher(state, soldier, .1, orders);
    expect(soldier.order).toBe('flee'); expect(attacks).toEqual([100]);
    expect(Math.hypot(moves.at(-1)!.x - enemy.x, moves.at(-1)!.y - enemy.y)).toBeGreaterThan(2);
  });
});
