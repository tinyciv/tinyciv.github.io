import { CHECK_INTERVAL } from '../src/game/work-cadence';
import { constructionWorkerAllowance } from '../src/game/civilian-population';
import { roadsReachPalaces } from './helpers/roads';
import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it, vi } from 'vitest';
import { type GameState, type InputState, type Overlay, type World, distance, tileAt } from '../src/game/types';
import { atWar, buildAt, createGame, diplomacyAction, getLeader, housingCapacity, interactAt, MARAUDER_FACTION, migrateGame, recallRetinue, setRetinueOrder, updateGame, updateLeaderRespawns, validateBuildAt } from '../src/game/simulation';
import { canMove, canWalk, findPath, movementMultiplier } from '../src/game/pathfinding';
import { generateWorld, terrainYields } from '../src/world/generator';
import { FARM_TILES_PER_COURIER, FIELD_HARVEST_SECONDS, synchronizeFarms } from '../src/game/farms';
import { updateFogRaids } from '../src/game/fog-raids';
import { getFactionStrategy } from '../src/game/faction-strategy';
import { citySummaries } from '../src/game/cities';

const idle: InputState = { up: false, down: false, left: false, right: false };
function flatWorld(seed = 'test-valley'): World {
  return {
    width: 48, height: 32, seed, source: 'simulation fixture', spawns: [{ x: 8.5, y: 12.5 }, { x: 35.5, y: 17.5 }],
    tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: 0.4, moisture: 0.7, food: 2, production: 2, gold: 1, variation: 0.5 })),
  };
}
function game(culture = 0): GameState {
  const state = createGame(flatWorld());
  unlockBuildingResearch(state.factions[0]);
  state.factions[0].culture = culture;
  state.factions[1].relation = 'peace';
  // Economy and command tests isolate settled factions; roaming bands have separate integration coverage.
  entityStore(state).units.replace(state.units.filter(unit => unit.marauderPack === undefined && unit.villageId === undefined));
  state.marauderPacks = []; state.raiderCamps = []; state.villages = [];
  // Removed villages must not leave their generated movement-speed paths in command fixtures.
  for (const tile of state.world.tiles) delete tile.villageTrail;
  state.factions = state.factions.filter(faction => faction.villageId === undefined);
  entityStore(state).buildings.replace(state.buildings.filter(building => building.raiderCamp === undefined && building.villageId === undefined));
  // These fixtures deliberately edit tiles directly; unversioned worlds use
  // the navigation fingerprint instead of runtime terrain revision invalidation.
  delete state.world.revision;
  return state;
}
function advance(state: GameState, seconds: number): void {
  while (seconds > 0) { const step = Math.min(1, seconds); updateGame(state, step, idle); seconds -= step; }
}
function finishOrders(state: GameState): void {
  const ordered = state.buildings.filter(building => building.construction);
  for (let i = 0; i < 600 && ordered.some(building => building.construction); i++) updateGame(state, .1, idle);
  expect(ordered.every(building => !building.construction)).toBe(true);
}
function clearAround(state: GameState, x: number, y: number, radius: number): void {
  entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace' || distance(building, { x, y }) > radius));
  entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' || distance(unit, { x, y }) > radius));
}
/** A ready approach connects local road/gate fixtures back to the initial ring. */
function extendFixtureRoad(state: GameState, x: number, y: number): void {
  const palace = state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!;
  const add = (tx: number, ty: number) => {
    if (state.buildings.some(building => building.kind === 'road' && building.x === tx && building.y === ty)) return;
    entityStore(state).buildings.add({ id: Math.max(...state.buildings.map(building => building.id), ...state.units.map(unit => unit.id)) + 1,
      kind: 'road', faction: 0, x: tx, y: ty, hp: 100, maxHp: 100, capacity: 0 });
  };
  let tx = palace.x + 2, ty = palace.y + 1;
  add(tx, ty);
  while (tx !== x) { tx += Math.sign(x - tx); add(tx, ty); }
  while (ty !== y) { ty += Math.sign(y - ty); add(tx, ty); }
}

describe('settlements and economy', () => {
  it('starts the player at twenty with ready housing and productive farms, while rivals retain their smaller settlements', () => {
    const a = createGame(flatWorld()), b = createGame(flatWorld());
    expect(a).toEqual(b);
    for (const faction of a.factions.filter(faction => faction.villageId === undefined)) {
      expect([faction.food, faction.gold, faction.production]).toEqual([500, faction.id === 0 ? 500 : 1600, 0]);
      expect(faction.population).toBe(faction.id === 0 ? 20 : 5);
      expect(housingCapacity(a, faction.id)).toBe(faction.id === 0 ? 20 : 12);
      const camps = a.buildings.filter(building => building.faction === faction.id && building.kind === 'camp');
      expect(camps.length).toBeGreaterThan(2);
      expect(camps.every(camp => camp.residents === 0)).toBe(true);
      expect(camps.every(camp => camp.capacity === 0)).toBe(true);
      const houses = a.buildings.filter(building => building.faction === faction.id && building.kind === 'house');
      expect(houses).toHaveLength(faction.id === 0 ? 8 : 4);
      expect(houses.map(house => house.residents)).toEqual(faction.id === 0 ? [2, 2, 2, 2, 2, 2, 2, 2] : [2, 2, 1, 0]);
      expect(a.buildings.filter(building => building.faction === faction.id && building.kind === 'road')).toHaveLength(faction.id === 0 ? 12 : 16);
      expect(a.units.filter(unit => unit.faction === faction.id && unit.kind === 'warrior')).toHaveLength(faction.id === 0 ? 5 : 4);
      const workers = a.units.filter(unit => unit.faction === faction.id && unit.collector);
      const sharedFarmWorkforce = Math.ceil(camps.length / FARM_TILES_PER_COURIER);
      const availableResidents = faction.population - constructionWorkerAllowance(faction.population);
      expect(workers).toHaveLength(Math.min(sharedFarmWorkforce, availableResidents));
      expect(workers.length).toBeLessThanOrEqual(faction.population);
      expect(new Set(workers.map(worker => worker.collectorCamp)).size).toBe(workers.length);
      expect(workers.every(worker => camps.some(camp => camp.id === worker.collectorCamp))).toBe(true);
      expect(workers.every(worker => worker.collector && worker.inside && !worker.work)).toBe(true);
    }
  });

  it('harvests into physical bags before delivery and grows population into ready housing', () => {
    const state = game(), player = state.factions[0];
    const food = player.food;
    advance(state, 29);
    expect(player.food).toBe(food);
    expect(state.fields!.every(field => field.food === 0)).toBe(true);
    advance(state, 1);
    expect(state.tick).toBe(1);
    // All initial beds are occupied: credit waits for the first new house.
    expect(player.population).toBe(20);
    expect(state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!.populationGrowth).toBeGreaterThan(0);
    // Four garden rations and twenty consumed; births wait for housing.
    expect(player.food).toBe(food + 4 - 20);
    expect(state.fields!.every(field => field.food === 0)).toBe(true);
    const firstHarvest = Math.min(...state.fields!.filter(field => field.faction === 0 && field.planted).map(field =>
      field.nextHarvest + Math.max(0, Math.ceil(((field.wheatYieldAfter ?? field.nextHarvest) - field.nextHarvest - 1e-7)
        / FIELD_HARVEST_SECONDS)) * FIELD_HARVEST_SECONDS));
    advance(state, firstHarvest - state.time + CHECK_INTERVAL + .001);
    expect(state.fields!.some(field => field.faction === 0 && field.food > 0)).toBe(true);
    const storedBeforeDelivery = player.food, harvestTick = state.tick;
    advance(state, Math.min(20, (harvestTick + 1) * 30 - state.time - .001));
    // No next consumption tick has fired yet: only returning couriers can
    // increase these stores, not theoretical yields or uncollected crops.
    expect(state.tick).toBe(harvestTick);
    expect(player.food).toBeGreaterThan(storedBeforeDelivery);
    advance(state, 60);
    expect(player.population).toBeGreaterThan(20);
    expect(housingCapacity(state)).toBeGreaterThanOrEqual(player.population);
    expect(state.buildings.filter(building => building.kind === 'house').every(building => building.capacity === 2)).toBe(true);
  });

  it('starts with five escorts at twenty population and adds another at each twenty population', () => {
    const state = game(), leader = getLeader(state)!;
    clearAround(state, 20, 8, 4); leader.x = 20.5; leader.y = 8.5;
    expect(state.units.filter(unit => unit.faction === 0 && unit.kind === 'warrior')).toHaveLength(5);
    state.factions[0].population = 39; state.factions[0].food = 0;
    advance(state, 3);
    expect(state.units.filter(unit => unit.faction === 0 && unit.kind === 'warrior')).toHaveLength(5);
    state.factions[0].population = 40;
    advance(state, 30);
    expect(state.units.filter(unit => unit.faction === 0 && unit.kind === 'warrior')).toHaveLength(6);
    const previous = new Set(state.units.map(unit => unit.id));
    state.factions[0].population = 60; state.factions[0].food = 0;
    advance(state, 30);
    expect(state.units.filter(unit => unit.faction === 0 && unit.kind === 'warrior')).toHaveLength(7);
    const recruit = state.units.find(unit => unit.faction === 0 && unit.kind === 'warrior' && !previous.has(unit.id))!;
    expect(recruit.order).toBe('follow');
    expect(recruit.speed).toBeCloseTo(leader.speed * 1.1);
    expect(recruit.joiningRetinue).toBeUndefined();
    expect(distance(recruit, leader)).toBeLessThan(4);
  });

  it.each<Overlay>(['forest', 'jungle', 'swamp'])('clears %s from each farm’s crop cell without clearing the surrounding map', overlay => {
    const world = flatWorld();
    for (const tile of world.tiles) { tile.overlay = overlay; Object.assign(tile, terrainYields(tile.terrain, overlay)); }
    const state = createGame(world);
    const farmCount = state.buildings.filter(building => building.kind === 'camp').length;
    expect(state.fields).toHaveLength(farmCount);
    for (const field of state.fields!) {
      const tile = tileAt(world, field.x, field.y)!;
      const camp = state.buildings.find(building => building.id === field.camp)!;
      expect(field.x).toBe(camp.x); expect(field.y).toBe(camp.y);
      expect(tile.overlay).toBe('none'); expect(tile.farm).toBe(field.faction);
    }
    expect(world.tiles.some(tile => tile.overlay === overlay)).toBe(true);
    expect(state.fields!.filter(field => field.planted)).toHaveLength(farmCount);
  });

  it('migrates old workers into residents and collectors without resetting resources or retaining stale targets', () => {
    const state = game(), worker = state.units.find(unit => unit.kind === 'worker')!;
    const warrior = state.units.find(unit => unit.kind === 'warrior')!;
    delete state.fields;
    state.factions[0].food = 47; state.factions[0].color = '#3c7e70'; warrior.speed = 3.15;
    state.selected = worker.id; state.selectedType = 'unit'; warrior.target = worker.id; state.buildMode = 'camp';
    expect(migrateGame(state)).toBe(state);
    expect(warrior.speed).toBeCloseTo(3.96);
    expect(state.factions[0].food).toBe(47); expect(state.factions[0].population).toBe(20);
    expect(state.factions[0].color).toBe('#3c7e70');
    expect(state.units.filter(unit => unit.kind === 'worker').every(unit => (unit.collector || unit.builder) && unit.inside)).toBe(true);
    expect(warrior.target).toBeUndefined(); expect(state.selected).toBe(getLeader(state)!.id);
    expect(state.fields!.filter(field => field.faction === 0 && field.planted)).toHaveLength(state.buildings.filter(building => building.faction === 0 && building.kind === 'camp').length);
    expect(state.units.filter(unit => unit.kind === 'worker' && unit.faction === 0).length).toBeLessThanOrEqual(state.factions[0].population);
    expect(state.buildMode).toBe('camp');
  });
});

describe('movement, construction and roads', () => {
  it.each<[Overlay, number]>([['none', 1], ['forest', 0.5], ['jungle', 0.5], ['swamp', 0.7]])('moves across %s at %sx speed', (overlay, multiplier) => {
    const state = game(), leader = getLeader(state)!;
    clearAround(state, 20, 10, 4);
    leader.x = 20.5; leader.y = 10.5;
    tileAt(state.world, leader.x, leader.y)!.overlay = overlay;
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
    updateGame(state, 0.05, { ...idle, right: true });
    expect(leader.x - 20.5).toBeCloseTo(3.6 * 0.05 * multiplier, 8);
  });

  it('moves 1.5x faster on roads, including roads through forest', () => {
    const state = game(10000), leader = getLeader(state)!;
    clearAround(state, 20, 10, 4);
    leader.x = 20.5; leader.y = 10.5;
    tileAt(state.world, leader.x, leader.y)!.overlay = 'forest';
    extendFixtureRoad(state, 19, 10);
    expect(buildAt(state, 'road', 20, 10).ok).toBe(true);
    finishOrders(state);
    updateGame(state, 0.05, { ...idle, right: true });
    expect(leader.x - 20.5).toBeCloseTo(3.6 * 0.05 * 1.5, 8);
  });

  it('keeps a moving retinue within four tiles and catches up when separated', () => {
    const state = game(), leader = getLeader(state)!;
    const warrior = state.units.find(unit => unit.faction === 0 && unit.kind === 'warrior')!;
    entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' || unit.id === warrior.id));
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace'));
    leader.x = 15.5; leader.y = 6.5; warrior.x = 12.5; warrior.y = 6.5;
    for (let i = 0; i < 40; i++) {
      updateGame(state, 0.1, { ...idle, right: true });
      expect(distance(leader, warrior)).toBeLessThan(4);
    }
    warrior.x = leader.x - 7;
    advance(state, 2);
    expect(distance(leader, warrior)).toBeLessThan(4);
    expect(warrior.speed).toBeCloseTo(leader.speed * 1.1);
  });

  it('follows along a riverbank when the formation offset falls on disconnected land', () => {
    const state = game(), leader = getLeader(state)!;
    const warrior = state.units.find(unit => unit.faction === 0 && unit.kind === 'warrior')!;
    entityStore(state).units.replace([leader, warrior]);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace'));
    leader.x = 20.8; leader.y = 10.5; warrior.x = 16.5; warrior.y = 10.5; entityStore(state).units.retain(unit => unit !== warrior); warrior.id = 13; entityStore(state).units.add(warrior);
    for (let y = 0; y < state.world.height; y++) tileAt(state.world, 21, y)!.terrain = 'river';
    const offset = { x: leader.x + Math.cos(warrior.id * 2.399963) * 1.35, y: leader.y + Math.sin(warrior.id * 2.399963) * 1.35 };
    expect(canWalk(state, offset.x, offset.y, 0)).toBe(true);
    expect(findPath(state, warrior, offset, 0)).toHaveLength(0);
    advance(state, 4);
    expect(warrior.x).toBeLessThan(21);
    expect(distance(warrior, leader)).toBeLessThan(2);
    expect(warrior.order).toBe('follow');
  });

  it('lets an aggressive retinue keep fighting while the Leader leaves, then withdraw on recall', () => {
    const state = game(), leader = getLeader(state)!;
    const warrior = state.units.find(unit => unit.faction === 0 && unit.kind === 'warrior')!;
    const enemy = state.units.find(unit => unit.faction === 1 && unit.kind === 'warrior')!;
    entityStore(state).units.replace([leader, warrior, enemy]);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace'));
    state.factions[1].relation = 'war'; state.factions[1].nextRaid = Infinity;
    leader.x = 16.5; leader.y = 6.5; warrior.x = 19.5; warrior.y = 6.5;
    enemy.x = 22.5; enemy.y = 6.5; enemy.order = 'hold'; enemy.attack = 0;
    advance(state, 1.5);
    expect(enemy.hp).toBeLessThan(100);
    expect(distance(warrior, leader)).toBeGreaterThan(4);
    updateGame(state, 0.1, { ...idle, left: true });
    expect(warrior.target).toBe(enemy.id);
    recallRetinue(state);
    const before = warrior.x;
    updateGame(state, 0.1, { ...idle, left: true });
    expect(warrior.target).toBeUndefined();
    expect(warrior.x).toBeLessThan(before);
    for (let i = 0; i < 30; i++) updateGame(state, 0.1, { ...idle, left: true });
    advance(state, 2);
    expect(distance(warrior, leader)).toBeLessThan(4);
  });

  it('prefers an open detour around slow forest overlays', () => {
    const state = game();
    for (let x = 19; x <= 24; x++) tileAt(state.world, x, 8)!.overlay = 'forest';
    const path = findPath(state, { x: 18.5, y: 8.5 }, { x: 25.5, y: 8.5 }, 0);
    expect(path.length).toBeGreaterThan(0);
    expect(path.some(point => tileAt(state.world, point.x, point.y)?.overlay === 'forest')).toBe(false);
  });

  it('moves the leader with WASD while honoring pause and speed', () => {
    const state = game(), leader = getLeader(state)!;
    clearAround(state, 20, 10, 4);
    leader.x = 20.5; leader.y = 10.5;
    state.paused = true;
    updateGame(state, 1, { ...idle, right: true });
    expect(leader.x).toBe(20.5);
    state.paused = false; state.speed = 2;
    updateGame(state, 1, { ...idle, right: true });
    expect(leader.x).toBeCloseTo(27.7, 1);
  });

  it('blocks passage through water while allowing diagonal passage between touching corners', () => {
    const state = game(), leader = getLeader(state)!;
    clearAround(state, 20, 10, 5);
    leader.x = 20.5; leader.y = 10.5;
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * state.world.width + 21].terrain = 'river';
    updateGame(state, 1, { ...idle, right: true });
    expect(leader.x).toBeLessThan(21);
    expect(findPath(state, leader, { x: 23.5, y: 10.5 }, 0)).toEqual([]);
    const corner = game();
    corner.world.tiles[10 * 48 + 21].terrain = 'lake';
    corner.world.tiles[11 * 48 + 20].terrain = 'lake';
    const path = findPath(corner, { x: 20.5, y: 10.5 }, { x: 21.5, y: 11.5 }, 0);
    expect(path).toEqual([{ x: 21.5, y: 11.5 }]);
  });

  it('finds a walkable path around a lake', () => {
    const state = game();
    for (let y = 8; y <= 13; y++) for (let x = 20; x <= 22; x++) state.world.tiles[y * 48 + x].terrain = 'lake';
    const path = findPath(state, { x: 18.5, y: 10.5 }, { x: 25.5, y: 10.5 }, 0);
    expect(path.length).toBeGreaterThan(7);
    expect(path.every(point => canWalk(state, point.x, point.y, 0))).toBe(true);
    expect(path.at(-1)).toEqual({ x: 25.5, y: 10.5 });
  });

  it('walks the Leader through a stationary friendly soldier without rerouting or displacing it', () => {
    const state = game(), leader = getLeader(state)!;
    const blocker = state.units.find(unit => unit.kind === 'warrior' && unit.faction === 0)!;
    entityStore(state).units.replace([leader, blocker, getLeader(state, 1)!]);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace'));
    leader.x = 20.5; leader.y = 10.5; leader.destination = { x: 24.5, y: 10.5 };
    blocker.x = 22.5; blocker.y = 10.5; blocker.order = 'hold';
    let crossedFriendlyCell = false;
    for (let step = 0; step < 60; step++) {
      updateGame(state, .1, idle);
      crossedFriendlyCell ||= Math.floor(leader.x) === 22 && Math.floor(leader.y) === 10;
      expect(leader.y).toBeCloseTo(10.5);
      expect(blocker.x).toBe(22.5); expect(blocker.y).toBe(10.5); expect(blocker.order).toBe('hold');
    }
    expect(crossedFriendlyCell).toBe(true);
    expect(distance(leader, { x: 24.5, y: 10.5 })).toBeLessThan(.22);
    expect(blocker.x).toBe(22.5); expect(blocker.y).toBe(10.5);
  });

  it('enforces construction radius, resources and occupied tiles without charging failed builds', () => {
    const state = game(10000), leader = getLeader(state)!;
    leader.x = 18.5; leader.y = 10.5;
    state.factions[0].gold = 50;
    expect(buildAt(state, 'wall', 45, 2).ok).toBe(false);
    expect(state.factions[0].gold).toBe(50);
    expect(buildAt(state, 'wall', 19, 10).ok).toBe(true);
    expect(state.factions[0].gold).toBe(20);
    expect(buildAt(state, 'wall', 19, 10).ok).toBe(false);
    expect(state.factions[0].gold).toBe(20);
    expect(canWalk(state, 19.5, 10.5, 0)).toBe(true);
    expect(canWalk(state, 19.5, 10.5, 1)).toBe(true);
    state.factions[0].gold = 1;
    expect(buildAt(state, 'road', 18, 11).ok).toBe(false);
  });

  it.each([['road', 'wall'], ['wall', 'road']] as const)('builds a friendly gate with %s followed by %s, charging only each new layer', (first, second) => {
    const state = game(10000), leader = getLeader(state)!;
    clearAround(state, 20, 10, 5);
    // The completed gate belongs to a locally supported settlement.
    entityStore(state).buildings.add({ id: 10000, kind: 'well', faction: 0, x: 20, y: 7, hp: 100, maxHp: 100, capacity: 0 });
    leader.x = 20.5; leader.y = 10.5; state.factions[0].gold = 50;
    extendFixtureRoad(state, 21, 10);
    expect(buildAt(state, first, 22, 10).ok).toBe(true);
    expect(buildAt(state, second, 22, 10).ok).toBe(true);
    expect(state.factions[0].gold).toBe(18);
    expect(state.buildings.filter(building => building.x === 22 && building.y === 10).map(building => building.kind).sort()).toEqual(['road', 'wall']);
    expect(canWalk(state, 22.5, 10.5, 0)).toBe(true);
    finishOrders(state);
    expect(canWalk(state, 22.5, 10.5, 0)).toBe(true);
    for (const faction of [1, -1, MARAUDER_FACTION]) expect(canWalk(state, 22.5, 10.5, faction)).toBe(false);
    expect(movementMultiplier(state, 22.5, 10.5)).toBe(1.5);
    const road = state.buildings.find(building => building.kind === 'road' && building.x === 22)!;
    const wall = state.buildings.find(building => building.kind === 'wall' && building.x === 22)!;
    road.hp = 0;
    for (const faction of [0, 1, -1, MARAUDER_FACTION]) expect(canWalk(state, 22.5, 10.5, faction)).toBe(false);
    road.hp = 100; wall.hp = 0;
    expect(canWalk(state, 22.5, 10.5, 0)).toBe(true);
    expect(movementMultiplier(state, 22.5, 10.5)).toBe(1.5);
  });

  it('does not create gates from bridges or allow construction onto foreign layers', () => {
    const state = game(10000), leader = getLeader(state)!;
    clearAround(state, 20, 10, 5); leader.x = 20.5; leader.y = 10.5;
    state.factions[0].gold = 50;
    entityStore(state).buildings.add({ id: 10000, kind: 'wall', faction: 1, x: 22, y: 10, hp: 450, maxHp: 450, capacity: 0 });
    expect(buildAt(state, 'road', 22, 10).ok).toBe(false);
    entityStore(state).buildings.add({ id: 10001, kind: 'bridge', faction: 0, x: 22, y: 10, hp: 100, maxHp: 100, capacity: 0 });
    expect(canWalk(state, 22.5, 10.5, 0)).toBe(false);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.id < 10000));
    entityStore(state).buildings.add({ id: 10002, kind: 'road', faction: 1, x: 22, y: 10, hp: 100, maxHp: 100, capacity: 0 });
    expect(buildAt(state, 'wall', 22, 10).ok).toBe(false);
    expect(state.factions[0].gold).toBe(50);
  });

  it('allows a solid wall on a unit tile and a road underneath to create a gate', () => {
    const state = game(10000), leader = getLeader(state)!;
    clearAround(state, 20, 10, 5); leader.x = 20.9; leader.y = 10.5;
    entityStore(state).buildings.add({ id: 10000, kind: 'well', faction: 0, x: 20, y: 7, hp: 100, maxHp: 100, capacity: 0 });
    state.factions[0].gold = 50;
    extendFixtureRoad(state, 20, 10);
    expect(buildAt(state, 'wall', 21, 10).ok).toBe(true);
    expect(buildAt(state, 'road', 21, 10).ok).toBe(true);
    finishOrders(state);
    updateGame(state, .3, { ...idle, right: true });
    expect(leader.x).toBeGreaterThan(21);
  });

  it('blocks wall cells but permits diagonal passage at their touching corners', () => {
    const state = game(), leader = getLeader(state)!;
    clearAround(state, 20, 10, 5); leader.x = 20.5; leader.y = 10.5;
    entityStore(state).buildings.add(
      { id: 10000, kind: 'wall', faction: 0, x: 21, y: 10, hp: 450, maxHp: 450, capacity: 0 },
      { id: 10001, kind: 'wall', faction: 0, x: 20, y: 11, hp: 450, maxHp: 450, capacity: 0 },
    );
    expect(canMove(state, { x: 20.7, y: 10.7 }, { x: 21.3, y: 11.3 }, 0)).toBe(true);
    expect(canMove(state, leader, { x: 21.5, y: 10.5 }, 0)).toBe(false);
    expect(findPath(state, leader, { x: 21.5, y: 11.5 }, 0)[0]).toEqual({ x: 21.5, y: 11.5 });
    updateGame(state, 1, { ...idle, right: true, down: true });
    expect(leader.x).toBeGreaterThan(21);
    expect(leader.y).toBeGreaterThan(11);
  });

  it('stops a leader on a cached path when a gate closes and resumes through the reopened gate', () => {
    const state = game(), worker = getLeader(state)!;
    entityStore(state).units.replace([worker, getLeader(state, 1)!]); entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace'));
    worker.x = 20.5; worker.y = 10.5;
    worker.destination = { x: 24.5, y: 10.5 };
    for (let y = 0; y < state.world.height; y++) entityStore(state).buildings.add({ id: 10000 + y, kind: 'wall', faction: 0, x: 22, y, hp: 450, maxHp: 450, capacity: 0 });
    const road = { id: 11000, kind: 'road' as const, faction: 0, x: 22, y: 10, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(road);
    worker.path = findPath(state, worker, worker.destination, 0); worker.pathGoal = worker.destination;
    expect(worker.path.some(point => point.x === 22.5)).toBe(true);
    road.hp = 0;
    advance(state, 3);
    expect(worker.x).toBeLessThan(22);
    entityStore(state).buildings.add({ ...road, hp: 100 });
    advance(state, 5);
    expect(worker.x).toBeCloseTo(24.5);
    expect(worker.destination).toBeUndefined();
  });

  it.each([false, true])('selects or attacks a gate wall independently of layer order (wall first: %s)', wallFirst => {
    const state = game(), leader = getLeader(state)!;
    clearAround(state, 20, 10, 5); leader.x = 20.5; leader.y = 10.5;
    const wall = { id: 10000, kind: 'wall' as const, faction: 0, x: 22, y: 10, hp: 450, maxHp: 450, capacity: 0 };
    const road = { id: 10001, kind: 'road' as const, faction: 0, x: 22, y: 10, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(...(wallFirst ? [wall, road] : [road, wall]));
    interactAt(state, 22.5, 10.5);
    expect(state.selected).toBe(wall.id); expect(state.selectedType).toBe('building');
    wall.faction = 1; road.faction = 1; state.factions[1].relation = 'war';
    interactAt(state, 22.5, 10.5);
    expect(leader.target).toBe(wall.id);
  });

  it('moves legacy units out of solid walls on load while leaving units in gates in place', () => {
    const state = game(), leader = getLeader(state)!;
    const warrior = state.units.find(unit => unit.faction === 0 && unit.kind === 'warrior')!;
    entityStore(state).units.replace([leader, warrior]); entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace'));
    leader.x = 20.5; leader.y = 10.5; warrior.x = 22.5; warrior.y = 10.5;
    entityStore(state).buildings.add(
      { id: 10000, kind: 'wall', faction: 0, x: 20, y: 10, hp: 450, maxHp: 450, capacity: 0 },
      { id: 10001, kind: 'wall', faction: 0, x: 22, y: 10, hp: 450, maxHp: 450, capacity: 0 },
      { id: 10002, kind: 'road', faction: 0, x: 22, y: 10, hp: 100, maxHp: 100, capacity: 0 },
    );
    const outsider = { ...warrior, id: 12000, faction: 1 }; entityStore(state).units.add(outsider);
    tileAt(state.world, 19, 10)!.terrain = 'river';
    migrateGame(state);
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
    expect(distance(leader, { x: 20.5, y: 10.5 })).toBe(1);
    expect(tileAt(state.world, leader.x, leader.y)!.terrain !== 'river' || tileAt(state.world, leader.x, leader.y)!.overlay === 'ford').toBe(true);
    expect({ x: warrior.x, y: warrior.y }).toEqual({ x: 22.5, y: 10.5 });
    expect(canWalk(state, outsider.x, outsider.y, outsider.faction)).toBe(true);
    expect({ x: outsider.x, y: outsider.y }).not.toEqual({ x: 22.5, y: 10.5 });
  });

  it('extends the enclosing road ring cardinally without creating isolated roads or direct food income', () => {
    const state = game(), leader = getLeader(state)!;
    const palace = state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!;
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace' || building.kind === 'road' && building.faction === 0));
    synchronizeFarms(state); // Removed farms no longer reserve stale crop cells.
    const worker = state.units.find(unit => unit.faction === 0 && unit.kind === 'worker')!;
    entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' || unit.id === worker.id));
    worker.x = palace.x + 3.5; worker.y = palace.y + 0.5;
    leader.x = palace.x + 4.5; leader.y = palace.y + 1.5;
    state.factions[0].gold = 50;
    expect(buildAt(state, 'road', palace.x + 4, palace.y)).toEqual({ ok: false, message: 'Extend an existing road or bridge, or start from a ford.' });
    expect(state.factions[0].gold).toBe(50);
    expect(buildAt(state, 'road', palace.x + 3, palace.y).ok).toBe(true);
    expect(buildAt(state, 'road', palace.x + 4, palace.y).ok).toBe(true);
    const roadFoodYield = state.factions[0].yields.food;
    const food = state.factions[0].food;
    finishOrders(state);
    expect(state.time).toBeLessThan(30);
    expect(roadsReachPalaces(state)).toBe(true);
    expect(state.factions[0].food).toBe(food);
    expect(state.factions[0].yields.food).toBe(roadFoodYield);
  });

  it.each(['river', 'lake', 'coast', 'ocean'] as const)('builds bridges over %s, crosses them, and connects roads across water', terrain => {
    const state = game(), leader = getLeader(state)!;
    const palace = state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!;
    const worker = state.units.find(unit => unit.faction === 0 && unit.kind === 'worker')!;
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace' || building.kind === 'road' && building.faction === 0));
    entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' || unit.id === worker.id));
    leader.x = palace.x + 2.5; leader.y = palace.y + 2.5;
    worker.x = palace.x + 8.5; worker.y = palace.y + 0.5;
    state.factions[0].gold = 100;
    for (let y = 0; y < state.world.height; y++) tileAt(state.world, palace.x + 3, y)!.terrain = terrain;
    expect(canWalk(state, palace.x + 3.5, palace.y + 0.5, 0)).toBe(false);
    expect(buildAt(state, 'road', palace.x + 4, palace.y).ok).toBe(false);
    synchronizeFarms(state);
    const disconnectedFood = citySummaries(state).filter(city => city.palace.faction === 0).reduce((sum, city) => sum + city.food, 0);
    const before = state.factions[0].gold;
    expect(buildAt(state, 'bridge', palace.x + 3, palace.y).ok).toBe(true);
    expect(state.factions[0].gold).toBe(before - 8);
    expect(buildAt(state, 'road', palace.x + 4, palace.y).ok).toBe(true);
    expect(state.factions[0].yields.food).toBe(disconnectedFood);
    expect(canWalk(state, palace.x + 3.5, palace.y + .5, 0)).toBe(false);
    finishOrders(state);
    expect(roadsReachPalaces(state)).toBe(true);
    expect(canWalk(state, palace.x + 3.5, palace.y + 0.5, 0)).toBe(true);
    expect(movementMultiplier(state, palace.x + 3.5, palace.y + 0.5)).toBe(1);
    expect(findPath(state, { x: palace.x + 2.5, y: palace.y + 0.5 }, { x: palace.x + 4.5, y: palace.y + 0.5 }, 0)).toHaveLength(2);
    leader.x = palace.x + 3.5; leader.y = palace.y + 0.5;
    updateGame(state, 0.05, { ...idle, right: true });
    expect(leader.x - palace.x - 3.5).toBeCloseTo(3.6 * 0.05, 8);
    // The bank is for its road approach, never another paid bridge segment.
    expect(buildAt(state, 'bridge', palace.x + 4, palace.y + 1)).toEqual({ ok: false, message: 'Bridges span water tiles.' });
    const snapshot = JSON.stringify(state);
    // A parallel bridge here would create neighboring junctions on the palace loop.
    expect(validateBuildAt(state, 'bridge', palace.x + 3, palace.y + 1)).toMatchObject({ ok: false });
    expect(validateBuildAt(state, 'bridge', palace.x + 3, palace.y + 3).ok).toBe(true);
    expect(JSON.stringify(state)).toBe(snapshot);
    // The cheaper farm is now affordable and the completed bridge gives its builder a route.
    expect(buildAt(state, 'camp', palace.x + 5, palace.y + 1).ok).toBe(true);
  });

  it('selects warriors without interrupting follow and holds only on an explicit command', () => {
    const state = game();
    const warrior = state.units.find(unit => unit.faction === 0 && unit.kind === 'warrior')!;
    // Isolate command behavior from the larger starting retinue's temporary traffic yields.
    clearAround(state, 20, 8, 3); Object.assign(warrior, { x: 20.5, y: 8.5 });
    interactAt(state, warrior.x, warrior.y);
    expect(state.selected).toBe(warrior.id);
    expect(warrior.order).toBe('follow');
    setRetinueOrder(state, 'hold', warrior.id);
    expect(warrior.order).toBe('hold');
    const position = { x: warrior.x, y: warrior.y };
    advance(state, 1);
    expect(distance(warrior, position)).toBeLessThan(0.01);
    interactAt(state, warrior.x, warrior.y);
    expect(warrior.order).toBe('hold');
    setRetinueOrder(state, 'follow', warrior.id);
    expect(warrior.order).toBe('follow');
  });

  it('selects a warrior through its visible helmet without issuing a leader move order', () => {
    const state = game(), leader = getLeader(state)!;
    const warrior = state.units.find(unit => unit.faction === 0 && unit.kind === 'warrior')!;
    Object.assign(leader, { x: 20.5, y: 15.5, destination: undefined });
    Object.assign(warrior, { x: 22.5, y: 15.5 });
    interactAt(state, warrior.x, warrior.y - .8);
    expect(state.selected).toBe(warrior.id);
    expect(warrior.order).toBe('follow');
    expect(leader.destination).toBeUndefined();
    interactAt(state, warrior.x + .8, warrior.y - .8);
    expect(state.selected).toBe(leader.id);
    expect(leader.destination).toEqual({ x: 23.5, y: 14.5 });
  });

  it('attacks a visible enemy through its upper sprite but does not target hidden or dead figures', () => {
    const state = game(), leader = getLeader(state)!;
    const enemy = state.units.find(unit => unit.faction === 1 && unit.kind === 'warrior')!;
    state.factions[1].relation = 'war';
    Object.assign(leader, { x: 20.5, y: 15.5 });
    Object.assign(enemy, { x: 22.5, y: 15.5 });
    interactAt(state, enemy.x, enemy.y - .8);
    expect(leader.target).toBe(enemy.id);
    enemy.inside = true; leader.target = undefined;
    interactAt(state, enemy.x, enemy.y - .8);
    expect(leader.target).toBeUndefined();
    enemy.inside = false; enemy.hp = 0;
    interactAt(state, enemy.x, enemy.y - .8);
    expect(leader.target).toBeUndefined();
    enemy.hp = 100; enemy.x = 46.5;
    interactAt(state, enemy.x, enemy.y - .8);
    expect(leader.target).toBeUndefined();
  });
});

describe('combat, morale and exploration', () => {
  it('inflicts damage without creating floating hit numbers', () => {
    const state = game(), leader = getLeader(state)!;
    const victim = state.units.find(unit => unit.faction === 1 && unit.kind === 'warrior')!;
    state.factions[1].relation = 'war';
    entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' || unit.id === victim.id));
    leader.x = 21.5; leader.y = 10.5; victim.x = 22.5; victim.y = 10.5;
    leader.target = victim.id;
    state.particles = [];
    updateGame(state, 0.3, idle);
    expect(victim.hp).toBeLessThan(100);
    expect(leader.attackTime).toBeGreaterThan(0);
    expect(state.particles.some(particle => /^[-−]\d+$/.test(particle.text))).toBe(false);
  });

  it('awards loot for an exposed civilian and removes one resident from the victim’s city', () => {
    const state = game(), leader = getLeader(state)!;
    const victim = state.units.find(unit => unit.faction === 1 && unit.kind === 'worker')!;
    state.factions[1].relation = 'war';
    entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' || unit.id === victim.id));
    leader.x = 21.5; leader.y = 10.5; victim.x = 22.5; victim.y = 10.5; victim.hp = 1; victim.inside = false; entityStore(state).setUnitRole(victim, { kind: victim.kind, collector: false });
    state.selected = victim.id; state.selectedType = 'unit';
    const population = state.factions[1].population, gold = state.factions[0].gold;
    interactAt(state, victim.x, victim.y);
    updateGame(state, 0.3, idle);
    expect(victim.hp).toBe(0);
    expect(state.factions[0].gold).toBe(gold + 8);
    expect(state.factions[1].population).toBe(population - 1);
    expect(state.particles).toHaveLength(1);
    expect(state.particles[0]).toMatchObject({ x: victim.x, y: victim.y, text: '+8 gold' });
    const deathPosition = { x: state.particles[0].x, y: state.particles[0].y };
    advance(state, .5);
    expect(state.particles[0]).toMatchObject(deathPosition);
    advance(state, 1.2);
    expect(state.particles).toHaveLength(0);
    expect(state.factions[0].gold).toBe(gold + 8);
  });

  it('creates only bundled units and retires unsupported wildlife and ruins safely', () => {
    const state = game(), leader = getLeader(state)!;
    expect(state.units.every(unit => ['leader', 'warrior', 'worker', 'boar', 'merchant'].includes(unit.kind))).toBe(true);
    expect(state.buildings.some(building => building.kind === 'ruin')).toBe(false);
    entityStore(state).units.add({ ...leader, id: 9998, kind: 'deer', faction: -1 });
    const ruin = { id: 9999, kind: 'ruin' as const, faction: -1, x: 20, y: 10, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(ruin);
    state.fog!.buildings!.push({ ...ruin });
    leader.target = 9998;
    state.selected = 9999; state.selectedType = 'building';
    migrateGame(state);
    expect(state.units.some(unit => unit.id === 9998)).toBe(false);
    expect(state.buildings.some(building => building.id === 9999)).toBe(false);
    expect(state.fog!.buildings!.some(building => building.kind === 'ruin')).toBe(false);
    expect(leader.target).toBeUndefined();
    expect(state.selected).toBe(leader.id);
    expect(state.selectedType).toBe('unit');
  });

  it('routes low-health military units and regenerates health fifteen seconds after damage', () => {
    const state = game(), leader = getLeader(state)!;
    const warrior = state.units.find(unit => unit.faction === 0 && unit.kind === 'warrior')!;
    const enemy = state.units.find(unit => unit.faction === 1 && unit.kind === 'warrior')!;
    leader.x = 19; leader.y = 10.5; warrior.x = 20.5; warrior.y = 10.5; enemy.x = 23.5; enemy.y = 10.5;
    warrior.hp = 15; warrior.morale = 0.1; enemy.order = 'hold';
    state.factions[1].relation = 'war';
    updateGame(state, 0.1, idle);
    expect(warrior.order).toBe('flee');
    state.factions[1].relation = 'peace';
    warrior.order = 'hold'; warrior.morale = 100; warrior.hp = 50; warrior.lastDamagedAt = state.time;
    const refuge = state.buildings.find(building => building.faction === 0 && building.kind === 'palace')!;
    warrior.x = refuge.x - .5; warrior.y = refuge.y + .5;
    leader.x = warrior.x - 0.8; leader.y = warrior.y;
    advance(state, 14);
    expect(warrior.hp).toBe(50);
    advance(state, 3);
    expect(warrior.hp).toBeGreaterThan(50);
  });

  it('rehouses house residents into spare capacity and loses only unhoused population', () => {
    const state = game(), leader = getLeader(state)!;
    state.factions[1].relation = 'war';
    const homes = state.buildings.filter(building => building.faction === 1 && building.kind === 'house').slice(0, 2);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.faction !== 1 || building.kind !== 'house' || homes.includes(building)));
    const extra = { ...homes[1], id: 99999, x: 30, y: 10, residents: 0 };
    entityStore(state).buildings.add(extra); synchronizeFarms(state);
    const victimHome = homes[0];
    victimHome.hp = 1; leader.x = victimHome.x - .5; leader.y = victimHome.y + .5;
    entityStore(state).units.replace(state.units.filter(unit => unit.kind !== 'warrior'));
    const population = state.factions[1].population;
    leader.target = victimHome.id;
    updateGame(state, .3, idle);
    expect(victimHome.hp).toBe(0);
    expect(state.factions[1].population).toBe(population);
    // Damage resolves immediately; resident redistribution uses the next
    // settlement-maintenance sample rather than another full scan on impact.
    updateGame(state, .4, idle);
    expect(homes[1].residents).toBe(2); expect(extra.residents).toBe(2);
    extra.hp = 1; leader.x = extra.x - .5; leader.y = extra.y + .5; leader.cooldown = 0; leader.target = extra.id;
    updateGame(state, .3, idle);
    expect(extra.hp).toBe(0);
    updateGame(state, .4, idle);
    expect(state.factions[1].population).toBe(5);
    expect(state.buildings.find(building => building.kind === 'palace' && building.faction === 1)!.unhousedResidents).toBe(3);
  });

  it('sends a hostile Leader-led army toward the player settlement and allows a ten-second respawn while that settlement survives', () => {
    const state = game();
    state.factions[1].relation = 'war'; state.factions[1].nextRaid = 0;
    updateGame(state, 0.1, idle);
    expect(['attack', 'regroup']).toContain(getFactionStrategy(state, 1)?.mode);
    expect(state.units.some(unit => unit.faction === 1 && unit.order === 'raid')).toBe(false);
    const fallen = getLeader(state)!, treasury = state.factions[0].gold;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      fallen.hp = 0; updateGame(state, .4, idle);
      expect(state.buildings.some(building => building.kind === 'palace' && building.faction === 0 && building.hp > 0)).toBe(true);
      expect(state.factions[0]).toMatchObject({ defeated: false, gold: treasury - 200,
        leaderRespawn: { readyAtWallTime: 1_010_000 } });
      expect(getLeader(state)).toBeUndefined();
      expect(state.gameOver).toBe(false); expect(state.victory).toBe(false);
      updateLeaderRespawns(state, 1_009_999); expect(getLeader(state)).toBeUndefined();
      updateLeaderRespawns(state, 1_010_000);
      expect(getLeader(state)?.hp).toBeGreaterThan(0); expect(getLeader(state)?.id).not.toBe(fallen.id);
      expect(state.factions[0].leaderRespawn).toBeUndefined(); expect(state.gameOver).toBe(false);
    } finally { clock.mockRestore(); }
  });
});

describe('automatic combat target priorities', () => {
  function encounter(mode: 'warrior' | 'raider' | 'marauder' | 'leader' = 'warrior') {
    const state = game(), leader = getLeader(state)!, enemyLeader = getLeader(state, 1)!;
    const attacker = mode === 'leader' ? enemyLeader : state.units.find(unit => unit.faction === 1 && unit.kind === 'warrior')!;
    const warrior = state.units.find(unit => unit.faction === 0 && unit.kind === 'warrior')!;
    const worker = state.units.find(unit => unit.faction === 0 && unit.kind === 'worker')!;
    entityStore(state).units.replace([...new Set([attacker, enemyLeader, leader, warrior, worker])]);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace'));
    state.factions[1].relation = 'war'; state.factions[1].nextRaid = Infinity;
    const enemyPalace = state.buildings.find(building => building.faction === 1)!;
    enemyPalace.x = 18; enemyPalace.y = 13;
    for (const unit of state.units) { unit.attack = 0; unit.speed = 0; unit.order = 'hold'; unit.inside = false; entityStore(state).setUnitRole(unit, { kind: unit.kind, collector: false }); }
    enemyLeader.x = 19.5; enemyLeader.y = 13.5;
    attacker.x = 20.5; attacker.y = 10.5; attacker.order = mode === 'raider' ? 'raid' : 'follow';
    leader.x = 23.5; leader.y = 10.5;
    warrior.x = 22.5; warrior.y = 10.5;
    worker.x = 21.5; worker.y = 10.5;
    if (mode === 'marauder') { attacker.faction = MARAUDER_FACTION; attacker.marauderPack = 999; }
    return { state, attacker, leader, warrior, worker, enemyLeader };
  }

  it.each(['warrior', 'raider', 'marauder', 'leader'] as const)('makes a %s choose the nearer warrior over the leader and a closer worker', mode => {
    const { state, attacker, warrior } = encounter(mode);
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(warrior.id);
  });

  it('treats leaders and warriors as one military tier and selects the closest one', () => {
    const { state, attacker, leader, warrior, worker } = encounter();
    leader.x = 21.5; warrior.x = 23.5; worker.x = 20.5; worker.y = 9.8;
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(leader.id);
  });

  it.each(['marauder', 'leader'] as const)('makes a %s abandon a distant leader and its old path for a nearby warrior', mode => {
    const { state, attacker, leader, warrior } = encounter(mode);
    leader.x = 26.5;
    attacker.target = leader.id; attacker.speed = 2;
    attacker.path = [{ x: 19.5, y: 10.5 }]; attacker.pathGoal = { x: 26.5, y: 10.5 }; attacker.repathAt = 100;
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(warrior.id);
    if (mode === 'leader') { expect(attacker.x).toBe(20.5); expect(attacker.path).toBeUndefined(); }
    else expect(attacker.x).toBeGreaterThan(20.5);
  });

  it.each(['marauder', 'leader'] as const)('makes a %s release a target that leaves its pursuit radius', mode => {
    const { state, attacker, leader, warrior, worker, enemyLeader } = encounter(mode);
    leader.x = 30.5; warrior.x = 31.5; worker.x = 32.5;
    if (mode === 'marauder') enemyLeader.x = 40.5;
    const enemyPalace = state.buildings.find(building => building.faction === 1)!;
    enemyPalace.x = 40; enemyPalace.y = 24;
    attacker.target = leader.id;
    // Moving all player units out of pursuit range also hides the marauder.
    // Faction Leaders retain their normal next-step decision frequency.
    updateGame(state, mode === 'marauder' ? .5 : .1, idle);
    expect(attacker.target).toBeUndefined();
  });

  it('chooses the closest worker before buildings, then attacks a building when no units are nearby', () => {
    const { state, attacker, leader, warrior, worker } = encounter();
    leader.x = 30.5; warrior.x = 31.5; worker.x = 22.5;
    const nearerWorker = { ...worker, id: 9990, x: 21.5 };
    entityStore(state).units.add(nearerWorker);
    // Civilian buildings inside the attacker's city now switch allegiance.
    // A watchtower remains hostile, isolating unit-before-building priority.
    const tower = { id: 9991, kind: 'woodenTower' as const, faction: 0, x: 20, y: 9, hp: 100, maxHp: 100, capacity: 0, attackCooldown: Infinity };
    entityStore(state).buildings.add(tower);
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(nearerWorker.id);
    worker.x = 30.5; nearerWorker.x = 32.5;
    updateGame(state, .7, idle);
    expect(attacker.target).toBe(tower.id);
  });

  it('keeps hold orders stationary and considers only targets in striking range', () => {
    const { state, attacker, warrior, worker } = encounter();
    attacker.order = 'hold'; attacker.speed = 3.96;
    warrior.x = 21.9;
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(worker.id);
    expect(attacker.x).toBe(20.5);
    expect(attacker.y).toBe(10.5);
  });

  it('does not let an out-of-leash military target suppress an attack near the retinue leader', () => {
    const { state, attacker, leader, warrior, worker, enemyLeader } = encounter();
    enemyLeader.x = 16.5; enemyLeader.y = 10.5;
    leader.x = 31.5; warrior.x = 25;
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(worker.id);
  });

  it('preserves the player leader’s explicit attack order despite closer military targets', () => {
    const { state, attacker, leader, warrior, worker, enemyLeader } = encounter();
    leader.x = 20.5; attacker.x = 21.5; warrior.x = 30.5; worker.x = 32.5; enemyLeader.x = 40.5;
    const victim = { ...worker, id: 9990, faction: 1, x: 23.5 };
    entityStore(state).units.add(victim);
    interactAt(state, victim.x, victim.y);
    updateGame(state, .1, idle);
    expect(leader.target).toBe(victim.id);
  });

  it('lets an idle player leader strike military units first without chasing them out of reach', () => {
    const { state, attacker, leader, warrior, worker, enemyLeader } = encounter();
    leader.x = 20.5; leader.attack = 25; leader.speed = 3.6;
    attacker.x = 21.5; warrior.x = 30.5; worker.x = 32.5; enemyLeader.x = 40.5;
    const civilian = { ...worker, id: 9990, faction: 1, x: 20.5, y: 9.7 };
    entityStore(state).units.add(civilian);
    updateGame(state, .3, idle);
    expect(attacker.hp).toBeLessThan(100);
    expect(civilian.hp).toBe(50);
    expect(leader.target).toBeUndefined();
    const hp = attacker.hp;
    attacker.x = 25.5; civilian.x = 26.5;
    advance(state, 1);
    expect(attacker.hp).toBe(hp);
    expect(leader.x).toBe(20.5);
    expect(leader.y).toBe(10.5);
    expect(leader.target).toBeUndefined();
  });

  it.each(['keyboard', 'destination'] as const)('gives player %s movement precedence over automatic strikes', movement => {
    const { state, attacker, leader, warrior, worker, enemyLeader } = encounter();
    leader.x = 20.5; leader.attack = 25; leader.speed = 3.6;
    attacker.x = 21.5; warrior.x = 30.5; worker.x = 32.5; enemyLeader.x = 40.5;
    if (movement === 'destination') leader.destination = { x: 18.5, y: 10.5 };
    updateGame(state, .1, movement === 'keyboard' ? { ...idle, left: true } : idle);
    expect(attacker.hp).toBe(100);
    expect(leader.x).toBeLessThan(20.5);
    expect(leader.target).toBeUndefined();
  });
});

describe('diplomacy', () => {
  it('requires the leader to approach the palace and can declare war', () => {
    const state = game(), leader = getLeader(state)!;
    expect(diplomacyAction(state, 1, 'war').ok).toBe(false);
    const palace = state.buildings.find(building => building.faction === 1 && building.kind === 'palace')!;
    leader.x = palace.x - 2; leader.y = palace.y;
    interactAt(state, palace.x + 1, palace.y + 1);
    expect(state.diplomacy).toBe(1);
    expect(diplomacyAction(state, 1, 'war').ok).toBe(true);
    expect(state.factions[1].relation).toBe('war');
    expect(diplomacyAction(state, 1, 'war').ok).toBe(false);
  });

  it('merges people, housing, stores and soldiers after seeded successful confederation, yielding victory', () => {
    const state = game(), leader = getLeader(state)!;
    const palace = state.buildings.find(building => building.faction === 1 && building.kind === 'palace')!;
    leader.x = palace.x - 2; leader.y = palace.y;
    state.factions[1].affinity = 100; state.rngState = 0;
    state.factions[0].culture = 40; state.factions[1].culture = 60;
    const totalPopulation = state.factions.reduce((sum, faction) => sum + faction.population, 0);
    const food = state.factions.reduce((sum, faction) => sum + faction.food, 0);
    expect(diplomacyAction(state, 1, 'confederate').ok).toBe(true);
    expect(state.factions[1].relation).toBe('confederated');
    expect(state.factions[0].population).toBe(totalPopulation);
    expect(state.factions[0].food).toBe(food);
    expect(state.factions[0].culture).toBe(100); expect(state.factions[1].culture).toBe(0);
    expect(state.units.some(unit => unit.faction === 1)).toBe(false);
    expect(state.buildings.some(building => building.faction === 1)).toBe(false);
    expect(state.units.filter(unit => unit.kind === 'leader')).toHaveLength(1);
    expect(state.units.filter(unit => unit.kind === 'warrior').every(unit => Math.abs(unit.speed - leader.speed * 1.1) < 1e-8 && unit.order === 'follow')).toBe(true);
    expect(state.gameOver).toBe(true); expect(state.victory).toBe(true);
  });
});


describe('adversarial settlement and siege regressions', () => {
  it('walks to and breaches a complete wall perimeter instead of stalling outside an unreachable palace', () => {
    const state = game(), leader = getLeader(state)!;
    const palace = state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!;
    const commander = getLeader(state, 1)!;
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace'));
    entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' || unit.faction === 1 && unit.kind === 'warrior'));
    state.factions[1].relation = 'war'; state.factions[1].nextRaid = 0;
    // This probes siege navigation without repair crews rebuilding the breach.
    state.factions[0].population = 0;
    for (const faction of state.factions) faction.nextRetinueAt = Infinity;
    leader.x = 18.5; leader.y = 25.5;
    commander.x = 19.5; commander.y = palace.y - 1.5;
    state.units.filter(unit => unit.faction === 1 && unit.kind === 'warrior').forEach((unit, i) => {
      unit.x = 19.5 + i % 2; unit.y = palace.y + .5 + Math.floor(i / 2);
    });
    let id = 10000;
    for (let y = palace.y - 2; y <= palace.y + 3; y++) for (let x = palace.x - 2; x <= palace.x + 3; x++) {
      if (y !== palace.y - 2 && y !== palace.y + 3 && x !== palace.x - 2 && x !== palace.x + 3) continue;
      entityStore(state).buildings.add({ id: id++, kind: 'wall', faction: 0, x, y, hp: 60, maxHp: 450, defenseBaseMaxHp: 45, capacity: 0 });
    }
    const walls = state.buildings.filter(building => building.kind === 'wall' && building.faction === 0).length;
    advance(state, 24);
    expect(state.buildings.filter(building => building.kind === 'wall' && building.faction === 0).length).toBeLessThan(walls);
    expect(palace.hp).toBeLessThan(palace.maxHp);
  });

  it('throws at an enemy island within javelin range without crossing water', () => {
    const state = game(), leader = getLeader(state)!;
    const enemy = state.units.find(unit => unit.faction === 1 && unit.kind === 'worker')!;
    entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' || unit.id === enemy.id));
    state.factions[1].relation = 'war';
    leader.x = 20.5; leader.y = 10.5; enemy.x = 24.5; enemy.y = 10.5; enemy.inside = false; entityStore(state).setUnitRole(enemy, { kind: enemy.kind, collector: false });
    for (let y = 8; y <= 12; y++) for (let x = 22; x <= 26; x++) {
      if (x === 24 && y === 10) continue;
      state.world.tiles[y * 48 + x].terrain = 'lake';
    }
    interactAt(state, enemy.x, enemy.y);
    advance(state, 10);
    expect(enemy.hp).toBe(0);
    expect(leader.x).toBe(20.5);
    expect(leader.x).toBeLessThan(22);
    expect(canWalk(state, leader.x, leader.y, 0)).toBe(true);
  });

  it('does not house people in an isolated farm or teleport a collector out to its inaccessible center field', () => {
    const state = game();
    const worker = state.units.find(unit => unit.faction === 0 && unit.kind === 'worker')!;
    entityStore(state).units.replace(state.units.filter(unit => unit.kind === 'leader' || unit.id === worker.id));
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace' || building.id === worker.home));
    entityStore(state).buildings.add({ id: 10000, kind: 'camp', faction: 0, x: 18, y: 10, hp: 100, maxHp: 100, capacity: 1 });
    for (let y = 9; y <= 11; y++) for (let x = 17; x <= 19; x++) {
      if (x === 18 && y === 10) continue;
      state.world.tiles[y * 48 + x].terrain = 'lake';
    }
    const player = state.factions[0];
    player.population = 1;
    const palace = state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!;
    // Disable palace quarters to isolate the inaccessible farm's capacity.
    palace.capacity = 0; palace.populationGrowth = 2; player.production = 0; player.gold = 0;
    advance(state, 30);
    expect(player.population).toBe(1);
    const fields = state.fields!.filter(field => field.faction === 0);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ x: 18, y: 10, planted: true });
    expect(housingCapacity(state, 0)).toBe(0);
    expect(worker.inside).toBe(true);
    expect(state.units.filter(unit => unit.faction === 0 && unit.collector)).toHaveLength(0);
    expect(state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!.populationGrowth).toBeGreaterThanOrEqual(2);
  });

  it('continues the economy after one of two player palaces falls', () => {
    const state = game(), leader = getLeader(state)!;
    const palace = state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!;
    entityStore(state).buildings.add({ id: 10000, kind: 'palace', faction: 0, x: 18, y: 20, hp: 650, maxHp: 650, capacity: 0 });
    const attacker = getLeader(state, 1)!;
    entityStore(state).units.replace(state.units.filter(unit => unit.kind !== 'warrior'));
    state.factions[1].relation = 'war';
    leader.x = 20.5; leader.y = 25.5;
    attacker.x = palace.x - 0.5; attacker.y = palace.y + 0.5; attacker.target = palace.id; attacker.order = 'raid'; palace.hp = 1;
    // This is a deliberate palace strike; new civilian traders otherwise take
    // the normal unit-before-building combat priority.
    attacker.forcedAttack = { target: palace.id };
    updateGame(state, 0.7, idle);
    expect(state.buildings.some(building => building.id === palace.id)).toBe(false);
    expect(state.factions[0].defeated).toBe(false);
    expect(state.gameOver).toBe(false);
    // Keep this delivery/rerouting scenario independent of camp harvest phases.
    for (const field of state.fields!) field.nextHarvest = 30;
    advance(state, 30);
    const food = state.factions[0].food;
    advance(state, 20);
    expect(state.factions[0].food).toBeGreaterThan(food);
    expect(state.tick).toBe(1);
  });
});

describe('independent raider camps', { timeout: 30000 }, () => {
  it.each(['BTV-847', 'marauder-connected-valley'])('makes actual opening contact within thirty seconds on seed %s', async seed => {
    const state = createGame(generateWorld(seed));
    // Isolate the opening camp wave from independent full-faction assaults,
    // whose arrival times also depend on ford speed and woodland routes.
    for (const faction of state.factions) if (faction.id !== 0) faction.nextRaid = Infinity;
    expect(state.marauderPacks!.some(pack => pack.microRaid && pack.targetFaction === 0)).toBe(true);
    expect(state.raiderCamps!.length).toBeGreaterThan(0);
    let contactAt = Infinity;
    for (let step = 0; step < 300; step++) {
      updateGame(state, .1, idle);
      if (state.units.some(unit => unit.faction === -2 && unit.lastCombat > 0
        && state.marauderPacks!.some(pack => pack.id === unit.marauderPack && pack.microRaid && pack.targetFaction === 0))) {
        contactAt = state.time; break;
      }
      if (step % 50 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(contactAt).toBeLessThanOrEqual(30);
    expect(state.fogRaids!.waves).toBe(0); // The ordinary minute-one wave is still separate.
    expect(state.gameOver).toBe(false);
    expect(getLeader(state)!.hp).toBeGreaterThan(0);
    expect(state.buildings.some(building => building.kind === 'palace' && building.faction === 0 && building.hp > 0)).toBe(true);
  }, 30000);

  it('keeps camps separate from diplomacy factions and creates full-health raiders at their first departure', () => {
    const state = createGame(generateWorld('marauder-counts'));
    const factionCount = state.factions.length;
    expect(state.marauderPacks!.every(pack => pack.raiderCamp === undefined)).toBe(true);
    expect(state.raiderCamps!.map(camp => camp.size).sort()).toEqual(['large', 'medium', 'small']);
    for (const camp of state.raiderCamps!) {
      const [minimum, maximum] = { small: [3, 5], medium: [6, 9], large: [10, 18] }[camp.size];
      expect(camp.houses.length).toBeGreaterThanOrEqual(minimum); expect(camp.houses.length).toBeLessThanOrEqual(maximum);
    }
    state.time = state.fogRaids!.nextAt; updateFogRaids(state);
    expect(state.factions).toHaveLength(factionCount);
    const spawned = state.units.filter(unit => state.marauderPacks!.some(pack => pack.raid && !pack.microRaid && pack.id === unit.marauderPack));
    expect(spawned).toHaveLength(4);
    expect(spawned.every(unit => unit.faction === MARAUDER_FACTION && unit.hp === unit.maxHp && canWalk(state, unit.x, unit.y, MARAUDER_FACTION))).toBe(true);
    expect(state.marauderPacks!.find(pack => pack.raid && !pack.microRaid)!.raiderCamp).toBe(state.raiderCamps![0].id);
  });

  it('is hostile to every full faction but never another raider camp or wildlife', () => {
    const state = createGame(flatWorld('marauder-hostility'));
    for (const faction of state.factions) {
      const hostile = faction.villageId === undefined;
      expect(atWar(state, MARAUDER_FACTION, faction.id)).toBe(hostile);
      expect(atWar(state, faction.id, MARAUDER_FACTION)).toBe(hostile);
    }
    expect(atWar(state, MARAUDER_FACTION, MARAUDER_FACTION)).toBe(false);
    expect(atWar(state, MARAUDER_FACTION, -1)).toBe(false);
  });

  it('migrates legacy bands once and preserves camp identity and departure times on reload', () => {
    const state = createGame(generateWorld('legacy-camps'));
    const obsolete = { ...getLeader(state)!, id: 90000, kind: 'warrior' as const, faction: -2, marauderPack: 99 };
    entityStore(state).units.add(obsolete); delete state.raiderCamps;
    entityStore(state).buildings.replace(state.buildings.filter(building => building.raiderCamp === undefined));
    migrateGame(state);
    expect(state.units).not.toContain(obsolete);
    expect(state.raiderCamps!.length).toBeGreaterThan(0);
    const camps = structuredClone((state as GameState).raiderCamps);
    state.buildings.find(building => building.id === camps![0].houses[0])!.hp = 0;
    const restored = migrateGame(structuredClone(state));
    expect(restored.raiderCamps).toEqual(camps);
    expect(restored.buildings.some(building => building.id === camps![0].houses[0] && building.hp > 0)).toBe(false);
  });
});
