import { describe, expect, it, vi } from 'vitest';
import { ConstructionEffectCache, ConstructionGhostCache } from '../src/game/construction-presentation';
import { buildingEffectCells } from '../src/game/building-aoe';
import { indexBuildings } from '../src/game/presentation-index';
import type { ConstructionPlan } from '../src/game/construction';
import type { ConstructionGesturePreview } from '../src/game/construction-gesture';
import type { FogView } from '../src/game/fog';
import type { Building, FarmFieldMemory, Point } from '../src/game/types';
import * as display from '../src/game/construction-display';
import { armyWarningFixture } from './helpers/army-warnings';
import { recordNativeFrame } from './helpers/native-renderer';

const road = (id: number, x: number, faction = 0): Building =>
  ({ id, kind: 'road', faction, x, y: 25, hp: 100, maxHp: 100, capacity: 0 });

describe('retained construction presentation', () => {
  it('retains ghost occupancy and occupants without mutating observations, then refreshes validity, tool and ownership', () => {
    const { world } = armyWarningFixture(), cache = new ConstructionGhostCache();
    const wall = { ...road(1, 20), kind: 'wall' as const }, existing = road(2, 21);
    const base = indexBuildings([wall, existing]), create = vi.fn((point: Point) => road(-1, point.x));
    const cells = [{ x: 20, y: 25, valid: true }, { x: 21, y: 25, valid: true }];
    const first = cache.get(world, base, 'road', 0, cells, create);
    expect(first.index.get('20,25')).toEqual([wall, road(-1, 20)]);
    expect(base.get('20,25')).toEqual([wall]);
    expect(first.plans.get('21,25')!.building).toBe(existing);
    expect(cache.get(world, base, 'road', 0, cells.map(cell => ({ ...cell })), create)).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    const rejected = cache.get(world, base, 'road', 0, [{ ...cells[0], valid: false }, cells[1]], create);
    expect(rejected.index).toBe(base); expect(rejected.validCells.has('20,25')).toBe(false);
    const purchased = indexBuildings([wall, existing, road(3, 20)]);
    expect(cache.get(world, purchased, 'road', 0, cells, create).index).toBe(purchased);
    expect(cache.get(world, purchased, 'road', 1, cells, create).index).not.toBe(purchased);
    expect(cache.get(world, base, 'irrigation', 0, cells, point => ({ ...road(-1, point.x), kind: 'irrigation' })).plans.get('20,25')!.building.kind).toBe('irrigation');
    expect(cache.get(world, base, 'road', 0, [{ ...cells[0], skip: true }], create).index).toBe(base);
  });

  it('retains clipped irrigation coverage and refreshes highlights when sight or observed fields change', () => {
    const { world } = armyWarningFixture(), cache = new ConstructionEffectCache();
    const origins = [{ x: 20, y: 25 }], bounds = { left: 19, right: 24, top: 22, bottom: 29 };
    const fog: FogView = { width: world.width, height: world.height, visible: new Uint8Array(world.tiles.length),
      explored: [], buildings: [], fields: [{ x: 20, y: 25 } as FarmFieldMemory], sources: [], revision: 1, explorationRevision: 1 };
    const first = cache.get(world, origins, 2, bounds, fog);
    expect(first.map(({ x, y }) => ({ x, y }))).toEqual(buildingEffectCells(world, origins, 2, bounds));
    expect(first.every(cell => !cell.field)).toBe(true);
    expect(cache.get(world, [{ ...origins[0] }], 2, { ...bounds }, fog)).toBe(first);
    fog.visible[25 * world.width + 20] = 1; fog.revision++;
    const visible = cache.get(world, origins, 2, bounds, fog);
    expect(visible.find(cell => cell.x === 20 && cell.y === 25)?.field).toBe(true);
    expect(cache.get(world, origins, 2, bounds, fog)).toBe(visible);
    fog.fields = [];
    expect(cache.get(world, origins, 2, bounds, fog).every(cell => !cell.field)).toBe(true);
    expect(cache.get(world, origins, 2, { ...bounds, left: 21 }, fog).every(cell => cell.x >= 21)).toBe(true);
    expect(cache.get(world, [{ x: 30, y: 25 }], 2, bounds, fog)).toEqual([]);
  });

  it('uses the shared quote only for its matching gesture and preserves ordinary fallback', () => {
    const state = armyWarningFixture(); state.buildMode = 'road';
    const points = [{ x: 20, y: 25 }];
    const plan: ConstructionPlan = { ok: true, message: '', tiles: points, cells: [{ ...points[0], ok: true, existing: false, message: '' }],
      skipped: 0, cost: 10, costs: { food: 0, production: 0, gold: 10 } };
    const gesture: ConstructionGesturePreview = { state, world: state.world, kind: 'road', points, plan, requestedEnd: points[0] };
    const quote = vi.spyOn(display, 'previewConstructionPlan').mockReturnValue(plan);
    try {
      recordNativeFrame(state, { buildPreview: points, constructionGesture: gesture });
      expect(quote).not.toHaveBeenCalled();
      recordNativeFrame(state, { buildPreview: [...points], constructionGesture: gesture });
      expect(quote).toHaveBeenCalledTimes(1);
      recordNativeFrame(state, { buildPreview: points, constructionGesture: { ...gesture, state: { ...state } } });
      expect(quote).toHaveBeenCalledTimes(2);
      recordNativeFrame(state, { buildPreview: points, constructionGesture: { ...gesture, world: { ...state.world } } });
      expect(quote).toHaveBeenCalledTimes(3);
      recordNativeFrame(state, { buildPreview: points, constructionGesture: { ...gesture, kind: 'irrigation' } });
      expect(quote).toHaveBeenCalledTimes(4);
    } finally { quote.mockRestore(); }
  });

  it('shows pending orders and a truncated endpoint above fog without creating observations', () => {
    const state = armyWarningFixture(); state.buildMode = 'road';
    const points = [{ x: 20, y: 25 }];
    const plan: ConstructionPlan = { ok: true, message: '', tiles: points, cells: [{ ...points[0], ok: true, existing: false, message: '' }],
      skipped: 0, cost: 10, costs: { food: 0, production: 0, gold: 10 } };
    const fog: FogView = { width: state.world.width, height: state.world.height, visible: new Uint8Array(state.world.tiles.length),
      explored: Array(state.world.tiles.length).fill(0), buildings: [], fields: [], sources: [], revision: 1, explorationRevision: 1 };
    const gesture: ConstructionGesturePreview = { state, world: state.world, kind: 'road', points, plan, requestedEnd: { x: 23, y: 25 } };
    const frame = recordNativeFrame(state, { fog, buildPreview: points, constructionGesture: gesture,
      pendingConstruction: [{ kind: 'road', points }, { kind: 'irrigation', points: [{ x: 21, y: 25 }] }] });
    for (const key of ['pending-construction:road', 'pending-construction:irrigation', 'construction-requested-end'])
      expect(frame.drawOrder.indexOf(key)).toBeGreaterThan(frame.drawOrder.indexOf('fog'));
    expect(fog.explored.every(value => value === 0)).toBe(true);
    expect(fog.buildings).toEqual([]);
    const complete = recordNativeFrame(state, { fog, buildPreview: points, constructionGesture: { ...gesture, requestedEnd: points[0] } });
    expect(complete.drawOrder).not.toContain('construction-requested-end');
  });
});
