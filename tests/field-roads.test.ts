import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildAt, BUILD_COSTS, cancelConstruction, validateBuildAt } from '../src/game/simulation';
import { buildStroke, planConstruction } from '../src/game/construction';
import { synchronizeFarms } from '../src/game/farms';
import { canWalk } from '../src/game/pathfinding';
import { queueConstruction, CONSTRUCTION_SECONDS } from '../src/game/structures';
import { addPalaceRoadRing } from '../src/game/palace-roads';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { type Building, type GameState, buildingWidth, buildingHeight } from '../src/game/types';

function fixture(): GameState {
  const palace: Building = { id: 1, kind: 'palace', faction: 0, x: 5, y: 8, hp: 650, maxHp: 650, capacity: 0,
    governorPermissions: { farms: false, housing: false } };
  const farm: Building = { id: 3, kind: 'camp', faction: 0, x: 12, y: 8, hp: 100, maxHp: 100, capacity: 0 };
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'field-roads', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5,
        food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [palace, farm, { id: 4, kind: 'road', faction: 0, x: 11, y: 8, hp: 100, maxHp: 100, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 11.5, y: 11.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 4, culture: 10000, yields: { food: 0, production: 0, gold: 0 },
      nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'field-roads', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
  synchronizeFarms(state);
  return state;
}


function noOverlap(state: GameState): void {
  const roads = state.buildings.filter(building => building.hp > 0 && building.kind === 'road');
  for (const farm of state.buildings.filter(building => building.hp > 0 && building.kind === 'camp'))
    expect(roads.some(road => road.x === farm.x && road.y === farm.y)).toBe(false);
  for (const field of state.fields ?? []) expect(roads.some(road => road.x === field.x && road.y === field.y)).toBe(false);
}

describe('single crop tiles and displaced roads', () => {
  it('charges a rounded fifteen-gold farm price and one quarter of the former build time for a single reserved tile', () => {
    const state = fixture(), gold = state.factions[0].gold;
    expect(buildAt(state, 'camp', 13, 8).ok).toBe(true);
    const farm = state.buildings.at(-1)!;
    expect([buildingWidth(farm), buildingHeight(farm)]).toEqual([1, 1]);
    expect(BUILD_COSTS.camp.gold).toBe(15); expect(CONSTRUCTION_SECONDS.camp).toBe(3.75);
    expect(farm.construction).toMatchObject({ duration: 3.75, paidGold: 15 });
    expect(state.factions[0].gold).toBe(gold - 15);
    expect(cancelConstruction(state, farm.id)).toMatchObject({ ok: true, refund: 15 });
    expect(state.factions[0].gold).toBe(gold);
  });

  it('moves farms out of the entire road stroke for free while preserving crop bags and deadlines', () => {
    const state = fixture(), farm = state.buildings[1], field = state.fields![0];
    field.food = 1.2; field.expiresAt = 120; field.foodBatches = [{ amount: 1.2, expiresAt: 120 }]; field.nextHarvest = 99;
    const points = [{ x: 12, y: 8 }, { x: 13, y: 8 }, { x: 14, y: 8 }], before = JSON.stringify(state);
    expect(planConstruction(state, 'road', points)).toMatchObject({ ok: true, skipped: 0, cost: 30 });
    expect(JSON.stringify(state)).toBe(before);
    expect(buildStroke(state, 'road', points)).toMatchObject({ ok: true, placed: 3, skipped: 0 });
    expect(state.factions[0].gold).toBe(470); expect(state.buildings).toContain(farm);
    expect(state.fields).toEqual([field]); expect(field).toMatchObject({ food: 1.2, expiresAt: 120, nextHarvest: 99 });
    expect(points.some(point => point.x === farm.x && point.y === farm.y)).toBe(false);
    noOverlap(state); expect(canWalk(state, field.x + .5, field.y + .5, 0)).toBe(true);
  });

  it('rejects a road atomically when the farm has no replacement plot', () => {
    const state = fixture();
    for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++)
      if (!state.buildings.some(b => x >= b.x && x < b.x + buildingWidth(b) && y >= b.y && y < b.y + buildingHeight(b)))
        state.world.tiles[y * 32 + x].terrain = 'lake';
    state.world.revision!++;
    const before = JSON.stringify(state);
    expect(buildAt(state, 'road', 12, 8)).toMatchObject({ ok: false });
    expect(JSON.stringify(state)).toBe(before); noOverlap(state);
  });

  it('blocks new farms on completed or pending roads in manual and automatic placement', () => {
    for (const pending of [false, true]) {
      const state = fixture(), road = state.buildings[2];
      if (pending) queueConstruction(road, 0, 10, state);
      expect(validateBuildAt(state, 'camp', road.x, road.y).ok).toBe(false);
      const site = planAutomaticFarmSite(state, state.buildings[0]);
      expect(site?.point).not.toEqual({ x: road.x, y: road.y }); noOverlap(state);
    }
  });

  it('moves a queued farm order without charging it again or starting crops early', () => {
    const state = fixture(), farm = state.buildings[1]; queueConstruction(farm, 0, 15, state); synchronizeFarms(state);
    const old = { x: farm.x, y: farm.y }, gold = state.factions[0].gold;
    expect(buildAt(state, 'road', old.x, old.y).ok).toBe(true);
    expect(farm).not.toMatchObject(old); expect(farm.construction).toMatchObject({ paidGold: 15, duration: 3.75, waitingForBuilder: true });
    expect(farm.construction!.pausedAt).toBeUndefined(); expect(state.fields).toHaveLength(0);
    expect(state.factions[0].gold).toBe(gold - 10); noOverlap(state);
  });

  it('preserves unfinished work and makes its builder walk to the relocated plot', () => {
    const state = fixture(), farm = state.buildings[1]; state.time = 10;
    farm.construction = { startedAt: 8, duration: 3.75, paidGold: 15, waitingForBuilder: false, cleared: true, builderId: 99 };
    const worker = { ...state.units[0], id: 99, kind: 'worker' as const, x: 11.5, y: 8.5, home: 1,
      builder: true, buildSite: farm.id, buildPhase: 'working' as const, inside: false,
      destination: { x: 11.5, y: 8.5 }, path: [{ x: 11.5, y: 8.5 }], moving: true };
    entityStore(state).units.add(worker); synchronizeFarms(state);
    expect(buildAt(state, 'road', 12, 8).ok).toBe(true);
    expect(farm.construction).toMatchObject({ startedAt: 8, duration: 3.75, paidGold: 15, pausedAt: 10, waitingForBuilder: true, cleared: false });
    expect(worker).toMatchObject({ x: 11.5, y: 8.5, buildSite: farm.id, buildPhase: 'outbound', moving: false });
    expect(worker.path).toBeUndefined(); expect(worker.destination).toBeUndefined(); noOverlap(state);
  });

  it('keeps road-network rules and foreign ownership restrictions', () => {
    const state = fixture();
    expect(validateBuildAt(state, 'road', 13, 9).message).toContain('Extend');
    state.buildings[1].faction = 1;
    expect(validateBuildAt(state, 'road', 12, 8)).toMatchObject({ ok: false, message: 'Tile occupied.' });
  });

  it('moves perimeter farms off all twelve future settlement-ring cells', () => {
    const state = fixture(), farm = state.buildings[1], palace = state.buildings[0];
    farm.x = palace.x - 1; farm.y = palace.y; synchronizeFarms(state);
    expect(addPalaceRoadRing(state, palace)).toBe(12);
    expect(state.buildings).toContain(farm); expect(state.fields).toHaveLength(1); noOverlap(state);
    expect(Math.max(palace.x - farm.x, farm.x - (palace.x + 1), palace.y - farm.y, farm.y - (palace.y + 1))).toBeGreaterThan(1);
  });
});
