import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { stressScenario } from '../dev/navigation-lab/stress';
import { validateNetworkPlacement } from '../src/game/network-placement';
import { canPlaceRoad, recordTraffic, ROAD_TRAFFIC_THRESHOLD, updateTraffic } from '../src/game/traffic';
import { queueConstruction } from '../src/game/structures';
import type { Building, BuildingKind, GameState } from '../src/game/types';

function fixture(): GameState {
  const state = stressScenario('Single gate');
  entityStore(state).buildings.replace([{ id: 999, kind: 'palace', x: 28, y: 20, hp: 650, maxHp: 650, capacity: 0, faction: 0 }]);
  state.factions = [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
    production: 0, population: 5, culture: 30000, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }];
  entityStore(state).units.replace(state.units.slice(0, 1)); return state;
}
function add(state: GameState, kind: BuildingKind, x: number, y: number, queued = false) {
  const building: Building = { id: state.buildings.length + 1000, kind, x, y, hp: 100, maxHp: 100, capacity: 0, faction: 0 };
  entityStore(state).buildings.add(building); if (queued) queueConstruction(building, 0);
  return building;
}
function roadLine(state: GameState) { for (let x = 5; x <= 14; x++) add(state, 'road', x, 10); add(state, 'road', 6, 9); }

describe('reserved gate spacing', () => {
  it.each(['road', 'wall'] as const)('allows gates two tiles apart but rejects adjacent %s gate layers', kind => {
    for (const queued of [false, true]) {
      const state = fixture(); add(state, 'wall', 10, 10, queued); add(state, 'road', 10, 10, queued);
      for (const x of [11, 12, 13]) add(state, kind === 'road' ? 'wall' : 'road', x, 10);
      expect(validateNetworkPlacement(state, kind, 11, 10).ok).toBe(false);
      expect(validateNetworkPlacement(state, kind, 12, 10).ok).toBe(true);
      expect(validateNetworkPlacement(state, kind, 13, 10).ok).toBe(true);
      if (kind === 'road') {
        expect(canPlaceRoad(state, 11, 10)).toBe(false);
        expect(canPlaceRoad(state, 12, 10)).toBe(true);
      }
    }
  });
  it('rejects touching diagonal gates and gaps used to evade spacing', () => {
    const state = fixture(); add(state, 'road', 10, 10); add(state, 'wall', 10, 10);
    add(state, 'road', 11, 11); add(state, 'road', 12, 10);
    expect(validateNetworkPlacement(state, 'wall', 11, 11).ok).toBe(false);
    expect(validateNetworkPlacement(state, 'wall', 12, 10).ok).toBe(true);
    state.buildings.find(building => building.kind === 'road' && building.x === 10)!.hp = 0;
    expect(validateNetworkPlacement(state, 'wall', 11, 11).ok).toBe(true);
  });
  it('counts palisades and public roads as reserved gate layers', () => {
    const state = fixture(); add(state, 'palisade', 10, 10); add(state, 'road', 10, 10).faction = -1;
    add(state, 'road', 12, 10).faction = -1;
    expect(validateNetworkPlacement(state, 'palisade', 12, 10).ok).toBe(true);
  });
});

describe('road junction spacing', () => {
  it('checks junctions created on neighboring road cells, including queued bridges', () => {
    const state = fixture(); roadLine(state);
    expect(canPlaceRoad(state, 7, 11)).toBe(false);
    expect(validateNetworkPlacement(state, 'bridge', 7, 11).message).toContain('2 tiles');
    expect(canPlaceRoad(state, 8, 9)).toBe(true);
    expect(canPlaceRoad(state, 9, 9)).toBe(true);
    add(state, 'bridge', 9, 9, true);
    expect(canPlaceRoad(state, 10, 11)).toBe(false);
    expect(canPlaceRoad(state, 11, 11)).toBe(true);
  });
  it('rejects an invalid ambient junction and ignores farm-builder traffic', () => {
    for (const campRoad of [false, true]) {
      const state = fixture(); roadLine(state); const unit = state.units[0];
      Object.assign(unit, { kind: 'militia', x: 7.5, y: 11.5 });
      if (campRoad) {
        const camp = add(state, 'camp', 20, 20, true);
        Object.assign(unit, { builder: true, buildPhase: 'outbound', buildSite: camp.id });
        camp.construction!.builderId = unit.id;
      }
      for (let visit = 0; visit < ROAD_TRAFFIC_THRESHOLD; visit++) expect(recordTraffic(state, unit, { x: 7.5, y: 12.5 })).toBe(false);
      expect(updateTraffic(state)).toBe(false);
      expect(state.buildings.some(building => building.kind === 'road' && building.x === 7 && building.y === 11)).toBe(false);
    }
  });
});


describe('thin wall networks', () => {
  it.each(['wall', 'palisade'] as const)('rejects the fourth %s cell of a mixed 2x2 block, including orders', kind => {
    for (const queued of [false, true]) for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11]]) {
      const state = fixture();
      for (const [px, py] of [[10, 10], [11, 10], [10, 11], [11, 11]]) if (px !== x || py !== y)
        add(state, px % 2 ? 'wall' : 'palisade', px, py, queued);
      expect(validateNetworkPlacement(state, kind, x, y)).toMatchObject({ ok: false });
    }
  });
  it.each(['wall', 'palisade'] as const)('keeps straight, L and T %s junctions valid', kind => {
    for (const neighbors of [[[9, 10], [11, 10]], [[9, 10], [10, 9]], [[9, 10], [11, 10], [10, 9]]]) {
      const state = fixture(); for (const [x, y] of neighbors) add(state, kind, x, y);
      expect(validateNetworkPlacement(state, kind, 10, 10).ok).toBe(true);
    }
  });
  it.each(['wall', 'palisade'] as const)('rejects a new %s cross center and any fourth arm, counting mixed orders and gates', kind => {
    const cross = [[10, 10], [9, 10], [11, 10], [10, 9], [10, 11]];
    for (const queued of [false, true]) for (const [x, y] of cross) {
      const state = fixture();
      for (const [px, py] of cross) if (px !== x || py !== y)
        add(state, px % 2 ? 'wall' : 'palisade', px, py, queued);
      add(state, 'road', 10, 10, queued);
      expect(validateNetworkPlacement(state, kind, x, y)).toMatchObject({ ok: false, message: expect.stringContaining('four-way') });
    }
  });
  it('allows upgrading an existing T junction and opening its gate without adding a wall connection', () => {
    const state = fixture();
    for (const [x, y] of [[10, 10], [9, 10], [11, 10], [10, 9]]) add(state, 'palisade', x, y);
    expect(validateNetworkPlacement(state, 'wall', 10, 10).ok).toBe(true);
    expect(validateNetworkPlacement(state, 'road', 10, 10).ok).toBe(true);
    add(state, 'road', 10, 10);
    expect(validateNetworkPlacement(state, 'wall', 10, 10).ok).toBe(true);
  });
  it('ignores destroyed walls and never wraps a 2x2 test across world edges', () => {
    const state = fixture(); add(state, 'wall', 10, 10).hp = 0; add(state, 'wall', 11, 10); add(state, 'wall', 10, 11);
    expect(validateNetworkPlacement(state, 'wall', 11, 11).ok).toBe(true);
    const width = state.world.width;
    add(state, 'wall', width - 1, 10); add(state, 'wall', 0, 11); add(state, 'wall', width - 1, 11);
    expect(validateNetworkPlacement(state, 'wall', 0, 12).ok).toBe(true);
  });
});
