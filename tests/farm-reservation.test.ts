import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { createGame, getLeader, updateGame, validateBuildAt } from '../src/game/simulation';
import { CAMP_FIELD_OFFSETS, isPendingCampField, synchronizeFarms } from '../src/game/farms';
import { updateFog } from '../src/game/fog';
import { queueConstruction } from '../src/game/structures';
import { palaceReachability } from '../src/game/placement';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { canWalk } from '../src/game/pathfinding';
import { type World } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function buildingCamp() {
  const world: World = { width: 40, height: 30, seed: 'field-reservation', source: 'fixture', spawns: [{ x: 10, y: 10 }],
    tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .7, food: 2, production: 2, gold: 1, variation: .5 })) };
  const state = createGame(world);
  state.factions.forEach(unlockBuildingResearch);
  state.factions[0].culture = 10000; // Isolate field reservations inside established territory.
  entityStore(state).units.replace(state.units.filter(unit => unit.faction === 0)); state.marauderPacks = [];
  const camp = state.buildings.find(building => building.kind === 'camp')!;
  entityStore(state).buildings.retain(building => building.kind !== 'camp' || building.id === camp.id);
  queueConstruction(camp, state.time, 0, state);
  synchronizeFarms(state);
  // Exercise reservations and construction independently of automatic expansion.
  state.tick = 1000;
  state.fogRaids = { nextAt: 10000, waves: 0, pressureVersion: 1 };
  return { state, camp };
}

describe('future camp fields', () => {
  it('reserves one crop tile throughout construction without growing food early', () => {
    const { state, camp } = buildingCamp();
    expect(camp.construction).toBeDefined();
    for (const other of state.buildings.filter(other => other.kind === 'camp' && other.id !== camp.id))
      expect(Math.max(Math.abs(camp.x - other.x), Math.abs(camp.y - other.y))).toBeGreaterThanOrEqual(1);
    expect(state.fields!.filter(field => field.camp === camp.id)).toHaveLength(0);
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) {
      expect(isPendingCampField(state, camp.x + dx, camp.y + dy)).toBe(true);
      expect(canWalk(state, camp.x + dx + .5, camp.y + dy + .5, 0)).toBe(true);
    }
    expect(camp.construction!.waitingForBuilder).toBe(true);
    for (let i = 0; i < 100 && camp.construction!.waitingForBuilder; i++) updateGame(state, .1, idle);
    expect(camp.construction!.waitingForBuilder).toBe(false);
    expect(state.units.some(unit => unit.builder && unit.buildSite === camp.id && unit.buildPhase === 'working')).toBe(true);
    const remaining = camp.construction!.startedAt + camp.construction!.duration - state.time;
    updateGame(state, remaining - .1, idle);
    expect(state.fields!.filter(field => field.camp === camp.id)).toHaveLength(0);
    // Working peasants may yield to settlement traffic, pausing their clock.
    for (let i = 0; i < 150 && camp.construction; i++) {
      expect(state.fields!.filter(field => field.camp === camp.id)).toHaveLength(0);
      updateGame(state, .1, idle);
    }
    expect(camp.construction).toBeUndefined();
    expect(state.fields!.filter(field => field.camp === camp.id)).toHaveLength(1);
    expect(state.fields!.filter(field => field.camp === camp.id).every(field => field.planted && !field.food)).toBe(true);
  });

  it('rejects solid manual structures on future fields without reserving the whole neighborhood', () => {
    const { state, camp } = buildingCamp(), leader = getLeader(state)!;
    leader.x = camp.x + 2.5; leader.y = camp.y + 2.5; updateFog(state);
    for (const kind of ['tower', 'wall'] as const) for (const [dx, dy] of CAMP_FIELD_OFFSETS)
      expect(validateBuildAt(state, kind, camp.x + dx, camp.y + dy).ok).toBe(false);
    const nearby = [[3, 2], [-3, 2], [3, -2], [-3, -2]].map(([dx, dy]) => validateBuildAt(state, 'woodenTower', camp.x + dx, camp.y + dy));
    expect(nearby.some(result => result.ok)).toBe(true);
  });

  it('reserves the only possible automatic crop cell while a foreign farm is pending', () => {
    const { state } = buildingCamp();
    state.factions = [state.factions[0]]; state.villages = [];
    state.factions[0].population = 0;
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace', population: 40, food: 0 });
    entityStore(state).buildings.replace([
      { id: 8000, kind: 'palace', faction: 0, x: 5, y: 5, hp: 650, maxHp: 650, capacity: 0 },
      { id: 8001, kind: 'camp', faction: 0, x: 10, y: 10, hp: 100, maxHp: 100, capacity: 4, construction: { startedAt: 60, duration: 15 } },
      { id: 8002, kind: 'palace', faction: 1, x: 20, y: 10, hp: 650, maxHp: 650, capacity: 0, populationGrowth: -100 },
      { id: 8003, kind: 'camp', faction: 1, x: 25, y: 20, hp: 100, maxHp: 100, capacity: 4 },
    ]);
    state.fields = []; entityStore(state).units.replace([getLeader(state)!]);
    state.units[0].x = 8.5; state.units[0].y = 8.5;
    for (const tile of state.world.tiles) { tile.terrain = 'lake'; tile.overlay = 'none'; delete tile.farm; }
    // The reserved cell is the only possible farm. Road cells keep its narrow
    // connection walkable but cannot themselves hold crop fields.
    state.world.tiles[10 * 40 + 10].terrain = 'grassland';
    for (let y = 10; y <= 11; y++) for (let x = 20; x <= 21; x++) state.world.tiles[y * 40 + x].terrain = 'grassland';
    for (let x = 11; x <= 19; x++) {
      state.world.tiles[10 * 40 + x].terrain = 'grassland';
      entityStore(state).buildings.add({ id: 8100 + x, kind: 'road', faction: 1, x, y: 10, hp: 100, maxHp: 100, capacity: 0 });
    }
    state.world.revision = (state.world.revision ?? 0) + 1;
    const palace = state.buildings[2];
    expect(palaceReachability(state, palace)[10 * 40 + 10]).toBe(1);
    expect(isPendingCampField(state, 10, 10)).toBe(true);
    expect(planAutomaticFarmSite(state, palace)).toBeUndefined();
    entityStore(state).buildings.retain(building => building.id !== 8001);
    expect(planAutomaticFarmSite(state, palace)?.point).toEqual({ x: 10, y: 10 });
  });
});
