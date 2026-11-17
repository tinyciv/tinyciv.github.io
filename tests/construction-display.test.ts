import { describe, expect, it, vi } from 'vitest';
import { buildStroke, planConstruction } from '../src/game/construction';
import { previewConstructionGesture, previewConstructionPlan, previewConstructionRoute } from '../src/game/construction-display';
import { constructionRoute } from '../src/game/construction-route';
import { entityStore } from '../src/game/entity-store';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { denseConstructionFixture } from './helpers/construction-preview';
import * as previewState from '../src/game/construction-preview-state';
import * as previewCache from '../src/game/construction-preview-cache';
import * as previewRegion from '../src/game/construction-preview-region';
import * as borders from '../src/game/borders';
import { withSimulationReads } from '../src/game/simulation-reads';
import { markWorldChanged } from '../src/game/world-revisions';
import type { Building } from '../src/game/types';

describe('road gesture feedback', () => {
  it('validates each private road context once and omits unused authoritative tokens during UI queries', () => {
    const state = denseConstructionFixture(), from = { x: 83, y: 69 }, to = { x: 84, y: 69 };
    const before = JSON.stringify(state), context = vi.spyOn(previewCache, 'constructionPreviewContext');
    const region = vi.spyOn(previewRegion, 'constructionPreviewRegion');
    try {
      const route = previewConstructionRoute(state, 'road', from, to);
      expect(route.at(-1)).toEqual(to);
      expect(context.mock.calls.every(([, selection]) => selection === 'road')).toBe(true);
      // One live-state validation seeds the private scope. Route and quote
      // reuse it without rescanning either the live or filtered view.
      expect(region.mock.calls.filter(([game]) => game === state)).toHaveLength(1);
      expect(region.mock.calls.filter(([game]) => game !== state)).toHaveLength(0);
      expect(JSON.stringify(state)).toBe(before);
      context.mockClear();
      // Public planners retain the full token needed to reconsider a cached
      // local negative result before an authoritative purchase.
      planConstruction(state, 'road', route);
      expect(context.mock.calls.some(([, selection]) => selection === undefined)).toBe(true);
      context.mockClear();
      constructionRoute(state, 'road', from, to);
      expect(context.mock.calls.some(([, selection]) => selection === undefined)).toBe(true);
    } finally { context.mockRestore(); region.mockRestore(); }
  });

  it('ends readonly memoization after nested scopes and errors so subsequent direct edits remain visible', () => {
    const state = denseConstructionFixture();
    let first: ReturnType<typeof previewCache.constructionPreviewContext> | undefined;
    expect(() => previewCache.withConstructionDisplayReads(state, () => {
      first = previewCache.constructionPreviewContext(state, 'road');
      previewCache.withConstructionDisplayReads(state, () => {
        expect(previewCache.constructionPreviewContext(state, 'road')).toBe(first);
      });
      expect(previewCache.constructionDisplayReadsActive(state)).toBe(true);
      throw new Error('stop preview');
    })).toThrow('stop preview');
    expect(previewCache.constructionDisplayReadsActive(state)).toBe(false);
    // A fresh query must observe untracked editor changes, even at the same
    // game time and with unchanged entity-array and world revisions.
    state.units[0].x += .25;
    expect(previewCache.constructionPreviewContext(state, 'road')).not.toBe(first);
  });

  it('retains local routes while refreshing remote claim membership and shares current territory without repeated forks', () => {
    const state = denseConstructionFixture(), from = { x: 83, y: 69 }, to = { x: 84, y: 69 };
    const route = previewConstructionRoute(state, 'road', from, to);
    previewConstructionPlan(state, 'road', route);
    const context = previewCache.constructionDisplayContext(state, 'road'), preview = context.displayState!;
    const house: Building = { id: 900000, kind: 'house', faction: 0, x: 10, y: 10, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(house);
    expect(previewCache.constructionDisplayContext(state, 'road')).toBe(context);
    expect(previewConstructionRoute(state, 'road', from, to)).toBe(route);
    expect(context.displayState).toBe(preview);
    expect(preview.buildings).toContain(house);
    expect(withSimulationReads(preview, () => borders.territory(preview)).owners).toBe(borders.territory(state).owners);
    const forks = vi.spyOn(borders, 'forkTerritory');
    try {
      for (let i = 0; i < 3; i++) {
        expect(previewConstructionRoute(state, 'road', from, to)).toBe(route);
        expect(previewConstructionPlan(state, 'road', route)).toMatchObject({ ok: true, cost: 10 });
      }
      expect(forks).not.toHaveBeenCalled();
    } finally { forks.mockRestore(); }
    // Editor replacements can preserve array identity, length and ECS revision.
    // A live scalar query still needs the replacement object and current claims.
    const replacement = { ...house, id: 900001, x: 15 };
    (state.buildings as Building[])[state.buildings.indexOf(house)] = replacement;
    expect(previewConstructionRoute(state, 'road', from, to)).toBe(route);
    expect(preview.buildings).toContain(replacement); expect(preview.buildings).not.toContain(house);
    expect(withSimulationReads(preview, () => borders.territory(preview)).owners).toBe(borders.territory(state).owners);
  });

  it('avoids draft work for existing strokes and all quote context work for existing road ghosts', () => {
    const state = denseConstructionFixture(), points = [{ x: 83, y: 69 }, { x: 83.9, y: 69.1 }];
    state.factions[0].gold = 0;
    const before = JSON.stringify(state), draft = vi.spyOn(previewState, 'constructionPreviewState');
    try {
      expect(planConstruction(state, 'road', points)).toMatchObject({ ok: true, skipped: 0, cost: 0, tiles: [] });
      expect(draft).not.toHaveBeenCalled();
      const context = vi.spyOn(previewCache, 'constructionPreviewContext');
      try {
        expect(previewConstructionPlan(state, 'road', points)).toMatchObject({ ok: true, skipped: 0, cost: 0, tiles: [],
          cells: [{ x: 83, y: 69, existing: true, ok: true }] });
        expect(context).not.toHaveBeenCalled();
        expect(draft).not.toHaveBeenCalled();
        expect(JSON.stringify(state)).toBe(before);
      } finally { context.mockRestore(); }
    } finally { draft.mockRestore(); }
  });

  it('previews road geometry through a crop but rejects impossible relocation on release without moving it', () => {
    const state = denseConstructionFixture(), field = { ...state.fields![0], camp: 10, x: 8, y: 2, id: 249 };
    state.world = { ...state.world, width: 120, height: 5, tiles: Array.from({ length: 600 }, () =>
      ({ terrain: 'lake', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) };
    for (let x = 3; x <= 90; x++) state.world.tiles[2 * 120 + x].terrain = 'grassland';
    for (const x of [3, 4, 90]) state.world.tiles[120 + x].terrain = 'grassland';
    state.world.tiles[2 * 120 + 8].farm = 0;
    entityStore(state).units.replace([{ ...state.units[0], x: 8.5, y: 2.5 }]);
    entityStore(state).buildings.replace([
      { ...state.buildings[0], x: 3, y: 1 },
      { id: 10, kind: 'camp', faction: 0, x: 8, y: 2, hp: 100, maxHp: 100, capacity: 0 },
      { id: 900000, kind: 'house', faction: 0, x: 90, y: 1, hp: 100, maxHp: 100, capacity: 0 },
      ...Array.from({ length: 86 }, (_, i) => i + 5).filter(x => x !== 8).map(x =>
        ({ id: 1000 + x, kind: 'road' as const, faction: 0, x, y: 2, hp: 100, maxHp: 100, capacity: 0 })),
    ]);
    state.fields = [field];
    const from = { x: 7, y: 2 }, to = { x: 8, y: 2 }, before = JSON.stringify(state);
    const preview = previewConstructionRoute(state, 'road', from, to);
    expect(preview.at(-1)).toEqual(to);
    expect(previewConstructionPlan(state, 'road', preview)).toMatchObject({ ok: true, skipped: 0, cost: 10 });
    expect(JSON.stringify(state)).toBe(before);
    expect(planConstruction(state, 'road', preview)).toMatchObject({ ok: false });
    const authoritative = constructionRoute(state, 'road', from, to, true);
    expect(authoritative.at(-1)).toEqual(from);
    expect(buildStroke(state, 'road', authoritative).placed).toBe(0);
    expect(state.buildings.find(building => building.id === 10)).toMatchObject({ x: 8, y: 2 });
    expect(state.fields!.find(candidate => candidate.camp === 10)).toMatchObject({ x: 8, y: 2 });
    expect(state.buildings.some(building => building.kind === 'road' && building.x === 8 && building.y === 2)).toBe(false);
  });

  it.each(['gold', 'forbidden', 'building'] as const)('retains cheap %s checks in road feedback', change => {
    const state = denseConstructionFixture(), points = [{ x: 83, y: 69 }, { x: 84, y: 69 }];
    expect(previewConstructionPlan(state, 'road', points)).toMatchObject({ ok: true, skipped: 0, cost: 10 });
    if (change === 'gold') state.factions[0].gold = 0;
    if (change === 'forbidden') setForbiddenRectangle(state, points[1], points[1], true);
    if (change === 'building') entityStore(state).buildings.add({ id: 900000, kind: 'house', faction: 0,
      ...points[1], hp: 100, maxHp: 100, capacity: 0 });
    expect(previewConstructionPlan(state, 'road', points).skipped).toBeGreaterThan(0);
  });

  it('keeps other building feedback on the ordinary planner', () => {
    const state = denseConstructionFixture(), points = [{ x: 83, y: 68 }];
    expect(previewConstructionPlan(state, 'well', points)).toEqual(planConstruction(state, 'well', points));
  });
});

describe('shared infrastructure gesture feedback', () => {
  it.each(['road', 'irrigation'] as const)('keeps %s geometry stable as funds change and shares route/quote context validation', kind => {
    const state = denseConstructionFixture(), y = kind === 'road' ? 69 : 68;
    const from = { x: 83, y }, to = { x: 87, y };
    const region = vi.spyOn(previewRegion, 'constructionPreviewRegion');
    const contexts = vi.spyOn(previewCache, 'constructionPreviewContext');
    try {
      const first = previewConstructionGesture(state, kind, from, to);
      expect(first.points.at(-1)).toEqual(to);
      expect(first.plan.skipped).toBe(0);
      expect(first.requestedCost).toBe(kind === 'road' ? 40 : 175);
      expect(first.requestedTiles).toBe(kind === 'road' ? 4 : 5);
      expect(region.mock.calls).toHaveLength(1);
      expect(contexts.mock.calls.every(([, selection]) => selection === kind)).toBe(true);
      state.factions[0].gold = kind === 'road' ? 10 : 35;
      const before = JSON.stringify(state), poor = previewConstructionGesture(state, kind, from, to);
      expect(poor.points).toBe(first.points);
      expect(poor.plan.tiles).toHaveLength(1);
      expect(poor.plan.skipped).toBeGreaterThan(0);
      expect(poor.requestedCost).toBe(first.requestedCost);
      expect(poor.message).toMatch(/gold|Extend|freshwater/);
      expect(JSON.stringify(state)).toBe(before);
      state.factions[0].gold = 10000;
      const funded = previewConstructionGesture(state, kind, from, to);
      expect(funded.points).toBe(first.points);
      expect(funded.plan.skipped).toBe(0);
    } finally { region.mockRestore(); contexts.mockRestore(); }
  });

  it.each([false, true])('matches exact irrigation quotes, including reverse growth, without draft/ECS reservations (reverse=%s)', reverse => {
    const state = denseConstructionFixture(), a = { x: 83, y: 68 }, b = { x: 87, y: 68 };
    const points = constructionRoute(state, 'irrigation', reverse ? b : a, reverse ? a : b);
    for (const gold of [0, 70, 10000]) {
      state.factions[0].gold = gold;
      const expected = planConstruction(state, 'irrigation', points), before = JSON.stringify(state);
      const draft = vi.spyOn(previewState, 'constructionPreviewState');
      try {
        expect(previewConstructionPlan(state, 'irrigation', points)).toEqual(expected);
        expect(draft).not.toHaveBeenCalled();
        expect(JSON.stringify(state)).toBe(before);
      } finally { draft.mockRestore(); }
    }
  });

  it('retains irrigation feedback through remote changes but immediately observes local layers and source removal', () => {
    const state = denseConstructionFixture(), from = { x: 83, y: 68 }, to = { x: 85, y: 68 };
    const first = previewConstructionGesture(state, 'irrigation', from, to);
    const display = previewCache.constructionDisplayContext(state, 'irrigation');
    const publicContext = previewCache.constructionPreviewContext(state, 'irrigation');
    entityStore(state).buildings.add({ id: 900000, kind: 'house', faction: 0, x: 2, y: 2, hp: 100, maxHp: 100, capacity: 0 });
    expect(previewCache.constructionDisplayContext(state, 'irrigation')).toBe(display);
    expect(previewCache.constructionPreviewContext(state, 'irrigation')).not.toBe(publicContext);
    expect(previewConstructionGesture(state, 'irrigation', from, to).points).toBe(first.points);
    const crop = state.buildings.find(building => building.kind === 'camp' && building.x === to.x && building.y === to.y)!;
    crop.faction = 1; // Same-array/same-tick editor change must remain visible.
    const blocked = previewConstructionGesture(state, 'irrigation', from, to);
    expect(blocked.points.at(-1)).not.toEqual(to);
    expect(blocked.message).toMatch(/occupied/i);
    state.world.tiles[67 * state.world.width + 83].terrain = 'grassland';
    markWorldChanged(state.world, 'geometry', [67 * state.world.width + 83]);
    expect(previewConstructionGesture(state, 'irrigation', from, to).plan.ok).toBe(false);
    expect(planConstruction(state, 'irrigation', [from])).toMatchObject({ ok: false });
  });
});
