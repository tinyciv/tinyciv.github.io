import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildAt, BUILD_COSTS, cancelConstruction, moveUnit, validateBuildAt } from '../src/game/simulation';
import { canPlaceHouseAt, planHouseSite } from '../src/game/housing';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { canWalk } from '../src/game/pathfinding';
import { updateConstruction } from '../src/game/structures';
import { updateFog } from '../src/game/fog';
import { updateWellUpgrades } from '../src/game/wells';
import type { Building, GameState } from '../src/game/types';

const target = { x: 12, y: 8 };
function fixture(): GameState {
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'house-well-sharing', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 14.5, y: 12.5, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 1000, production: 0,
      population: 30, culture: 10000, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'house-well-sharing', rngState: 1,
  };
  updateFog(state); return state;
}
function add(state: GameState, kind: Building['kind'], changes: Partial<Building> = {}): Building {
  const building: Building = { id: Math.max(...state.buildings.map(b => b.id), ...state.units.map(u => u.id)) + 1,
    kind, faction: 0, ...target, hp: 160, maxHp: 160, capacity: kind === 'house' ? 4 : 0, ...changes };
  entityStore(state).buildings.add(building); return building;
}
function advanceUntilComplete(state: GameState, buildings: Building[]): void {
  for (let step = 0; step < 900 && buildings.some(b => b.construction); step++) {
    state.time += .1; updateConstruction(state); ensureBuilders(state);
    for (const unit of state.units) if (unit.builder && unit.hp > 0) updateBuilder(state, unit, .1, moveUnit);
  }
  expect(buildings.every(b => !b.construction)).toBe(true);
}

describe('houses and wells sharing a tile', () => {
  it.each(['house', 'well'] as const)('orders %s first and independently completes both buildings on one tile', first => {
    const state = fixture(), second = first === 'house' ? 'well' : 'house', before = state.factions[0].gold;
    expect(buildAt(state, first, target.x, target.y).ok).toBe(true);
    const one = state.buildings.at(-1)!;
    expect(one.construction?.waitingForBuilder).toBe(true);
    expect(buildAt(state, second, target.x, target.y)).toEqual(expect.objectContaining({ ok: true }));
    const two = state.buildings.at(-1)!;
    expect(two.id).not.toBe(one.id);
    expect(state.factions[0].gold).toBe(before - BUILD_COSTS.house.gold - BUILD_COSTS.well.gold);
    expect([one, two].map(b => b.construction?.paidGold)).toEqual([BUILD_COSTS[first].gold, BUILD_COSTS[second].gold]);
    advanceUntilComplete(state, [one, two]);
    expect(canWalk(state, target.x + .5, target.y + .5, 0)).toBe(false);
    const house = first === 'house' ? one : two;
    updateWellUpgrades(state); updateWellUpgrades(state);
    expect(house).toMatchObject({ houseLevel: 2, capacity: 3, maxHp: 200 });
  });

  it.each(['house', 'well'] as const)('adds the second building to an already completed %s', first => {
    const state = fixture(), existing = add(state, first), second = first === 'house' ? 'well' : 'house';
    const before = { hp: existing.hp, maxHp: existing.maxHp, capacity: existing.capacity };
    expect(buildAt(state, second, target.x, target.y).ok).toBe(true);
    const ordered = state.buildings.at(-1)!;
    expect(existing).toMatchObject(before);
    expect(existing.construction).toBeUndefined();
    advanceUntilComplete(state, [ordered]);
    expect(state.buildings).toContain(existing);
    expect(state.buildings).toContain(ordered);
    expect(existing).toMatchObject(before);
  });

  it.each(['house', 'well'] as const)('canceling a %s order leaves its completed partner and collision intact', orderedKind => {
    const state = fixture(), existing = add(state, orderedKind === 'house' ? 'well' : 'house'), gold = state.factions[0].gold;
    expect(buildAt(state, orderedKind, target.x, target.y).ok).toBe(true);
    const ordered = state.buildings.at(-1)!;
    expect(cancelConstruction(state, ordered.id)).toEqual({ ok: true, refund: BUILD_COSTS[orderedKind].gold });
    expect(state.buildings).toContain(existing);
    expect(state.buildings).not.toContain(ordered);
    expect(existing.hp).toBe(160);
    expect(state.factions[0].gold).toBe(gold);
    expect(canWalk(state, target.x + .5, target.y + .5, 0)).toBe(false);
  });

  it('keeps housing upgrades when the shared well dies, and permits replacing just the well', () => {
    const state = fixture(), house = add(state, 'house'), well = add(state, 'well');
    updateWellUpgrades(state); well.hp = 0;
    expect(house).toMatchObject({ houseLevel: 2, capacity: 3, hp: 200 });
    expect(canWalk(state, target.x + .5, target.y + .5, 0)).toBe(false);
    expect(buildAt(state, 'well', target.x, target.y).ok).toBe(true);
    expect(state.buildings.filter(b => b.kind === 'well' && b.hp > 0)).toHaveLength(1);
    updateWellUpgrades(state);
    expect(house).toMatchObject({ houseLevel: 2, capacity: 3, hp: 200 });
  });

  it('can rebuild a destroyed house while its shared well survives', () => {
    const state = fixture(), house = add(state, 'house'), well = add(state, 'well');
    house.hp = 0;
    expect(buildAt(state, 'house', target.x, target.y).ok).toBe(true);
    expect(well.hp).toBe(160);
    expect(state.buildings.filter(b => b.kind === 'house' && b.hp > 0)).toHaveLength(1);
  });

  it.each(['house', 'well'] as const)('rejects another %s once both layers are reserved', kind => {
    const state = fixture(); add(state, 'house'); add(state, 'well', { construction: { startedAt: 0, duration: 20, waitingForBuilder: true } });
    const count = state.buildings.length, gold = state.factions[0].gold;
    expect(buildAt(state, kind, target.x, target.y)).toEqual({ ok: false, message: 'Tile occupied.' });
    expect(state.buildings).toHaveLength(count); expect(state.factions[0].gold).toBe(gold);
  });

  it.each(['house', 'well'] as const)('rejects sharing an enemy %s', existingKind => {
    const state = fixture(); add(state, existingKind, { faction: 1 });
    expect(validateBuildAt(state, existingKind === 'house' ? 'well' : 'house', target.x, target.y)).toEqual({ ok: false, message: 'Tile occupied.' });
  });

  it.each(['house', 'well'] as const)('keeps other structures occupied when adding %s', kind => {
    const state = fixture(); add(state, 'woodenTower');
    expect(validateBuildAt(state, kind, target.x, target.y)).toEqual({ ok: false, message: 'Tile occupied.' });
  });

  it('still enforces well population and cost when the house already exists', () => {
    const state = fixture(); add(state, 'house'); state.factions[0].population = 29;
    expect(validateBuildAt(state, 'well', target.x, target.y).message).toBe('Wells require 30 population.');
    state.factions[0].population = 30; state.factions[0].gold = 49;
    expect(validateBuildAt(state, 'well', target.x, target.y).message).toBe('Need 50 gold.');
  });

  it('adds a well inside a house block without treating the other houses as new lane obstructions', () => {
    const state = fixture();
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) add(state, 'house', { x: target.x + x, y: target.y + y });
    expect(validateBuildAt(state, 'well', target.x + 1, target.y).ok).toBe(true);
    // Standalone wells may also sit directly alongside the housing block.
    expect(validateBuildAt(state, 'well', target.x + 1, target.y - 1).ok).toBe(true);
  });

  it('includes a well tile in automatic housing growth without moving or removing the well', () => {
    const state = fixture(), well = add(state, 'well'), palace = state.buildings[0];
    for (const tile of state.world.tiles) tile.overlay = 'forest';
    state.world.tiles[target.y * state.world.width + target.x].overlay = 'none';
    const before = JSON.stringify(state);
    expect(planHouseSite(state, palace)).toEqual({ point: target });
    expect(JSON.stringify(state)).toBe(before); expect(state.buildings).toContain(well);
  });

  it('allows isolated manual parcels and waits for builder access before construction', () => {
    const state = fixture(), palace = state.buildings[0]; add(state, 'well');
    for (let x = 1; x <= 4; x++) add(state, 'house', { x: target.x - x });
    expect(canPlaceHouseAt(state, palace, target)).toBe(true);
    entityStore(state).buildings.replace(state.buildings.filter(b => b.kind !== 'house'));
    expect(canPlaceHouseAt(state, palace, target)).toBe(true);
    for (let y = target.y - 1; y <= target.y + 1; y++) for (let x = target.x - 1; x <= target.x + 1; x++)
      if (x !== target.x || y !== target.y) state.world.tiles[y * state.world.width + x].terrain = 'lake';
    state.world.revision = 1;
    expect(canPlaceHouseAt(state, palace, target)).toBe(true);
    expect(buildAt(state, 'house', target.x, target.y).ok).toBe(true);
    const house = state.buildings.at(-1)!;
    state.time += 30; ensureBuilders(state); updateConstruction(state);
    expect(house.construction?.waitingForBuilder).toBe(true);
    state.world.tiles[target.y * state.world.width + target.x - 1].terrain = 'grassland';
    state.world.revision++;
    advanceUntilComplete(state, [house]);
    const far = add(state, 'well', { x: 24, y: 8 });
    expect(canPlaceHouseAt(state, palace, far)).toBe(true);
  });
});
