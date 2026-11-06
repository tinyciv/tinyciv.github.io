import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { canReachConstruction } from '../src/game/builders';
import { synchronizeFarms } from '../src/game/farms';
import { updateFog } from '../src/game/fog';
import { canPlaceHouseAt, planHouseSite } from '../src/game/housing';
import { canWalk } from '../src/game/pathfinding';
import { buildAt, updateGame, validateBuildAt } from '../src/game/simulation';
import { type Building, type GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const structure = (id: number, kind: Building['kind'], x: number, y: number, pending = false): Building => ({
  id, kind, faction: 0, x, y, hp: 160, maxHp: 160, capacity: kind === 'house' ? 4 : 0,
  construction: pending ? { startedAt: 0, duration: 20, waitingForBuilder: true } : undefined,
});
function fixture(): GameState {
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'wall-adjacency', source: 'fixture', spawns: [], revision: 0,
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) },
    buildings: [structure(1, 'palace', 6, 10)], fields: [],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 13.5, y: 12.5, hp: 100, morale: 100, attack: 0, defense: 0,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 5000,
      production: 0, population: 30, culture: 10000, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], projectiles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'wall-adjacency', rngState: 1, marauderPacks: [], raiderCamps: [],
  };
  state.factions.forEach(unlockBuildingResearch);
  updateFog(state); return state;
}

describe('buildings adjoining walls', () => {
  it.each(['house', 'well', 'monument', 'woodenTower'] as const)('permits %s beside completed and queued walls, with only towers sharing the wall tile', kind => {
    for (const pending of [false, true]) {
      const state = fixture(); entityStore(state).buildings.add(structure(3, 'wall', 13, 10, pending));
      expect(validateBuildAt(state, kind, 12, 10).ok, `${kind}, pending wall ${pending}`).toBe(true);
      expect(buildAt(state, kind, 12, 10).ok).toBe(true);
      expect(validateBuildAt(state, kind, 13, 10).ok).toBe(kind === 'woodenTower');
      expect(canWalk(state, 13.5, 10.5, 0)).toBe(pending);
    }
  });

  it.each(['wall', 'palisade'] as const)('allows houses alongside and diagonally beside %s in the automatic planner', kind => {
    for (const [x, y] of [[13, 10], [13, 11]]) {
      const state = fixture(), site = { x: 12, y: 10 };
      for (const tile of state.world.tiles) tile.overlay = 'forest';
      state.world.tiles[10 * 32 + 12].overlay = 'none';
      entityStore(state).buildings.add(structure(3, kind, x, y));
      expect(planHouseSite(state, state.buildings[0])).toEqual({ point: site });
      expect(canPlaceHouseAt(state, state.buildings[0], site)).toBe(true);
    }
  });

  it.each(['house', 'well', 'monument', 'woodenTower'] as const)('permits a later wall beside %s, sharing only a tower footprint', kind => {
    for (const pending of [false, true]) {
      const state = fixture(); entityStore(state).buildings.add(structure(3, kind, 12, 10, pending));
      expect(buildAt(state, 'wall', 13, 10).ok).toBe(true);
      expect(validateBuildAt(state, 'wall', 12, 10).ok).toBe(kind === 'woodenTower');
    }
  });

  it.each(['wall first', 'farm first'] as const)('allows a wall directly against the farm perimeter, preserving its single crop tile (%s)', ordering => {
    for (const pending of [false, true]) {
      const state = fixture();
      if (ordering === 'wall first') {
        entityStore(state).buildings.add(structure(3, 'wall', 13, 10, pending));
        expect(buildAt(state, 'camp', 12, 10).ok).toBe(true);
      } else {
        entityStore(state).buildings.add(structure(3, 'camp', 12, 10, pending)); synchronizeFarms(state);
        expect(buildAt(state, 'wall', 13, 10).ok).toBe(true);
      }
      const camp = state.buildings.find(building => building.kind === 'camp')!;
      // Completed farms can now move aside for a wall; unfinished plots retain
      // their construction reservation. A preview preserves all current crops.
      expect(validateBuildAt(state, 'wall', 12, 10).ok).toBe(!camp.construction);
      delete camp.construction; synchronizeFarms(state);
      expect(state.fields?.filter(field => field.camp === camp.id)).toHaveLength(1);
      expect(state.fields?.some(field => field.x === 13 && field.y === 10)).toBe(false);
    }
  });

  it.each(['well', 'monument', 'woodenTower'] as const)('allows houses to fill parcels beside an existing %s without changing its later-construction rules', kind => {
    const state = fixture(); entityStore(state).buildings.add(structure(3, kind, 13, 10));
    expect(validateBuildAt(state, 'house', 12, 10).ok).toBe(true);
    entityStore(state).buildings.replace([state.buildings[0], structure(4, 'house', 12, 10)]);
    expect(validateBuildAt(state, kind, 13, 10).ok).toBe(false);
  });

  it('finishes an adjoining house through a reachable face without removing wall collision', () => {
    const state = fixture(); state.factions[0].population = 4;
    entityStore(state).buildings.add(structure(3, 'wall', 13, 10));
    expect(buildAt(state, 'house', 12, 10).ok).toBe(true);
    const house = state.buildings.find(building => building.kind === 'house')!;
    for (let step = 0; step < 300 && house.construction; step++) updateGame(state, .1, idle);
    expect(house.construction).toBeUndefined();
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(false); expect(canWalk(state, 13.5, 10.5, 0)).toBe(false);
    expect(canWalk(state, 12.5, 9.5, 0)).toBe(true);
  });

  it('allows a manual parcel between walls when both sides retain a route around their ends', () => {
    const state = fixture(); let id = 10;
    for (let x = 8; x <= 18; x++) for (const y of [9, 11]) entityStore(state).buildings.add(structure(id++, 'wall', x, y));
    expect(canPlaceHouseAt(state, state.buildings[0], { x: 12, y: 10 })).toBe(true);
  });

  it('rejects a farm sealed away from its builder, then accepts it through a legal owned gate', () => {
    const state = fixture(); let id = 10;
    for (let y = 8; y <= 12; y++) for (let x = 10; x <= 14; x++) if (x === 10 || x === 14 || y === 8 || y === 12)
      entityStore(state).buildings.add(structure(id++, 'wall', x, y));
    const proposed = structure(100, 'camp', 12, 10);
    expect(canReachConstruction(state, state.buildings[0], proposed)).toBe(false);
    expect(validateBuildAt(state, 'camp', 12, 10).ok).toBe(false);
    entityStore(state).buildings.add(structure(101, 'road', 10, 10));
    expect(canReachConstruction(state, state.buildings[0], proposed)).toBe(true);
    expect(validateBuildAt(state, 'camp', 12, 10).ok).toBe(true);
    expect(canWalk(state, 10.5, 10.5, 0)).toBe(true); expect(canWalk(state, 10.5, 10.5, -2)).toBe(false);
  });
});
