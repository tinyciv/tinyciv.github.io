import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it, vi } from 'vitest';
import { buildAt, createGame, moveUnit } from '../src/game/simulation';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { updateConstruction } from '../src/game/structures';
import { CAMP_FIELD_OFFSETS, synchronizeFarms } from '../src/game/farms';
import { updateFog } from '../src/game/fog';
import { movementMultiplier } from '../src/game/pathfinding';
import { sightDistance } from '../src/game/sight';
import { recordTraffic, ROAD_TRAFFIC_THRESHOLD } from '../src/game/traffic';
import { hasTree, TREE_CLEAR_SECONDS } from '../src/game/tree-clearing';
import { tileAt, type GameState } from '../src/game/types';

vi.mock('../src/game/puny-world', async importOriginal => ({
  ...await importOriginal<typeof import('../src/game/puny-world')>(), drawPuny: vi.fn(() => true),
}));
import { drawPuny } from '../src/game/puny-world';
import { drawPalm } from '../src/game/palm-art';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 24, height: 18, seed: 'coastal-palms', source: 'test', spawns: [],
      tiles: Array.from({ length: 24 * 18 }, () => ({ terrain: 'desert', overlay: 'none', beach: true,
        elevation: .3, moisture: .5, food: 0, production: 1, gold: 1, variation: .2 })) },
    units: [{ id: 2, kind: 'leader', faction: 0, x: 10.5, y: 8.5, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    buildings: [{ id: 1, kind: 'palace', x: 3, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 1000,
      production: 0, population: 5, culture: 10000, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'coastal-palms', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
  };
  unlockBuildingResearch(state.factions[0]);
  updateFog(state);
  return state;
}

function advance(state: GameState, seconds: number): void {
  for (let remaining = seconds; remaining > 1e-6; remaining -= .1) {
    state.time += .1; updateConstruction(state); ensureBuilders(state);
    for (const unit of state.units) if (unit.builder && unit.hp > 0) updateBuilder(state, unit, .1, moveUnit);
  }
}

describe('native coastal palms', () => {
  it('draws the unmodified single-trunk Puny palm at the map tile scale', () => {
    const c = { save: vi.fn(), restore: vi.fn(), imageSmoothingEnabled: true } as unknown as CanvasRenderingContext2D;
    drawPalm(c, 64, 96, 32);
    expect(drawPuny).toHaveBeenLastCalledWith(c, 48, 448, 16, 16, 64, 96, 32, 32);
    expect(c.imageSmoothingEnabled).toBe(false);
    expect(c.save).toHaveBeenCalledOnce(); expect(c.restore).toHaveBeenCalledOnce();
  });

  it('leaves scattered palms walkable at open-ground speed and sight range', () => {
    const state = fixture();
    for (const x of [11, 13, 15]) tileAt(state.world, x, 8)!.palm = true;
    expect(movementMultiplier(state, 13.5, 8.5)).toBe(1);
    expect(sightDistance(state.world, state.units[0], 17.5, 8.5)).toBeCloseTo(7);
    expect(hasTree(state, { x: 13, y: 8 })).toBe(true);
  });

  it('clears a palm through the existing four-second peasant chopping order without changing sand yields', () => {
    const state = fixture(), tile = tileAt(state.world, 12, 8)!;
    tile.palm = true; tile.food = 1; // Preserve a separate fertility bonus.
    expect(buildAt(state, 'clearTrees', 12, 8).ok).toBe(true);
    const worker = state.units.find(unit => unit.builder)!;
    for (let i = 0; i < 200 && worker.buildPhase !== 'clearing'; i++) advance(state, .1);
    expect(worker.buildPhase).toBe('clearing');
    advance(state, TREE_CLEAR_SECONDS - .2); expect(tile.palm).toBe(true);
    advance(state, .2);
    expect(tile.palm).toBeUndefined(); expect(hasTree(state, { x: 12, y: 8 })).toBe(false);
    expect(tile).toMatchObject({ terrain: 'desert', beach: true, overlay: 'none', food: 1, production: 1, gold: 1 });
    expect(state.treeClearings).toHaveLength(0);
  });

  it('clears palms immediately from ordered structures and roads while retaining neighboring palms', () => {
    const state = fixture();
    for (const x of [10, 12, 14]) tileAt(state.world, x, 8)!.palm = true;
    entityStore(state).buildings.add({ id: 3, kind: 'road', x: 9, y: 8, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    expect(buildAt(state, 'road', 10, 8).ok).toBe(true);
    expect(buildAt(state, 'woodenTower', 12, 8).ok).toBe(true);
    expect(tileAt(state.world, 10, 8)!.palm).toBeUndefined();
    expect(tileAt(state.world, 12, 8)!.palm).toBeUndefined();
    expect(tileAt(state.world, 14, 8)!.palm).toBe(true);
    expect(state.buildings.filter(b => b.construction)).toHaveLength(2);
  });

  it('clears the complete four-tile farm when ordered, leaving neighboring palms untouched', () => {
    const state = fixture();
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) tileAt(state.world, 12 + dx, 8 + dy)!.palm = true;
    tileAt(state.world, 14, 8)!.palm = true;
    expect(buildAt(state, 'camp', 12, 8).ok).toBe(true);
    expect(state.buildings.find(b => b.kind === 'camp')!.construction!.waitingForBuilder).toBe(true);
    for (const [dx, dy] of CAMP_FIELD_OFFSETS) expect(tileAt(state.world, 12 + dx, 8 + dy)!.palm).toBeUndefined();
    expect(tileAt(state.world, 14, 8)!.palm).toBe(true);
    expect(state.fields).toHaveLength(0);
  });

  it('clears palms from all planted farm tiles even when the field ownership is already synchronized', () => {
    const state = fixture();
    entityStore(state).buildings.add({ id: 3, kind: 'camp', x: 12, y: 8, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    synchronizeFarms(state);
    for (const field of state.fields!) tileAt(state.world, field.x, field.y)!.palm = true;
    synchronizeFarms(state);
    expect(state.fields).toHaveLength(1);
    for (const field of state.fields!) expect(tileAt(state.world, field.x, field.y)!.palm).toBeUndefined();
  });

  it('removes palms when repeated militia traffic forms a road', () => {
    const state = fixture(), leader = state.units[0], tile = tileAt(state.world, 10, 8)!;
    leader.kind = 'militia';
    tile.palm = true;
    entityStore(state).buildings.add({ id: 3, kind: 'road', x: 9, y: 8, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD - 1; i++) expect(recordTraffic(state, leader, { x: 9.5, y: 8.5 })).toBe(false);
    expect(recordTraffic(state, leader, { x: 9.5, y: 8.5 })).toBe(true);
    expect(tile.palm).toBeUndefined();
    expect(state.buildings.some(b => b.kind === 'road' && b.x === 10 && b.y === 8)).toBe(true);
  });

  it('keeps every starting building and farm footprint clear on a palm-covered map', () => {
    const world = fixture().world;
    world.spawns = [{ x: 7, y: 7 }];
    for (const tile of world.tiles) tile.palm = true;
    const state = createGame(world);
    for (const building of state.buildings) {
      const size = building.kind === 'palace' ? 2 : 1;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++)
        expect(tileAt(state.world, building.x + dx, building.y + dy)!.palm).toBeUndefined();
    }
    for (const field of state.fields!) expect(tileAt(state.world, field.x, field.y)!.palm).toBeUndefined();
    expect(world.tiles.some(tile => tile.palm)).toBe(true);
  });
});
