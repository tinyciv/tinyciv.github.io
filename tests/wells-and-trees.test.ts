import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import type { Building, GameState } from '../src/game/types';
import { buildAt, housingCapacity, migrateGame, moveUnit } from '../src/game/simulation';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { updateConstruction } from '../src/game/structures';
import { synchronizeFarms } from '../src/game/farms';
import { isExplored, isVisible, updateFog } from '../src/game/fog';
import { buildStroke, planConstruction } from '../src/game/construction';
import { tilesInRectangle } from '../src/game/area-tools';
import { updateWellUpgrades } from '../src/game/wells';
import { fellTree, TREE_CLEAR_SECONDS, TREE_STUMP_SECONDS, updateTreeStumps } from '../src/game/tree-clearing';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 24, height: 18, seed: 'wells-trees', source: 'test', spawns: [], tiles: Array.from({ length: 24 * 18 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    units: [{ id: 2, kind: 'leader', faction: 0, x: 10.5, y: 8.5, hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    buildings: [{ id: 1, kind: 'palace', x: 3, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 1000, production: 0, population: 5, culture: 100, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'wells-trees', rngState: 1, fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
  };
  updateFog(state); return state;
}
function house(state: GameState, id: number, x: number, y: number, faction = 0): Building {
  const building: Building = { id, kind: 'house', x, y, faction, hp: 130, maxHp: 160, capacity: 2 };
  entityStore(state).buildings.add(building); return building;
}
function advance(state: GameState, seconds: number): void {
  for (let remaining = seconds; remaining > 1e-6; remaining -= .1) {
    state.time += .1; updateConstruction(state); ensureBuilders(state);
    for (const unit of state.units) if (unit.builder && unit.hp > 0) updateBuilder(state, unit, .1, moveUnit);
  }
}

describe('wells', () => {
  it('requires 30 population, charges 50 gold, and upgrades nearby completed friendly homes only after construction', () => {
    const state = fixture();
    const near = house(state, 3, 10, 2), outside = house(state, 4, 19, 8), enemy = house(state, 5, 13, 11, 1);
    state.units[0].x = 9.5; state.units[0].y = 10.5; near.hp = near.maxHp;
    state.factions[0].population = 29; state.factions[0].gold = 50;
    expect(buildAt(state, 'well', 10, 8)).toMatchObject({ ok: false });
    expect(state.factions[0].gold).toBe(50); expect(state.buildings.some(building => building.kind === 'well')).toBe(false);
    state.factions[0].population = 30;
    state.factions[0].gold = 49; expect(buildAt(state, 'well', 10, 8).ok).toBe(false);
    state.factions[0].gold = 50; expect(buildAt(state, 'well', 10, 8).ok).toBe(true);
    expect(state.factions[0].gold).toBe(0);
    const well = state.buildings.find(building => building.kind === 'well')!;
    updateWellUpgrades(state); expect(near.houseLevel).toBe(1);
    state.factions[0].population = 29; // The unlock applies when ordering, not after construction.
    advance(state, 35); expect(well.construction).toBeUndefined();
    const unfinished = house(state, 1000, 12, 10); unfinished.construction = { startedAt: 0, duration: 1000, waitingForBuilder: true };
    updateWellUpgrades(state);
    expect(near).toMatchObject({ houseLevel: 2, houseStyle: 'hovel', hp: 200, maxHp: 200, capacity: 3 });
    expect(outside.houseLevel).toBe(1); expect(enemy.houseLevel).toBe(1); expect(unfinished.houseLevel).toBeUndefined();
    delete unfinished.construction; updateWellUpgrades(state); expect(unfinished.houseLevel).toBe(2);
    synchronizeFarms(state); expect(near.capacity).toBe(3); expect(housingCapacity(state)).toBe(8);
  });

  it('upgrades once to level two despite overlapping wells or repeated updates', () => {
    const state = fixture(), home = house(state, 3, 8, 8);
    for (let i = 0; i < 5; i++) entityStore(state).buildings.add({ id: i + 10, kind: 'well', x: 8 + i, y: 10, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    updateWellUpgrades(state); updateWellUpgrades(state);
    expect(home).toMatchObject({ houseLevel: 2, houseStyle: 'hovel', hp: 170, maxHp: 200, capacity: 3 });
  });

  it('includes the eight-tile boundary and measures diagonal distances radially', () => {
    const state = fixture();
    const offsets = [[8, 0], [-8, 0], [0, 8], [0, -8], [5, 6], [6, 6], [9, 0]];
    const homes = offsets.map(([x, y], index) => house(state, index + 3, 10 + x, 8 + y));
    entityStore(state).buildings.add({ id: 20, kind: 'well', x: 10, y: 8, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    updateWellUpgrades(state);
    expect(homes.map(home => home.houseLevel)).toEqual([2, 2, 2, 2, 2, 1, 1]);
  });

  it('keeps improvements after a well is destroyed and does not stack a replacement', () => {
    const state = fixture(), home = house(state, 3, 8, 8);
    const well: Building = { id: 10, kind: 'well', x: 8, y: 10, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(well); updateWellUpgrades(state);
    well.hp = 0; updateWellUpgrades(state);
    expect(home).toMatchObject({ houseLevel: 2, hp: 170, maxHp: 200, capacity: 3 });
    entityStore(state).buildings.add({ ...well, id: 11, hp: 100 }); updateWellUpgrades(state);
    expect(home).toMatchObject({ houseLevel: 2, hp: 170, maxHp: 200, capacity: 3 });
  });

  it('ignores unfinished, destroyed, and enemy wells', () => {
    const state = fixture(), home = house(state, 3, 8, 8);
    const well: Building = { id: 10, kind: 'well', x: 8, y: 10, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(
      { ...well, construction: { startedAt: 0, duration: 20 } },
      { ...well, id: 11, hp: 0 },
      { ...well, id: 12, faction: 1 },
    );
    updateWellUpgrades(state);
    expect(home).toMatchObject({ houseLevel: 1, hp: 130, maxHp: 160, capacity: 2 });
  });

  it('preserves existing higher housing levels and their health and capacity', () => {
    const state = fixture(), cottage = house(state, 3, 8, 8), villa = house(state, 4, 9, 8);
    Object.assign(cottage, { houseLevel: 3, houseStyle: 'cottage', hp: 210, maxHp: 240, capacity: 8 });
    Object.assign(villa, { houseLevel: 4, houseStyle: 'villa', hp: 250, maxHp: 280, capacity: 5 });
    entityStore(state).buildings.add({ id: 10, kind: 'well', x: 8, y: 10, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    updateWellUpgrades(state);
    expect(cottage).toMatchObject({ houseLevel: 3, houseStyle: 'cottage', hp: 210, maxHp: 240, capacity: 4 });
    expect(villa).toMatchObject({ houseLevel: 4, houseStyle: 'villa', hp: 250, maxHp: 280, capacity: 5 });
  });
});

describe('tree clearing peasants', () => {
  it.each([false, true])('queues and completes tree clearing through fog (previously explored: %s)', explored => {
    const state = fixture();
    for (let y = 0; y < 18; y++) for (let x = 12; x <= 18; x++) state.world.tiles[y * 24 + x].overlay = 'forest';
    delete state.fog;
    expect(isVisible(state, 18.5, 8.5)).toBe(false);
    state.fog!.explored[8 * 24 + 18] = Number(explored);
    expect(isExplored(state, 18.5, 8.5)).toBe(explored);
    const before = [...state.fog!.explored], points = [{ x: 18, y: 8 }];
    expect(planConstruction(state, 'clearTrees', points)).toMatchObject({ ok: true, skipped: 0, tiles: points });
    expect(buildStroke(state, 'clearTrees', points)).toMatchObject({ ok: true, placed: 1 });
    expect(state.fog!.explored).toEqual(before);
    expect(isVisible(state, 18.5, 8.5)).toBe(false);
    expect(state.treeClearings).toContainEqual({ x: 18, y: 8, faction: 0 });
    advance(state, 60);
    expect(state.world.tiles[8 * 24 + 18].overlay).toBe('none');
    expect(state.treeClearings).toHaveLength(0);
  });

  it('previews and queues a complete rectangular clearing through unexplored woodland', () => {
    const state = fixture();
    for (let y = 0; y < 18; y++) for (let x = 12; x <= 18; x++) state.world.tiles[y * 24 + x].overlay = 'forest';
    delete state.fog;
    const points = tilesInRectangle(state, { x: 17, y: 7 }, { x: 18, y: 8 });
    expect(points.every(point => !isVisible(state, point.x + .5, point.y + .5))).toBe(true);
    expect(points.every(point => !isExplored(state, point.x + .5, point.y + .5))).toBe(true);
    const before = [...state.fog!.explored];
    expect(planConstruction(state, 'clearTrees', points)).toMatchObject({ ok: true, tiles: points, skipped: 0 });
    expect(buildStroke(state, 'clearTrees', points)).toMatchObject({ ok: true, placed: 4, skipped: 0 });
    expect(state.fog!.explored).toEqual(before);
    // The single worker makes a palace round trip for each marked tree.
    for (let t = 0; t < 180 && state.treeClearings?.length; t += 5) advance(state, 5);
    expect(points.every(({ x, y }) => state.world.tiles[y * 24 + x].overlay === 'none')).toBe(true);
  });

  it('leaves matching walkable stumps for thirty simulation seconds and expires each independently', () => {
    const state = fixture();
    state.world.tiles[8 * 24 + 12].overlay = 'forest';
    state.world.tiles[8 * 24 + 13].overlay = 'jungle';
    fellTree(state, { x: 12, y: 8 });
    expect(state.treeStumps).toHaveLength(1);
    expect(state.treeStumps![0]).toMatchObject({ x: 12, y: 8, expiresAt: TREE_STUMP_SECONDS });
    expect(state.world.tiles[8 * 24 + 12].overlay).toBe('none');
    state.time = 5; fellTree(state, { x: 13, y: 8 });
    state.time = 29.9; updateTreeStumps(state); expect(state.treeStumps).toHaveLength(2);
    state.time = 30; updateTreeStumps(state); expect(state.treeStumps).toHaveLength(1);
    state.time = 35; updateTreeStumps(state); expect(state.treeStumps).toHaveLength(0);
  });
  it('walks from the palace, spends four seconds chopping, then returns home', () => {
    const state = fixture(), tile = state.world.tiles[8 * 24 + 12]; tile.overlay = 'forest';
    expect(buildAt(state, 'clearTrees', 12, 8).ok).toBe(true);
    expect(tile.overlay).toBe('forest'); expect(state.factions[0].gold).toBe(1000);
    const worker = state.units.find(unit => unit.builder)!; expect(worker.inside).toBe(true);
    advance(state, .1); expect(worker).toMatchObject({ inside: false, buildPhase: 'outbound', clearTree: { x: 12, y: 8 } });
    expect(tile.overlay).toBe('forest');
    for (let i = 0; i < 200 && worker.buildPhase !== 'clearing'; i++) advance(state, .1);
    expect(worker.buildPhase).toBe('clearing');
    advance(state, TREE_CLEAR_SECONDS - .2); expect(tile.overlay).toBe('forest');
    advance(state, .2); expect(tile.overlay).toBe('none'); expect(state.treeClearings).toHaveLength(0);
    advance(state, 10); expect(worker).toMatchObject({ inside: true, buildPhase: 'idle' });
  });

  it('queues each tree in a stroke, skips empty cells, and recovers assignments after a worker dies', () => {
    const state = fixture();
    for (const x of [10, 12]) state.world.tiles[8 * 24 + x].overlay = 'jungle';
    const result = buildStroke(state, 'clearTrees', [{ x: 10, y: 8 }, { x: 11, y: 8 }, { x: 12, y: 8 }]);
    expect(result).toMatchObject({ ok: true, placed: 2, skipped: 1 });
    advance(state, .1); const first = state.units.find(unit => unit.builder)!; first.hp = 0;
    ensureBuilders(state); expect(state.treeClearings?.every(order => order.workerId === undefined)).toBe(true);
    advance(state, 45);
    expect(state.world.tiles[8 * 24 + 10].overlay).toBe('none'); expect(state.world.tiles[8 * 24 + 12].overlay).toBe('none');
    expect(state.treeClearings).toHaveLength(0);
  });

  it('rejects trees that no palace peasant can reach', () => {
    const state = fixture(); state.world.tiles[8 * 24 + 12].overlay = 'forest';
    for (let y = 0; y < state.world.height; y++) state.world.tiles[y * 24 + 9].terrain = 'river';
    expect(buildAt(state, 'clearTrees', 12, 8)).toMatchObject({ ok: false, message: 'Tree needs a route from the settlement.' });
    expect(state.treeClearings ?? []).toHaveLength(0);
  });

  it('resumes an assigned tree and its chopping progress after reloading a save', () => {
    const state = fixture(); state.buildMode = 'clearTrees';
    state.world.tiles[8 * 24 + 12].overlay = 'forest';
    expect(buildAt(state, 'clearTrees', 12, 8).ok).toBe(true);
    const worker = state.units.find(unit => unit.builder)!;
    for (let i = 0; i < 200 && worker.buildPhase !== 'clearing'; i++) advance(state, .1);
    advance(state, 1.5);
    const progress = worker.clearProgress!, location = { x: worker.x, y: worker.y };
    expect(progress).toBeGreaterThan(1); expect(progress).toBeLessThan(TREE_CLEAR_SECONDS);
    const restored = migrateGame(JSON.parse(JSON.stringify(state)));
    const loaded = restored.units.find(unit => unit.id === worker.id)!;
    expect(restored.buildMode).toBe('clearTrees');
    expect(loaded).toMatchObject({ ...location, buildPhase: 'clearing', clearProgress: progress, clearTree: { x: 12, y: 8 } });
    expect(restored.treeClearings).toEqual([{ x: 12, y: 8, faction: 0, workerId: worker.id }]);
    advance(restored, TREE_CLEAR_SECONDS - progress - .1);
    expect(restored.world.tiles[8 * 24 + 12].overlay).toBe('forest');
    advance(restored, .1);
    expect(restored.world.tiles[8 * 24 + 12].overlay).toBe('none');
    expect(restored.treeClearings).toHaveLength(0);
    advance(restored, 10); expect(loaded).toMatchObject({ inside: true, buildPhase: 'idle' });
  });
});
