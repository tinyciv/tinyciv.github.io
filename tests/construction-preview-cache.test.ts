import { advanceConstructionReconciliation } from '../src/game/simulation';
import { describe, expect, it, vi } from 'vitest';
import * as farming from '../src/game/farms';
import { constructionRoute } from '../src/game/construction-route';
import { constructionLine, planConstruction, buildStroke } from '../src/game/construction';
import { createNetworkPlacementQuery } from '../src/game/network-placement';
import { entityStore } from '../src/game/entity-store';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { denseConstructionFixture } from './helpers/construction-preview';
import { markWorldChanged } from '../src/game/world-revisions';
import { constructionPreviewContext } from '../src/game/construction-preview-cache';
import { withSimulationReads } from '../src/game/simulation-reads';
import { ensureBuilders } from '../src/game/builders';

const start = { x: 83, y: 68 }, end = { x: 99, y: 68 };
const irrigation = constructionLine(start, end);

describe('construction previews on a developed map', () => {
  it('retains local road quotes through distant routine work but invalidates local blockers', () => {
    const state = denseConstructionFixture(), points = constructionLine({ x: 83, y: 69 }, { x: 85, y: 69 });
    const before = planConstruction(state, 'road', points);
    entityStore(state).buildings.add({ id: 900000, kind: 'road', faction: 0, x: 1, y: 1, hp: 100, maxHp: 100, capacity: 0 });
    state.world.tiles[0].terrain = 'lake'; markWorldChanged(state.world, 'geometry', [0]);
    expect(planConstruction(state, 'road', points)).toBe(before);
    entityStore(state).buildings.add({ id: 900001, kind: 'house', faction: 0, x: 84, y: 69, hp: 100, maxHp: 100, capacity: 0 });
    const blocked = planConstruction(state, 'road', points);
    expect(blocked).not.toBe(before); expect(blocked.skipped).toBeGreaterThan(0);
  });

  it('reconsiders a cached rejected preview at commit when a distant replacement plot opens', () => {
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
    const points = [{ x: 7, y: 2 }, { x: 8, y: 2 }], rejected = planConstruction(state, 'road', points);
    const shortened = constructionRoute(state, 'road', points[0], points[1]);
    expect(rejected.ok).toBe(false);
    expect(shortened.at(-1)).toEqual(points[0]);
    entityStore(state).buildings.retain(building => building.id !== 900000);
    expect(planConstruction(state, 'road', points)).toBe(rejected);
    expect(constructionRoute(state, 'road', points[0], points[1])).toBe(shortened);
    const committedRoute = constructionRoute(state, 'road', points[0], points[1], true);
    expect(committedRoute.at(-1)).toEqual(points[1]);
    expect(buildStroke(state, 'road', committedRoute)).toMatchObject({ ok: true, placed: 1 });
    expect(state.buildings.find(building => building.id === 10)).toMatchObject({ x: 90, y: 1 });
  });

  it('reconciles an explicit paused stroke after the same-step maintenance clock was already sampled', () => {
    const state = denseConstructionFixture();
    withSimulationReads(state, () => { farming.synchronizeFarms(state); farming.ensureCollectors(state); ensureBuilders(state); });
    entityStore(state).units.retain(unit => !unit.builder);
    state.paused = true;
    const time = state.time, gold = state.factions[0].gold;
    const path = constructionLine({ x: 83, y: 69 }, { x: 85, y: 69 });
    expect(buildStroke(state, 'road', path)).toMatchObject({ ok: true, placed: 2, skipped: 0 });
    expect(state.paused).toBe(true); expect(state.time).toBe(time);
    expect(state.factions[0].gold).toBe(gold - 20);
    while (advanceConstructionReconciliation(state)) {}
    expect(state.units.some(unit => unit.builder)).toBe(true);
    expect(state.fields!.some(field => path.some(point => point.x === field.x && point.y === field.y))).toBe(false);
  });

  it('keeps road previews through cosmetic changes and boat movement while bridge previews follow boats', () => {
    const state = denseConstructionFixture();
    const boat = { ...state.units[1], id: 900000, kind: 'sailboat' as const, faction: 0 };
    entityStore(state).units.add(boat);
    const roads = constructionPreviewContext(state, 'road'), bridges = constructionPreviewContext(state, 'bridge');
    state.world.tiles[0].variation += .1; markWorldChanged(state.world, 'appearance', [0]);
    boat.x += 1;
    expect(constructionPreviewContext(state, 'road')).toBe(roads);
    expect(constructionPreviewContext(state, 'bridge')).not.toBe(bridges);
  });

  it('reuses irrigation routes and quotes while units move and game time advances', () => {
    const state = denseConstructionFixture();
    const route = constructionRoute(state, 'irrigation', start, end), plan = planConstruction(state, 'irrigation', route);
    expect(plan).toMatchObject({ ok: true, skipped: 0, cost: 595 });
    for (let frame = 0; frame < 20; frame++) {
      state.time += .1; state.units[1].x += .01;
      expect(constructionRoute(state, 'irrigation', start, end)).toBe(route);
      expect(planConstruction(state, 'irrigation', route)).toBe(plan);
    }
  });

  it('keeps affordable road geometry and quotes while income changes every frame', () => {
    const state = denseConstructionFixture(), from = { x: 83, y: 69 }, to = { x: 99, y: 69 };
    const route = constructionRoute(state, 'road', from, to), plan = planConstruction(state, 'road', route);
    expect(plan).toMatchObject({ ok: true, skipped: 0, cost: 160 });
    for (let frame = 0; frame < 20; frame++) {
      state.time += .03;
      state.factions[0].gold += .1; state.factions[0].food -= .01; state.factions[0].production += .02;
      expect(constructionRoute(state, 'road', from, to)).toBe(route);
      expect(planConstruction(state, 'road', route)).toBe(plan);
    }
    state.factions[0].gold = 5;
    expect(planConstruction(state, 'road', route).skipped).toBeGreaterThan(0);
    state.factions[0].gold = 1000;
    expect(planConstruction(state, 'road', route)).toMatchObject({ ok: true, skipped: 0, cost: 160 });
  });

  it('extends a route shortened by insufficient funds after receiving income', () => {
    const state = denseConstructionFixture(); state.factions[0].gold = 20;
    const from = { x: 83, y: 69 }, to = { x: 89, y: 69 };
    const short = constructionRoute(state, 'road', from, to);
    expect(short.at(-1)).not.toEqual(to);
    state.factions[0].gold = 1000;
    const funded = constructionRoute(state, 'road', from, to);
    expect(funded.at(-1)).toEqual(to);
    expect(planConstruction(state, 'road', funded).skipped).toBe(0);
  });

  it.each(['gold', 'research', 'leader', 'terrain', 'forbidden', 'ownership'] as const)('invalidates immediately after %s changes', change => {
    const state = denseConstructionFixture(), first = planConstruction(state, 'irrigation', irrigation);
    expect(first.skipped).toBe(0);
    if (change === 'gold') state.factions[0].gold = 0;
    if (change === 'research') state.factions[0].research!.levels.irrigation = 0;
    if (change === 'leader') state.units[0].x = 10;
    if (change === 'terrain') { state.world.tiles[start.y * 192 + start.x].terrain = 'lake'; state.world.revision!++; }
    if (change === 'forbidden') setForbiddenRectangle(state, start, end, true);
    if (change === 'ownership') entityStore(state).buildings.add({ id: 99999, kind: 'house', ...start, faction: 1, hp: 100, maxHp: 100, capacity: 2 });
    const next = planConstruction(state, 'irrigation', irrigation);
    expect(next).not.toBe(first);
    if (change === 'terrain') expect(next.cells[0].existing).toBe(true);
    else expect(next.skipped).toBeGreaterThan(0);
  });

  it('rechecks scalar ownership edits to an existing ditch without a world revision', () => {
    const state = denseConstructionFixture();
    const ditch = { id: 99999, kind: 'irrigation' as const, ...start, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(ditch);
    const first = planConstruction(state, 'irrigation', [start]); expect(first.cells[0].existing).toBe(true);
    ditch.faction = 1;
    expect(planConstruction(state, 'irrigation', [start])).toMatchObject({ ok: false, skipped: 1 });
  });

  it('quotes a road across fields without reconciling farms or touching live cargo, clocks or terrain', () => {
    const state = denseConstructionFixture(), path = constructionLine({ x: 83, y: 69 }, { x: 99, y: 69 });
    const before = JSON.stringify(state), reconcile = vi.spyOn(farming, 'synchronizeFarms');
    try {
      const plan = planConstruction(state, 'road', path);
      expect(plan).toMatchObject({ ok: true, skipped: 0, cost: 160 });
      expect(reconcile).not.toHaveBeenCalled();
      expect(JSON.stringify(state)).toBe(before);
      expect(planConstruction(state, 'road', path)).toBe(plan);
    } finally { reconcile.mockRestore(); }
    const farmIds = state.buildings.filter(b => b.kind === 'camp').map(b => b.id);
    const staffing = vi.spyOn(farming, 'ensureCollectors'), synchronize = vi.spyOn(farming, 'synchronizeFarms');
    try {
      expect(buildStroke(state, 'road', path)).toMatchObject({ ok: true, placed: 16, skipped: 0 });
      expect(staffing).not.toHaveBeenCalled();
      while (advanceConstructionReconciliation(state)) {}
      expect(staffing).toHaveBeenCalledTimes(1);
      expect(synchronize).toHaveBeenCalledTimes(2);
    } finally { staffing.mockRestore(); synchronize.mockRestore(); }
    expect(state.buildings.filter(b => b.kind === 'camp').map(b => b.id)).toEqual(farmIds);
    expect(state.fields).toHaveLength(320);
    expect(state.fields!.every(field => !path.some(point => point.x === field.x && point.y === field.y))).toBe(true);
  });

  it('reads the global network once while testing hundreds of reserved search paths', () => {
    const state = denseConstructionFixture(); let reads = 0;
    for (const building of state.buildings) {
      const x = building.x;
      Object.defineProperty(building, 'x', { configurable: true, get: () => { reads++; return x; } });
    }
    const query = createNetworkPlacementQuery(state), initial = reads;
    for (let probe = 0; probe < 200; probe++) query('road', 84 + probe % 15, 69, 0,
      [{ id: -1, kind: 'road', faction: 0, x: 84, y: 69, hp: 1, maxHp: 1, capacity: 0 }]);
    expect(initial).toBeGreaterThan(1000); expect(reads).toBe(initial);
  });
});
