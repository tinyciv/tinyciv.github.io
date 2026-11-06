import { describe, expect, it } from 'vitest';
import { clearArea } from '../src/game/area-tools';
import { ensureBuilders, updateBuilder } from '../src/game/builders';
import { entityStore } from '../src/game/entity-store';
import { CAMP_FIELD_OFFSETS, synchronizeFarms } from '../src/game/farms';
import { updateFog } from '../src/game/fog';
import { canWalk, movementMultiplier } from '../src/game/pathfinding';
import { buildAt, moveUnit } from '../src/game/simulation';
import { updateConstruction } from '../src/game/structures';
import { hasTree, TREE_CLEAR_SECONDS } from '../src/game/tree-clearing';
import { tileAt, type GameState } from '../src/game/types';
import { unlockBuildingResearch } from './helpers/research';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 24, height: 18, seed: 'marsh-gameplay', source: 'test', spawns: [],
      tiles: Array.from({ length: 24 * 18 }, () => ({ terrain: 'grassland', overlay: 'none',
        elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    units: [{ id: 2, kind: 'leader', faction: 0, x: 10.5, y: 8.5, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
      moving: false, facing: 0, attackTime: 0 }],
    buildings: [{ id: 1, kind: 'palace', x: 3, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 1000,
      production: 0, population: 5, culture: 10000, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'marsh-gameplay', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
  };
  unlockBuildingResearch(state.factions[0]);
  updateFog(state);
  return state;
}

const wetland = { terrain: 'grassland', overlay: 'none', biome: 'wetland', delta: 2,
  elevation: .1, moisture: .95, fertility: .73, food: 4, production: 1, gold: 1 } as const;

function plantMarsh(state: GameState, x: number, y: number) {
  return Object.assign(tileAt(state.world, x, y)!, wetland, { marsh: true });
}

function advance(state: GameState, seconds: number): void {
  for (let remaining = seconds; remaining > 1e-6; remaining -= .1) {
    state.time += .1; updateConstruction(state); ensureBuilders(state);
    for (const unit of state.units) if (unit.builder && unit.hp > 0) updateBuilder(state, unit, .1, moveUnit);
  }
}

describe('delta marsh gameplay', () => {
  it('uses the Clear tool and a worker to remove reeds while retaining walkable wetland without a stump', () => {
    const state = fixture(), tile = plantMarsh(state, 12, 8), neighbor = plantMarsh(state, 13, 8);
    expect(canWalk(state, 12.5, 8.5, 0)).toBe(true);
    expect(movementMultiplier(state, 12.5, 8.5)).toBe(.7);
    expect(clearArea(state, { x: 12, y: 8 }, { x: 12, y: 8 })).toMatchObject({ ok: true, count: 1 });
    const worker = state.units.find(unit => unit.builder)!;
    for (let i = 0; i < 200 && worker.buildPhase !== 'clearing'; i++) advance(state, .1);
    expect(worker.buildPhase).toBe('clearing');
    advance(state, TREE_CLEAR_SECONDS - .2);
    expect(tile.marsh).toBe(true);
    advance(state, .2);
    expect(tile.marsh).toBeUndefined();
    expect(hasTree(state, { x: 12, y: 8 })).toBe(false);
    expect(tile).toMatchObject(wetland);
    expect(neighbor.marsh).toBe(true);
    expect(state.treeClearings).toHaveLength(0);
    expect(state.treeStumps ?? []).toHaveLength(0);
    expect(canWalk(state, 12.5, 8.5, 0)).toBe(true);
    expect(movementMultiplier(state, 12.5, 8.5)).toBe(.7);
  });

  it('clears reeds only under ordered roads and structures', () => {
    const state = fixture(), roadTile = plantMarsh(state, 10, 8), towerTile = plantMarsh(state, 12, 8);
    const neighbor = plantMarsh(state, 13, 8);
    entityStore(state).buildings.add({ id: 3, kind: 'road', x: 9, y: 8, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    expect(buildAt(state, 'road', 10, 8).ok).toBe(true);
    expect(buildAt(state, 'woodenTower', 12, 8).ok).toBe(true);
    for (const tile of [roadTile, towerTile]) {
      expect(tile.marsh).toBeUndefined();
      expect(tile).toMatchObject(wetland);
    }
    expect(neighbor.marsh).toBe(true);
  });

  it('clears the entire reserved farm footprint before construction without removing neighboring marsh', () => {
    const state = fixture();
    const plots = CAMP_FIELD_OFFSETS.map(([dx, dy]) => plantMarsh(state, 12 + dx, 8 + dy));
    const neighbor = plantMarsh(state, 14, 8);
    expect(buildAt(state, 'camp', 12, 8).ok).toBe(true);
    expect(state.buildings.find(building => building.kind === 'camp')!.construction!.waitingForBuilder).toBe(true);
    for (const tile of plots) {
      expect(tile.marsh).toBeUndefined();
      expect(tile).toMatchObject(wetland);
    }
    expect(neighbor.marsh).toBe(true);
    expect(state.fields).toHaveLength(0);
  });

  it('clears reeds from planted farm tiles even when field ownership is already synchronized', () => {
    const state = fixture(), neighbor = plantMarsh(state, 14, 8);
    entityStore(state).buildings.add({ id: 3, kind: 'camp', x: 12, y: 8, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    synchronizeFarms(state);
    expect(state.fields).toHaveLength(1);
    for (const field of state.fields!) {
      const tile = plantMarsh(state, field.x, field.y);
      expect(tile.farm).toBe(0);
    }
    synchronizeFarms(state);
    expect(state.fields).toHaveLength(1);
    for (const field of state.fields!) {
      const tile = tileAt(state.world, field.x, field.y)!;
      expect(tile.marsh).toBeUndefined();
      expect(tile).toMatchObject({ ...wetland, farm: 0 });
    }
    expect(neighbor.marsh).toBe(true);
  });
});
