import { describe, expect, it, vi } from 'vitest';
import * as farming from '../src/game/farms';
import { constructionRoute } from '../src/game/construction-route';
import { constructionLine, planConstruction, buildStroke } from '../src/game/construction';
import { createNetworkPlacementQuery } from '../src/game/network-placement';
import { entityStore } from '../src/game/entity-store';
import { setForbiddenRectangle } from '../src/game/forbidden-zones';
import { denseConstructionFixture } from './helpers/construction-preview';

const start = { x: 83, y: 68 }, end = { x: 99, y: 68 };
const irrigation = constructionLine(start, end);

describe('construction previews on a developed map', () => {
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
    expect(buildStroke(state, 'road', path)).toMatchObject({ ok: true, placed: 16, skipped: 0 });
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
