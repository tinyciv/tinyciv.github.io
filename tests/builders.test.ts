import { roadsReachPalaces } from './helpers/roads';
import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import type { Building, GameState, Point, Unit } from '../src/game/types';
import { buildingReady, distance } from '../src/game/types';
import { builderCapacity, constructionEdges, repairRate, ensureBuilders, updateBuilder } from '../src/game/builders';
import { queueConstruction, startConstruction, updateConstruction } from '../src/game/structures';
import { canMove, canWalk, findPath } from '../src/game/pathfinding';
import { BUILD_COSTS, buildAt, migrateGame, moveUnit, updateGame } from '../src/game/simulation';
import { updateFog } from '../src/game/fog';
import { recordTraffic } from '../src/game/traffic';

function fixture(): GameState {
  const state: GameState = { world: { width: 24, height: 18, seed: 'builders', source: 'test', spawns: [], tiles: Array.from({ length: 24 * 18 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    units: [], buildings: [{ id: 1, kind: 'palace', x: 3, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 500, population: 5, culture: 10000, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'builders', rngState: 1, fields: [], marauderPacks: [] };
  state.factions.forEach(unlockBuildingResearch);
  return state;
}
function order(state: GameState, x = 15, y = 8, kind: Building['kind'] = 'tower'): Building {
  const site: Building = { id: Math.max(...state.buildings.map(building => building.id), ...state.units.map(unit => unit.id)) + 1, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
  queueConstruction(site, state.time); entityStore(state).buildings.add(site); ensureBuilders(state); return site;
}
function seedRoadLoop(state: GameState): void {
  for (let y = 6; y <= 9; y++) for (let x = 2; x <= 5; x++) {
    if (x > 2 && x < 5 && y > 6 && y < 9) continue;
    entityStore(state).buildings.add({ id: 100 + y * 24 + x, kind: 'road', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
  }
}
// This movement adapter respects actual grid routes and speed. Integration tests
// below also exercise the simulation's real collision/yielding movement.
function move(state: GameState, unit: Unit, goal: Point, dt: number): void {
  if (!unit.path?.length) unit.path = findPath(state, unit, goal, unit.faction);
  const next = unit.path?.[0]; if (!next) return;
  const d = distance(unit, next), fraction = Math.min(1, unit.speed * dt / Math.max(.001, d));
  const point = { x: unit.x + (next.x - unit.x) * fraction, y: unit.y + (next.y - unit.y) * fraction };
  if (!canMove(state, unit, point, unit.faction)) { unit.path = undefined; return; }
  unit.x = point.x; unit.y = point.y;
  if (distance(unit, next) < .01) unit.path.shift();
}
function advance(state: GameState, seconds: number): void {
  for (let remaining = seconds; remaining > 1e-6; remaining -= .1) {
    state.time += .1; updateConstruction(state); ensureBuilders(state);
    for (const unit of state.units) if (unit.builder && unit.hp > 0) updateBuilder(state, unit, .1, move);
  }
}

describe('palace construction peasants', () => {
  it.each([[0, 0], [1, 1], [4, 1], [5, 1], [9, 1], [10, 2], [25, 5]])('staffs %i residents with %i builders without needing pending orders', (population, expected) => {
    const state = fixture(); state.factions[0].population = population;
    ensureBuilders(state);
    expect(state.units.filter(unit => unit.builder && !unit.builderRetiring)).toHaveLength(expected);
    expect(state.units.every(unit => unit.inside && unit.hp === 50)).toBe(true);
    ensureBuilders(state);
    expect(state.units.filter(unit => unit.builder && !unit.builderRetiring)).toHaveLength(expected);
  });

  it('shares the population allowance across palaces and retires surplus workers without casualties', () => {
    const state = fixture(); state.factions[0].population = 15; state.buildings[0].unhousedResidents = 10;
    entityStore(state).buildings.add({ ...state.buildings[0], id: 30, x: 12, y: 12, unhousedResidents: 5 });
    ensureBuilders(state);
    expect(state.units.filter(unit => unit.builder)).toHaveLength(3);
    expect(new Set(state.units.map(unit => unit.home)).size).toBe(2);
    state.factions[0].population = 5;
    ensureBuilders(state);
    expect(state.units.filter(unit => unit.builder)).toHaveLength(1);
    expect(state.casualties ?? []).toHaveLength(0);
    expect(state.factions[0].population).toBe(5);
  });

  it.each([5, 10])('keeps %i residents’ builders at their inhabited origin instead of dispatching from an empty nearer city', population => {
    const state = fixture(); state.factions[0].population = population; ensureBuilders(state);
    const workers = [...state.units], worker = workers[0];
    expect(workers.every(unit => unit.home === 1)).toBe(true);
    const nearby = { ...state.buildings[0], id: 30, x: 17, y: 10 };
    entityStore(state).buildings.add(nearby);
    const site = order(state, 20, 5);
    updateBuilder(state, worker, .1, move);
    expect(worker).toMatchObject({ home: 1, inside: false, buildPhase: 'outbound', buildSite: site.id });
    expect(constructionEdges(state, state.buildings[0])).toContainEqual({ x: worker.x, y: worker.y });
    expect(site.construction!.builderId).toBe(worker.id);
    expect(state.units).toHaveLength(builderCapacity(population));
    expect(state.units.map(unit => unit.id)).toEqual(workers.map(unit => unit.id));
  });

  it('falls back to a farther settlement when every exit from the nearest settlement is blocked', () => {
    const state = fixture(), nearby = { ...state.buildings[0], id: 30, x: 17, y: 10 };
    entityStore(state).buildings.add(nearby);
    for (const edge of constructionEdges(state, nearby)) state.world.tiles[Math.floor(edge.y) * 24 + Math.floor(edge.x)].terrain = 'river';
    const site = order(state, 20, 5), worker = state.units[0];
    updateBuilder(state, worker, .1, move);
    expect(worker).toMatchObject({ home: 1, buildSite: site.id, buildPhase: 'outbound' });
    expect(constructionEdges(state, state.buildings[0])).toContainEqual({ x: worker.x, y: worker.y });
  });

  it('compares walking routes instead of sending a geometrically nearer settlement around a long detour', () => {
    const state = fixture(), direct = state.buildings[0];
    direct.x = 21; direct.y = 13;
    const detour = { ...direct, id: 30, x: 13, y: 8 };
    entityStore(state).buildings.add(detour);
    for (let y = 1; y < state.world.height; y++) state.world.tiles[y * 24 + 16].terrain = 'river';
    const site = order(state, 18, 8), worker = state.units[0];
    expect(distance(detour, site)).toBeLessThan(distance(direct, site));
    updateBuilder(state, worker, .1, move);
    expect(worker).toMatchObject({ home: direct.id, buildSite: site.id, buildPhase: 'outbound' });
    expect(worker.path!.every(point => point.x > 16)).toBe(true);
  });

  it.each(['unfinished', 'foreign', 'destroyed', 'forbidden'] as const)('does not dispatch from a nearer %s settlement', condition => {
    const state = fixture(), nearby = { ...state.buildings[0], id: 30, x: 17, y: 10 };
    if (condition === 'unfinished') startConstruction(nearby, state.time);
    if (condition === 'foreign') nearby.faction = 1;
    if (condition === 'destroyed') nearby.hp = 0;
    if (condition === 'forbidden') state.forbiddenZones = { cells: [nearby.y * 24 + nearby.x], revision: 1 };
    entityStore(state).buildings.add(nearby);
    const site = order(state, 20, 5), worker = state.units[0];
    updateBuilder(state, worker, .1, move);
    expect(worker).toMatchObject({ home: 1, buildSite: site.id, buildPhase: 'outbound' });
  });

  it('waits for a local population slot and then leaves its inhabited origin', () => {
    const state = fixture(); state.factions[0].population = 1; ensureBuilders(state);
    const worker = state.units[0], courier = { ...worker, id: 50, builder: false, inside: false, x: 8.5, y: 8.5 };
    entityStore(state).units.add(courier);
    const nearby = { ...state.buildings[0], id: 30, x: 17, y: 10 };
    entityStore(state).buildings.add(nearby);
    const site = order(state, 20, 5);
    updateBuilder(state, worker, .1, move);
    expect(worker).toMatchObject({ home: 1, inside: true, buildPhase: 'idle' });
    expect(site.construction!.builderId).toBeUndefined();
    courier.inside = true; state.time += 1;
    updateBuilder(state, worker, .1, move);
    expect(worker).toMatchObject({ home: 1, inside: false, buildSite: site.id });
    expect(state.units.filter(unit => unit.builder)).toHaveLength(1);
  });

  it.each(['outbound', 'working', 'returning'] as const)('does not teleport or reassign an %s worker when a closer settlement gains new work', phase => {
    const state = fixture(), first = order(state, 8, 8), worker = state.units[0];
    updateBuilder(state, worker, .1, move);
    if (phase === 'working') {
      Object.assign(worker, constructionEdges(state, first)[0]);
      updateBuilder(state, worker, .1, move);
      expect(worker.buildPhase).toBe('working');
    } else if (phase === 'returning') {
      worker.x = 8.5; worker.y = 7.5; worker.buildSite = undefined; worker.buildPhase = 'returning';
      delete first.construction;
    }
    const original = { home: worker.home, x: worker.x, y: worker.y, buildSite: worker.buildSite };
    entityStore(state).buildings.add({ ...state.buildings[0], id: 30, x: 17, y: 10 });
    const next = order(state, 20, 5);
    updateBuilder(state, worker, .1, () => {});
    expect(worker).toMatchObject({ ...original, buildPhase: phase, inside: false });
    expect(next.construction!.builderId).toBeUndefined();
    expect(state.units.filter(unit => unit.builder)).toHaveLength(1);
  });

  it('samples new orders at the next idle deadline while preserving retries for unchanged unreachable work', () => {
    const state = fixture(); ensureBuilders(state);
    const worker = state.units[0]; updateBuilder(state, worker, .1, move);
    expect(worker.repathAt).toBe(2);
    state.time = .1;
    order(state); updateBuilder(state, worker, .1, move);
    expect(worker.buildPhase).toBe('idle');
    state.time = 2 / 3; updateBuilder(state, worker, .1, move);
    expect(worker.buildPhase).toBe('outbound');

    const blocked = fixture();
    for (let y = 0; y < blocked.world.height; y++) blocked.world.tiles[y * 24 + 10].terrain = 'river';
    order(blocked);
    const waiting = blocked.units[0]; updateBuilder(blocked, waiting, .1, move);
    expect(waiting.repathAt).toBe(2);
    blocked.time = .1; ensureBuilders(blocked); updateBuilder(blocked, waiting, .1, move);
    expect(waiting.repathAt).toBe(2);
  });

  it('keeps working builders before idle ones after population falls and preserves the cap on reload', () => {
    const state = fixture(); state.factions[0].population = 15; ensureBuilders(state);
    const site = order(state), worker = state.units[2];
    Object.assign(worker, { x: site.x - .5, y: site.y + .5, inside: false, buildSite: site.id, buildPhase: 'working' });
    Object.assign(site.construction!, { builderId: worker.id, waitingForBuilder: false, cleared: true });
    state.factions[0].population = 5; ensureBuilders(state);
    expect(state.units.filter(unit => unit.builder)).toEqual([worker]);
    const restored: GameState = JSON.parse(JSON.stringify(state)); ensureBuilders(restored);
    expect(restored.units.filter(unit => unit.builder)).toHaveLength(1);
    expect(restored.units[0]).toMatchObject({ buildSite: site.id, buildPhase: 'working' });
  });

  it('uses the existing builder to repair after five quiet seconds, walks there, and pauses on another attack', () => {
    const state = fixture();
    const target: Building = { id: 2, kind: 'house', faction: 0, x: 8, y: 8, hp: 60, maxHp: 160, capacity: 4, lastAttacked: 0 };
    entityStore(state).buildings.add(target); ensureBuilders(state);
    const worker = state.units[0];
    advance(state, 4.9);
    expect(worker.inside).toBe(true); expect(target.hp).toBe(60);
    for (let i = 0; i < 50 && worker.repairSite === undefined; i++) advance(state, .1);
    expect(worker).toMatchObject({ repairSite: target.id, inside: false, buildPhase: 'outbound' });
    expect(target.hp).toBe(60);
    for (let i = 0; i < 100 && worker.buildPhase !== 'repairing'; i++) advance(state, .1);
    expect(worker.buildPhase).toBe('repairing');
    const before = target.hp; advance(state, 1);
    expect(target.hp - before).toBeCloseTo(repairRate(target), 5);
    target.hp -= 10; target.lastAttacked = state.time;
    const damaged = target.hp;
    advance(state, 4.9); expect(target.hp).toBe(damaged);
    advance(state, .2); expect(target.hp).toBeGreaterThan(damaged);
    advance(state, 25);
    expect(target.hp).toBe(target.maxHp);
    expect(target.repairerId).toBeUndefined();
    expect(state.units.filter(unit => unit.builder)).toHaveLength(1);
    expect(worker).toMatchObject({ inside: true, buildPhase: 'idle', repairSite: undefined });
  });

  it('scales repair rate with original construction duration and never duplicates repair assignments', () => {
    const state = fixture(); state.factions[0].population = 20;
    const house: Building = { id: 2, kind: 'house', faction: 0, x: 8, y: 8, hp: 60, maxHp: 160, capacity: 4 };
    const tower: Building = { id: 3, kind: 'woodenTower', faction: 0, x: 9, y: 12, hp: 100, maxHp: 600, capacity: 0 };
    expect(repairRate(house)).toBe(12); expect(repairRate(tower)).toBe(40);
    entityStore(state).buildings.add(house, tower); ensureBuilders(state); advance(state, .1);
    const repairing = state.units.filter(unit => unit.repairSite !== undefined);
    expect(repairing).toHaveLength(2);
    expect(new Set(repairing.map(unit => unit.repairSite)).size).toBe(2);
    expect(state.units.filter(unit => unit.builder)).toHaveLength(4);
  });

  it('dispatches onto the existing palace road loop without creating an isolated road', () => {
    const state = fixture(); seedRoadLoop(state); order(state, 17, 3, 'camp');
    entityStore(state).units.add({ id: 90, kind: 'leader', faction: 0, x: 4.5, y: 12.5, hp: 100, morale: 100, attack: 25,
      defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
    updateGame(state, .05, { up: false, down: false, left: false, right: false });
    const worker = state.units.find(unit => unit.builder)!;
    const roads = state.buildings.filter(building => building.kind === 'road');
    expect(worker.buildPhase).toBe('outbound');
    expect(roads).toHaveLength(12);
    expect(roadsReachPalaces(state)).toBe(true);
    expect(roads).toContainEqual(expect.objectContaining({ x: Math.floor(worker.x), y: Math.floor(worker.y) }));
  });
  it('reaches a new farm across open ground without laying roads on either leg', () => {
    const state = fixture(); seedRoadLoop(state); const camp = order(state, 17, 3, 'camp');
    const initialRoadIds = state.buildings.filter(building => building.kind === 'road').map(building => building.id);
    const worker = state.units.find(unit => unit.builder)!;
    let reachedWork = false, completed = false;
    for (let i = 0; i < 1600; i++) {
      const from = { x: worker.x, y: worker.y };
      state.time += .05; updateConstruction(state); updateBuilder(state, worker, .05, moveUnit);
      recordTraffic(state, worker, from);
      reachedWork ||= worker.buildPhase === 'working';
      completed ||= !camp.construction;
      if (completed && worker.inside) break;
    }
    expect(reachedWork).toBe(true); expect(completed).toBe(true); expect(worker.inside).toBe(true);
    expect(state.buildings.filter(building => building.kind === 'road').map(building => building.id)).toEqual(initialRoadIds);
    expect(state.traffic).toBeUndefined();
  });
  it('does not pave fields, impassable overlays, river fords or 2×2 road blocks while making a camp approach', () => {
    const state = fixture(), camp = order(state, 17, 8, 'camp');
    const worker = state.units.find(unit => unit.builder)!;
    updateBuilder(state, worker, .1, moveUnit);
    const positions: Point[] = [{ x: 8, y: 4 }, { x: 9, y: 4 }, { x: 10, y: 4 }, { x: 16, y: 8 }, { x: 3, y: 7 }, { x: 12, y: 4 }];
    state.world.tiles[4 * 24 + 8].farm = 0;
    state.world.tiles[4 * 24 + 9].overlay = 'glacier';
    Object.assign(state.world.tiles[4 * 24 + 10], { terrain: 'river', overlay: 'ford' });
    for (const [x, y] of [[11, 3], [12, 3], [11, 4]]) entityStore(state).buildings.add({ id: 100 + x + y * 24, kind: 'road', x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    for (const position of positions) {
      worker.x = position.x + .5; worker.y = position.y + .5;
      expect(recordTraffic(state, worker, { x: worker.x - 1, y: worker.y })).toBe(false);
      expect(state.buildings.some(building => building.kind === 'road' && building.x === position.x && building.y === position.y)).toBe(false);
    }
    expect(state.world.tiles[4 * 24 + 9].overlay).toBe('glacier');
    expect(camp.construction!.waitingForBuilder).toBe(true);
  });
  it('never paves vegetation while a farm builder crosses it', () => {
    for (const overlay of ['forest', 'jungle', 'swamp'] as const) {
      const state = fixture(); order(state, 17, 8, 'camp');
      const worker = state.units.find(unit => unit.builder)!;
      updateBuilder(state, worker, .1, moveUnit);
      const tile = state.world.tiles[4 * 24 + 9]; tile.overlay = overlay;
      const underlying = { ...tile };
      entityStore(state).buildings.add({ id: 500, kind: 'road', faction: 0, x: 8, y: 4, hp: 100, maxHp: 100, capacity: 0 });
      worker.x = 9.5; worker.y = 4.5;
      expect(recordTraffic(state, worker, { x: 8.5, y: 4.5 })).toBe(false);
      expect(state.buildings.some(building => building.kind === 'road' && building.x === 9)).toBe(false);
      expect(state.traffic).toBeUndefined();
      expect(tile).toEqual(underlying);
    }
  });
  it('does not count ordinary construction or return trips toward road wear', () => {
    const state = fixture(); order(state);
    const worker = state.units.find(unit => unit.builder)!;
    updateBuilder(state, worker, .1, moveUnit);
    worker.x = 8.5; worker.y = 4.5;
    expect(recordTraffic(state, worker, { x: 7.5, y: 4.5 })).toBe(false);
    const site = state.buildings.find(building => building.id === worker.buildSite)!;
    entityStore(state).setBuildingKind(site, 'camp'); worker.buildPhase = 'returning'; worker.x = 9.5;
    expect(recordTraffic(state, worker, { x: 8.5, y: 4.5 })).toBe(false);
    expect(state.buildings.some(building => building.kind === 'road')).toBe(false);
    expect(state.traffic).toBeUndefined();
  });
  it('still reaches a camp through a necessary diagonal corner passage', () => {
    const state = fixture();
    for (let y = 0; y < state.world.height; y++) for (let x = 0; x < state.world.width; x++) {
      if (x === 10 && y !== 7 || x === 11 && y !== 8) state.world.tiles[y * 24 + x].terrain = 'river';
    }
    const route = findPath(state, { x: 5.5, y: 7.5 }, { x: 16.5, y: 8.5 }, 0, false, undefined, undefined, undefined, true);
    expect(route.at(-1)).toEqual({ x: 16.5, y: 8.5 });
    expect(route).toContainEqual({ x: 10.5, y: 7.5 });
    expect(route).toContainEqual({ x: 11.5, y: 8.5 });
    for (let i = 0; i < route.length; i++) expect(canMove(state, i ? route[i - 1] : { x: 5.5, y: 7.5 }, route[i], 0)).toBe(true);
  });
  it('dispatches real simulation movement after a build command and preserves that journey on reload', () => {
    let state = fixture();
    entityStore(state).units.add({ id: 90, kind: 'leader', faction: 0, x: 17.5, y: 8.5, hp: 100, morale: 100, attack: 25,
      defense: 5, speed: 3.6, range: 1.65, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
    updateFog(state);
    expect(buildAt(state, 'woodenTower', 15, 8).ok).toBe(true);
    const towerId = state.buildings.find(building => building.kind === 'woodenTower')!.id;
    expect(state.factions[0].gold).toBe(500 - BUILD_COSTS.woodenTower.gold);
    const idle = { up: false, down: false, left: false, right: false };
    updateGame(state, 2, idle);
    const outbound = state.units.find(unit => unit.builder)!;
    expect(outbound).toMatchObject({ buildPhase: 'outbound', inside: false, buildSite: towerId });
    expect(outbound.x).toBeGreaterThan(5); expect(outbound.x).toBeLessThan(12);
    state = migrateGame(JSON.parse(JSON.stringify(state)));
    expect(state.units.filter(unit => unit.builder)).toHaveLength(1);
    const tower = state.buildings.find(building => building.id === towerId)!;
    for (let i = 0; i < 120 && tower.construction!.waitingForBuilder; i++) updateGame(state, .1, idle);
    expect(tower.construction!.waitingForBuilder).toBe(false);
    expect(tower.construction!.startedAt).toBeGreaterThan(4);
    const left = tower.construction!.startedAt + tower.construction!.duration - state.time;
    updateGame(state, left - .2, idle); expect(buildingReady(tower)).toBe(false);
    updateGame(state, .3, idle); expect(buildingReady(tower)).toBe(true);
  });
  it('reserves an order, walks from the palace, then starts the actual duration on arrival', () => {
    const state = fixture(), site = order(state);
    const worker = state.units.find(unit => unit.builder)!;
    expect(worker).toMatchObject({ inside: true, buildPhase: 'idle', home: 1, kind: 'worker' });
    expect(site.construction).toMatchObject({ waitingForBuilder: true, startedAt: 0, duration: 25 });
    expect(canWalk(state, site.x, site.y, 0)).toBe(true);
    advance(state, .1);
    expect(worker).toMatchObject({ inside: false, buildPhase: 'outbound', buildSite: site.id });
    expect(distance(worker, state.buildings[0])).toBeLessThan(3);
    expect(distance(worker, site)).toBeGreaterThan(9);
    advance(state, 2);
    expect(worker.x).toBeGreaterThan(5.5); expect(worker.x).toBeLessThan(14);
    expect(site.construction!.waitingForBuilder).toBe(true);
    for (let i = 0; i < 100 && site.construction!.waitingForBuilder; i++) advance(state, .1);
    expect(worker.buildPhase).toBe('working');
    expect(canWalk(state, site.x, site.y, 0)).toBe(false);
    const arrivedAt = site.construction!.startedAt;
    expect(arrivedAt).toBeGreaterThan(4);
    advance(state, 24); expect(buildingReady(site)).toBe(false);
    advance(state, 1.2); expect(buildingReady(site)).toBe(true); expect(worker.buildPhase).toBe('returning');
    advance(state, 8); expect(worker).toMatchObject({ inside: true, buildPhase: 'idle', buildSite: undefined });
    expect(state.factions[0].population).toBe(5);
  });
  it('never starts an unreachable order, then dispatches after access opens', () => {
    const state = fixture();
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * 24 + 10].terrain = 'river';
    const site = order(state);
    advance(state, 40);
    expect(site.construction).toMatchObject({ waitingForBuilder: true, startedAt: 0 });
    expect(state.units.filter(unit => unit.builder).every(unit => unit.inside)).toBe(true);
    state.world.tiles[8 * 24 + 10].overlay = 'ford';
    advance(state, 15);
    expect(site.construction!.waitingForBuilder).toBe(false);
    expect(site.construction!.startedAt).toBeGreaterThan(40);
  });
  it('pauses a killed builders work and resumes its remaining duration after replacement arrives', () => {
    const state = fixture(), site = order(state);
    advance(state, 12);
    const worker = state.units.find(unit => unit.builder)!;
    expect(worker.buildPhase).toBe('working');
    const completedWork = state.time - site.construction!.startedAt;
    worker.hp = 0; advance(state, .1);
    expect(site.construction!.waitingForBuilder).toBe(true);
    expect(site.construction!.pausedAt).toBeCloseTo(state.time);
    expect(canWalk(state, site.x, site.y, 0)).toBe(true);
    const replacement = state.units.find(unit => unit.builder && unit.hp > 0)!;
    expect(replacement.id).not.toBe(worker.id); expect(replacement.buildPhase).toBe('outbound');
    advance(state, 3); expect(site.construction!.waitingForBuilder).toBe(true);
    for (let i = 0; i < 100 && site.construction!.waitingForBuilder; i++) advance(state, .1);
    expect(state.time - site.construction!.startedAt).toBeCloseTo(completedWork + .1, 5);
    expect(replacement.buildPhase).toBe('working');
    advance(state, site.construction!.duration - completedWork + .2);
    expect(buildingReady(site)).toBe(true);
  });
  it('preserves outbound journeys and active work through a save roundtrip', () => {
    let state = fixture(); const site = order(state);
    advance(state, 2); state = JSON.parse(JSON.stringify(state)); ensureBuilders(state);
    expect(state.units.filter(unit => unit.builder)).toHaveLength(1);
    advance(state, 7);
    const loaded = state.buildings.find(building => building.id === site.id)!;
    expect(loaded.construction!.waitingForBuilder).toBe(false);
    const startedAt = loaded.construction!.startedAt;
    state = JSON.parse(JSON.stringify(state)); ensureBuilders(state); advance(state, 2);
    expect(state.buildings.find(building => building.id === site.id)!.construction!.startedAt).toBe(startedAt);
    expect(state.units.filter(unit => unit.builder)).toHaveLength(1);
  });
  it('bounds a long build queue by population and leaves legacy active timers running', () => {
    const state = fixture();
    for (let y = 3; y < 10; y++) order(state, 15, y, 'wall');
    expect(state.units.filter(unit => unit.builder)).toHaveLength(builderCapacity(state.factions[0].population));
    const legacy: Building = { id: 99, kind: 'wall', x: 20, y: 15, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
    startConstruction(legacy, 0); entityStore(state).buildings.add(legacy);
    advance(state, 8.1); expect(buildingReady(legacy)).toBe(true);
    expect(state.buildings.some(building => building.construction?.waitingForBuilder)).toBe(true);
  });
  it('reroutes an outbound builder when its original working edge is blocked', () => {
    const state = fixture(), site = order(state);
    advance(state, 2);
    const worker = state.units.find(unit => unit.builder)!;
    const edge = worker.destination!;
    entityStore(state).buildings.add({ id: 200, kind: 'wall', x: Math.floor(edge.x), y: Math.floor(edge.y), faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    advance(state, 12);
    expect(site.construction!.waitingForBuilder).toBe(false);
    expect(worker.buildPhase).toBe('working');
    expect(distance(worker, edge)).toBeGreaterThan(.8);
  });
  it('returns a peasant after its ordered site is destroyed, then reuses it for new work', () => {
    const state = fixture(), site = order(state);
    advance(state, 2); site.hp = 0; advance(state, 5);
    const worker = state.units.find(unit => unit.builder)!;
    expect(worker).toMatchObject({ buildPhase: 'idle', inside: true, buildSite: undefined });
    const replacementOrder = order(state, 12, 5, 'wall');
    advance(state, 6);
    expect(state.units.filter(unit => unit.builder)).toHaveLength(1);
    expect(worker).toMatchObject({ buildSite: replacementOrder.id, buildPhase: 'working' });
  });
});
