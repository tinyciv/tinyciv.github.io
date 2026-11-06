import { describe, expect, it } from 'vitest';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { panicCivilian, updateCivilianPanic } from '../src/game/civilian-panic';
import { courierReturnPath } from '../src/game/courier-routes';
import { entityStore } from '../src/game/entity-store';
import { palaceWalkingDistances } from '../src/game/farm-travel';
import { ensureCollectors, synchronizeFarms, updateCollector } from '../src/game/farms';
import { isForbidden, setForbiddenRectangle, unitRespectsForbidden } from '../src/game/forbidden-zones';
import { planHouseAt, planHouseSite } from '../src/game/housing';
import { queueConstruction, updateConstruction } from '../src/game/structures';
import { updateMerchant, updateTradeRoutes } from '../src/game/trade';
import { updateVillageUnit } from '../src/game/villages';
import type { Building, GameState } from '../src/game/types';

const idleMove = () => {};
const city = (id: number, x: number, y = 7): Building => ({ id, kind: 'palace', x, y, faction: 0, hp: 650, maxHp: 650, capacity: 4 });
function fixture(): GameState {
  return {
    world: { width: 24, height: 18, seed: 'forbidden-work', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 24 * 18 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .3 })) },
    buildings: [city(1, 3)], units: [], factions: [{ id: 0, name: 'Test', color: '#e44', affinity: 100, relation: 'self',
      food: 100, gold: 500, production: 0, population: 5, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'forbidden-work', rngState: 1, fields: [], treeClearings: [],
  };
}
function forbid(state: GameState, x: number, y: number, x2 = x, y2 = y, value = true): void {
  setForbiddenRectangle(state, { x, y }, { x: x2, y: y2 }, value);
}

describe('forbidden civilian work', () => {
  it('pauses active construction, preserves paid work, and resumes after removal', () => {
    const state = fixture();
    const house: Building = { id: 2, kind: 'house', x: 10, y: 8, faction: 0, hp: 160, maxHp: 160, capacity: 4 };
    queueConstruction(house, 0, 125); entityStore(state).buildings.add(house); ensureBuilders(state);
    const worker = state.units[0];
    Object.assign(worker, { x: 9.5, y: 8.5, inside: false, buildSite: house.id, buildPhase: 'working' });
    Object.assign(house.construction!, { waitingForBuilder: false, builderId: worker.id, cleared: true });
    state.time = 5; forbid(state, 10, 8); updateConstruction(state);
    expect(house.construction).toMatchObject({ waitingForBuilder: true, pausedAt: 5, paidGold: 125 });
    state.time = 40; updateConstruction(state);
    expect(house.construction).toBeDefined(); expect(state.factions[0].gold).toBe(500);
    forbid(state, 10, 8, 10, 8, false); updateBuilder(state, worker, .1, idleMove);
    expect(house.construction).toMatchObject({ waitingForBuilder: false, startedAt: 35 });
    state.time = 35 + 40 / 3 - .1; updateConstruction(state); expect(house.construction).toBeDefined();
    state.time = 35 + 40 / 3; updateConstruction(state); expect(house.construction).toBeUndefined();
  });

  it('does not dispatch builders for forbidden construction, repair, or tree orders', () => {
    const state = fixture();
    const site: Building = { id: 2, kind: 'house', x: 10, y: 8, faction: 0, hp: 160, maxHp: 160, capacity: 4 };
    queueConstruction(site, 0, 125); entityStore(state).buildings.add(site);
    entityStore(state).buildings.add({ ...site, id: 3, x: 12, construction: undefined, hp: 50 });
    state.world.tiles[6 * 24 + 11].overlay = 'forest';
    state.treeClearings = [{ x: 11, y: 6, faction: 0 }];
    forbid(state, 10, 6, 13, 9); ensureBuilders(state);
    updateBuilder(state, state.units[0], .1, idleMove);
    expect(state.units[0]).toMatchObject({ inside: true, buildPhase: 'idle' });
    expect(state.units[0].buildSite).toBeUndefined(); expect(state.units[0].repairSite).toBeUndefined();
    expect(state.units[0].clearTree).toBeUndefined(); expect(state.treeClearings).toHaveLength(1);
    forbid(state, 10, 6, 13, 9, false); state.time = 3; updateBuilder(state, state.units[0], .1, idleMove);
    expect(state.units[0].buildSite).toBe(site.id);
  });

  it('releases a newly forbidden harvest without collecting or deleting it', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 2, kind: 'camp', x: 10, y: 8, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    synchronizeFarms(state); ensureCollectors(state);
    const worker = state.units.find(unit => unit.collector)!, field = state.fields![0];
    Object.assign(field, { food: 5, foodBatches: [{ amount: 5, expiresAt: 100 }], expiresAt: 100, claimedBy: worker.id });
    Object.assign(worker, { x: field.x + .5, y: field.y + .5, inside: false, field: field.id, collectPhase: 'outbound' });
    forbid(state, field.x, field.y); updateCollector(state, worker, .1, idleMove);
    expect(worker.cargo ?? 0).toBe(0); expect(field.food).toBe(5); expect(field.claimedBy).toBeUndefined();
    expect(worker.field).toBeUndefined(); expect(worker.collectPhase).toBe('returning');
  });

  it('dispatches collectors only to permitted plots, with paths around the zone', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 2, kind: 'camp', x: 10, y: 8, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    synchronizeFarms(state); ensureCollectors(state);
    for (const field of state.fields!) Object.assign(field, { food: 5, foodBatches: [{ amount: 5, expiresAt: 100 }], expiresAt: 100 });
    forbid(state, 8, 5, 9, 8); // Leave the single farm tile open beyond the forbidden approach.
    const worker = state.units.find(unit => unit.collector)!; updateCollector(state, worker, .1, idleMove);
    expect(worker.collectPhase).toBe('outbound');
    const target = state.fields!.find(field => field.id === worker.field)!;
    expect(isForbidden(state, target.x, target.y)).toBe(false);
    expect(worker.path!.length).toBeGreaterThan(0);
    expect(worker.path!.every(point => !isForbidden(state, point.x, point.y))).toBe(true);
  });

  it('invalidates walking maps and cached courier routes immediately when a zone changes', () => {
    const state = fixture(), palace = state.buildings[0], goal = { x: 19.5, y: 8.5 }, from = { x: 6.5, y: 8.5 };
    const original = palaceWalkingDistances(state, palace), path = courierReturnPath(state, from, goal, 0);
    expect(Number.isFinite(original[8 * 24 + 19])).toBe(true); expect(path.length).toBeGreaterThan(0);
    forbid(state, 12, 0, 12, 17);
    const blocked = palaceWalkingDistances(state, palace);
    expect(blocked).not.toBe(original); expect(blocked[8 * 24 + 19]).toBe(Infinity);
    const waiting = courierReturnPath(state, from, goal, 0);
    expect(waiting.every(point => !isForbidden(state, point.x, point.y))).toBe(true);
    expect(waiting.at(-1)).not.toEqual(goal);
    forbid(state, 12, 0, 12, 17, false);
    expect(Number.isFinite(palaceWalkingDistances(state, palace)[8 * 24 + 19])).toBe(true);
    expect(courierReturnPath(state, from, goal, 0).at(-1)).toEqual(goal);
  });

  it('does not let manual or automatic housing reuse a forbidden candidate from cache', () => {
    const state = fixture(), palace = state.buildings[0], point = { x: 8, y: 8 };
    expect(planHouseAt(state, palace, point)).toBeDefined();
    forbid(state, 8, 8);
    expect(planHouseAt(state, palace, point)).toBeUndefined();
    const next = planHouseSite(state, palace);
    expect(next).toBeDefined(); expect(isForbidden(state, next!.point.x, next!.point.y)).toBe(false);
  });

  it('routes a panicked worker to allowed refuge instead of its forbidden settlement', () => {
    const state = fixture(); ensureBuilders(state);
    const worker = state.units[0]; Object.assign(worker, { x: 8.5, y: 8.5, inside: false });
    forbid(state, 0, 0, 6, 17);
    panicCivilian(state, worker, { x: 9.5, y: 8.5 });
    updateCivilianPanic(state, worker, .1, idleMove, () => false, () => false);
    expect(worker.destination).toBeDefined();
    expect(isForbidden(state, worker.destination!.x, worker.destination!.y)).toBe(false);
    expect(worker.path!.every(point => !isForbidden(state, point.x, point.y))).toBe(true);
  });

  it('makes allied village guards respect zones and abandons forbidden patrol and combat targets', () => {
    const state = fixture(); ensureBuilders(state);
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace', villageId: 1 });
    state.villages = [{ id: 1, faction: 1, campId: 3, name: 'Allied camp', identity: 'growers', relation: 'allied',
      x: 10, y: 8, nextGrowthAt: 90, nextThinkAt: 0, nextRecruitAt: 90 }];
    entityStore(state).buildings.add({ id: 3, kind: 'villageTent', faction: 1, villageId: 1, x: 10, y: 8, hp: 100, maxHp: 100, capacity: 0 });
    const guard = { ...state.units[0], id: 4, kind: 'warrior' as const, faction: 1, villageId: 1, builder: undefined,
      x: 10.5, y: 10.5, inside: false, home: 3, attack: 16, destination: { x: 12.5, y: 10.5 }, villageNextWanderAt: 100 };
    const enemy = { ...guard, id: 5, kind: 'leader' as const, faction: 2, villageId: undefined, x: 12.5 };
    entityStore(state).units.replace([guard, enemy]);
    forbid(state, 12, 10);
    expect(unitRespectsForbidden(state, guard)).toBe(true);
    let attacks = 0;
    const orders = { move: idleMove, engage: () => { attacks++; }, hostile: (a: number, b: number) => a === 1 && b === 2, visible: () => true };
    updateVillageUnit(state, guard, .1, orders);
    expect(attacks).toBe(0); expect(guard.target).toBeUndefined();
    expect(!guard.destination || !isForbidden(state, guard.destination.x, guard.destination.y, 1)).toBe(true);
    forbid(state, 12, 10, 12, 10, false); state.time = 1;
    updateVillageUnit(state, guard, .1, orders); expect(attacks).toBe(1);
  });

  it('retains a blocked trade route and resumes it without paying for waiting', () => {
    const state = fixture(); entityStore(state).buildings.add(city(2, 19));
    updateTradeRoutes(state); const merchant = state.units.find(unit => unit.kind === 'merchant')!, route = state.tradeRoutes![0];
    expect(merchant).toBeDefined(); const gold = state.factions[0].gold;
    forbid(state, 19, 7, 20, 8); updateTradeRoutes(state); updateMerchant(state, merchant, .1, idleMove);
    expect(state.tradeRoutes).toHaveLength(1); expect(merchant.hp).toBeGreaterThan(0); expect(route.goal).toBeUndefined();
    expect(state.factions[0].gold).toBe(gold); expect(route.journeys).toBe(0);
    forbid(state, 19, 7, 20, 8, false); state.time = 10; updateMerchant(state, merchant, .1, idleMove);
    expect(route.goal).toBeDefined(); expect(state.factions[0].gold).toBe(gold);
  });
});
