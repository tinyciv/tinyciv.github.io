import { grantIncome } from '../src/game/resource-income';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { BUILD_COSTS, buildAt, createGame, updateGame, validateBuildAt } from '../src/game/simulation';
import { factionCityDevelopmentPriority, factionDevelopmentReserve, factionResearchTarget, updateFactionDevelopment, type DevelopmentKind } from '../src/game/faction-development';
import { updateFactionDefenses } from '../src/game/faction-defense';
import { canSustainFactionDefense, factionCommittedBudget } from '../src/game/faction-budget';
import { factionIrrigationSites } from '../src/game/faction-irrigation';
import { synchronizeFarms } from '../src/game/farms';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { cityDevelopmentNeeds } from '../src/game/governor';
import { RESEARCH_BRANCHES, researchStatus, updateResearch } from '../src/game/research';
import type { Building, GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function realm(): GameState {
  const state = createGame({ width: 84, height: 60, seed: 'rival-development', source: 'fixture', spawns: [{ x: 12, y: 30 }, { x: 62, y: 30 }],
    tiles: Array.from({ length: 84 * 60 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) });
  state.raiderCamps = []; state.marauderPacks = []; state.fogRaids = { nextAt: 1e9, waves: 0 };
  entityStore(state).units.replace(state.units.filter(unit => unit.faction >= 0 && unit.villageId === undefined));
  // These scenarios isolate paid development from the starting-defense grant;
  // the complete free enclosure and its upkeep are covered in faction-ai-upgrade.
  entityStore(state).buildings.replace(state.buildings.filter(building => building.faction >= 0 && building.villageId === undefined
    && !['palisade', 'woodenTower'].includes(building.kind)
    && (building.kind !== 'road' || state.buildings.some(city => city.kind === 'palace' && city.faction === building.faction
      && Math.abs(city.x - building.x) <= 2 && Math.abs(city.y - building.y) <= 2))));
  state.factions = state.factions.filter(faction => faction.villageId === undefined); state.villages = [];
  for (const faction of state.factions) { faction.nextRaid = 1e9; faction.nextRetinueAt = 1e9; }
  state.factions[1].relation = 'peace';
  state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!.governorPermissions = { farms: false, housing: false };
  return state;
}
const own = (state: GameState, kind: Building['kind']) => state.buildings.filter(building => building.faction === 1 && building.kind === kind);
/** Supply deliberate city scenarios with enough nearby lower-yield farms;
 * these are completed plots, not fictional income or far-away spoiled crops. */
function supplyFood(state: GameState, foodCapacity: number): void {
  const palace = own(state, 'palace')[0];
  for (let count = 0; cityDevelopmentNeeds(state, palace).foodCapacity < foodCapacity && count < 240; count++) {
    const site = planAutomaticFarmSite(state, palace);
    expect(site).toBeDefined();
    entityStore(state).buildings.add({ id: Math.max(...state.buildings.map(b => b.id), ...state.units.map(u => u.id)) + 1,
      kind: 'camp', faction: 1, ...site!.point, hp: 100, maxHp: 100, capacity: 0 });
    state.world.revision = (state.world.revision ?? 0) + 1;
    synchronizeFarms(state);
  }
  expect(cityDevelopmentNeeds(state, palace).foodCapacity).toBeGreaterThanOrEqual(foodCapacity);
}
const orders = (state: GameState) => ({
  farms: () => {}, houses: () => {},
  validate: (faction: number, kind: DevelopmentKind, x: number, y: number) => validateBuildAt(state, kind, x, y, faction),
  build: (faction: number, kind: DevelopmentKind, x: number, y: number) => buildAt(state, kind, x, y, faction),
});
function researchRealm(): GameState {
  const state = realm(), palace = own(state, 'palace')[0];
  palace.governorPermissions = { farms: false, housing: false };
  entityStore(state).buildings.add({ id: 20000, kind: 'library', faction: 1, x: palace.x + 2, y: palace.y + 2,
    hp: 250, maxHp: 250, capacity: 0 });
  state.time = 3;
  return state;
}
function riverFarms(state: GameState): void {
  const palace = own(state, 'palace')[0];
  entityStore(state).buildings.retain(building => building.faction !== 1 || building.kind !== 'camp');
  state.world.tiles[(palace.y - 2) * state.world.width + palace.x - 7].terrain = 'lake'; state.world.revision!++;
  let id = 40000;
  for (let y = -3; y <= -1; y++) for (let x = -5; x <= -3; x++) entityStore(state).buildings.add({
    id: id++, kind: 'camp', faction: 1, x: palace.x + x, y: palace.y + y, hp: 100, maxHp: 100, capacity: 0 });
  for (const y of [-3, -1]) entityStore(state).buildings.add({ id: id++, kind: 'camp', faction: 1, x: palace.x - 6, y: palace.y + y, hp: 100, maxHp: 100, capacity: 0 });
  synchronizeFarms(state);
}

describe('rival city development', () => {
  it('validates rival construction near any completed owned settlement, not unfinished or foreign ones', () => {
    const state = researchRealm(), faction = state.factions[1], first = own(state, 'palace')[0];
    const second = { ...first, id: 20001, x: 40, y: 10 };
    entityStore(state).buildings.add(second);
    faction.research = { focus: 'traditionalMedicine', levels: { traditionalMedicine: 1 }, progress: {} };
    faction.gold = 1000;
    expect(validateBuildAt(state, 'healerShack', 38, 10, 1).ok).toBe(true);
    second.construction = { startedAt: 0, duration: 90, paidGold: 500 };
    expect(validateBuildAt(state, 'healerShack', 38, 10, 1).message).toBe('Build near your settlement.');
    delete second.construction; second.faction = 0;
    expect(validateBuildAt(state, 'healerShack', 38, 10, 1).message).toBe('Build near your settlement.');
    expect(validateBuildAt(state, 'healerShack', 78, 10, 1).message).toBe('Build near your settlement.');
  });

  it('chooses cheaper unfinished technologies before the remaining Traditional Medicine branch', () => {
    const state = researchRealm(), faction = state.factions[1];
    expect(factionResearchTarget(state, faction)).toBe('woodenTower');
    faction.research = { focus: 'woodenTower', levels: { woodenTower: 1 }, progress: {} };
    expect(factionResearchTarget(state, faction)).toBe('scoutLodge');
    faction.research.levels = Object.fromEntries(RESEARCH_BRANCHES.filter(branch => branch.id !== 'traditionalMedicine').map(branch => [branch.id, 1]));
    expect(factionResearchTarget(state, faction)).toBe('traditionalMedicine');
    faction.research.levels.traditionalMedicine = 1;
    expect(factionResearchTarget(state, faction)).toBeUndefined();
  });

  it('builds one researched healer per city while preserving shared upkeep reserves', () => {
    const state = researchRealm(), faction = state.factions[1], first = own(state, 'palace')[0];
    faction.constructionPauseUntil = { supplyDepot: Infinity, fort: Infinity };
    const second = { ...first, id: 20001, x: 40, y: 10, unhousedResidents: 0, governorNextPlanAt: 3 };
    entityStore(state).buildings.add(second,
      { id: 20002, kind: 'archeryRange', faction: 1, x: 70, y: 35, hp: 250, maxHp: 250, capacity: 0 },
      { id: 20003, kind: 'blacksmith', faction: 1, x: 70, y: 37, hp: 250, maxHp: 250, capacity: 0 });
    faction.research = { focus: 'traditionalMedicine', levels: Object.fromEntries(RESEARCH_BRANCHES.map(branch => [branch.id, 1])), progress: {} };
    const reserve = factionDevelopmentReserve(state, faction);
    expect(reserve).toBe(37.5);
    faction.gold = 2 * BUILD_COSTS.healerShack.gold + reserve - 1;
    updateFactionDevelopment(state, orders(state));
    expect(own(state, 'healerShack')).toHaveLength(1);
    expect(own(state, 'healerShack')[0].construction).toMatchObject({ duration: 45, paidGold: 200 });
    expect(faction.gold).toBe(236.5);
    faction.gold++; state.time = 9;
    updateFactionDevelopment(state, orders(state));
    const healers = own(state, 'healerShack');
    expect(healers).toHaveLength(2); expect(faction.gold).toBe(reserve);
    expect(healers.some(building => building.x > 50)).toBe(true);
    expect(healers.some(building => building.x < 50)).toBe(true);
    faction.gold = 5000; state.time = 15;
    updateFactionDevelopment(state, orders(state));
    expect(own(state, 'healerShack')).toHaveLength(2); // Pending shacks already satisfy each city's order.
    for (const building of healers) delete building.construction;
    state.time = 21; updateFactionDevelopment(state, orders(state));
    expect(own(state, 'healerShack')).toHaveLength(2);
  });

  it('shares income-funded research across city planners without charging the treasury twice', () => {
    const state = researchRealm(), faction = state.factions[1], palace = own(state, 'palace')[0];
    entityStore(state).buildings.add({ ...palace, id: 20001, x: 40, y: 10, governorNextPlanAt: 3 });
    faction.gold = 500;
    updateFactionDevelopment(state, orders(state));
    expect(researchStatus(state, 1)).toMatchObject({ focus: 'woodenTower', active: true, progress: 0 });
    expect(faction.gold).toBe(500);
    state.time = 9; updateFactionDevelopment(state, orders(state));
    updateResearch(state, 90);
    expect(researchStatus(state, 1).progress).toBe(0);
    const cost = researchStatus(state, 1).required;
    grantIncome(faction, { gold: cost / .25 }, state);
    updateResearch(state,30);
    expect(faction.gold).toBeCloseTo(500 + cost * 3);
    expect(researchStatus(state, 1)).toMatchObject({ focus: 'scoutLodge', active: true, progress: 0 });
  });

  it.each(['farm', 'house'] as const)('preserves the next %s investment without an upfront research reserve', priority => {
    const state = researchRealm(), faction = state.factions[1], palace = own(state, 'palace')[0];
    palace.governorPermissions = { farms: true, housing: true };
    const reserve = priority === 'farm' ? BUILD_COSTS.camp.gold * 4 : BUILD_COSTS.house.gold;
    if (priority === 'house') {
      supplyFood(state, 21); faction.population = 20;
    }
    expect(factionCityDevelopmentPriority(state, palace)).toBe(priority);
    expect(factionDevelopmentReserve(state, faction)).toBe(reserve);
    faction.gold = reserve + 99;
    updateFactionDevelopment(state, orders(state));
    expect(researchStatus(state, 1).progress).toBe(0); expect(faction.gold).toBe(reserve + 99);
    faction.gold++; state.time = 9; updateFactionDevelopment(state, orders(state));
    expect(researchStatus(state, 1).progress).toBe(0); expect(faction.gold).toBe(reserve + 100);
  });

  it('uses researched irrigation where one connected ditch improves at least six existing farm tiles', () => {
    const state = researchRealm(), faction = state.factions[1], palace = own(state, 'palace')[0];
    riverFarms(state); palace.governorPermissions = { farms: true, housing: true }; faction.gold = 250;
    faction.research = { focus: 'wall', levels: { wall: 1, woodenTower: 1, irrigation: 1 }, progress: {} };
    expect(factionIrrigationSites(state, palace).length).toBeGreaterThan(0);
    updateFactionDevelopment(state, orders(state));
    expect(own(state, 'irrigation')).toHaveLength(1);
    expect(faction.gold).toBe(215);
    // A queued ditch reserves its coverage so later planning cannot duplicate it.
    state.time = 9; updateFactionDevelopment(state, orders(state));
    expect(own(state, 'irrigation')).toHaveLength(1);
  });

  it('never spends stored gold on research, regardless of food reserves', () => {
    const state = researchRealm(), faction = state.factions[1];
    faction.food = 0; faction.gold = 500;
    updateFactionDevelopment(state, orders(state));
    expect(researchStatus(state, 1).progress).toBe(0); expect(faction.gold).toBe(500);
    faction.food = 500; state.time = 9; updateFactionDevelopment(state, orders(state));
    expect(researchStatus(state, 1).progress).toBe(0); expect(faction.gold).toBe(500);
  });

  it('reserves city investments without holding extra gold for the next technology', () => {
    const state = researchRealm(), faction = state.factions[1];
    faction.research = { focus: 'woodenTower', levels: { wall: 1 }, progress: {} };
    faction.gold = 150; state.time = 15;
    expect(factionDevelopmentReserve(state, faction)).toBe(0);
    updateFactionDevelopment(state, orders(state));
    expect(researchStatus(state, 1)).toMatchObject({ focus: 'woodenTower', progress: 0 });
    expect(faction.gold).toBe(150);
  });

  it('saves for one library after establishing food supply, then funds a real construction order', () => {
    const state = realm(), faction = state.factions[1], palace = own(state, 'palace')[0];
    supplyFood(state, 12); faction.gold = 199; state.time = 3;
    const calls = orders(state);
    calls.farms = () => { throw Error('Healthy city should bank research gold'); };
    calls.houses = () => { throw Error('Spare beds must not consume the library reserve'); };
    updateFactionDevelopment(state, calls);
    expect(faction.gold).toBe(199); expect(own(state, 'library')).toHaveLength(0);
    faction.gold = 200; state.time = 9; updateFactionDevelopment(state, calls);
    expect(own(state, 'library')).toHaveLength(1); expect(faction.gold).toBe(0);
    expect(own(state, 'library')[0].construction).toMatchObject({ duration: 90, waitingForBuilder: true });
    faction.gold = 2000; state.time = 15; updateFactionDevelopment(state, orders(state));
    expect(own(state, 'library')).toHaveLength(1);
  });

  it('does not search or order locked military buildings, then develops unlocked branches', () => {
    const state = realm(), faction = state.factions[1], palace = own(state, 'palace')[0];
    palace.governorPermissions = { farms: false, housing: false };
    entityStore(state).buildings.add({ id: 10000, kind: 'library', faction: 1, x: palace.x + 2, y: palace.y + 2,
      hp: 250, maxHp: 250, capacity: 0 });
    faction.gold = 3000; state.time = 3;
    const locked = { ...orders(state), validate: () => { throw Error('Do not search locked branches'); } };
    updateFactionDevelopment(state, locked);
    state.time = 15;
    updateFactionDefenses(state, { validate: (_id, kind) => { expect(['palisade', 'road']).toContain(kind); return { ok: false }; },
      build: () => { throw Error('Do not build rejected defenses'); } });
    faction.population = 60;
    faction.research = { focus: 'wall', levels: { wall: 1, woodenTower: 1, archeryRange: 1, blacksmith: 1 }, progress: {} };
    updateFactionDevelopment(state, orders(state));
    expect(own(state, 'guardPost')).toHaveLength(1);
    state.time = 21; updateFactionDevelopment(state, orders(state));
    expect(own(state, 'archeryRange')).toHaveLength(1);
    for (const building of state.buildings) delete building.construction;
    state.world.revision = (state.world.revision ?? 0) + 1;
    state.time = 27;
    const reserve = factionDevelopmentReserve(state, faction);
    faction.gold = 200 + reserve;
    updateFactionDevelopment(state, orders(state));
    expect(own(state, 'blacksmith')).toHaveLength(1);
    expect(faction.gold).toBe(reserve);
    expect(faction.archerFraction).toBe(.25);
    state.time = 33; updateFactionDevelopment(state, orders(state));
    expect(own(state, 'guardPost')).toHaveLength(1);
    expect(own(state, 'archeryRange')).toHaveLength(1);
    expect(own(state, 'blacksmith')).toHaveLength(1);
  });

  it('funds a batch of single-tile opening farms before the first income tick using real builders and gold', () => {
    const state = realm(); entityStore(state).buildings.retain(building => building.faction !== 1 || building.kind !== 'camp');
    synchronizeFarms(state);
    const originalGold = state.factions[1].gold;
    updateGame(state, 10, idle);
    expect(own(state, 'camp').length).toBeGreaterThanOrEqual(4);
    expect(own(state, 'camp').length).toBeLessThanOrEqual(8);
    expect(state.factions[1].gold).toBeLessThanOrEqual(originalGold - own(state, 'camp').length * BUILD_COSTS.camp.gold);
    expect(own(state, 'camp').filter(farm => farm.construction).length).toBeLessThanOrEqual(8);
    expect(state.units.some(unit => unit.faction === 1 && unit.builder)).toBe(true);
    expect(own(state, 'wall')).toHaveLength(0);
    expect(state.tick).toBe(0);
  });

  it('respects disabled farm and housing permissions while retaining defensive spending', () => {
    const state = realm(), palace = own(state, 'palace')[0];
    palace.governorPermissions = { farms: false, housing: false };
    const farms = own(state, 'camp').length, houses = own(state, 'house').length;
    updateGame(state, 28, idle);
    expect(own(state, 'camp')).toHaveLength(farms);
    expect(own(state, 'house')).toHaveLength(houses);
    expect(own(state, 'well')).toHaveLength(0);
  });

  it('protects the next farm purchase from optional tower and wall spending', () => {
    const state = realm(), faction = state.factions[1];
    faction.gold = 70; state.time = 15;
    expect(factionDevelopmentReserve(state, faction)).toBeGreaterThanOrEqual(4 * BUILD_COSTS.camp.gold);
    updateFactionDefenses(state, {
      validate: (id, kind, x, y) => validateBuildAt(state, kind, x, y, id),
      build: (id, kind, x, y) => buildAt(state, kind, x, y, id),
    });
    expect(faction.gold).toBeGreaterThanOrEqual(BUILD_COSTS.camp.gold);
    expect(own(state, 'woodenTower')).toHaveLength(0);
  });

  it('fills a housing bottleneck before adding a farm safety margin only when real food reserves permit', () => {
    const state = realm(), faction = state.factions[1], palace = own(state, 'palace')[0];
    supplyFood(state, 21); faction.population = 20; faction.food = 100;
    expect(factionCityDevelopmentPriority(state, palace)).toBe('house');
    expect(factionDevelopmentReserve(state, faction)).toBe(62.5); // Housing is the bottleneck; the smaller town is not ready for a library.
    faction.food = 20;
    expect(factionCityDevelopmentPriority(state, palace)).toBe('farm');
    faction.food = 100; faction.population = 22;
    expect(factionCityDevelopmentPriority(state, palace)).toBe('farm');
  });

  it('keeps spare-bed construction credit at ten percent despite frequent planning', () => {
    const state = realm(), faction = state.factions[1], palace = own(state, 'palace')[0];
    supplyFood(state, 13);
    Object.assign(faction, { gold: 10000, food: 10000 });
    palace.populationGrowth = -10000;
    // Research spending is covered separately; isolate the housing clock here.
    entityStore(state).buildings.add({ id: 10002, kind: 'library', faction: 1, x: palace.x + 2, y: palace.y + 2,
      hp: 250, maxHp: 250, capacity: 0 });
    synchronizeFarms(state);
    updateGame(state, 30, idle);
    expect(own(state, 'house')).toHaveLength(4);
    expect(palace.automaticHouseCredit).toBeCloseTo(.2);
  });

  it('does not steal the workforce with perimeter jobs while opening farms are pending', () => {
    const state = realm(); state.time = 15;
    for (const farm of own(state, 'camp')) farm.construction = { duration: 10, startedAt: 10, paidGold: 150, waitingForBuilder: true };
    const original = state.buildings.length;
    updateFactionDefenses(state, { validate: () => ({ ok: true }), build: () => { throw Error('Productive jobs must finish before optional defenses'); } });
    expect(state.buildings).toHaveLength(original);
  });

  it('buys an efficient well instead of more houses and avoids duplicate pending wells', () => {
    const state = realm(), faction = state.factions[1], palace = own(state, 'palace')[0];
    faction.population = 34; faction.gold = 500; state.time = 3;
    entityStore(state).buildings.retain(building => building.faction !== 1 || building.kind !== 'camp');
    synchronizeFarms(state);
    let id = 10000;
    for (const [dx, dy] of [[-4, -2], [-4, -1], [-4, 0], [-4, 1]])
      entityStore(state).buildings.add({ id: id++, kind: 'house', faction: 1, x: palace.x + dx, y: palace.y + dy, hp: 160, maxHp: 160, capacity: 4 });
    supplyFood(state, 35);
    entityStore(state).buildings.add({ id: 20000, kind: 'library', faction: 1, x: palace.x + 2, y: palace.y + 2,
      hp: 250, maxHp: 250, capacity: 0 });
    const calls = orders(state);
    calls.houses = () => { throw Error('A well provides the next housing investment'); };
    updateFactionDevelopment(state, calls);
    expect(own(state, 'well')).toHaveLength(1);
    expect(faction.gold).toBe(450);
    expect(researchStatus(state, 1).active).toBe(true);
    expect(own(state, 'well')[0].construction).toBeDefined();
    state.time = 9; updateFactionDevelopment(state, calls);
    expect(own(state, 'well')).toHaveLength(1);
    expect(faction.gold).toBe(450);
  });

  it('plans between economy ticks but throttles repeated frames', () => {
    const state = researchRealm(); state.time = 3;
    let farmCalls = 0, houseSeconds = 0;
    const callbacks = { ...orders(state), farms: () => { farmCalls++; }, houses: (_faction: unknown, elapsed: number) => { houseSeconds += elapsed; } };
    updateFactionDevelopment(state, callbacks);
    updateFactionDevelopment(state, callbacks);
    expect(farmCalls).toBe(4); expect(houseSeconds).toBe(6);
    state.time = 9; updateFactionDevelopment(state, callbacks);
    expect(farmCalls).toBe(8); expect(houseSeconds).toBe(12);
  });

  it('funds research while multiple productive construction jobs are queued', () => {
    const state = researchRealm(), faction = state.factions[1]; faction.gold = 500;
    for (const farm of own(state, 'camp').slice(0, 3)) farm.construction = { duration: 90, startedAt: 0, waitingForBuilder: true };
    updateFactionDevelopment(state, orders(state));
    expect(researchStatus(state, 1)).toMatchObject({ focus: 'woodenTower', active: true });
    expect(faction.gold).toBe(500);
    grantIncome(faction, { gold: researchStatus(state, 1).required / .25 }, state);
    updateResearch(state,30);
    expect(faction.research?.levels.woodenTower).toBe(1);
  });

  it('defaults to cheapest available work and honors an explicit priority without losing progress', () => {
    const state = researchRealm(), faction = state.factions[1], palace = own(state, 'palace')[0];
    palace.governorPermissions = { farms: true, housing: true };
    riverFarms(state);
    faction.research = { focus: 'monument', levels: { wall: 1, woodenTower: 1 }, progress: {} };
    expect(factionResearchTarget(state, faction)).toBe('scoutLodge');
    faction.research.priorities = ['monument']; faction.research.progress.monument = 1;
    expect(factionResearchTarget(state, faction)).toBe('irrigation'); // Statehood first needs Grain Storage and Irrigation.
    updateFactionDevelopment(state, orders(state));
    expect(faction.research.progress.monument).toBe(1);
  });

  it('counts pending defensive upkeep and avoids funding a garrison from one-off treasury wealth', () => {
    const state = researchRealm(), faction = state.factions[1]; faction.gold = 10000; faction.population = 20;
    expect(canSustainFactionDefense(state, faction, 'woodenTower')).toBe(true);
    const palace = own(state, 'palace')[0];
    entityStore(state).buildings.add({ id: 30000, kind: 'guardPost', faction: 1, x: palace.x + 3, y: palace.y,
      hp: 100, maxHp: 100, capacity: 0, construction: { startedAt: 0, duration: 30, waitingForBuilder: true } });
    expect(factionCommittedBudget(state, faction).upkeep).toBe(15);
    expect(canSustainFactionDefense(state, faction, 'woodenTower')).toBe(false);
    expect(canSustainFactionDefense(state, faction, 'guardPost')).toBe(false);
  });

  it('starts palisade defenses before research and excludes neutral villages from both planners', () => {
    const state = realm(); state.time = 10;
    updateFactionDefenses(state, { validate: (id, kind, x, y) => validateBuildAt(state, kind, x, y, id), build: (id, kind, x, y) => buildAt(state, kind, x, y, id) });
    expect(own(state, 'palisade').length).toBeGreaterThan(0);
    expect(state.factions[1].research?.levels.wall).toBeUndefined();
    state.factions[1].villageId = 123; state.time = 30;
    const fail = () => { throw Error('Village must retain its own development system'); };
    updateFactionDevelopment(state, { farms: faction => { if (faction.id === 1) fail(); }, houses: faction => { if (faction.id === 1) fail(); }, validate: fail, build: fail });
    updateFactionDefenses(state, { validate: fail, build: fail });
  });
});
