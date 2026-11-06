import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildAt, BUILD_COSTS, validateBuildAt } from '../src/game/simulation';
import { planHouseAt, planHouseSite } from '../src/game/housing';
import { planFarmRelocation, planWallFarmRelocation, relocateFarm } from '../src/game/farm-relocation';
import { buildStroke, constructionLine, planConstruction } from '../src/game/construction';
import { ensureCollectors, synchronizeFarms } from '../src/game/farms';
import { type Building, type GameState, tileAt } from '../src/game/types';

function fixture(): GameState {
  const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({ id, kind, faction: 0, x, y, hp: 160, maxHp: 160, capacity: 0 });
  const state: GameState = {
    world: { width: 30, height: 24, seed: 'relocation', source: 'fixture', spawns: [], revision: 0,
      tiles: Array.from({ length: 720 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 8, 10), building(2, 'camp', 12, 10)], fields: [],
    units: [{ id: 3, kind: 'leader', faction: 0, x: 11.5, y: 9.5, hp: 100, morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4,
      order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#f43', affinity: 100, relation: 'self', food: 500, gold: 1000, population: 4, production: 0,
      culture: 10000, yields: { food: 10, gold: 4, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 10, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'relocation', rngState: 1,
  };
  synchronizeFarms(state); ensureCollectors(state);
  return state;
}

describe('free relocation of farmland for housing', () => {
  it.each([[0, 0]])('redevelops the farm cell (%i,%i) for exactly the house cost', (dx, dy) => {
    const state = fixture(), farm = state.buildings[1], point = { x: farm.x + dx, y: farm.y + dy };
    const beforeGold = state.factions[0].gold, beforeFood = state.factions[0].food, before = JSON.stringify(state);
    const plan = planHouseAt(state, state.buildings[0], point)!;
    expect(plan.farmMove).toBeDefined(); expect(JSON.stringify(state)).toBe(before);
    expect(validateBuildAt(state, 'house', point.x, point.y).ok).toBe(true);
    expect(buildAt(state, 'house', point.x, point.y).ok).toBe(true);
    expect(state.buildings.find(building => building.kind === 'house')).toMatchObject({ ...point, capacity: 3, redevelopedFarm: true });
    expect(state.buildings).toContain(farm); expect(farm.kind).toBe('camp');
    expect(state.fields).toHaveLength(1);
    expect(state.factions[0].gold).toBe(beforeGold - BUILD_COSTS.house.gold);
    expect(state.factions[0].food).toBe(beforeFood);
    expect(tileAt(state.world, point.x, point.y)?.farm).toBeUndefined();
  });

  it('requires a reachable complete replacement plot and leaves everything unchanged when none exists', () => {
    const state = fixture(), farm = state.buildings[1];
    for (let y = 0; y < state.world.height; y++) for (let x = 0; x < state.world.width; x++)
      if (!(x >= 7 && x <= 10 && y >= 9 && y <= 12) && !(x === 12 && y === 10) && !(x === 11 && y === 10))
        tileAt(state.world, x, y)!.terrain = 'lake';
    state.world.revision!++;
    const before = JSON.stringify(state);
    expect(planFarmRelocation(state, state.buildings[0], farm, farm)).toBeUndefined();
    expect(buildAt(state, 'house', farm.x, farm.y).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rejects a stale relocation atomically instead of spending gold or losing crops', () => {
    const state = fixture(), farm = state.buildings[1], point = { x: farm.x, y: farm.y };
    const plan = planFarmRelocation(state, state.buildings[0], farm, point)!;
    entityStore(state).buildings.add({ id: 999, kind: 'house', faction: 0, ...plan.to, hp: 160, maxHp: 160, capacity: 4 });
    const before = JSON.stringify(state);
    expect(relocateFarm(state, plan, point)).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('uses nearest farmland before a farther empty parcel, and an even closer empty parcel before farmland', () => {
    const state = fixture(), farm = state.buildings[1], palace = state.buildings[0];
    for (const tile of state.world.tiles) tile.overlay = 'forest';
    for (const field of state.fields!) tileAt(state.world, field.x, field.y)!.overlay = 'none';
    tileAt(state.world, 18, 10)!.overlay = 'none';
    state.world.revision!++;
    expect(planHouseSite(state, palace)).toMatchObject({ point: { x: farm.x, y: farm.y }, replaceCampId: farm.id });
    tileAt(state.world, 11, 10)!.overlay = 'none'; state.world.revision!++;
    expect(planHouseSite(state, palace)).toEqual({ point: { x: 11, y: 10 } });
  });

  it('keeps relocated field IDs unique when a new farm later occupies its former footprint', () => {
    const state = fixture(), farm = state.buildings[1], old = { x: farm.x, y: farm.y };
    const plan = planFarmRelocation(state, state.buildings[0], farm, old)!;
    expect(relocateFarm(state, plan, old)).toBe(true);
    entityStore(state).buildings.add({ id: 999, kind: 'camp', faction: 0, ...old, hp: 160, maxHp: 160, capacity: 0 });
    synchronizeFarms(state);
    expect(state.fields).toHaveLength(2);
    expect(new Set(state.fields!.map(field => field.id)).size).toBe(2);
  });

  it('reuses hover plans and immediately invalidates them when a destination is reserved', () => {
    const state = fixture(), point = { x: 12, y: 10 }, palace = state.buildings[0];
    const first = planHouseAt(state, palace, point)!;
    expect(planHouseAt(state, palace, point)).toBe(first);
    entityStore(state).buildings.add({ id: 999, kind: 'house', faction: 0, ...first.farmMove!.to, hp: 160, maxHp: 160, capacity: 4 });
    const second = planHouseAt(state, palace, point)!;
    expect(second).not.toBe(first);
    expect(second.farmMove!.to).not.toEqual(first.farmMove!.to);
  });
});

describe('free relocation of farmland for defensive walls', () => {
  it.each(['wall', 'palisade'] as const)('moves crops and courier jobs intact for only the %s price', kind => {
    const state = fixture(), farm = state.buildings[1], old = { x: farm.x, y: farm.y };
    state.factions[0].research = { focus: 'wall', levels: { wall: 1 }, progress: {} };
    const fields = [...state.fields!], worker = state.units.find(unit => unit.collector)!;
    fields[0].food = 7; fields[0].foodBatches = [{ amount: 7, expiresAt: 140 }];
    fields[0].nextHarvest = 99; fields[0].claimedBy = worker.id;
    worker.field = fields[0].id; worker.cargoField = fields[0].id; worker.cargo = 3;
    worker.collectPhase = 'outbound'; worker.destination = { x: old.x + .5, y: old.y + .5 };
    worker.path = [{ ...worker.destination }]; worker.inside = false;
    const gold = state.factions[0].gold, food = state.factions[0].food;
    expect(validateBuildAt(state, kind, old.x, old.y)).toMatchObject({ ok: true });
    expect(buildAt(state, kind, old.x, old.y)).toMatchObject({ ok: true });
    expect(farm).not.toMatchObject(old); expect(state.buildings).toContain(farm);
    expect(state.fields).toEqual(fields); expect(state.fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ food: 7, nextHarvest: 99, foodBatches: [{ amount: 7, expiresAt: 140 }], claimedBy: worker.id });
    expect(worker).toMatchObject({ field: fields[0].id, cargoField: fields[0].id, cargo: 3, collectorCamp: farm.id });
    expect(worker.path).toBeUndefined(); expect(worker.destination).toBeUndefined();
    expect(state.factions[0].gold).toBe(gold - BUILD_COSTS[kind].gold);
    expect(state.factions[0].food).toBe(food);
    expect(tileAt(state.world, old.x, old.y)?.farm).toBeUndefined();
  });

  it.each(['wall', 'palisade'] as const)('keeps roads underneath %s and relocates several farms once each across a drag', kind => {
    const state = fixture(); state.factions[0].research = { focus: 'wall', levels: { wall: 1 }, progress: {} };
    const farm = state.buildings[1];
    const second = { ...farm, id: 800, x: 14, y: 10 };
    const road: Building = { id: 801, kind: 'road', faction: 0, x: 13, y: 10, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(second, road); synchronizeFarms(state);
    const points = constructionLine({ x: 12, y: 10 }, { x: 15, y: 10 });
    const before = JSON.stringify(state), gold = state.factions[0].gold;
    const preview = planConstruction(state, kind, points);
    expect(preview.tiles).toHaveLength(4); expect(JSON.stringify(state)).toBe(before);
    expect(buildStroke(state, kind, points)).toMatchObject({ ok: true, placed: 4, skipped: 0 });
    expect(state.fields).toHaveLength(2); expect(new Set(state.fields!.map(field => field.id)).size).toBe(2);
    expect(state.fields!.every(field => !points.some(point => point.x === field.x && point.y === field.y))).toBe(true);
    expect(state.buildings).toContain(road);
    expect(state.factions[0].gold).toBe(gold - 4 * BUILD_COSTS[kind].gold);
  });

  it.each(['wall', 'palisade'] as const)('rejects an inaccessible replacement after the complete %s stroke without any mutation', kind => {
    const state = fixture(), farm = state.buildings[1];
    state.factions[0].research = { focus: 'wall', levels: { wall: 1 }, progress: {} };
    for (let y = 0; y < state.world.height; y++) for (let x = 0; x < state.world.width; x++)
      if (!(x >= 7 && x <= 10 && y >= 9 && y <= 12) && !(x >= 12 && x <= 13 && y >= 10 && y <= 11)
        && !(x >= 16 && x <= 17 && y >= 10 && y <= 11) && !(y === 10 && x >= 11 && x <= 15))
        tileAt(state.world, x, y)!.terrain = 'lake';
    state.world.revision!++;
    for (let y = 9; y <= 12; y++) for (let x = 7; x <= 11; x++) {
      if (x >= 8 && x <= 9 && y >= 10 && y <= 11) continue;
      entityStore(state).buildings.add({ id: 9000 + y * 30 + x, kind: 'road', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
    }
    const points = [{ x: 12, y: 10 }, { x: 12, y: 11 }], reserved = new Set(points.map(point => point.y * state.world.width + point.x));
    const before = JSON.stringify(state);
    expect(planWallFarmRelocation(state, farm, 0, reserved)).toBeUndefined();
    expect(buildAt(state, kind, farm.x, farm.y, 0, reserved).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('does not move a farm if the wall cannot be paid for or its planned destination becomes occupied', () => {
    const state = fixture(), farm = state.buildings[1], point = { x: farm.x, y: farm.y };
    const plan = planWallFarmRelocation(state, point, 0)!;
    entityStore(state).buildings.add({ id: 999, kind: 'house', faction: 0, ...plan.to, hp: 160, maxHp: 160, capacity: 4 });
    let before = JSON.stringify(state);
    expect(relocateFarm(state, plan, point, { wall: true })).toBe(false); expect(JSON.stringify(state)).toBe(before);
    state.factions[0].gold = 0; before = JSON.stringify(state);
    expect(buildAt(state, 'palisade', point.x, point.y).ok).toBe(false); expect(JSON.stringify(state)).toBe(before);
  });
});
