import { describe, expect, it } from 'vitest';
import { farmBlockPlacementQuery } from '../src/game/farm-blocks';
import { entityStore } from '../src/game/entity-store';
import { planAutomaticFarmSite } from '../src/game/farm-siting';
import { planBuildingFarmRelocations, planFarmRelocation, relocateBuildingFarms } from '../src/game/farm-relocation';
import { type Building, type Point } from '../src/game/types';
import { scoutRealm } from './helpers/scouts';

function fixture() {
  const state = scoutRealm();
  entityStore(state).buildings.replace([{ id: 1, kind: 'palace', faction: 0, x: 10, y: 10, hp: 650, maxHp: 650, capacity: 4 }]);
  return state;
}
const rectangle = (x: number, y: number, width: number, height: number): Point[] =>
  Array.from({ length: width * height }, (_, index) => ({ x: x + index % width, y: y + Math.floor(index / width) }));
function plant(state: ReturnType<typeof fixture>, points: readonly Point[], extra: Partial<Building> = {}): Building[] {
  let id = Math.max(...state.buildings.map(building => building.id));
  const farms = points.map(point => ({ id: ++id, kind: 'camp' as const, faction: 0, hp: 100, maxHp: 100, capacity: 0, ...point, ...extra }));
  entityStore(state).buildings.add(...farms); state.world.revision!++;
  return farms;
}

describe('hard physical farm-block geometry', () => {
  it('permits all shapes through six cells, then enforces a maximum 1.5:1 aspect ratio', () => {
    const query = farmBlockPlacementQuery(fixture());
    expect(query.canAdd({ x: 3, y: 3 }).ok).toBe(true);
    expect(query.canAddAll(rectangle(3, 3, 6, 1)).ok).toBe(true);
    expect(query.canAddAll(rectangle(3, 3, 7, 1))).toMatchObject({ ok: false, reason: 'shape' });
    expect(query.canAddAll(rectangle(3, 3, 4, 2))).toMatchObject({ ok: false, reason: 'shape' });
    expect(query.canAddAll(rectangle(3, 3, 3, 3)).ok).toBe(true);
    expect(query.canAddAll(rectangle(3, 3, 4, 3)).ok).toBe(true);
    expect(query.canAddAll(rectangle(3, 3, 3, 4)).ok).toBe(true);
    expect(query.canAddAll(rectangle(3, 3, 5, 3))).toMatchObject({ ok: false, reason: 'shape' });
    const sparseBoundary = [...rectangle(3, 3, 3, 2), { x: 6, y: 3 }, { x: 7, y: 3 }, { x: 8, y: 3 }, { x: 3, y: 5 }, { x: 3, y: 6 }];
    expect(query.canAddAll(sparseBoundary)).toMatchObject({ ok: true, blocks: [{ aspectRatio: 1.5 }] });
  });

  it('accepts sixteen cells but rejects the seventeenth even with a compact bounding box', () => {
    const state = fixture(), square = rectangle(15, 10, 4, 4);
    plant(state, square.slice(0, 15));
    expect(farmBlockPlacementQuery(state).canAdd(square[15])).toMatchObject({ ok: true, blocks: [{ size: 16 }] });
    plant(state, [square[15]]);
    expect(farmBlockPlacementQuery(state).canAdd({ x: 19, y: 11 })).toMatchObject({ ok: false, reason: 'size', blocks: [{ size: 17 }] });
  });

  it('counts connected farms of every owner, including orchards and unfinished or fallow reservations', () => {
    const state = fixture(), square = rectangle(15, 10, 4, 4);
    plant(state, square.slice(0, 5), { faction: -1 });
    plant(state, square.slice(5, 10), { faction: 1, orchard: { startedAt: 0, readyAt: 120 } });
    plant(state, square.slice(10), { construction: { startedAt: 0, duration: 3.75, waitingForBuilder: true } });
    expect(farmBlockPlacementQuery(state).canAdd({ x: 19, y: 11 })).toMatchObject({ ok: false, reason: 'size' });
    state.buildings.at(-1)!.hp = 0;
    expect(farmBlockPlacementQuery(state).canAdd({ x: 19, y: 11 })).toMatchObject({ ok: true, blocks: [{ size: 16 }] });
  });

  it('treats diagonals as separate blocks and never wraps neighbors across map edges', () => {
    const state = fixture(); plant(state, rectangle(3, 3, 4, 4));
    expect(farmBlockPlacementQuery(state).canAdd({ x: 7, y: 7 })).toMatchObject({ ok: true, blocks: [{ size: 1 }] });
    plant(state, [{ x: state.world.width - 1, y: 2 }]);
    expect(farmBlockPlacementQuery(state).canAdd({ x: 0, y: 3 })).toMatchObject({ ok: true, blocks: [{ size: 1 }] });
  });

  it('counts each neighboring component once and detects a bridge merging several blocks', () => {
    const state = fixture();
    plant(state, rectangle(3, 3, 3, 3).filter(point => point.x !== 4 || point.y !== 4));
    expect(farmBlockPlacementQuery(state).canAdd({ x: 4, y: 4 })).toMatchObject({ ok: true, blocks: [{ size: 9 }] });
    plant(state, rectangle(7, 3, 3, 3));
    expect(farmBlockPlacementQuery(state).canAdd({ x: 6, y: 4 })).toMatchObject({ ok: false, reason: 'size', blocks: [{ size: 18 }] });
  });

  it('validates the final atomic union, deduplicates additions and honors source removal and reservations', () => {
    const state = fixture(), base = rectangle(3, 3, 4, 4); plant(state, base);
    const removed = new Set(base.slice(0, 4).map(point => point.y * state.world.width + point.x));
    const added = new Set([7 * state.world.width + 3, 7 * state.world.width + 4, 7 * state.world.width + 5]);
    const query = farmBlockPlacementQuery(state, { removedCells: removed, addedCells: added });
    expect(query.canAddAll([{ x: 6, y: 7 }, { x: 6, y: 7 }])).toMatchObject({ ok: true, blocks: [{ size: 16 }] });
    expect(query.canAddAll([{ x: 6, y: 7 }, { x: 7, y: 6 }])).toMatchObject({ ok: false, reason: 'size' });
    expect(farmBlockPlacementQuery(fixture()).canAddAll(rectangle(3, 3, 3, 3)).ok).toBe(true);
  });

  it('permits redevelopment to fragment the source block without relaxing destination checks', () => {
    const state = fixture(); plant(state, rectangle(3, 3, 3, 4));
    const removed = new Set(rectangle(3, 3, 1, 4).map(point => point.y * state.world.width + point.x));
    // The remaining source is 2×4. It is not an addition and does not block rebuilding elsewhere.
    expect(farmBlockPlacementQuery(state, { removedCells: removed }).canAdd({ x: 20, y: 20 }).ok).toBe(true);
  });
});

describe('automatic farm geometry enforcement', () => {
  it('keeps every growing block legal across repeated automatic orders', () => {
    const state = fixture();
    for (let i = 0; i < 70; i++) {
      const plan = planAutomaticFarmSite(state, state.buildings[0]); expect(plan).toBeDefined();
      plant(state, [plan!.point]);
      expect(farmBlockPlacementQuery(state).canAddAll(state.buildings.filter(building => building.kind === 'camp')).ok).toBe(true);
    }
  });

  it('does not enlarge a capped block even when its edge has much richer soil', () => {
    const state = fixture(); plant(state, rectangle(14, 9, 4, 4));
    for (const point of rectangle(13, 8, 6, 6)) state.world.tiles[point.y * state.world.width + point.x].fertility = 1;
    const site = planAutomaticFarmSite(state, state.buildings[0])!;
    expect(farmBlockPlacementQuery(state).canAdd(site.point).ok).toBe(true);
    expect(site.point.x < 13 || site.point.x > 18 || site.point.y < 8 || site.point.y > 13
      || (site.point.x === 13 || site.point.x === 18) && (site.point.y === 8 || site.point.y === 13)).toBe(true);
  });

  it('rejects illegal quoted relocation destinations and plans a legal replacement', () => {
    const state = fixture(), palace = state.buildings[0], [farm] = plant(state, [{ x: 20, y: 10 }]);
    plant(state, rectangle(14, 9, 4, 4));
    expect(planFarmRelocation(state, palace, farm, farm, undefined, { nearby: true, destination: { x: 18, y: 10 } })).toBeUndefined();
    // Reserving a multi-tile wall/road stroke does not promise every later
    // tile succeeds; other farms remain part of the physical block for now.
    expect(planFarmRelocation(state, palace, farm, farm, undefined, { nearby: true, destination: { x: 18, y: 10 },
      reservedTiles: new Set([9 * state.world.width + 14]) })).toBeUndefined();
    const move = planFarmRelocation(state, palace, farm, farm, undefined, { nearby: true })!;
    expect(move).toBeDefined();
    expect(farmBlockPlacementQuery(state, { removedCells: new Set([farm.y * state.world.width + farm.x]) }).canAdd(move.to).ok).toBe(true);
  });

  it('relocates an entire final farm block atomically and rejects tampered duplicate destinations', () => {
    const state = fixture(), origin = { x: 15, y: 10 }; plant(state, rectangle(origin.x, origin.y, 2, 2));
    const plan = planBuildingFarmRelocations(state, 'library', origin, 0)!;
    expect(plan.farms).toHaveLength(4);
    const bad = { ...plan, farms: plan.farms.map((move, index) => index === 1 ? { ...move, to: plan.farms[0].to } : move) };
    expect(relocateBuildingFarms(state, bad)).toBe(false);
    expect(relocateBuildingFarms(state, plan)).toBe(true);
    expect(farmBlockPlacementQuery(state).canAddAll(plan.farms.map(move => move.to)).ok).toBe(true);
  });
});
