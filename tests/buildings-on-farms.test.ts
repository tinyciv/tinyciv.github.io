import { describe, expect, it, vi } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { buildAt, BUILD_COSTS, updateGame, validateBuildAt } from '../src/game/simulation';
import { buildStroke, planConstruction } from '../src/game/construction';
import { constructionProgress } from '../src/game/construction-cancellation';
import { planBuildingFarmRelocations, relocateBuildingFarms } from '../src/game/farm-relocation';
import { synchronizeFarms } from '../src/game/farms';
import { queueConstruction } from '../src/game/structures';
import { type Building, type BuildingKind, type GameState, buildingHeight, buildingWidth } from '../src/game/types';
import { unlockBuildingResearch } from './helpers/research';
import * as farmTravel from '../src/game/farm-travel';

const origin = { x: 12, y: 8 };
const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  const palace: Building = { id: 1, kind: 'palace', faction: 0, x: 5, y: 8, hp: 650, maxHp: 650,
    capacity: 20, unhousedResidents: 20, governorPermissions: { farms: false, housing: false } };
  const farms = Array.from({ length: 4 }, (_, i): Building => ({ id: 10 + i, kind: 'camp', faction: 0,
    x: origin.x + i % 2, y: origin.y + Math.floor(i / 2), hp: 100, maxHp: 100, capacity: 0 }));
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'building-farm-relocation', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5,
        food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [palace, ...farms],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 11.5, y: 11.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#d85842', affinity: 100, relation: 'self', food: 1000, gold: 2000,
      production: 0, population: 20, culture: 10000, yields: { food: 0, production: 0, gold: 0 },
      nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'building-farm-relocation', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
  unlockBuildingResearch(state.factions[0]); synchronizeFarms(state);
  return state;
}
function inside(building: Pick<Building, 'kind' | 'x' | 'y'>, x: number, y: number): boolean {
  return x >= building.x && x < building.x + buildingWidth(building) && y >= building.y && y < building.y + buildingHeight(building);
}
function assertNoCropOverlap(state: GameState, target: Building): void {
  for (const farm of state.buildings.filter(building => building.kind === 'camp')) expect(inside(target, farm.x, farm.y)).toBe(false);
  for (const field of state.fields ?? []) {
    expect(inside(target, field.x, field.y)).toBe(false);
    expect(state.buildings.some(building => building.kind === 'road' && building.hp > 0 && inside(building, field.x, field.y))).toBe(false);
  }
}

describe('solid buildings relocating farm footprints', () => {
  it('previews and orders a library over four farms without losing crops, cargo or gold', () => {
    const state = fixture(), farms = state.buildings.slice(1), fields = [...state.fields!];
    for (let i = 0; i < fields.length; i++) Object.assign(fields[i], { food: i + .5, nextHarvest: 180 + i,
      expiresAt: 160 + i, foodBatches: [{ amount: i + .5, expiresAt: 160 + i }] });
    const courier = { ...state.units[0], id: 500, kind: 'worker' as const, home: 1, collector: true, collectorCamp: farms[0].id,
      inside: false, collectPhase: 'outbound' as const, field: fields[0].id, cargoField: fields[0].id,
      cargo: 2, cargoBatches: [{ amount: 2, expiresAt: 150 }], cargoExpiresAt: 150,
      destination: { x: 12.5, y: 8.5 }, path: [{ x: 12.5, y: 8.5 }] };
    fields[0].claimedBy = courier.id; entityStore(state).units.add(courier);
    const before = JSON.stringify(state), gold = state.factions[0].gold;
    expect(validateBuildAt(state, 'library', origin.x, origin.y)).toEqual({ ok: true, message: '' });
    expect(planConstruction(state, 'library', [origin])).toMatchObject({ ok: true, cost: 200, skipped: 0 });
    expect(JSON.stringify(state)).toBe(before);
    expect(buildStroke(state, 'library', [origin])).toMatchObject({ ok: true, placed: 1, skipped: 0 });
    const library = state.buildings.find(building => building.kind === 'library')!;
    expect(library).toMatchObject({ ...origin, construction: { paidGold: 200, duration: 90, waitingForBuilder: true } });
    expect(state.factions[0].gold).toBe(gold - 200);
    expect(state.buildings).toEqual(expect.arrayContaining(farms)); expect(state.fields).toEqual(fields);
    expect(new Set(farms.map(farm => `${farm.x},${farm.y}`)).size).toBe(4);
    // Established plots reforming one wheat block share its latest crop clock;
    // harvested grain and its original spoilage deadline remain per cell.
    for (let i = 0; i < fields.length; i++) expect(fields[i]).toMatchObject({ food: i + .5, nextHarvest: 183, expiresAt: 160 + i,
      foodBatches: [{ amount: i + .5, expiresAt: 160 + i }] });
    expect(courier).toMatchObject({ collectorCamp: farms[0].id, field: fields[0].id, cargoField: fields[0].id,
      cargo: 2, cargoBatches: [{ amount: 2, expiresAt: 150 }] });
    expect(courier.path).toBeUndefined(); expect(courier.destination).toBeUndefined();
    assertNoCropOverlap(state, library);
  });

  it('finishes the library with a real builder after freeing its complete footprint', () => {
    const state = fixture();
    expect(buildAt(state, 'library', origin.x, origin.y).ok).toBe(true);
    const library = state.buildings.find(building => building.kind === 'library')!;
    let seenBuilder = false;
    for (let step = 0; step < 1200 && library.construction; step++) {
      updateGame(state, .1, idle);
      seenBuilder ||= state.units.some(unit => unit.builder && unit.buildSite === library.id && unit.buildPhase === 'working');
    }
    expect(seenBuilder).toBe(true); expect(library.construction).toBeUndefined();
    expect(state.buildings.filter(building => building.kind === 'camp')).toHaveLength(4);
    assertNoCropOverlap(state, library);
  });

  it('fails without any mutation if only three replacement plots exist for four farms', () => {
    const state = fixture();
    for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++)
      if (!state.buildings.some(building => inside(building, x, y)) && !(y === 8 && x >= 7 && x <= 9))
        state.world.tiles[y * 32 + x].terrain = 'lake';
    state.world.tiles[8 * 32 + 10].terrain = 'grassland'; state.world.tiles[8 * 32 + 11].terrain = 'grassland';
    for (const x of [10, 11]) entityStore(state).buildings.add({ id: 20 + x, kind: 'road', faction: 0, x, y: 8, hp: 100, maxHp: 100, capacity: 0 });
    state.world.revision!++;
    const before = JSON.stringify(state);
    expect(buildAt(state, 'library', origin.x, origin.y)).toMatchObject({ ok: false, message: expect.stringContaining('Every displaced farm') });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('revalidates the entire quoted batch before moving even its first farm', () => {
    const state = fixture(), batch = planBuildingFarmRelocations(state, 'library', origin, 0)!;
    expect(batch.farms).toHaveLength(4);
    const last = batch.farms.at(-1)!;
    entityStore(state).buildings.add({ id: 999, kind: 'well', faction: 0, ...last.to, hp: 100, maxHp: 100, capacity: 0 });
    const before = JSON.stringify(state);
    expect(relocateBuildingFarms(state, batch)).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('reuses the live placement quote during repeated library hover previews', () => {
    const state = fixture(), distances = vi.spyOn(farmTravel, 'palaceWalkingDistances');
    try {
      expect(planConstruction(state, 'library', [origin]).ok).toBe(true);
      expect(distances.mock.calls.length).toBeGreaterThan(0);
      distances.mockClear();
      for (let frame = 0; frame < 20; frame++) expect(planConstruction(state, 'library', [origin]).ok).toBe(true);
      expect(distances).not.toHaveBeenCalled();
    } finally { distances.mockRestore(); }
  });

  it('does not move crops to a shore that the completed library would cut off', () => {
    const state = fixture();
    for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++)
      if (!state.buildings.some(building => inside(building, x, y))) state.world.tiles[y * 32 + x].terrain = 'lake';
    for (let y = 8; y <= 9; y++) for (let x = 7; x <= 18; x++) {
      state.world.tiles[y * 32 + x].terrain = 'grassland';
      if (x <= 11) entityStore(state).buildings.add({ id: 100 + y * 32 + x, kind: 'road', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
    }
    state.world.revision!++;
    expect(planBuildingFarmRelocations(state, 'library', origin, 0)).toBeUndefined();
    const before = JSON.stringify(state);
    expect(buildAt(state, 'library', origin.x, origin.y).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('preserves queued and active farm work while retargeting their builder', () => {
    const state = fixture(), queued = state.buildings[1], active = state.buildings[2]; state.time = 10;
    queueConstruction(queued, 0, 12.5, state);
    active.construction = { startedAt: 8, duration: 3.75, paidGold: 12.5, waitingForBuilder: false, cleared: true, builderId: 501 };
    const worker = { ...state.units[0], id: 501, kind: 'worker' as const, x: 14.5, y: 8.5, home: 1, builder: true,
      buildSite: active.id, buildPhase: 'working' as const, inside: false, moving: true,
      destination: { x: 14.5, y: 8.5 }, path: [{ x: 14.5, y: 8.5 }] };
    entityStore(state).units.add(worker); synchronizeFarms(state);
    const progress = constructionProgress(state, active);
    expect(buildAt(state, 'library', origin.x, origin.y).ok).toBe(true);
    expect(queued.construction).toMatchObject({ paidGold: 12.5, duration: 3.75, waitingForBuilder: true });
    expect(queued.construction!.pausedAt).toBeUndefined();
    expect(active.construction).toMatchObject({ startedAt: 8, pausedAt: 10, paidGold: 12.5, waitingForBuilder: true, cleared: false });
    expect(constructionProgress(state, active)).toBe(progress);
    expect(worker).toMatchObject({ x: 14.5, y: 8.5, buildSite: active.id, buildPhase: 'outbound', moving: false });
    expect(worker.path).toBeUndefined(); expect(worker.destination).toBeUndefined();
    expect(state.fields).toHaveLength(2);
  });

  it.each(['library', 'archeryRange', 'monument', 'blacksmith', 'woodenTower'] as BuildingKind[])(
    'also relocates non-anchor farm cells for a %s without granting housing bonuses', kind => {
      const state = fixture(); entityStore(state).buildings.retain(building => building.kind !== 'camp'
        || inside({ kind, ...origin }, building.x, building.y)); synchronizeFarms(state);
      expect(buildAt(state, kind, origin.x, origin.y)).toMatchObject({ ok: true });
      const built = state.buildings.find(building => building.kind === kind)!;
      expect(built.redevelopedFarm).toBeUndefined();
      expect(state.factions[0].gold).toBe(2000 - BUILD_COSTS[kind].gold);
      assertNoCropOverlap(state, built);
    });

  it.each(['foreign farm', 'well', 'water'] as const)('still rejects a %s on the far corner without moving friendly farms', obstruction => {
    const state = fixture(), corner = state.buildings.at(-1)!;
    if (obstruction === 'foreign farm') corner.faction = 1;
    if (obstruction === 'well') entityStore(state).setBuildingKind(corner, 'well');
    if (obstruction === 'water') state.world.tiles[corner.y * 32 + corner.x].terrain = 'lake';
    state.world.revision!++; synchronizeFarms(state);
    const before = JSON.stringify(state);
    expect(buildAt(state, 'library', origin.x, origin.y).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('keeps replaceable road cells until work begins and relocates only crops', () => {
    const state = fixture(), road = state.buildings[1]; entityStore(state).setBuildingKind(road, 'road'); synchronizeFarms(state);
    expect(buildAt(state, 'library', origin.x, origin.y).ok).toBe(true);
    expect(state.buildings).toContain(road); expect(state.fields).toHaveLength(3);
    assertNoCropOverlap(state, state.buildings.find(building => building.kind === 'library')!);
  });
});
