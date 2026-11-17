import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildStroke, constructionLine, planConstruction } from '../src/game/construction';
import { buildAt, moveUnit, validateBuildAt } from '../src/game/simulation';
import { hasGateWall, validateNetworkPlacement } from '../src/game/network-placement';
import { canMove, canWalk, findPath } from '../src/game/pathfinding';
import { buildingTerritoryOwner } from '../src/game/property-territory';
import { updateWallOwnership } from '../src/game/wall-ownership';
import { markWorldChanged } from '../src/game/world-revisions';
import type { Building, GameState, Unit } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 36, height: 28, seed: 'gate-exceptions', source: 'test', spawns: [],
      tiles: Array.from({ length: 36 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 0, gold: 0, variation: .2 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 3, y: 3, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 15.5, y: 14.5, hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'City', color: '#38f', relation: 'self', affinity: 100, food: 500, gold: 100, production: 0,
      population: 5, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], treasures: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed: 'gate-exceptions', rngState: 1, marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
  };
}
function add(state: GameState, kind: Building['kind'], x = 16, y = 12, faction = 0): Building {
  const result: Building = { id: 100 + state.buildings.length, kind, x, y, faction, hp: 100, maxHp: 100, capacity: 0 };
  entityStore(state).buildings.add(result); return result;
}

describe('roads opening existing walls', () => {
  it.each(['wall', 'palisade'] as const)('opens an isolated owned or neutral %s with no adjoining road, including queued walls', kind => {
    for (const faction of [0, -1]) for (const queued of [false, true]) {
      const state = fixture(), wall = add(state, kind, 16, 12, faction);
      if (queued) wall.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
      expect(hasGateWall(state, 16, 12)).toBe(true);
      expect(validateBuildAt(state, 'road', 16, 12).ok).toBe(true);
      const plan = planConstruction(state, 'road', [{ x: 16, y: 12 }]);
      expect(plan).toMatchObject({ ok: true, cost: 10, skipped: 0, tiles: [{ x: 16, y: 12 }] });
      expect(state.factions[0].gold).toBe(100);
      expect(buildStroke(state, 'road', [{ x: 16, y: 12 }])).toMatchObject({ ok: true, placed: 1, skipped: 0 });
      expect(state.factions[0].gold).toBe(90);
      expect(canWalk(state, 16.5, 12.5, 0)).toBe(true);
    }
  });

  it('opens walls beside nearby junctions that still reject an ordinary road', () => {
    const state = fixture(); state.units[0].x = 9.5; state.units[0].y = 12.5;
    for (let x = 5; x <= 14; x++) add(state, 'road', x, 10);
    add(state, 'road', 6, 9);
    expect(validateBuildAt(state, 'road', 7, 11).message).toContain('junctions');
    add(state, 'wall', 7, 11);
    expect(validateBuildAt(state, 'road', 7, 11).ok).toBe(true);
    expect(buildAt(state, 'road', 7, 11).ok).toBe(true);
  });

  it('allows a gate in a 2-by-2 road block but never beside an existing gate', () => {
    const state = fixture();
    add(state, 'road', 15, 11); add(state, 'road', 16, 11); add(state, 'road', 15, 12); add(state, 'wall', 15, 12);
    expect(validateNetworkPlacement(state, 'road', 16, 12).ok).toBe(false);
    add(state, 'wall');
    expect(validateBuildAt(state, 'road', 16, 12).ok).toBe(false);
    expect(buildStroke(state, 'road', [{ x: 16, y: 12 }]).placed).toBe(0);
    expect(state.factions[0].gold).toBe(100);
    state.buildings.find(b => b.kind === 'wall' && b.x === 15)!.hp = 0;
    expect(validateBuildAt(state, 'road', 16, 12).ok).toBe(true);
    expect(buildStroke(state, 'road', [{ x: 16, y: 12 }])).toMatchObject({ ok: true, placed: 1 });
  });

  it.each([false, true])('seeds an outward road stroke at an isolated wall in either drag direction (reverse: %s)', reverse => {
    const state = fixture(); add(state, 'wall');
    const line = constructionLine({ x: reverse ? 19 : 16, y: 12 }, { x: reverse ? 16 : 19, y: 12 });
    const plan = planConstruction(state, 'road', line);
    expect(plan.tiles).toEqual([16, 17, 18, 19].map(x => ({ x, y: 12 })));
    expect(plan.cells.every(cell => cell.ok)).toBe(true);
    expect(buildStroke(state, 'road', line)).toMatchObject({ ok: true, placed: 4, skipped: 0 });
    expect(state.factions[0].gold).toBe(60);
  });

  it('opens a wall on a ford rather than skipping it as a free natural crossing', () => {
    const state = fixture(); add(state, 'wall');
    Object.assign(state.world.tiles[12 * 36 + 16], { terrain: 'river', overlay: 'ford' });
    expect(canWalk(state, 16.5, 12.5, 0)).toBe(false);
    expect(planConstruction(state, 'road', [{ x: 16, y: 12 }])).toMatchObject({ ok: true, cost: 10, tiles: [{ x: 16, y: 12 }] });
    expect(buildStroke(state, 'road', [{ x: 16, y: 12 }])).toMatchObject({ ok: true, placed: 1 });
    expect(canWalk(state, 16.5, 12.5, 0)).toBe(true);
  });

  it('keeps ownership, cost, range and tower occupancy checks for gate roads', () => {
    for (const problem of ['hostile', 'dead', 'tower', 'poor', 'far'] as const) {
      const state = fixture(), wall = add(state, 'wall');
      if (problem === 'hostile') wall.faction = 1;
      if (problem === 'dead') wall.hp = 0;
      if (problem === 'tower') add(state, 'woodenTower');
      if (problem === 'poor') state.factions[0].gold = 1;
      if (problem === 'far') state.units[0].x = 1.5;
      const before = state.factions[0].gold;
      expect(validateBuildAt(state, 'road', 16, 12).ok, problem).toBe(false);
      expect(buildStroke(state, 'road', [{ x: 16, y: 12 }]).placed, problem).toBe(0);
      expect(state.factions[0].gold).toBe(before);
    }
  });

  it('keeps ordinary isolated roads and new walls over nearby gate roads restricted', () => {
    const state = fixture();
    expect(validateBuildAt(state, 'road', 16, 12).ok).toBe(false);
    add(state, 'wall', 15, 12); add(state, 'road', 15, 12); add(state, 'road');
    expect(validateNetworkPlacement(state, 'wall', 16, 12).ok).toBe(false);
  });
});

describe.each(['wall', 'palisade'] as const)('outlying player-built %s gates', kind => {
  it.each([false, true])('requires enemies to breach the gate in either build order (road first: %s)', roadFirst => {
    const state = fixture(), start = { x: 14.5, y: 12.5 }, goal = { x: 18.5, y: 12.5 };
    state.factions[0].research = { focus: 'wall', levels: { wall: 1 }, progress: {} };
    // The gate is the only crossing of a water barrier, well beyond the city.
    for (let y = 0; y < state.world.height; y++) if (y !== 12)
      state.world.tiles[y * state.world.width + 16].terrain = 'lake';
    markWorldChanged(state.world, 'geometry');
    if (roadFirst) add(state, 'road', 15, 12);
    const complete = (building: Building): void => {
      delete building.construction;
      markWorldChanged(state.world, 'structure', [12 * state.world.width + 16]);
      updateWallOwnership(state);
    };
    let wall!: Building, road!: Building;
    for (const layer of roadFirst ? ['road', kind] as const : [kind, 'road'] as const) {
      expect(buildAt(state, layer, 16, 12).ok).toBe(true);
      const building = state.buildings.find(candidate => candidate.kind === layer && candidate.x === 16 && candidate.y === 12)!;
      if (layer === 'road') road = building; else wall = building;
      // A queued road already opens a completed wall for its owner only.
      if (layer === 'road' && !roadFirst) {
        updateWallOwnership(state);
        expect(canWalk(state, 16.5, 12.5, 0)).toBe(true);
        for (const faction of [-2, 1]) expect(canWalk(state, 16.5, 12.5, faction)).toBe(false);
      }
      complete(building);
      expect(building.faction).toBe(0);
    }
    expect(buildingTerritoryOwner(state, wall)).toBeUndefined();
    expect(road.faction).toBe(0);
    expect(findPath(state, start, goal, 0).at(-1)).toEqual(goal);
    for (const faction of [-2, 1]) {
      expect(findPath(state, start, goal, faction)).toEqual([]);
      expect(canMove(state, start, goal, faction)).toBe(false);
      for (const direct of [false, true]) {
        const enemy: Unit = { ...state.units[0], id: 1000, kind: 'warrior', faction, ...start,
          order: 'raid', path: [16.5, 17.5, 18.5].map(x => ({ x, y: 12.5 })), pathGoal: goal, repathAt: Infinity };
        for (let step = 0; step < 20; step++) { state.time += .1; moveUnit(state, enemy, goal, .1, direct); }
        expect(enemy.x).toBeLessThan(16);
      }
    }
    expect(wall.hp).toBe(wall.maxHp);
    wall.hp = 0;
    for (const faction of [-2, 1]) {
      expect(canMove(state, start, goal, faction)).toBe(true);
      expect(findPath(state, start, goal, faction).at(-1)).toEqual(goal);
      const enemy: Unit = { ...state.units[0], id: 1000, kind: 'warrior', faction, ...start, order: 'raid' };
      for (let step = 0; step < 20; step++) { state.time += .1; moveUnit(state, enemy, goal, .1, true); }
      expect(enemy.x).toBeGreaterThan(16);
    }
  });
});
