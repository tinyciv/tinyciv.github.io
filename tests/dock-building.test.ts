import { describe, expect, it } from 'vitest';
import { dockPlacement, dockBerth, dockBerthOccupiedByFootprint, dockFootprint, DOCK_BUILD_SECONDS, DOCK_COST, DOCK_DIRECTIONS, dockMoorings } from '../src/game/dock';
import { buildAt, validateBuildAt, BUILD_COSTS } from '../src/game/simulation';
import { buildingResearchRequirement, isBuildingUnlocked, RESEARCH_BRANCHES } from '../src/game/research';
import { CONSTRUCTION_SECONDS } from '../src/game/structures';
import { entityStore } from '../src/game/entity-store';
import { type Building, type GameState } from '../src/game/types';
import { recordNativeFrame } from './helpers/native-renderer';
import { buildingAtPoint } from '../src/game/hit-testing';

const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({ id, kind, x, y, faction: 0, hp: 250, maxHp: 250, capacity: 0 });
function fixture(): GameState {
  return { world: { width: 18, height: 14, seed: 'dock', source: 'test', spawns: [], revision: 1,
    tiles: Array.from({ length: 18 * 14 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 4, 3)],
    units: [{ id: 100, kind: 'leader', x: 6.5, y: 6.5, faction: 0, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 0, speed: 3,
      range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#08f', affinity: 100, relation: 'self', food: 500, gold: 1000, production: 0, population: 20,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false,
      research: { focus: 'sailing', levels: { scoutLodge: 1, sailing: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'dock', rngState: 1 };
}
function water(state: GameState, x: number, y: number) { state.world.tiles[y * state.world.width + x].terrain = 'coast'; state.world.revision!++; }
function coast(state: GameState, facing = 2) {
  const d = DOCK_DIRECTIONS[facing];
  water(state, 8 + d.x, 6 + d.y); water(state, 8 + d.x - d.y, 6 + d.y + d.x);
}

describe('coastal dock placement', () => {
  it.each([0, 1, 2, 3] as const)('faces its reserved water tile in direction %i while retaining a dry house tile', facing => {
    const state = fixture(), direction = DOCK_DIRECTIONS[facing];
    coast(state, facing);
    expect(dockPlacement(state, 8, 6)).toEqual({ facing, berth: { x: 8.5 + direction.x, y: 6.5 + direction.y } });
    expect(validateBuildAt(state, 'dock', 8, 6).ok).toBe(true);
    expect(buildAt(state, 'dock', 8, 6).ok).toBe(true);
    const dock = state.buildings.find(b => b.kind === 'dock')!;
    expect(dock.dockFacing).toBe(facing);
    const footprint = dockFootprint(dock);
    expect(footprint.width * footprint.height).toBe(2);
    expect(footprint).toMatchObject({ width: 1 + Math.abs(direction.x), height: 1 + Math.abs(direction.y) });
    expect(dockBerth(dock)).toEqual({ x: 8.5 + direction.x, y: 6.5 + direction.y });
    expect(state.factions[0].gold).toBe(1000 - DOCK_COST);
    expect(dock.construction?.duration).toBe(DOCK_BUILD_SECONDS);
    expect(dock.dockBoatLaunched).not.toBe(true);
    expect(dockMoorings(state, dock).length).toBeGreaterThan(0);
    expect(dockMoorings(state, dock)).not.toContainEqual(dockBerth(dock));
  });

  it.each([0, 1, 2, 3] as const)('rotates the live preview and reserves/selects both construction cells facing %i', facing => {
    const state = fixture(), direction = DOCK_DIRECTIONS[facing]; coast(state, facing); state.buildMode = 'dock';
    const frame = recordNativeFrame(state, { buildPreview: [{ x: 8, y: 6 }] });
    const waterPreview = frame.rects.filter(rect => rect.color === '#7fcce9' && rect.width === 32 && rect.height === 32);
    expect(waterPreview).toHaveLength(1);
    expect(waterPreview[0]).toMatchObject({ x: (8 + direction.x) * 32, y: (6 + direction.y) * 32, width: 32, height: 32 });
    expect(buildAt(state, 'dock', 8, 6).ok).toBe(true);
    const dock = state.buildings.find(building => building.kind === 'dock')!;
    expect(buildingAtPoint(state, dockBerth(dock))?.id).toBe(dock.id);
    expect(validateBuildAt(state, 'bridge', 8 + direction.x, 6 + direction.y)).toMatchObject({ ok: false, message: 'Leave the dock jetty clear.' });
  });

  it('requires Sailing after Exploration and uses normal construction funding', () => {
    const state = fixture(); coast(state);
    state.factions[0].research!.levels.sailing = 0;
    expect(buildingResearchRequirement('dock')).toBe('sailing');
    expect(isBuildingUnlocked(state.factions[0], 'dock')).toBe(false);
    expect(validateBuildAt(state, 'dock', 8, 6)).toMatchObject({ ok: false, message: expect.stringContaining('Sailing') });
    expect(RESEARCH_BRANCHES.find(branch => branch.id === 'sailing')).toMatchObject({ prerequisites: ['scoutLodge'] });
    expect(BUILD_COSTS.dock.gold).toBe(DOCK_COST);
    expect(CONSTRUCTION_SECONDS.dock).toBe(30);
  });

  it('rejects inland, water-only and isolated shore cells without a dry approach', () => {
    const state = fixture();
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
    expect(validateBuildAt(state, 'dock', 8, 6).ok).toBe(false);
    water(state, 8, 6);
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
    state.world.tiles[6 * state.world.width + 8].terrain = 'grassland';
    for (const direction of DOCK_DIRECTIONS) water(state, 8 + direction.x, 6 + direction.y);
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
  });

  it('rejects a bridge, another dock or a unit occupying the reserved berth', () => {
    const state = fixture(); coast(state);
    const bridge = building(2, 'bridge', 8, 7); entityStore(state).buildings.add(bridge);
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
    bridge.hp = 0;
    const otherDock = { ...building(3, 'dock', 8, 8), dockFacing: 0 as const };
    entityStore(state).buildings.add(otherDock);
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
    expect(dockBerthOccupiedByFootprint(state, 7, 7, 2, 1)).toBe(true);
    expect(dockBerthOccupiedByFootprint(state, 7, 6, 1, 1)).toBe(false);
    otherDock.hp = 0;
    state.units[0].x = 8.5; state.units[0].y = 7.5;
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
  });

  it('needs open water beside the jetty and an accessible boarding bank', () => {
    const state = fixture(); water(state, 8, 7);
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
    water(state, 7, 7);
    expect(dockPlacement(state, 8, 6)?.facing).toBe(2);
  });

  it('keeps ford crossings and cliff shores clear', () => {
    const state = fixture(); coast(state);
    state.world.tiles[7 * state.world.width + 8].terrain = 'river';
    state.world.tiles[7 * state.world.width + 8].overlay = 'ford';
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
    state.world.tiles[7 * state.world.width + 8].overlay = 'none';
    state.world.tiles[6 * state.world.width + 8].ridge = 1;
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
  });

  it('does not reserve a waterfall as a berth or launch beside one into its face', () => {
    const state = fixture(); coast(state);
    expect(dockPlacement(state, 8, 6)?.facing).toBe(2);
    const berth = state.world.tiles[7 * state.world.width + 8];
    berth.waterfall = 'south';
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
    expect(dockMoorings(state, { x: 8, y: 6, dockFacing: 2, faction: 0 })).toEqual([]);
    delete berth.waterfall;
    state.world.tiles[7 * state.world.width + 7].waterfall = 'south';
    expect(dockPlacement(state, 8, 6)).toBeUndefined();
    expect(dockMoorings(state, { x: 8, y: 6, dockFacing: 2, faction: 0 })).toEqual([]);
  });
});
